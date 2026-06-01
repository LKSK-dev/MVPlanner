# `core/secrets` — encrypted-at-rest secret store (T8.12)

Spec: plan/07 §7.7 (security & privacy of stored data), plan/08 §8.3 (security).

Wraps the app's secrets — MAVLink v2 signing keys and map/tile provider API
keys — with WebCrypto so a casual disk read can never lift a plaintext secret.

## Crypto

- **PBKDF2-HMAC-SHA256** derives a 256-bit AES key from a passphrase + a random
  16-byte salt (`DEFAULT_PBKDF2_ITERATIONS = 210_000`).
- **AES-GCM** (96-bit random IV per record) encrypts each secret. GCM is
  authenticated: a wrong key/passphrase fails the decrypt, which is how
  `unlock()` verifies a passphrase (via a stored verifier token).
- Only **ciphertext** (base64) is persisted to the injected `KvStore`. The
  derived key is non-extractable and held in memory only while unlocked.

## Passphrase

The passphrase is **optional**. `unlock()` with no argument uses the empty
passphrase — an obfuscation-level "device" wrap (encrypted, but the key is
derivable by anyone who can run the app). A real passphrase via `unlock(pw)` /
`rekey(pw)` provides meaningful at-rest protection. The UI surfaces this.

## API

```ts
const store = createSecretStore({ storage: kv /* , crypto, iterations */ });
await store.unlock(passphrase?);   // seed on first use, verify thereafter
store.lock();                      // drop the in-memory key
await store.set(id, bytesOrString);
await store.get(id);               // Uint8Array | undefined
await store.getString(id);         // string | undefined
await store.has(id) / store.list();
await store.clear(id?);            // one secret, or wipe the whole vault
await store.rekey(newPassphrase?); // re-encrypt everything
await store.export({ redact });    // redaction-aware (never plaintext)
```

Well-known ids: `SECRET_MAVLINK_SIGNING_KEY`, `SECRET_MAP_API_KEY`.

## Guarantees

- Secrets are **never logged**.
- `export()` is **redaction-aware**: by default only ids are emitted; even
  `{ redact: false }` emits ciphertext only — plaintext never leaves the store.
- Wrong passphrase ⇒ `WrongPassphraseError`, store stays locked, nothing mutates.
- Locked reads/writes ⇒ `SecretsLockedError`.

## Testing

Inject a fake `KvStore` and the global `crypto.subtle` (node provides it). See
`test/unit/secrets-store.test.ts` for round-trip / wrong-passphrase / redaction
coverage.
