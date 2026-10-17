// Direct calls to R2 through signed links. The server is not in these calls.
// See spec 04-server.md (Reading the index, Upload link) and 12-implementation.md (Upload links, Index).
import type { IndexFile, UploadLink } from "@pappdrive/protocol"
import { buf } from "./bytes.js"
import { SyncError } from "./errors.js"

/** A failed answer from R2 itself (not from the server). */
export class R2Error extends Error {
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`network: R2 answered ${status} to ${what}. The next sync tries again.`)
    this.name = "R2Error"
  }
}

async function call(url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new SyncError("network", `Could not reach storage to ${what}. Check the connection; the next sync tries again.`)
  }
}

export type IndexFetch =
  | { kind: "unchanged" }
  | { kind: "missing" }
  | { kind: "found"; index: IndexFile; etag: string }

/** GETs the index with the cache off, sending the ETag it has. 304: unchanged. 404: no index. */
export async function getIndex(url: string, etag: string | null): Promise<IndexFetch> {
  const headers: Record<string, string> = {}
  if (etag) headers["If-None-Match"] = etag
  const res = await call(url, { cache: "no-store", headers }, "read the index")
  if (res.status === 304) return { kind: "unchanged" }
  if (res.status === 404) return { kind: "missing" }
  if (!res.ok) throw new R2Error(res.status, "reading the index")
  const tag = res.headers.get("ETag")
  let index: IndexFile
  try {
    index = (await res.json()) as IndexFile
  } catch {
    throw new SyncError("server", "The folder's index is not valid JSON. The next sync reads it again.")
  }
  if (!index || typeof index !== "object" || index.v !== 1) {
    throw new SyncError(
      "update-needed",
      `The folder's index has format version ${String((index as { v?: unknown })?.v)}, which this version of pappdrive does not know. ` +
        `Sync has stopped so nothing is overwritten. Update the pappdrive package, then open the folder again.`,
    )
  }
  if (!tag) throw new SyncError("server", "Storage did not send the index's ETag. Check that the bucket's CORS rules expose the ETag header.")
  return { kind: "found", index, etag: tag }
}

/**
 * PUTs a blob with the signed headers. Content-Length is left out: fetch sets it from the body,
 * and browsers refuse to let a page set it. R2's 412 means "already stored": success.
 */
export async function putBlob(link: UploadLink, data: Uint8Array): Promise<void> {
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(link.headers)) if (k.toLowerCase() !== "content-length") headers[k] = v
  const res = await call(link.url, { method: "PUT", headers, body: buf(data) }, "upload a blob")
  if (res.ok || res.status === 412) return
  throw new R2Error(res.status, "uploading a blob")
}

export async function getBlob(url: string): Promise<Uint8Array> {
  const res = await call(url, {}, "download a blob")
  if (!res.ok) throw new R2Error(res.status, "downloading a blob")
  return new Uint8Array(await res.arrayBuffer())
}
