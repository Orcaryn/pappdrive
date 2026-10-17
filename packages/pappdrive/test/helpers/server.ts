// A fake server and R2 for tests. Implements FolderApi, and answers the signed "URLs" through a
// stubbed globalThis.fetch: ETag, If-None-Match, 304, 412 for a blob already stored, size checks at commit.
import type { IndexBody, IndexFile, UploadItem } from "@pappdrive/protocol"
import { ApiError } from "../../src/core/errors.js"
import { decodeBody, sha256, type DataKeys } from "../../src/core/crypto.js"
import { buf, toBase64 } from "../../src/core/bytes.js"
import type { FolderApi } from "../../src/core/types.js"

let hostN = 0
const servers = new Map<string, FakeServer>()
let realFetch: typeof fetch | null = null

function installFetch(): void {
  if (realFetch) return
  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const s = servers.get(url.host)
    if (!s) return realFetch!(input, init)
    return s.handle(url, init ?? {})
  }) as typeof fetch
}

export class FakeServer {
  readonly host = `r2-${++hostN}.test`
  blobs = new Map<string, Uint8Array>()
  index: { text: string; etag: string } | null = null
  private etagN = 0
  private signed = new Map<string, UploadItem>()
  puts: string[] = [] // blob ids stored by PUT (not counting 412s)
  putAttempts = 0
  commits = 0
  indexGets = 0
  /** A failure for the next fetch to R2 (simulates being offline). */
  offline = false
  /** Runs before a commit is checked; may change the server (another device committing first). */
  beforeCommit: ((n: number) => Promise<void> | void) | null = null
  beforeBlobGet: ((id: string) => Promise<void> | void) | null = null
  sawContentLength = false
  sawCacheNoStore = true

  constructor() {
    installFetch()
    servers.set(this.host, this)
  }

  api(): FolderApi {
    return {
      indexLink: async () => ({ url: `https://${this.host}/index`, expires: Date.now() + 7 * 86400_000 }),
      downloadLinks: async (ids) => {
        if (ids.length > 100) throw new ApiError(400, "bad-request")
        return ids.map((id) => ({ id, url: `https://${this.host}/blob/${id}` }))
      },
      uploadLinks: async (items) => {
        if (items.length > 100) throw new ApiError(400, "bad-request")
        return items.map((i) => {
          this.signed.set(i.id, i)
          return {
            id: i.id,
            url: `https://${this.host}/blob/${i.id}`,
            headers: { "content-length": String(i.size), "x-amz-checksum-sha256": i.sha256, "if-none-match": "*" },
          }
        })
      },
      commit: async (index, etag) => this.commit(index, etag),
      history: async () => [],
    }
  }

  async commit(index: IndexFile, etag: string | null): Promise<{ etag: string }> {
    this.commits++
    await this.beforeCommit?.(this.commits)
    if ((this.index?.etag ?? null) !== etag) throw new ApiError(412, "stale")
    const old: Record<string, number> = this.index ? (JSON.parse(this.index.text) as IndexFile).blobs : {}
    const missing: string[] = []
    for (const [id, size] of Object.entries(index.blobs)) {
      if (old[id] !== undefined) {
        if (old[id] !== size) throw new ApiError(422, "missing", { missing: [id] })
        continue
      }
      const b = this.blobs.get(id)
      if (!b || b.length !== size) missing.push(id)
    }
    if (missing.length) throw new ApiError(422, "missing", { missing })
    return { etag: this.writeIndex(index) }
  }

  writeIndex(index: IndexFile): string {
    const etag = `"e${++this.etagN}"`
    this.index = { text: JSON.stringify(index), etag }
    return etag
  }

  async body(keys: DataKeys): Promise<IndexBody> {
    if (!this.index) return {}
    return decodeBody(keys, (JSON.parse(this.index.text) as IndexFile).body)
  }

  header(): Record<string, number> {
    return this.index ? (JSON.parse(this.index.text) as IndexFile).blobs : {}
  }

  async handle(url: URL, init: RequestInit): Promise<Response> {
    if (this.offline) throw new TypeError("fetch failed")
    const method = (init.method ?? "GET").toUpperCase()
    const headers = new Headers(init.headers)
    if (url.pathname === "/index" && method === "GET") {
      this.indexGets++
      if (init.cache !== "no-store") this.sawCacheNoStore = false
      if (!this.index) return new Response("", { status: 404 })
      if (headers.get("if-none-match") === this.index.etag) return new Response(null, { status: 304 })
      return new Response(this.index.text, { status: 200, headers: { ETag: this.index.etag } })
    }
    const m = /^\/blob\/([0-9a-f]{64})$/.exec(url.pathname)
    if (m && method === "PUT") {
      this.putAttempts++
      const id = m[1]!
      if (headers.has("content-length")) this.sawContentLength = true
      const body = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer())
      const signed = this.signed.get(id)
      if (!signed || signed.size !== body.length) return new Response("bad size", { status: 403 })
      if (headers.get("x-amz-checksum-sha256") !== toBase64(await sha256(body))) return new Response("bad checksum", { status: 400 })
      if (headers.get("if-none-match") !== "*") return new Response("unsigned", { status: 403 })
      if (this.blobs.has(id)) return new Response("", { status: 412 })
      this.blobs.set(id, body)
      this.puts.push(id)
      return new Response("", { status: 200 })
    }
    if (m && method === "GET") {
      await this.beforeBlobGet?.(m[1]!)
      const b = this.blobs.get(m[1]!)
      if (!b) return new Response("", { status: 404 })
      return new Response(buf(b), { status: 200 })
    }
    return new Response("", { status: 400 })
  }
}
