import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { afterAll, describe, expect, it } from "vitest"
import { SyncError } from "../src/core/errors.js"
import { IgnoreRules } from "../src/core/ignore.js"
import type { Papp } from "../src/core/types.js"
import { openNodeFs } from "../src/node/fs.js"
import { createPrompter, explainAuthError, signInPrompt } from "../src/node/prompt.js"
import { loadParcelWatcher, nodeWatcher } from "../src/node/watcher.js"

const scratch: string[] = []
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })))

const hasWatcher = (await loadParcelWatcher()) !== null

describe.runIf(hasWatcher)("node watcher", () => {
  it("reports changed paths as relative NFC hints, and skips ignored folders", async () => {
    const root = mkdtempSync(join(tmpdir(), "pappdrive-watch-"))
    scratch.push(root)
    const fs = await openNodeFs(root, "visible")
    mkdirSync(join(root, "node_modules"))
    const seen = new Set<string>()
    let dropped = 0
    const stop = await nodeWatcher.start(fs, new IgnoreRules().watcherSkipGlobs(), (ps) => ps.forEach((p) => seen.add(p)), () => dropped++)
    try {
      await new Promise((r) => setTimeout(r, 300))
      mkdirSync(join(root, "notes"))
      writeFileSync(join(root, "notes", "Café.md".normalize("NFD")), "x")
      writeFileSync(join(root, "node_modules", "dep.js"), "x")
      await fs.saveState("synced", "{}")
      const until = Date.now() + 5000
      while (!seen.has("notes/Café.md".normalize("NFC")) && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
      await new Promise((r) => setTimeout(r, 300))
    } finally {
      await stop()
    }
    expect(seen.has("notes/Café.md".normalize("NFC"))).toBe(true)
    expect([...seen].some((p) => p.startsWith("node_modules"))).toBe(false)
    expect([...seen].some((p) => p.startsWith(".pappdrive"))).toBe(false)
    expect(dropped).toBe(0)
  })
})

/** A prompter fed with the given lines, collecting what it says. */
function scripted(lines: string[]) {
  const input = new PassThrough()
  const output = new PassThrough()
  let text = ""
  output.on("data", (d) => (text += String(d)))
  input.end(lines.join("\n") + "\n")
  return { prompter: createPrompter(input, output), said: () => text }
}

function fakePapp(over: Partial<Papp>): Papp & { calls: string[] } {
  const calls: string[] = []
  const base = {
    ready: Promise.resolve(),
    signedIn: false,
    calls,
    async signIn(email: string, pw: string) {
      calls.push(`signIn ${email} ${pw}`)
    },
    async signUp(email: string, pw: string) {
      calls.push(`signUp ${email} ${pw}`)
      return { recoveryCode: "ABCDE-FGHJK-MNPQR-STVWX-YZ0123" }
    },
    async recover(email: string, code: string, pw: string) {
      calls.push(`recover ${email} ${code} ${pw}`)
    },
  }
  return Object.assign(base, over) as unknown as Papp & { calls: string[] }
}

describe("terminal sign-in form", () => {
  it("signs in, retrying after a wrong password", async () => {
    let tries = 0
    const papp = fakePapp({})
    papp.signIn = async (email, pw) => {
      papp.calls.push(`signIn ${email} ${pw}`)
      if (tries++ === 0) throw new SyncError("credentials", "wrong")
    }
    const s = scripted(["", "me@x.com", "bad password", "1", "me@x.com", "good password"])
    await signInPrompt(papp, s.prompter)
    expect(papp.calls).toEqual(["signIn me@x.com bad password", "signIn me@x.com good password"])
    expect(s.said()).toContain("Wrong email or password")
    expect(s.said()).not.toContain("good password") // the password is not echoed
  })

  it("signs up: refuses a short password, then requires the last group of the recovery code", async () => {
    const papp = fakePapp({})
    const s = scripted(["2", "not an email", "me@x.com", "short", "long enough pw", "long enough pw", "WRONG", "yz0i23"])
    await signInPrompt(papp, s.prompter)
    expect(papp.calls).toEqual(["signUp me@x.com long enough pw"])
    const out = s.said()
    expect(out).toContain("ABCDE-FGHJK-MNPQR-STVWX-YZ0123")
    expect(out).toContain("does not look like an email")
    expect(out).toContain("Use at least 12")
    expect(out).toContain("That does not match")
    expect(out).toContain("Recovery code confirmed")
  })

  it("recovers with the code and a new password", async () => {
    const papp = fakePapp({})
    const s = scripted(["3", "me@x.com", "abcde-fghjk-mnpqr-stvwx-yz0123", "a brand new pass", "a brand new pass"])
    await signInPrompt(papp, s.prompter)
    expect(papp.calls).toEqual(["recover me@x.com abcde-fghjk-mnpqr-stvwx-yz0123 a brand new pass"])
  })

  it("returns at once when already signed in, and fails clearly when input runs out", async () => {
    await signInPrompt(fakePapp({ signedIn: true }), scripted([]).prompter)
    await expect(signInPrompt(fakePapp({}), scripted(["1"]).prompter)).rejects.toThrow(/No more input/)
  })

  it("explains errors in plain words", () => {
    expect(explainAuthError(new SyncError("rate-limited", "x", { retryAfter: 42 }))).toBe("Too many tries. Wait 42 seconds, then try again.")
    expect(explainAuthError(new SyncError("exists", "x"))).toContain("already exists")
    expect(explainAuthError(new SyncError("weak-password", "x"))).toContain("12 characters")
    expect(explainAuthError(new SyncError("no-app", "Create it with `npx pappdrive-cli apps create my-notes`."))).toContain(
      "apps create my-notes",
    )
    expect(explainAuthError(new SyncError("no-app", "No app."))).toContain("pappdrive apps create")
    expect(explainAuthError(new SyncError("credentials", "x"), "recovery")).toContain("recovery code")
  })
})
