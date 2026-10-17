import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type IndexBody, type IndexFile, PART_SIZE } from "@pappdrive/protocol"
import { fromBase64 } from "../../pappdrive/src/core/bytes.js"
import * as c from "../../pappdrive/src/core/crypto.js"
import { ApiError } from "../../pappdrive/src/core/errors.js"
import type { KeyStore } from "../../pappdrive/src/core/types.js"
import type { Prompter } from "../../pappdrive/src/node/prompt.js"
import { normalizeServer, parseArgs, resolveServer, UsageError } from "../src/args.js"
import { Client } from "../src/client.js"
import * as cmd from "../src/commands.js"
import { planExport, runExport } from "../src/export.js"

const scratch: string[] = []
const tmp = (label: string) => {
  const d = mkdtempSync(join(tmpdir(), `pappdrive-cli-${label}-`))
  scratch.push(d)
  return d
}
const savedXdg = process.env.XDG_CONFIG_HOME
beforeAll(() => {
  process.env.XDG_CONFIG_HOME = tmp("config") // never touch the real ~/.config
})
afterAll(() => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
  scratch.forEach((d) => rmSync(d, { recursive: true, force: true }))
})

describe("parseArgs", () => {
  it("parses commands, arguments and flags", () => {
    expect(parseArgs(["signup", "--server", "https://s.x", "--email=a@b.c", "--app", "my-notes"])).toEqual({
      command: "signup",
      args: [],
      flags: { server: "https://s.x", email: "a@b.c", app: "my-notes" },
    })
    expect(parseArgs(["apps", "create", "my-notes"])).toEqual({ command: "apps create", args: ["my-notes"], flags: {} })
    expect(parseArgs(["apps", "list", "--server=https://s.x"]).command).toBe("apps list")
    expect(parseArgs(["export", "my-notes", "./out", "--recovery", "--force"])).toEqual({
      command: "export",
      args: ["my-notes", "./out"],
      flags: { recovery: true, force: true },
    })
    expect(parseArgs(["--email", "a@b.c", "login"]).flags.email).toBe("a@b.c") // flags anywhere
    expect(parseArgs(["export", "a", "--", "--odd-dir"]).args).toEqual(["a", "--odd-dir"])
    expect(parseArgs(["delete-app", "x"]).args).toEqual(["x"])
    expect(parseArgs(["delete-account"]).command).toBe("delete-account")
  })
  it("gives help and version", () => {
    expect(parseArgs([]).command).toBe("help")
    expect(parseArgs(["help"]).command).toBe("help")
    expect(parseArgs(["login", "-h"]).command).toBe("help")
    expect(parseArgs(["--version"]).command).toBe("version")
  })
  it("refuses bad input with a message that says the fix", () => {
    const bad: [string[], RegExp][] = [
      [["frobnicate"], /Unknown command "frobnicate".*pappdrive help/],
      [["apps"], /apps list.*apps create/],
      [["apps", "remove", "x"], /Unknown subcommand "apps remove"/],
      [["apps", "create"], /Missing <name>.*pappdrive apps create <name>/],
      [["export", "a"], /Missing <dir>/],
      [["logout", "extra"], /Too many arguments: extra/],
      [["login", "--server"], /--server needs a value/],
      [["login", "--server="], /--server needs a value/],
      [["login", "--colour"], /Unknown option --colour/],
      [["login", "-x"], /Unknown option -x/],
      [["login", "--force"], /does not take --force/],
      [["export", "a", "b", "--recovery=yes"], /takes no value/],
    ]
    for (const [argv, msg] of bad) {
      expect(() => parseArgs(argv), argv.join(" ")).toThrow(UsageError)
      expect(() => parseArgs(argv), argv.join(" ")).toThrow(msg)
    }
  })
  it("finds the server: flag, then env, then saved; normalized", () => {
    expect(resolveServer("https://a.x/", "https://b.x", "https://c.x")).toBe("https://a.x")
    expect(resolveServer(undefined, "https://b.x/v1", "https://c.x")).toBe("https://b.x")
    expect(resolveServer(undefined, "", "https://c.x/base/")).toBe("https://c.x/base")
    expect(() => resolveServer(undefined, undefined, undefined)).toThrow(/--server.*PAPPDRIVE_SERVER/)
    expect(() => normalizeServer("sync.example.com")).toThrow(/full address/)
    expect(() => normalizeServer("ftp://x")).toThrow(/http or https/)
  })
})

describe("planExport", () => {
  const e = (id = "a".repeat(64)) => ({ id, size: 1, mtime: 0 })
  it("skips what cannot be written, with reasons", () => {
    const body: IndexBody = {
      "ok.md": e(),
      "notes/a.md": e(),
      "Notes/b.md": e(),
      "Todo.md": e(),
      "todo.md": e(),
      notes: e(),
      "../evil": e(),
      ".pappdrive/x": e(),
      "a:b.md": e(),
    }
    const insensitive = planExport(body, { caseInsensitive: true, canCreate: (s) => !s.includes(":") })
    expect(insensitive.items.map((i) => i.path).sort()).toEqual(["Notes/b.md", "Todo.md", "notes/a.md", "ok.md"])
    const reasons = Object.fromEntries(insensitive.skipped.map((s) => [s.path, s.reason]))
    expect(reasons["todo.md"]).toMatch(/only in capital letters/)
    expect(reasons["notes"]).toMatch(/folder has the same name/)
    expect(reasons["../evil"]).toMatch(/not a valid path/)
    expect(reasons[".pappdrive/x"]).toMatch(/reserved/)
    expect(reasons["a:b.md"]).toMatch(/cannot create the name "a:b.md"/)
    const sensitive = planExport(body, { caseInsensitive: false, canCreate: () => true })
    expect(sensitive.items.map((i) => i.path)).toContain("todo.md")
    expect(sensitive.items.map((i) => i.path)).toContain("a:b.md")
  })
})

// ---------- A fake server and storage, in memory ----------

const PARAMS = { m: 256, t: 1, p: 1 } // fast Argon2 for tests

interface Fake {
  fetch: typeof fetch
  requests: { route: string; body: unknown; auth: string | null }[]
  setFolder(index: IndexFile | null, blobs: Map<string, Uint8Array>): void
  signup?: Record<string, unknown>
}

function fakeServer(): Fake {
  let index: IndexFile | null = null
  let blobs = new Map<string, Uint8Array>()
  const fake: Fake = {
    requests: [],
    setFolder(i, b) {
      index = i
      blobs = b
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } })
      if (url.host === "r2.test") {
        if (url.pathname === "/index") return index ? json(index) : new Response("", { status: 404 })
        const b = blobs.get(url.pathname.slice(1))
        return b ? new Response(new Uint8Array(b)) : new Response("", { status: 404 })
      }
      const route = url.pathname.replace(/^\/v1/, "") + url.search
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      const auth = new Headers(init?.headers).get("authorization")
      fake.requests.push({ route, body, auth })
      if (route === "/auth/params") return json(PARAMS)
      if (route === "/auth/signup") {
        fake.signup = body
        return json({ accessToken: "acc", refreshToken: "ref", installId: "inst" })
      }
      if (route === "/auth/login") {
        if (body.loginKey !== fake.signup?.loginKey) return json({ error: "credentials" }, 401)
        return json({ accessToken: "acc", refreshToken: "ref2", installId: "inst2", passwordCopy: fake.signup?.passwordCopy })
      }
      if (route === "/auth/refresh") return json({ accessToken: "acc" })
      if (route === "/auth/logout") return new Response(null, { status: 204 })
      if (route === "/apps" && init?.method === "GET") return json([{ name: "my-notes", created: 0 }])
      if (route === "/apps") return body.name === "taken" ? json({ error: "exists" }, 409) : new Response(null, { status: 201 })
      if (route.startsWith("/index/link")) return json({ url: "https://r2.test/index", expires: Date.now() + 1e6 })
      if (route.startsWith("/blobs/download")) return json((body as string[]).map((id) => ({ id, url: `https://r2.test/${id}` })))
      if (route === "/app/delete" || route === "/account/delete") return new Response(null, { status: 204 })
      return json({ error: "bad-request" }, 400)
    }) as typeof fetch,
  }
  return fake
}

function memoryKeyStore(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async (n) => data.get(n) ?? null,
    set: async (n, v) => void data.set(n, v),
    delete: async (n) => void data.delete(n),
  }
}

/** Answers questions by matching their text; collects everything said. */
function fakePrompter(answer: (q: string, said: string) => string): Prompter & { said: () => string } {
  let text = ""
  return {
    said: () => text,
    ask: async (q, fallback) => {
      text += q
      const a = answer(q, text)
      return a === "" && fallback !== undefined ? fallback : a
    },
    askHidden: async (q) => {
      text += q
      return answer(q, text)
    },
    say: (t) => void (text += t + "\n"),
    close: () => {},
  }
}

function ctxFor(fake: Fake, p: Prompter, flags: cmd.Ctx["flags"] = {}): cmd.Ctx & { lines: string[] } {
  const lines: string[] = []
  return {
    server: "https://sync.test",
    flags,
    config: {},
    client: new Client("https://sync.test", fake.fetch),
    keyStore: memoryKeyStore(),
    p,
    out: (l) => void lines.push(l),
    status: () => {},
    lines,
  }
}

const PASSWORD = "correct horse battery staple"

describe("commands against a fake server", () => {
  it("signup sends the keys and locked copies, saves the sign-in, and requires the code's last group", async () => {
    const fake = fakeServer()
    const p = fakePrompter((q, said) => {
      if (q.startsWith("Email")) return "Me@Example.com"
      if (q.startsWith("Password") || q.startsWith("Type it again")) return PASSWORD
      if (q.includes("last group")) {
        const code = said.match(/[0-9A-Z]{5}(-[0-9A-Z]{5}){3}-[0-9A-Z]{6}/)![0]
        return said.includes("does not match") ? code.split("-").pop()!.toLowerCase() : "nope"
      }
      throw new Error(`unexpected question ${q}`)
    })
    const ctx = ctxFor(fake, p, { app: "my-notes" })
    await cmd.signup(ctx)
    const s = fake.signup as Record<string, string>
    expect(s.email).toBe("me@example.com")
    expect(s.app).toBe("my-notes")
    expect(s.read).toEqual([])
    expect(fromBase64(s.loginKey!).length).toBe(32)
    expect(fromBase64(s.recoveryLoginKey!).length).toBe(32)
    // The password copy opens with the password key, so a later login gets the data key.
    const pk = await c.deriveFromPassword("me@example.com", PASSWORD, PARAMS)
    expect((await c.unlockDataKey(s.passwordCopy!, pk.passwordKey)).length).toBe(32)
    expect(p.said()).toContain("does not match")
    expect(p.said()).toContain("Recovery code confirmed")
    const saved = JSON.parse([...(ctx.keyStore as ReturnType<typeof memoryKeyStore>).data.values()][0]!)
    expect(saved).toEqual({ email: "me@example.com", refreshToken: "ref", installId: "inst" })
    expect(ctx.lines.join("\n")).toContain('The app "my-notes" is created')
  })

  it("apps list and create use the saved sign-in; errors say the fix", async () => {
    const fake = fakeServer()
    const ctx = ctxFor(fake, fakePrompter(() => ""))
    await (ctx.keyStore as KeyStore).set("pappdrive-cli:https://sync.test", JSON.stringify({ email: "a@b.c", refreshToken: "r", installId: "i" }))
    await cmd.appsList(ctx)
    expect(ctx.lines.join("\n")).toContain("my-notes")
    await cmd.appsCreate(ctx, "journal")
    expect(fake.requests.filter((r) => r.route === "/apps").at(-1)).toMatchObject({ body: { name: "journal" }, auth: "Bearer acc" })
    const err = await cmd.appsCreate(ctx, "taken").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(cmd.describeError(err, ctx.server, "create", "taken")).toMatch(/already have an app named "taken"/)
    await expect(cmd.appsCreate(ctx, "Bad Name")).rejects.toThrow(/lowercase letters, digits and -/)
  })

  it("maps rate limits, no-app and network failures to plain words", async () => {
    const limited = new Client("https://s.test", (async () =>
      new Response(JSON.stringify({ error: "rate-limited" }), { status: 429, headers: { "Retry-After": "37" } })) as unknown as typeof fetch)
    const e = await limited.params("a@b.c").catch((x: unknown) => x)
    expect((e as ApiError).retryAfter).toBe(37)
    expect(cmd.describeError(e, "https://s.test", "login")).toBe("Too many tries. Wait 37 seconds, then run the command again.")
    expect(cmd.describeError(new ApiError(404, "no-app"), "https://s.test", "export", "notes")).toMatch(/pappdrive apps create notes/)
    const down = new Client("https://s.test", (async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch)
    const n = await down.params("a@b.c").catch((x: unknown) => x)
    expect(cmd.describeError(n, "https://s.test")).toMatch(/Could not reach https:\/\/s.test/)
  })

  it("delete-app needs the name typed back before anything is sent", async () => {
    const fake = fakeServer()
    const ctx = ctxFor(fake, fakePrompter((q) => (q.includes("type the app's name") ? "wrong" : "")))
    await expect(cmd.deleteApp(ctx, "my-notes")).rejects.toThrow(/Nothing was deleted/)
    expect(fake.requests).toHaveLength(0)
    expect(ctx.lines.join("\n")).toMatch(/pappdrive export my-notes <folder>/)
  })
})

describe("export", () => {
  let keys: c.DataKeys
  let index: IndexFile
  let blobs: Map<string, Uint8Array>
  let big: Uint8Array
  const mtime = 1760690000000

  beforeAll(async () => {
    keys = await c.dataKeys(c.newDataKey())
    blobs = new Map()
    const header: Record<string, number> = {}
    const put = async (pt: Uint8Array) => {
      const id = await c.blobId(keys, pt)
      const blob = await c.encryptBlob(keys, pt)
      blobs.set(id, blob)
      header[id] = blob.length
      return id
    }
    big = new Uint8Array(PART_SIZE + 5)
    for (let i = 0; i < big.length; i += 4096) big[i] = (i / 4096) & 0xff
    const parts = [await put(big.subarray(0, PART_SIZE)), await put(big.subarray(PART_SIZE))]
    const small = new TextEncoder().encode("hello")
    const body: IndexBody = {
      "notes/todo.md": { id: await put(small), size: 5, mtime },
      "empty.txt": { id: await put(new Uint8Array(0)), size: 0, mtime },
      ["Café/thé.md".normalize("NFC")]: { id: await put(small), size: 5, mtime },
      "video/talk.bin": { id: await c.bigFileId(keys, parts), size: big.length, mtime, parts },
    }
    index = { v: 1, blobs: header, body: await c.encodeBody(keys, body) }
  })

  const run = (dir: string, fake: Fake, force = false) =>
    runExport({ client: new Client("https://sync.test", fake.fetch), token: "acc", app: "my-notes", dir, keys, force, log: () => {}, fetchFn: fake.fetch })

  it("downloads and decrypts every file, big files in parts, with their modified times", async () => {
    const fake = fakeServer()
    fake.setFolder(index, blobs)
    const dir = join(tmp("export"), "out")
    const r = await run(dir, fake)
    expect(r.failed).toEqual([])
    expect(r.written).toBe(4)
    expect(readFileSync(join(dir, "notes", "todo.md"), "utf8")).toBe("hello")
    expect(readFileSync(join(dir, "empty.txt")).length).toBe(0)
    expect(readFileSync(join(dir, "Café".normalize("NFC"), "thé.md".normalize("NFC")), "utf8")).toBe("hello")
    expect(Buffer.compare(readFileSync(join(dir, "video", "talk.bin")), Buffer.from(big))).toBe(0)
    expect(Math.round(statSync(join(dir, "notes", "todo.md")).mtimeMs)).toBe(mtime)
    expect(readdirSync(dir).sort()).toEqual(["Café".normalize("NFC"), "empty.txt", "notes", "video"]) // temp folder gone
    // Links come in batches, not one call per blob, and always for <app>.
    const linkCalls = fake.requests.filter((q) => q.route.startsWith("/blobs/download"))
    expect(linkCalls.every((q) => q.route === "/blobs/download?app=my-notes")).toBe(true)
    expect(linkCalls.length).toBeLessThanOrEqual(3)
  })

  it("refuses a non-empty folder without --force; with it, skips files already exported", async () => {
    const fake = fakeServer()
    fake.setFolder(index, blobs)
    const dir = tmp("export-force")
    writeFileSync(join(dir, "other.txt"), "x")
    await expect(run(dir, fake)).rejects.toThrow(/not empty.*--force/)
    expect((await run(dir, fake, true)).written).toBe(4)
    const again = await run(dir, fake, true)
    expect(again.written).toBe(0)
    expect(again.unchanged).toBe(4)
  })

  it("reports a blob that does not match its id, and keeps going", async () => {
    const fake = fakeServer()
    const tampered = new Map(blobs)
    const [first] = [...tampered.keys()]
    const other = [...tampered.values()].at(-1)!
    tampered.set(first!, other) // wrong contents under the first id
    fake.setFolder(index, tampered)
    const dir = join(tmp("export-bad"), "out")
    const r = await run(dir, fake)
    expect(r.failed.length).toBeGreaterThan(0)
    expect(r.written + r.failed.length).toBe(4)
    expect(r.failed[0]!.reason).toMatch(/does not match its id|did not decrypt/)
  })

  it("an app with no index exports nothing", async () => {
    const fake = fakeServer()
    fake.setFolder(null, new Map())
    expect((await run(join(tmp("export-empty"), "out"), fake)).empty).toBe(true)
  })

  it("export command: signs in without an app, reading <app>, and signs that install out after", async () => {
    const fake = fakeServer()
    // An account made by signup, whose data key encrypted the folder.
    const pk = await c.deriveFromPassword("me@example.com", PASSWORD, PARAMS)
    const { toBase64 } = await import("../../pappdrive/src/core/bytes.js")
    fake.signup = { loginKey: toBase64(pk.loginKey), passwordCopy: await c.lockDataKey(keys.raw, pk.passwordKey) }
    fake.setFolder(index, blobs)
    const dir = join(tmp("export-cmd"), "out")
    mkdirSync(dir)
    let tries = 0
    const ctx = ctxFor(
      fake,
      fakePrompter((q) => (q.startsWith("Email") ? "me@example.com" : tries++ === 0 ? "wrong password!" : PASSWORD)),
    )
    await cmd.exportApp(ctx, "my-notes", dir)
    const logins = fake.requests.filter((q) => q.route === "/auth/login")
    expect(logins).toHaveLength(2) // one wrong password, then the right one
    expect(logins[1]!.body).toMatchObject({ email: "me@example.com", read: ["my-notes"] })
    expect((logins[1]!.body as Record<string, unknown>).app).toBeUndefined()
    expect(fake.requests.at(-1)).toMatchObject({ route: "/auth/logout", auth: "Bearer acc" })
    expect(readFileSync(join(dir, "notes", "todo.md"), "utf8")).toBe("hello")
    expect(ctx.lines.join("\n")).toContain("Wrong email or password")
    expect(ctx.lines.join("\n")).toContain("Exported 4 files")
  })
})
