/**
 * Dependency-free base64 codec for raw bytes (task T8.12; spec plan/07 §7.7).
 *
 * The {@link import('./secret-store').SecretStore} persists salt / IV /
 * ciphertext as base64 strings so the stored records are plain
 * structured-clone-safe JSON (portable + trivially exportable) rather than
 * relying on `Uint8Array` round-tripping through every storage backend. This is
 * a small, self-contained implementation (no `btoa`/`atob`, no `Buffer`) so it
 * behaves identically in the browser single-file build and the node test
 * harness.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Reverse lookup: char code → 6-bit value (or `-1` for non-alphabet bytes). */
const LOOKUP = ((): Int8Array => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Encode raw bytes to a standard (padded) base64 string. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1] as number;
    const b2 = bytes[i + 2] as number;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out +=
      `${ALPHABET[(n >>> 18) & 63] as string}${ALPHABET[(n >>> 12) & 63] as string}` +
      `${ALPHABET[(n >>> 6) & 63] as string}${ALPHABET[n & 63] as string}`;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const b0 = bytes[i] as number;
    const n = b0 << 16;
    out += `${ALPHABET[(n >>> 18) & 63] as string}${ALPHABET[(n >>> 12) & 63] as string}==`;
  } else if (rem === 2) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1] as number;
    const n = (b0 << 16) | (b1 << 8);
    out += `${ALPHABET[(n >>> 18) & 63] as string}${ALPHABET[(n >>> 12) & 63] as string}${
      ALPHABET[(n >>> 6) & 63] as string
    }=`;
  }
  return out;
}

/**
 * Decode a standard base64 string to raw bytes.
 *
 * @throws {Error} when the input contains characters outside the base64
 *   alphabet (after stripping `=` padding) — a corrupt/forged record.
 */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/[=]+$/u, '');
  const outLen = Math.floor((clean.length * 6) / 8);
  const out = new Uint8Array(outLen);
  let bits = 0;
  let value = 0;
  let p = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const six = code < 128 ? (LOOKUP[code] as number) : -1;
    if (six < 0) {
      throw new Error('invalid base64 input');
    }
    value = (value << 6) | six;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (value >>> bits) & 0xff;
    }
  }
  return out;
}
