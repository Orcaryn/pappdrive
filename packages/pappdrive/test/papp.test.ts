import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_ARGON2, type Argon2Params, type GoneReason } from "@pappdrive/protocol"
import type { Folder, FolderContext, KeyStore, Platform, Status } from "../src/core/types.js"

// ---------- Mock sync engine ----------

const opened: { ctx: FolderContext; folder: Folder }[] = []
vi.mock("../src/core/folder.js", () => ({
  openFolder: (ctx: FolderContext): Folder => {
    const status: Status = { syncing: false, lastSync: null, pending: 0, skipped: [], deleted: null }
    const folder = {
      readOnly: ctx.readOnly,
      status,
      start: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      markDeleted: vi.fn(async (reason: GoneReason) => {
        status.deleted = reason
      }),
    } as unknown as Folder
    opened.push({ ctx, folder })
    return folder
  },
}))

const { createPappCore, SyncError } = await import("../src/core/index.js")

// ---------- Fake server ----------

const LOW: Argon2Params = { m: 1024, t: 1, p: 1 }
const SERVER = "https://sync.test"

interface User {
  userId: string
  loginKey: string
  recoveryLoginKey: string
  params: Argon2Params
  passwordCopy: string
  recoveryCopy: string
  apps: Set<string>
}
interface Install {
  userId: string
  app: string
  read: string[]
  stopped?: GoneReason
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

class FakeServer {
  users = new Map<string, User>()
  installs = new Map<string, Install>() // by refresh token
  calls: string[] = []
  accessSeconds = 3600
  rateLimitNext = false
  expireNext = false // next authed call answers 401 expired once
  n = 0

  token(refresh: string, inst: Install): string {
    const exp = Math.floor(Date.now() / 1000) + this.accessSeconds
    return `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: inst.userId, app: inst.app, install: refresh, read: inst.read, exp }))}.sig`
  }

  issue(userId: string, app: string, read: string[]) {
    const refreshToken = `rt${++this.n}`
    const inst = { userId, app, read }
    this.installs.set(refreshToken, inst)
    return { accessToken: this.token(refreshToken, inst), refreshToken, installId: `inst${this.n}` }
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const path = url.pathname.replace(/^\/v1/, "")
    this.calls.push(`${init?.method ?? "GET"} ${path}${url.search}`)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const json = (status: number, data?: unknown, headers: Record<string, string> = {}) =>
      new Response(data === undefined ? null : JSON.stringify(data), { status, headers })
    const err = (status: number, error: string, extra: object = {}, headers: Record<string, string> = {}) =>
      json(status, { error, ...extra }, headers)
    if (this.rateLimitNext && path.startsWith("/auth/") && path !== "/auth/refresh") {
      this.rateLimitNext = false
      return err(429, "rate-limited", {}, { "retry-after": "30" })
    }
    const checkApps = (u: User, names: string[]) => names.every((n) => u.apps.has(n))
    switch (path) {
      case "/auth/params":
        return json(200, this.users.get(body.email)?.params ?? LOW)
      case "/auth/signup": {
        if (this.users.has(body.email)) return err(409, "exists")
        const u: User = {
          userId: `user${++this.n}`,
          loginKey: body.loginKey,
          recoveryLoginKey: body.recoveryLoginKey,
          params: LOW,
          passwordCopy: body.passwordCopy,
          recoveryCopy: body.recoveryCopy,
          apps: new Set(body.app ? [body.app] : []),
        }
        if (!checkApps(u, body.read)) return err(404, "no-app")
        this.users.set(body.email, u)
        return json(200, this.issue(u.userId, body.app ?? "", body.read))
      }
      case "/auth/login":
      case "/auth/recover": {
        const u = this.users.get(body.email)
        const ok = path === "/auth/login" ? u?.loginKey === body.loginKey : u?.recoveryLoginKey === body.recoveryLoginKey
        if (!u || !ok) return err(401, "credentials")
        if (body.app && !u.apps.has(body.app)) return err(404, "no-app")
        if (!checkApps(u, body.read)) return err(404, "no-app")
        const t = this.issue(u.userId, body.app ?? "", body.read)
        return json(200, path === "/auth/login" ? { ...t, passwordCopy: u.passwordCopy } : { ...t, recoveryCopy: u.recoveryCopy })
      }
      case "/auth/refresh": {
        const inst = this.installs.get(body.refreshToken)
        if (!inst) return err(401, "credentials")
        if (inst.stopped) return err(410, "gone", { reason: inst.stopped })
        if (body.read) inst.read = body.read
        return json(200, { accessToken: this.token(body.refreshToken, inst) })
      }
      case "/app/delete":
      case "/account/delete": {
        const u = this.users.get(body.email)
        if (!u || u.loginKey !== body.loginKey) return err(401, "credentials")
        for (const inst of this.installs.values()) {
          if (inst.userId !== u.userId) continue
          if (path === "/account/delete") inst.stopped = "account"
          else if (inst.app === body.app) inst.stopped = "app"
        }
        if (path === "/account/delete") this.users.delete(body.email)
        else u.apps.delete(body.app)
        return json(204)
      }
    }
    // Authed routes
    const auth = (init?.headers as Record<string, string> | undefined)?.["authorization"]
    const claims = auth ? JSON.parse(atob(auth.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) : null
    if (!claims || claims.exp < Date.now() / 1000 || this.expireNext) {
      this.expireNext = false
      return err(401, "expired")
    }
    const inst = this.installs.get(claims.install)
    const user = [...this.users.values()].find((u) => u.userId === claims.sub)
    switch (path) {
      case "/auth/password":
        if (!user) return err(401, "expired")
        user.loginKey = body.loginKey
        user.passwordCopy = body.passwordCopy
        user.params = DEFAULT_ARGON2
        return json(204)
      case "/auth/logout":
        this.installs.delete(claims.install)
        return json(204)
      case "/index/link": {
        const app = url.searchParams.get("app")
        if (app && !claims.read.includes(app)) return err(403, "not-allowed")
        if (inst?.stopped) return err(410, "gone", { reason: inst.stopped })
        return json(200, { url: `https://r2.test/${claims.sub}/${app ?? claims.app}/index`, expires: Date.now() + 1000 })
      }
      case "/blobs/download":
        return json(200, (body as string[]).map((id) => ({ id, url: `https://r2.test/${id}` })))
    }
    return err(400, "bad-request")
  }
}

function memoryStore(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async (n) => data.get(n) ?? null,
    set: async (n, v) => void data.set(n, v),
    delete: async (n) => void data.delete(n),
  }
}

function platform(store: KeyStore): Platform & { persist: ReturnType<typeof vi.fn> } {
  return {
    name: "node",
    defaultKeyStore: () => store,
    openPrivate: vi.fn(async (_u: string, _a: string, readFor?: string) => ({ kind: "private", readFor }) as never),
    openVisible: vi.fn(async (path: string) => ({ kind: "visible", path }) as never),
    persist: vi.fn(async () => {}),
  }
}

let server: FakeServer
beforeEach(() => {
  server = new FakeServer()
  opened.length = 0
  vi.stubGlobal("fetch", server.fetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const EMAIL = "Sagi@Example.com"
const PW = "correct horse battery"

function device(opts: { app?: string; read?: string[]; store?: KeyStore } = {}) {
  const store = opts.store ?? memoryStore()
  const p = platform(store)
  const papp = createPappCore({ server: SERVER + "/", app: opts.app ?? "notes", read: opts.read }, p)
  return { papp, store: store as ReturnType<typeof memoryStore>, platform: p }
}

async function storedKey(store: ReturnType<typeof memoryStore>): Promise<string> {
  const v = [...store.data.values()][0]
  return JSON.parse(v!).dataKey
}

async function errorOf(p: Promise<unknown>): Promise<InstanceType<typeof SyncError>> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(SyncError)
    return e as InstanceType<typeof SyncError>
  }
  throw new Error("expected a SyncError")
}

// ---------- Tests ----------

describe("account layer", () => {
  it("signs up, and a second device signs in to the same data key", async () => {
    const a = device()
    await a.papp.ready
    expect(a.papp.signedIn).toBe(false)
    const { recoveryCode } = await a.papp.signUp(EMAIL, PW)
    expect(recoveryCode).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}-[0-9A-Z]{6}$/)
    expect(a.papp.signedIn).toBe(true)
    expect(a.platform.persist).toHaveBeenCalled()
    expect([...a.store.data.keys()]).toEqual(["pappdrive:https://sync.test:notes"])

    const b = device()
    await b.papp.ready
    await b.papp.signIn("sagi@example.com", PW)
    expect(await storedKey(b.store)).toBe(await storedKey(a.store))
    expect(await errorOf(device().papp.signIn(EMAIL, "wrong password!!"))).toMatchObject({ code: "credentials" })
  })

  it("restores the session on ready", async () => {
    const store = memoryStore()
    await device({ store }).papp.signUp(EMAIL, PW)
    const again = device({ store })
    await again.papp.ready
    expect(again.papp.signedIn).toBe(true)
    await again.papp.open({ mode: "private" })
    await opened[0]!.ctx.api.indexLink()
    expect(server.calls.slice(-2)).toEqual(["POST /auth/refresh", "GET /index/link"])
  })

  it("recovers with the code and sets a new password; the old one then fails", async () => {
    const { papp, store } = device()
    const { recoveryCode } = await papp.signUp(EMAIL, PW)
    const key = await storedKey(store)
    const other = device()
    await other.papp.recover(EMAIL, recoveryCode.toLowerCase(), "a brand new password")
    expect(await storedKey(other.store)).toBe(key)
    expect(await errorOf(device().papp.signIn(EMAIL, PW))).toMatchObject({ code: "credentials" })
    const third = device()
    await third.papp.signIn(EMAIL, "a brand new password")
    expect(await storedKey(third.store)).toBe(key)
    expect(await errorOf(device().papp.recover(EMAIL, "00000-00000-00000-00000-000000", "a brand new password"))).toMatchObject({
      code: "credentials",
    })
  }, 30_000)

  it("setPassword changes the password on a signed-in device", async () => {
    const { papp } = device()
    await papp.signUp(EMAIL, PW)
    await papp.setPassword("another long password")
    expect(server.users.get("sagi@example.com")!.params).toEqual(DEFAULT_ARGON2)
    await device().papp.signIn(EMAIL, "another long password")
    expect(await errorOf(papp.setPassword("short"))).toMatchObject({ code: "weak-password" })
  }, 30_000)

  it("refuses weak passwords before calling the server", async () => {
    const e = await errorOf(device().papp.signUp(EMAIL, "short"))
    expect(e.code).toBe("weak-password")
    expect(e.message).toContain("12")
    expect(server.calls).toEqual([])
  })

  it("maps exists, no-app, rate-limited and network", async () => {
    await device().papp.signUp(EMAIL, PW)
    expect(await errorOf(device().papp.signUp(EMAIL, PW))).toMatchObject({ code: "exists" })
    const noApp = await errorOf(device({ app: "journal" }).papp.signIn(EMAIL, PW))
    expect(noApp.code).toBe("no-app")
    expect(noApp.message).toContain("apps create journal")
    server.rateLimitNext = true
    expect(await errorOf(device().papp.signIn(EMAIL, PW))).toMatchObject({ code: "rate-limited", retryAfter: 30 })
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed")
    })
    expect(await errorOf(device().papp.signIn(EMAIL, PW))).toMatchObject({ code: "network" })
  })

  it("refreshes on 401 expired and retries once", async () => {
    const { papp } = device()
    await papp.signUp(EMAIL, PW)
    await papp.open({ mode: "private" })
    const api = opened[0]!.ctx.api
    server.expireNext = true
    const link = await api.indexLink()
    expect(link.url).toContain("/notes/index")
    expect(server.calls.slice(-3)).toEqual(["GET /index/link", "POST /auth/refresh", "GET /index/link"])
  })

  it("refreshes a token that is about to expire before the call", async () => {
    server.accessSeconds = 30
    const { papp } = device()
    await papp.signUp(EMAIL, PW)
    await papp.open({ mode: "private" })
    await opened[0]!.ctx.api.indexLink()
    expect(server.calls.slice(-2)).toEqual(["POST /auth/refresh", "GET /index/link"])
  })

  it("410 on refresh runs the gone flow and clears the key store", async () => {
    const a = device()
    await a.papp.signUp(EMAIL, PW)
    const b = device()
    await b.papp.signIn(EMAIL, PW)
    const files = await b.papp.open({ mode: "private" })
    expect(await b.papp.open({ mode: "private" })).toBe(files)
    await a.papp.deleteAccount(PW)
    expect(a.store.data.size).toBe(0)
    expect(await opened[0]!.ctx.checkGone()).toBe("gone")
    expect(opened[0]!.folder.markDeleted).toHaveBeenCalledWith("account")
    expect(b.store.data.size).toBe(0)
    expect(b.papp.signedIn).toBe(false)
    expect(b.papp.files.status.deleted).toBe("account")
    expect(await errorOf(b.papp.open({ mode: "private" }))).toMatchObject({ code: "signed-out" })
  })

  it("deleteApp deletes the app on this device and others learn it on their next call", async () => {
    const a = device()
    await a.papp.signUp(EMAIL, PW)
    const fa = await a.papp.open({ mode: "private" })
    const b = device()
    await b.papp.signIn(EMAIL, PW)
    await b.papp.open({ mode: "visible", path: "/tmp/notes" })
    expect(await errorOf(a.papp.deleteApp("wrong password!!"))).toMatchObject({ code: "credentials" })
    await a.papp.deleteApp(PW)
    expect(fa.status.deleted).toBe("app")
    expect(a.store.data.size).toBe(0)
    expect(a.papp.signedIn).toBe(false)
    // b's token is fresh, so it only learns at its next refresh
    server.expireNext = true
    expect(await errorOf(opened[1]!.ctx.api.indexLink())).toMatchObject({ code: "gone", reason: "app" })
    expect(opened[1]!.folder.markDeleted).toHaveBeenCalledWith("app")
    expect(b.store.data.size).toBe(0)
  })

  it("open needs a session; files needs open", async () => {
    const { papp } = device()
    await papp.ready
    expect(await errorOf(papp.open({ mode: "private" }))).toMatchObject({ code: "signed-out" })
    expect(() => papp.files).toThrow(/await papp.open/)
  })

  it("openReadOnly: only names in read, uses ?app=, refuses writes", async () => {
    const notes = device()
    await notes.papp.signUp(EMAIL, PW)
    const dash = device({ app: "dash", read: ["notes"] })
    // "dash" does not exist yet: the fake server needs it created
    server.users.get("sagi@example.com")!.apps.add("dash")
    await dash.papp.signIn(EMAIL, PW)
    const e = await errorOf(dash.papp.openReadOnly("journal"))
    expect(e.code).toBe("not-allowed")
    expect(e.message).toContain("read")
    const ro = await dash.papp.openReadOnly("notes")
    expect(await dash.papp.openReadOnly("notes")).toBe(ro)
    const { ctx } = opened[0]!
    expect(ctx).toMatchObject({ app: "notes", readOnly: true })
    expect(dash.platform.openPrivate).toHaveBeenCalledWith(expect.stringMatching(/^user/), "dash", "notes")
    await ctx.api.indexLink()
    await ctx.api.downloadLinks(["a".repeat(64)])
    expect(server.calls.slice(-2)).toEqual(["GET /index/link?app=notes", "POST /blobs/download?app=notes"])
    expect(await errorOf(ctx.api.commit({ v: 1, blobs: {}, body: "" }, null))).toMatchObject({ code: "read-only" })
    expect(await errorOf(ctx.api.uploadLinks([]))).toMatchObject({ code: "read-only" })
  })

  it("signOut logs out, closes folders and deletes the key store entry", async () => {
    const { papp, store } = device()
    await papp.signUp(EMAIL, PW)
    await papp.open({ mode: "private" })
    await papp.signOut()
    expect(server.calls).toContain("POST /auth/logout")
    expect(opened[0]!.folder.close).toHaveBeenCalled()
    expect(store.data.size).toBe(0)
    expect(papp.signedIn).toBe(false)
  })

  it("a refresh token stopped on the server signs out locally", async () => {
    server.accessSeconds = 0
    const { papp, store } = device()
    await papp.signUp(EMAIL, PW)
    server.installs.clear()
    expect(await errorOf(papp.open({ mode: "private" }).then(() => opened[0]!.ctx.api.indexLink()))).toMatchObject({
      code: "signed-out",
    })
    expect(store.data.size).toBe(0)
  })

  it("signInPrompt throws without a terminal", async () => {
    expect(await errorOf(device().papp.signInPrompt())).toMatchObject({ code: "signed-out" })
  })
})
