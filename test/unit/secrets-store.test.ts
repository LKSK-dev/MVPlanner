/**
 * Secret-store conformance (task T8.12; spec plan/07 §7.7, plan/08 §8.3):
 * encrypt/decrypt round-trip under a passphrase, wrong-passphrase rejection,
 * lock/unlock gating, persisted-ciphertext-only (no plaintext at rest), and
 * redaction-aware export. Uses the global WebCrypto `crypto.subtle` (node) and a
 * fake in-memory KV so it runs without IndexedDB.
 */
import { describe, expect, it } from 'vitest';
import type { KvStore } from '../../src/contracts';
import {
  SECRET_MAP_API_KEY,
  SecretsLockedError,
  WrongPassphraseError,
  createSecretStore,
} from '../../src/core/secrets';

/** Minimal in-memory {@link KvStore} keyed by `ns\x00key`. */
function makeKv(): KvStore & { dump(): Map<string, unknown> } {
  const map = new Map<string, unknown>();
  const k = (ns: string, key: string): string => `${ns}\u0000${key}`;
  return {
    dump: () => map,
    get<T>(ns: string, key: string): Promise<T | undefined> {
      return Promise.resolve(map.get(k(ns, key)) as T | undefined);
    },
    set<T>(ns: string, key: string, v: T): Promise<void> {
      map.set(k(ns, key), v);
      return Promise.resolve();
    },
    del(ns: string, key: string): Promise<void> {
      map.delete(k(ns, key));
      return Promise.resolve();
    },
  };
}

/** Fewer PBKDF2 iterations keep the test fast (still exercises the same path). */
const FAST = { iterations: 1000 } as const;

describe('SecretStore', () => {
  it('round-trips a secret under a passphrase', async () => {
    const store = createSecretStore({ storage: makeKv(), ...FAST });
    await store.unlock('correct horse battery staple');
    const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await store.set('mavlink.signingKey', key);
    expect(await store.get('mavlink.signingKey')).toEqual(key);
    await store.set(SECRET_MAP_API_KEY, 'tile-key-123');
    expect(await store.getString(SECRET_MAP_API_KEY)).toBe('tile-key-123');
    expect(await store.list()).toEqual(['mavlink.signingKey', SECRET_MAP_API_KEY]);
  });

  it('persists ciphertext only — no plaintext at rest', async () => {
    const kv = makeKv();
    const store = createSecretStore({ storage: kv, ...FAST });
    await store.unlock('pw');
    await store.set(SECRET_MAP_API_KEY, 'super-secret-token');
    const serialized = JSON.stringify([...kv.dump().values()]);
    expect(serialized).not.toContain('super-secret-token');
  });

  it('rejects the wrong passphrase and leaves the key locked', async () => {
    const kv = makeKv();
    const a = createSecretStore({ storage: kv, ...FAST });
    await a.unlock('right');
    await a.set('x', 'value');

    const b = createSecretStore({ storage: kv, ...FAST });
    await expect(b.unlock('wrong')).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(b.isLocked()).toBe(true);

    await b.unlock('right');
    expect(await b.getString('x')).toBe('value');
  });

  it('blocks reads while locked', async () => {
    const store = createSecretStore({ storage: makeKv(), ...FAST });
    await store.unlock('pw');
    await store.set('x', 'value');
    store.lock();
    expect(store.isLocked()).toBe(true);
    await expect(store.get('x')).rejects.toBeInstanceOf(SecretsLockedError);
  });

  it('rekeys to a new passphrase, preserving secrets', async () => {
    const kv = makeKv();
    const store = createSecretStore({ storage: kv, ...FAST });
    await store.unlock('old');
    await store.set('x', 'value');
    await store.rekey('new');

    const reopened = createSecretStore({ storage: kv, ...FAST });
    await expect(reopened.unlock('old')).rejects.toBeInstanceOf(WrongPassphraseError);
    await reopened.unlock('new');
    expect(await reopened.getString('x')).toBe('value');
  });

  it('clears one secret and the whole vault', async () => {
    const kv = makeKv();
    const store = createSecretStore({ storage: kv, ...FAST });
    await store.unlock('pw');
    await store.set('a', '1');
    await store.set('b', '2');
    await store.clear('a');
    expect(await store.list()).toEqual(['b']);

    await store.clear();
    expect(await store.list()).toEqual([]);
    // The vault is gone: a fresh unlock seeds a new one (no WrongPassphrase).
    const reopened = createSecretStore({ storage: kv, ...FAST });
    await reopened.unlock('whatever-now');
    expect(await reopened.list()).toEqual([]);
  });

  it('exports redaction-aware (never plaintext)', async () => {
    const store = createSecretStore({ storage: makeKv(), ...FAST });
    await store.unlock('pw');
    await store.set(SECRET_MAP_API_KEY, 'plaintext-secret');

    const redacted = await store.export();
    expect(redacted.ids).toEqual([SECRET_MAP_API_KEY]);
    expect(redacted.ciphertext).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain('plaintext-secret');

    const full = await store.export({ redact: false });
    expect(full.ciphertext?.[SECRET_MAP_API_KEY]).toBeDefined();
    // Even unredacted, only ciphertext is present — plaintext never leaves.
    expect(JSON.stringify(full)).not.toContain('plaintext-secret');
  });
});
