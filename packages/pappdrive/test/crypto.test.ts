import { describe, expect, it } from "vitest"
import * as c from "../src/core/crypto.js"

describe("crypto", () => {
  it("round-trips blobs, bodies, locked copies and recovery codes", async () => {
    const keys = await c.dataKeys(c.randomBytes(32))
    const pt = new TextEncoder().encode("hello")
    const id = await c.blobId(keys, pt)
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    const blob = await c.encryptBlob(keys, pt)
    expect(blob.length).toBe(pt.length + 29)
    expect(new TextDecoder().decode(await c.decryptBlob(keys, blob, id))).toBe("hello")
    const body = { "a.md": { id, size: 5, mtime: 1 } }
    expect(await c.decodeBody(keys, await c.encodeBody(keys, body))).toEqual(body)
    const lock = c.randomBytes(32)
    expect(await c.unlockDataKey(await c.lockDataKey(keys.raw, lock), lock)).toEqual(keys.raw)
    const code = c.randomBytes(16)
    const text = c.formatRecoveryCode(code)
    expect(text).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}-[0-9A-Z]{6}$/)
    expect(c.parseRecoveryCode(text.toLowerCase())).toEqual(code)
    expect(await c.bigFileId(keys, [id, id])).not.toBe(id)
  })
  it("derives login and password keys", async () => {
    const a = await c.deriveFromPassword(" Sagi@X.com", "correct horse battery", { m: 1024, t: 1, p: 1 })
    const b = await c.deriveFromPassword("sagi@x.com", "correct horse battery", { m: 1024, t: 1, p: 1 })
    expect(a.loginKey).toEqual(b.loginKey)
    expect(a.loginKey).not.toEqual(a.passwordKey)
  })
})
