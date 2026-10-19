import { argon2id } from 'hash-wasm';
import { type Argon2Params, type DeltaBody, type IndexBody, normalizeEmail } from '@pappdrive/protocol';
import { withPlainBuffer, concat, fromBase64, toBase64, toHex, fromHex, utf8 } from './bytes.js';
import { SyncError } from './errors.js';

const subtle = globalThis.crypto.subtle;
const BLOB_VERSION = 1;
const COPY_VERSION = 1;
const HMAC = { name: 'HMAC', hash: 'SHA-256' };

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

async function hkdf(ikm: Uint8Array, info: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await subtle.importKey('raw', withPlainBuffer(ikm), 'HKDF', false, ['deriveBits']);

  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8.encode(info) }, key, 256));
}

export async function deriveFromPassword(email: string, password: string, params: Argon2Params) {
  const salt = new Uint8Array(await subtle.digest('SHA-256', utf8.encode('pappdrive|' + normalizeEmail(email))));
  const out = await argon2id({
    password: password.normalize('NFC'),
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: 'binary',
  });

  return { loginKey: await hkdf(out, 'pappdrive login key'), passwordKey: await hkdf(out, 'pappdrive password key') };
}

export async function deriveFromRecovery(code: Uint8Array) {
  return { recoveryLoginKey: await hkdf(code, 'pappdrive recovery login key'), recoveryKey: await hkdf(code, 'pappdrive recovery key') };
}

export interface DataKeys {
  enc: CryptoKey;
  blobId: CryptoKey;
  fileId: CryptoKey;
}

export async function dataKeys(raw: Uint8Array): Promise<DataKeys> {
  return {
    enc: await subtle.importKey('raw', await hkdf(raw, 'pappdrive encrypt'), 'AES-GCM', false, ['encrypt', 'decrypt']),
    blobId: await subtle.importKey('raw', await hkdf(raw, 'pappdrive blob id'), HMAC, false, ['sign']),
    fileId: await subtle.importKey('raw', await hkdf(raw, 'pappdrive file id'), HMAC, false, ['sign']),
  };
}

export async function lockDataKey(dataKey: Uint8Array, lockKey: Uint8Array): Promise<string> {
  const key = await subtle.importKey('raw', withPlainBuffer(lockKey), 'AES-GCM', false, ['encrypt']);

  return toBase64(concat(new Uint8Array([COPY_VERSION]), await seal(key, dataKey)));
}

export async function unlockDataKey(copy: string, lockKey: Uint8Array): Promise<Uint8Array> {
  const bytes = fromBase64(copy);

  if (bytes[0] !== COPY_VERSION) {
    throw new SyncError('update-needed', 'The locked key has an unknown format. Update pappdrive.');
  }

  const key = await subtle.importKey('raw', withPlainBuffer(lockKey), 'AES-GCM', false, ['decrypt']);

  return unseal(key, bytes.subarray(1), new SyncError('credentials', "The password or recovery code does not open this account's key."));
}

export async function blobId(keys: DataKeys, plaintext: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await subtle.sign('HMAC', keys.blobId, withPlainBuffer(plaintext))));
}

export async function bigFileId(keys: DataKeys, partIds: string[]): Promise<string> {
  return toHex(new Uint8Array(await subtle.sign('HMAC', keys.fileId, concat(...partIds.map(fromHex)))));
}

export async function encryptBlob(keys: DataKeys, plaintext: Uint8Array): Promise<Uint8Array> {
  return concat(new Uint8Array([BLOB_VERSION]), await seal(keys.enc, plaintext));
}

export async function decryptBlob(keys: DataKeys, blob: Uint8Array, expectedId: string): Promise<Uint8Array> {
  if (blob[0] !== BLOB_VERSION) {
    throw new SyncError('update-needed', 'A blob has an unknown format. Update pappdrive.');
  }

  const plaintext = await unseal(keys.enc, blob.subarray(1), new SyncError('server', 'A downloaded blob did not decrypt. It will be fetched again on the next sync.'));

  if ((await blobId(keys, plaintext)) !== expectedId) {
    throw new SyncError('server', 'A downloaded blob does not match its id. It will be fetched again on the next sync.');
  }

  return plaintext;
}

type Body = IndexBody | DeltaBody;

export async function encodeBody(keys: DataKeys, body: Body): Promise<string> {
  const gzip = new Blob([JSON.stringify(body)]).stream().pipeThrough(new CompressionStream('gzip'));

  return toBase64(await seal(keys.enc, new Uint8Array(await new Response(gzip).arrayBuffer())));
}

export async function decodeBody<T extends Body>(keys: DataKeys, b64: string): Promise<T> {
  const gzip = await unseal(keys.enc, fromBase64(b64), new SyncError('server', "The index did not decrypt with this account's key."));

  return (await new Response(new Blob([gzip]).stream().pipeThrough(new DecompressionStream('gzip'))).json()) as T;
}

async function seal(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = randomBytes(12);

  return concat(nonce, new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, withPlainBuffer(plaintext))));
}

async function unseal(key: CryptoKey, sealed: Uint8Array, failure: SyncError): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = withPlainBuffer(sealed);

  return subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)).then(
    plain => new Uint8Array(plain),
    () => {
      throw failure;
    }
  );
}
