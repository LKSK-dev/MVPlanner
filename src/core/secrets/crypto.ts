/**
 * WebCrypto primitives for the secret store (task T8.12; spec plan/07 §7.7,
 * plan/08 §8.3).
 *
 * Secrets are wrapped with **AES-GCM** under a key **derived from a passphrase
 * via PBKDF2 (SHA-256)**. AES-GCM is authenticated, so a wrong key (wrong
 * passphrase) fails the decrypt with an exception rather than returning garbage
 * — that is how {@link import('./secret-store').SecretStore.unlock} verifies a
 * passphrase. All crypto goes through the injected {@link CryptoProvider} so the
 * store is unit-testable against the node/global `crypto.subtle` (or a fake).
 */

/** Default PBKDF2 iteration count (OWASP-aligned for PBKDF2-HMAC-SHA256). */
export const DEFAULT_PBKDF2_ITERATIONS = 210_000;

/** AES-GCM IV length in bytes (96-bit, the recommended GCM nonce size). */
export const AES_GCM_IV_BYTES = 12;

/** PBKDF2 salt length in bytes. */
export const PBKDF2_SALT_BYTES = 16;

/** AES-GCM key length in bits. */
const AES_KEY_BITS = 256;

/**
 * The crypto surface the secret store needs, narrowed for injection. The
 * default ({@link defaultCryptoProvider}) wraps the ambient `globalThis.crypto`.
 */
export interface CryptoProvider {
  /** WebCrypto subtle interface (PBKDF2 + AES-GCM). */
  readonly subtle: SubtleCrypto;
  /** Cryptographically-strong random fill (salts + IVs). */
  getRandomValues<T extends ArrayBufferView<ArrayBuffer>>(array: T): T;
}

/** Raised when WebCrypto is unavailable in the host environment. */
export class SecretsCryptoUnavailableError extends Error {
  constructor() {
    super('WebCrypto (crypto.subtle) is unavailable; secrets cannot be encrypted');
    this.name = 'SecretsCryptoUnavailableError';
  }
}

/**
 * Build the default {@link CryptoProvider} from the ambient `globalThis.crypto`.
 *
 * @throws {SecretsCryptoUnavailableError} when `crypto.subtle` is absent (e.g. a
 *   non-secure context); callers surface this as a clear "secrets unavailable"
 *   state rather than silently storing plaintext.
 */
export function defaultCryptoProvider(): CryptoProvider {
  const ambient = (globalThis as { crypto?: Crypto }).crypto;
  if (!ambient || typeof ambient.subtle === 'undefined') {
    throw new SecretsCryptoUnavailableError();
  }
  const c = ambient;
  return {
    subtle: c.subtle,
    getRandomValues<T extends ArrayBufferView<ArrayBuffer>>(array: T): T {
      return c.getRandomValues(array);
    },
  };
}

/** Allocate `n` cryptographically-random bytes via the provider. */
export function randomBytes(provider: CryptoProvider, n: number): Uint8Array<ArrayBuffer> {
  return provider.getRandomValues(new Uint8Array(n));
}

/** Encode a string to fresh ArrayBuffer-backed UTF-8 bytes (WebCrypto-ready). */
export function utf8Bytes(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const out = new Uint8Array(encoded.length);
  out.set(encoded);
  return out;
}

/**
 * Derive a non-extractable AES-GCM {@link CryptoKey} from `passphrase` + `salt`
 * via PBKDF2-HMAC-SHA256. An empty passphrase is permitted (obfuscation-level
 * "device" wrapping); a user passphrase strengthens it.
 */
export async function deriveAesKey(
  provider: CryptoProvider,
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await provider.subtle.importKey('raw', utf8Bytes(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return provider.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** AES-GCM encrypt `plaintext` under `key` with `iv`. */
export async function aesGcmEncrypt(
  provider: CryptoProvider,
  key: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const ct = await provider.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return new Uint8Array(ct);
}

/**
 * AES-GCM decrypt `ciphertext` under `key` with `iv`.
 *
 * @throws when authentication fails (wrong key / tampered ciphertext) — the
 *   caller treats this as a wrong-passphrase / corrupt-record condition.
 */
export async function aesGcmDecrypt(
  provider: CryptoProvider,
  key: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  ciphertext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const pt = await provider.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(pt);
}
