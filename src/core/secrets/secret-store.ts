/**
 * Encrypted-at-rest secret store (task T8.12; spec plan/07 §7.7, plan/08 §8.3).
 *
 * Wraps MAVLink v2 signing keys and map/tile provider API keys with WebCrypto
 * (PBKDF2 → AES-GCM, see `./crypto.ts`) and persists only **ciphertext** in the
 * injected {@link KvStore} (IndexedDB in the app). A casual disk read can never
 * lift a plaintext secret; an optional user passphrase strengthens the wrap.
 *
 * Lifecycle:
 *  - {@link SecretStore.unlock} derives the AES key. The first unlock on a fresh
 *    store seeds the vault (random salt + a verifier token). A later unlock
 *    re-derives with the stored salt and decrypts the verifier — a wrong
 *    passphrase fails authentication and is reported as
 *    {@link WrongPassphraseError} (nothing is mutated).
 *  - {@link SecretStore.lock} drops the in-memory key; reads/writes then fail
 *    with {@link SecretsLockedError} until unlocked again.
 *  - {@link SecretStore.set}/{@link SecretStore.get}/{@link SecretStore.clear}
 *    encrypt/decrypt with the active key.
 *  - {@link SecretStore.rekey} re-encrypts every secret under a new passphrase.
 *  - {@link SecretStore.export} is redaction-aware: it NEVER emits plaintext
 *    (only ids by default; ciphertext only when explicitly requested).
 *
 * Secrets are never logged. Crypto + storage are injected for testability.
 */
import type { KvStore } from '../../contracts';
import { fromBase64, toBase64 } from './base64';
import {
  AES_GCM_IV_BYTES,
  DEFAULT_PBKDF2_ITERATIONS,
  PBKDF2_SALT_BYTES,
  type CryptoProvider,
  aesGcmDecrypt,
  aesGcmEncrypt,
  defaultCryptoProvider,
  deriveAesKey,
  randomBytes,
  utf8Bytes,
} from './crypto';

/** KV namespace under which all secret records live. */
export const SECRETS_NS = 'secrets';

/** KV keys for the vault metadata + the id index. */
const VAULT_KEY = '__vault__';
const INDEX_KEY = '__index__';
const secretKey = (id: string): string => `s:${id}`;

/** Plaintext probe encrypted into the vault verifier (authentication check). */
const VERIFIER_TOKEN = 'mvplanner.secrets.v1';

/** Raised when a read/write is attempted while the store is locked. */
export class SecretsLockedError extends Error {
  constructor() {
    super('secret store is locked; call unlock() first');
    this.name = 'SecretsLockedError';
  }
}

/** Raised when {@link SecretStore.unlock} is given the wrong passphrase. */
export class WrongPassphraseError extends Error {
  constructor() {
    super('incorrect passphrase for the secret store');
    this.name = 'WrongPassphraseError';
  }
}

/** Persisted vault metadata (no key material — only salt + a verifier). */
interface VaultRecord {
  v: 1;
  /** PBKDF2 salt (base64). */
  salt: string;
  /** PBKDF2 iteration count. */
  iterations: number;
  /** AES-GCM IV for the verifier (base64). */
  verifierIv: string;
  /** Encrypted {@link VERIFIER_TOKEN} (base64). */
  verifierCt: string;
}

/** Persisted per-secret record (ciphertext only). */
interface SecretRecord {
  v: 1;
  /** AES-GCM IV (base64). */
  iv: string;
  /** Ciphertext (base64). */
  ct: string;
}

/** Redaction-aware export of the vault (never contains plaintext). */
export interface SecretsExport {
  kind: 'mvplanner.secrets';
  version: 1;
  /** Always `true`: stored material is AES-GCM ciphertext. */
  encrypted: true;
  /** The stored secret ids. */
  ids: string[];
  /**
   * Per-id ciphertext (base64), present only when `redact: false` was passed.
   * Even then this is ciphertext — plaintext is never exported.
   */
  ciphertext?: Record<string, { iv: string; ct: string }>;
}

/** The encrypted secret store surface. */
export interface SecretStore {
  /** Whether the store currently holds no in-memory key. */
  isLocked(): boolean;
  /**
   * Derive the AES key from `passphrase` (default empty — obfuscation-level
   * "device" wrap). Seeds the vault on first use; verifies on later unlocks.
   *
   * @throws {WrongPassphraseError} when the passphrase does not match the vault.
   */
  unlock(passphrase?: string): Promise<void>;
  /** Drop the in-memory key (reads/writes then require {@link unlock}). */
  lock(): void;
  /** Encrypt + store `value` under `id`. */
  set(id: string, value: Uint8Array | string): Promise<void>;
  /** Decrypt the raw bytes for `id`, or `undefined` if absent. */
  get(id: string): Promise<Uint8Array | undefined>;
  /** Decrypt `id` as a UTF-8 string, or `undefined` if absent. */
  getString(id: string): Promise<string | undefined>;
  /** Whether a secret is stored for `id`. */
  has(id: string): Promise<boolean>;
  /** All stored secret ids. */
  list(): Promise<string[]>;
  /** Remove the secret for `id`, or — with no id — wipe the whole vault. */
  clear(id?: string): Promise<void>;
  /** Re-encrypt every secret under a new passphrase (requires unlocked). */
  rekey(newPassphrase?: string): Promise<void>;
  /** Redaction-aware export (never plaintext; ids only unless `redact:false`). */
  export(opts?: { redact?: boolean }): Promise<SecretsExport>;
}

/** Injected dependencies for {@link createSecretStore}. */
export interface SecretStoreDeps {
  /** KV store backing the ciphertext records (IndexedDB in the app). */
  storage: KvStore;
  /** WebCrypto provider; defaults to {@link defaultCryptoProvider}. */
  crypto?: CryptoProvider;
  /** PBKDF2 iterations for new vaults; defaults to {@link DEFAULT_PBKDF2_ITERATIONS}. */
  iterations?: number;
}

/**
 * Coerce a value to fresh ArrayBuffer-backed bytes (WebCrypto-ready) without
 * leaking it through any intermediate log.
 */
function toBytes(value: Uint8Array | string): Uint8Array<ArrayBuffer> {
  if (typeof value === 'string') return utf8Bytes(value);
  const out = new Uint8Array(value.length);
  out.set(value);
  return out;
}

class WebCryptoSecretStore implements SecretStore {
  readonly #storage: KvStore;
  readonly #crypto: CryptoProvider;
  readonly #newIterations: number;

  #key: CryptoKey | undefined;

  constructor(deps: SecretStoreDeps) {
    this.#storage = deps.storage;
    this.#crypto = deps.crypto ?? defaultCryptoProvider();
    this.#newIterations = deps.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  }

  isLocked(): boolean {
    return this.#key === undefined;
  }

  async unlock(passphrase = ''): Promise<void> {
    const vault = await this.#storage.get<VaultRecord>(SECRETS_NS, VAULT_KEY);
    if (!vault) {
      await this.#seedVault(passphrase);
      return;
    }
    const salt = fromBase64(vault.salt);
    const key = await deriveAesKey(this.#crypto, passphrase, salt, vault.iterations);
    try {
      const probe = await aesGcmDecrypt(
        this.#crypto,
        key,
        fromBase64(vault.verifierIv),
        fromBase64(vault.verifierCt),
      );
      if (new TextDecoder().decode(probe) !== VERIFIER_TOKEN) {
        throw new WrongPassphraseError();
      }
    } catch {
      throw new WrongPassphraseError();
    }
    this.#key = key;
  }

  lock(): void {
    this.#key = undefined;
  }

  async set(id: string, value: Uint8Array | string): Promise<void> {
    const record = await this.#encrypt(toBytes(value));
    await this.#storage.set<SecretRecord>(SECRETS_NS, secretKey(id), record);
    await this.#addToIndex(id);
  }

  async get(id: string): Promise<Uint8Array | undefined> {
    const key = this.#requireKey();
    const record = await this.#storage.get<SecretRecord>(SECRETS_NS, secretKey(id));
    if (!record) return undefined;
    return aesGcmDecrypt(this.#crypto, key, fromBase64(record.iv), fromBase64(record.ct));
  }

  async getString(id: string): Promise<string | undefined> {
    const bytes = await this.get(id);
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  }

  async has(id: string): Promise<boolean> {
    return (await this.#loadIndex()).includes(id);
  }

  async list(): Promise<string[]> {
    return this.#loadIndex();
  }

  async clear(id?: string): Promise<void> {
    if (id !== undefined) {
      await this.#storage.del(SECRETS_NS, secretKey(id));
      await this.#saveIndex((await this.#loadIndex()).filter((x) => x !== id));
      return;
    }
    for (const existing of await this.#loadIndex()) {
      await this.#storage.del(SECRETS_NS, secretKey(existing));
    }
    await this.#storage.del(SECRETS_NS, INDEX_KEY);
    await this.#storage.del(SECRETS_NS, VAULT_KEY);
    this.#key = undefined;
  }

  async rekey(newPassphrase = ''): Promise<void> {
    this.#requireKey();
    const ids = await this.#loadIndex();
    const plaintexts = new Map<string, Uint8Array>();
    for (const id of ids) {
      const bytes = await this.get(id);
      if (bytes !== undefined) plaintexts.set(id, bytes);
    }
    await this.#seedVault(newPassphrase);
    for (const [id, bytes] of plaintexts) {
      await this.set(id, bytes);
    }
  }

  async export(opts?: { redact?: boolean }): Promise<SecretsExport> {
    const redact = opts?.redact ?? true;
    const ids = await this.#loadIndex();
    const out: SecretsExport = {
      kind: 'mvplanner.secrets',
      version: 1,
      encrypted: true,
      ids: [...ids],
    };
    if (!redact) {
      const ciphertext: Record<string, { iv: string; ct: string }> = {};
      for (const id of ids) {
        const record = await this.#storage.get<SecretRecord>(SECRETS_NS, secretKey(id));
        if (record) ciphertext[id] = { iv: record.iv, ct: record.ct };
      }
      out.ciphertext = ciphertext;
    }
    return out;
  }

  // --- internals -----------------------------------------------------------

  #requireKey(): CryptoKey {
    if (this.#key === undefined) throw new SecretsLockedError();
    return this.#key;
  }

  /** (Re)initialise the vault with a fresh salt + verifier under `passphrase`. */
  async #seedVault(passphrase: string): Promise<void> {
    const salt = randomBytes(this.#crypto, PBKDF2_SALT_BYTES);
    const key = await deriveAesKey(this.#crypto, passphrase, salt, this.#newIterations);
    const iv = randomBytes(this.#crypto, AES_GCM_IV_BYTES);
    const ct = await aesGcmEncrypt(this.#crypto, key, iv, utf8Bytes(VERIFIER_TOKEN));
    const vault: VaultRecord = {
      v: 1,
      salt: toBase64(salt),
      iterations: this.#newIterations,
      verifierIv: toBase64(iv),
      verifierCt: toBase64(ct),
    };
    await this.#storage.set<VaultRecord>(SECRETS_NS, VAULT_KEY, vault);
    this.#key = key;
  }

  async #encrypt(plaintext: Uint8Array<ArrayBuffer>): Promise<SecretRecord> {
    const key = this.#requireKey();
    const iv = randomBytes(this.#crypto, AES_GCM_IV_BYTES);
    const ct = await aesGcmEncrypt(this.#crypto, key, iv, plaintext);
    return { v: 1, iv: toBase64(iv), ct: toBase64(ct) };
  }

  async #loadIndex(): Promise<string[]> {
    return (await this.#storage.get<string[]>(SECRETS_NS, INDEX_KEY)) ?? [];
  }

  async #saveIndex(ids: string[]): Promise<void> {
    await this.#storage.set<string[]>(SECRETS_NS, INDEX_KEY, ids);
  }

  async #addToIndex(id: string): Promise<void> {
    const ids = await this.#loadIndex();
    if (!ids.includes(id)) {
      ids.push(id);
      await this.#saveIndex(ids);
    }
  }
}

/** Construct an encrypted {@link SecretStore} over injected crypto + storage. */
export function createSecretStore(deps: SecretStoreDeps): SecretStore {
  return new WebCryptoSecretStore(deps);
}
