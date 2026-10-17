import { describe, expect, it } from "vitest"
import { formatRecoveryCode, lastRecoveryGroup, newRecoveryCode } from "../src/core/crypto.js"
import { SyncError } from "../src/core/errors.js"
import { errorInfo, errorText, matchesGroup, passwordTooShort } from "../src/ui/messages.js"

describe("sign-in form texts", () => {
  it("reads the code from a SyncError, and from a message that crossed Electron IPC", () => {
    expect(errorInfo(new SyncError("credentials", "Wrong email or password.")).code).toBe("credentials")
    const ipc = new Error("Error invoking remote method 'papp:signIn': SyncError: rate-limited: Too many tries. Wait 42 seconds, then try again.")
    expect(errorInfo(ipc)).toMatchObject({ code: "rate-limited", retryAfter: 42 })
    expect(errorInfo(new TypeError("Failed to fetch")).code).toBe("network")
  })

  it("says each error in plain words", () => {
    expect(errorText(new SyncError("credentials", "x"), "sign-in")).toMatchObject({ text: expect.stringMatching(/^Wrong email or password/), field: "password" })
    expect(errorText(new SyncError("credentials", "x"), "recover").field).toBe("code")
    expect(errorText(new SyncError("exists", "x"), "sign-up")).toMatchObject({ text: expect.stringMatching(/already exists/), field: "email" })
    expect(errorText(new SyncError("weak-password", "x"), "sign-up").text).toMatch(/at least 12 characters/)
    expect(errorText(new SyncError("rate-limited", "x", { retryAfter: 90 }), "sign-in").text).toBe("Too many tries. Wait 2 minutes, then try again.")
    expect(errorText(new SyncError("rate-limited", "x", { retryAfter: 1 }), "sign-in").text).toMatch(/Wait 1 second,/)
    expect(errorText(new SyncError("network", "x"), "sign-in").text).toMatch(/offline/)
    expect(errorText(new Error("boom"), "sign-in", { online: false }).text).toMatch(/offline/)
  })

  it("names the command that creates a missing app", () => {
    const fromLib = new SyncError(
      "no-app",
      'The app "my-notes" does not exist in this account. Create it first with the command-line tool: npx pappdrive-cli apps create my-notes (installed: pappdrive apps create my-notes). Then sign in again.',
    )
    expect(errorText(fromLib, "sign-in")).toMatchObject({ text: expect.stringContaining('"my-notes" is not created yet'), command: "npx pappdrive-cli apps create my-notes" })
    expect(errorText(new SyncError("no-app", "missing"), "sign-in", { app: "journal" }).command).toBe("pappdrive apps create journal")
  })

  it("checks the typed-back group of the recovery code", () => {
    const code = formatRecoveryCode(newRecoveryCode())
    const group = lastRecoveryGroup(code)
    expect(matchesGroup(group.toLowerCase(), group)).toBe(true)
    expect(matchesGroup(` ${group} `, group)).toBe(true)
    expect(matchesGroup("", group)).toBe(false)
    expect(matchesGroup("ZZZZZZ", "ZZZZZY")).toBe(false)
    expect(matchesGroup("1o1L1i", "101111")).toBe(true) // Crockford: O is 0, I and L are 1
  })

  it("refuses passwords under 12 characters", () => {
    expect(passwordTooShort("elevenchars")).toBe(true)
    expect(passwordTooShort("twelve chars")).toBe(false)
  })
})
