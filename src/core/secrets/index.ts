/**
 * `core/secrets` public surface (task T8.12; spec plan/07 §7.7, plan/08 §8.3).
 *
 * A WebCrypto-backed, encrypted-at-rest store for the app's secrets — MAVLink v2
 * signing keys and map/tile API keys — keyed by the {@link SECRET_MAVLINK_SIGNING_KEY}
 * / {@link SECRET_MAP_API_KEY} ids. Ciphertext (PBKDF2 → AES-GCM) is the only
 * thing persisted; an optional user passphrase strengthens the wrap. Crypto +
 * storage are injected so the store is fully unit-testable. Cross-module
 * consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3).
 *
 * @see ./README.md for the API, the threat model and how to test it.
 */
export {
  createSecretStore,
  SECRETS_NS,
  SecretsLockedError,
  WrongPassphraseError,
  type SecretStore,
  type SecretStoreDeps,
  type SecretsExport,
} from './secret-store';
export {
  DEFAULT_PBKDF2_ITERATIONS,
  SecretsCryptoUnavailableError,
  defaultCryptoProvider,
  type CryptoProvider,
} from './crypto';
export { SECRET_MAVLINK_SIGNING_KEY, SECRET_MAP_API_KEY } from './ids';
