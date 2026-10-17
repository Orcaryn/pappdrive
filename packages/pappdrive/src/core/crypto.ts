// All crypto. WebCrypto everywhere, except Argon2id (hash-wasm).
// See spec 07-encryption.md and 12-implementation.md, Crypto and Formats.
import { argon2id } from "hash-wasm"
import {
  ARGON2_HASH_LENGTH,
  type Argon2Params,
  type IndexBody,
  normalizeEmail,
  SALT_PREFIX,
} from "@pappdrive/protocol"
import { buf, concat, fromBase64, fromUtf8, toBase64, toHex, fromHex, utf8 } from "./bytes.js"
import { SyncError } from "./errors.js"

const subtle = globalThis.crypto.subtle
const BLOB_VERSION = 1
const COPY_VERSION = 1

export function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n))
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest("SHA-256", buf(data)))
}

async function hkdf(ikm: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"])
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8.encode(info) },
    key,
    256,
  )
  return new Uint8Array(bits)
}

function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey("raw", buf(raw), "AES-GCM", false, ["encrypt", "decrypt"])
}

function hmacKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey("raw", buf(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
}

// ---------- Password and recovery code ----------

export interface PasswordKeys {
  loginKey: Uint8Array // sent to the server
  passwordKey: Uint8Array // locks the password copy, never leaves the device
}

export async function deriveFromPassword(email: string, password: string, params: Argon2Params): Promise<PasswordKeys> {
  const salt = await sha256(utf8.encode(SALT_PREFIX + normalizeEmail(email)))
  const out = await argon2id({
    password: password.normalize("NFC"),
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: "binary",
  })
  return {
    loginKey: await hkdf(out, "pappdrive login key"),
    passwordKey: await hkdf(out, "pappdrive password key"),
  }
}

export interface RecoveryKeys {
  recoveryLoginKey: Uint8Array
  recoveryKey: Uint8Array
}

export async function deriveFromRecovery(code: Uint8Array): Promise<RecoveryKeys> {
  return {
    recoveryLoginKey: await hkdf(code, "pappdrive recovery login key"),
    recoveryKey: await hkdf(code, "pappdrive recovery key"),
  }
}

// Recovery code: 128 random bits as 26 Crockford base32 characters, in groups 5-5-5-5-6.
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function newRecoveryCode(): Uint8Array {
  return randomBytes(16)
}

export function formatRecoveryCode(code: Uint8Array): string {
  let n = BigInt("0x" + toHex(code))
  let s = ""
  for (let i = 0; i < 26; i++) {
    s = B32[Number(n & 31n)] + s
    n >>= 5n
  }
  return [s.slice(0, 5), s.slice(5, 10), s.slice(10, 15), s.slice(15, 20), s.slice(20)].join("-")
}

export function parseRecoveryCode(text: string): Uint8Array {
  const s = text
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
  if (s.length !== 26 || [...s].some((c) => !B32.includes(c)) || B32.indexOf(s[0]!) > 7) {
    throw new SyncError("credentials", "That recovery code is not valid. Check it against the saved copy: 26 letters and digits.")
  }
  let n = 0n
  for (const c of s) n = (n << 5n) | BigInt(B32.indexOf(c))
  return fromHex(n.toString(16).padStart(32, "0"))
}

/** The last group of a formatted code. The sign-up form asks the user to type it back. */
export function lastRecoveryGroup(formatted: string): string {
  return formatted.split("-").pop()!
}

// ---------- Data key ----------

export interface DataKeys {
  raw: Uint8Array // 32 bytes, stored on the device
  enc: CryptoKey // AES-256-GCM
  blobId: CryptoKey // HMAC-SHA256 for blob ids
  fileId: CryptoKey // HMAC-SHA256 for file ids of big files
}

export function newDataKey(): Uint8Array {
  return randomBytes(32)
}

export async function dataKeys(raw: Uint8Array): Promise<DataKeys> {
  return {
    raw,
    enc: await aesKey(await hkdf(raw, "pappdrive encrypt")),
    blobId: await hmacKey(await hkdf(raw, "pappdrive blob id")),
    fileId: await hmacKey(await hkdf(raw, "pappdrive file id")),
  }
}

/** The data key, locked with the password key or the recovery key. Base64. */
export async function lockDataKey(dataKey: Uint8Array, lockKey: Uint8Array): Promise<string> {
  const nonce = randomBytes(12)
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, await aesKey(lockKey), buf(dataKey)))
  return toBase64(concat(new Uint8Array([COPY_VERSION]), nonce, ct))
}

export async function unlockDataKey(copy: string, lockKey: Uint8Array): Promise<Uint8Array> {
  const bytes = fromBase64(copy)
  if (bytes[0] !== COPY_VERSION) throw new SyncError("update-needed", "The locked key has an unknown format. Update pappdrive.")
  try {
    const pt = await subtle.decrypt({ name: "AES-GCM", iv: buf(bytes.subarray(1, 13)) }, await aesKey(lockKey), buf(bytes.subarray(13)))
    return new Uint8Array(pt)
  } catch {
    throw new SyncError("credentials", "The password or recovery code does not open this account's key.")
  }
}

// ---------- Blobs ----------

export async function blobId(keys: DataKeys, plaintext: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await subtle.sign("HMAC", keys.blobId, buf(plaintext))))
}

/** File id of a big file: HMAC of its part ids in order, each as 32 raw bytes. */
export async function bigFileId(keys: DataKeys, partIds: string[]): Promise<string> {
  const raw = concat(...partIds.map(fromHex))
  return toHex(new Uint8Array(await subtle.sign("HMAC", keys.fileId, buf(raw))))
}

/** Layout: version byte, 12-byte nonce, ciphertext with 16-byte tag. */
export async function encryptBlob(keys: DataKeys, plaintext: Uint8Array): Promise<Uint8Array> {
  const nonce = randomBytes(12)
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, keys.enc, buf(plaintext)))
  return concat(new Uint8Array([BLOB_VERSION]), nonce, ct)
}

/** Decrypts and checks the result against the expected blob id. */
export async function decryptBlob(keys: DataKeys, blob: Uint8Array, expectedId?: string): Promise<Uint8Array> {
  if (blob[0] !== BLOB_VERSION) throw new SyncError("update-needed", "A blob has an unknown format. Update pappdrive.")
  let pt: Uint8Array
  try {
    pt = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: buf(blob.subarray(1, 13)) }, keys.enc, buf(blob.subarray(13))))
  } catch {
    throw new SyncError("server", "A downloaded blob did not decrypt. It will be fetched again on the next sync.")
  }
  if (expectedId !== undefined && (await blobId(keys, pt)) !== expectedId) {
    throw new SyncError("server", "A downloaded blob does not match its id. It will be fetched again on the next sync.")
  }
  return pt
}

// ---------- Index body ----------

async function pipeThrough(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([buf(data)]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

/** JSON, then gzip, then AES-256-GCM with a random 12-byte nonce in front, then base64. */
export async function encodeBody(keys: DataKeys, body: IndexBody): Promise<string> {
  const gz = await pipeThrough(utf8.encode(JSON.stringify(body)), new CompressionStream("gzip"))
  const nonce = randomBytes(12)
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, keys.enc, buf(gz)))
  return toBase64(concat(nonce, ct))
}

export async function decodeBody(keys: DataKeys, b64: string): Promise<IndexBody> {
  const bytes = fromBase64(b64)
  let gz: Uint8Array
  try {
    gz = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: buf(bytes.subarray(0, 12)) }, keys.enc, buf(bytes.subarray(12))))
  } catch {
    throw new SyncError("server", "The index did not decrypt with this account's key.")
  }
  return JSON.parse(fromUtf8.decode(await pipeThrough(gz, new DecompressionStream("gzip")))) as IndexBody
}
