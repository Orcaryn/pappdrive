export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));

  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function fromBase64(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(s)) {
    return null;
  }

  const t = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');

  if (t.length % 4 === 1) {
    return null;
  }

  return Uint8Array.from(atob(t.padEnd(Math.ceil(t.length / 4) * 4, '=')), c => c.charCodeAt(0));
}
