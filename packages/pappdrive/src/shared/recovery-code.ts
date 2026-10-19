import { fromHex, toHex } from './bytes.js';
import { SyncError } from './errors.js';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BITS_PER_CHAR = 5;
const CODE_BITS = 128;
const CODE_CHARS = Math.ceil(CODE_BITS / BITS_PER_CHAR);
const FIRST_CHAR_VALUES = 2 ** (CODE_BITS - (CODE_CHARS - 1) * BITS_PER_CHAR);

export function formatRecoveryCode(code: Uint8Array): string {
  let n = BigInt('0x' + toHex(code));
  let s = '';

  for (let i = 0; i < CODE_CHARS; i++) {
    s = CROCKFORD_BASE32[Number(n & 31n)] + s;
    n >>= 5n;
  }

  return [s.slice(0, 5), s.slice(5, 10), s.slice(10, 15), s.slice(15, 20), s.slice(20)].join('-');
}

export function foldRecoveryCode(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export function parseRecoveryCode(text: string): Uint8Array {
  const s = foldRecoveryCode(text);

  if (s.length !== CODE_CHARS || [...s].some(c => !CROCKFORD_BASE32.includes(c)) || CROCKFORD_BASE32.indexOf(s.charAt(0)) >= FIRST_CHAR_VALUES) {
    throw new SyncError('credentials', `That recovery code is not valid. Check it against the saved copy: ${CODE_CHARS} letters and digits.`);
  }

  let n = 0n;

  for (const c of s) {
    n = (n << 5n) | BigInt(CROCKFORD_BASE32.indexOf(c));
  }

  return fromHex(n.toString(16).padStart(CODE_BITS / 4, '0'));
}
