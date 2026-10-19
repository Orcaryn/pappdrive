export const utf8 = new TextEncoder();
export const fromUtf8 = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';

  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);

  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i);
  }

  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = '';

  for (const b of bytes) {
    s += b.toString(16).padStart(2, '0');
  }

  return s;
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);

  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;

  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }

  return out;
}

export function withPlainBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes);
}
