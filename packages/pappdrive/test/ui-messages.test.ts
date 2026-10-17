import { describe, expect, it } from "vitest"
import { formatRecoveryCode, randomBytes } from "../src/core/crypto.js"
import { SyncError } from "../src/core/errors.js"
import { errorText, matchesGroup } from "../src/ui/index.js"

describe("sign-in form texts", () => {
  it("says each error in plain words", () => {
    expect(errorText(new SyncError("credentials", "x"), "sign-in")).toMatchObject({ text: expect.stringMatching(/^Wrong email or password/), field: "password" })
    expect(errorText(new SyncError("credentials", "x"), "recover").field).toBe("code")
    expect(errorText(new SyncError("exists", "x"), "sign-up")).toMatchObject({ text: expect.stringMatching(/already exists/), field: "email" })
    expect(errorText(new SyncError("weak-password", "x"), "sign-up").text).toMatch(/at least 12 characters/)
    expect(errorText(new SyncError("rate-limited", "x", { retryAfter: 90 }), "sign-in").text).toBe("Too many tries. Wait 2 minutes, then try again.")
    expect(errorText(new SyncError("rate-limited", "x", { retryAfter: 1 }), "sign-in").text).toMatch(/Wait 1 second,/)
    expect(errorText(new SyncError("network", "x"), "sign-in").text).toMatch(/offline/)
    expect(errorText(new Error("boom"), "sign-in").text).toBe("Something went wrong: boom")
  })

  it("names the command that creates a missing app", () => {
    const fromLib = new SyncError(
      "no-app",
      'The app "my-notes" does not exist in this account. Create it first with the command-line tool: npx pappdrive-cli apps create my-notes (installed: pappdrive apps create my-notes). Then sign in again.',
    )
    expect(errorText(fromLib, "sign-in")).toMatchObject({ text: expect.stringContaining('"my-notes" is not created yet'), command: "npx pappdrive-cli apps create my-notes" })
  })

  it("checks the typed-back group of the recovery code", () => {
    const code = formatRecoveryCode(randomBytes(16))
    const group = code.split("-").pop()!
    expect(matchesGroup(group.toLowerCase(), group)).toBe(true)
    expect(matchesGroup(` ${group} `, group)).toBe(true)
    expect(matchesGroup("", group)).toBe(false)
    expect(matchesGroup("ZZZZZZ", "ZZZZZY")).toBe(false)
    expect(matchesGroup("1o1L1i", "101111")).toBe(true) // Crockford: O is 0, I and L are 1
  })
})
