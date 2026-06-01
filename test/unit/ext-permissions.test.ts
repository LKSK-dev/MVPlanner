/**
 * Unit tests for the T7.2 permission model + broker (spec plan/06 §6.5,
 * plan/08 §8.3).
 *
 * Pure / in-process: a fake {@link KvStore} (Map), the real {@link RingAuditLog},
 * and typed `vi.fn` fakes for the injected `confirm` + `prompt`. Covers the
 * grant store (grant/revoke/persist), the install-prompt flow, broker gating
 * (ungranted method rejected, granted handler runs), armed-aware confirm + audit
 * for vehicle-affecting calls, `net:<host>` egress gating, and
 * `capabilitiesFor`.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ConfirmOptions, ExtManifest, KvStore, Permission } from '../../src/contracts';
import { createAuditLog } from '../../src/core/audit';
import {
  ExtPermissionError,
  PermissionBroker,
  createGrantStore,
  createPermissionBroker,
  isHighRiskPermission,
  requestGrants,
  type ConfirmFn,
  type EgressRecord,
  type GrantPrompt,
  type GrantStore,
} from '../../src/ext/permissions';

/** In-memory {@link KvStore} keyed by `ns\0key`. */
function fakeKv(): KvStore {
  const store = new Map<string, unknown>();
  const k = (ns: string, key: string): string => `${ns}\u0000${key}`;
  return {
    get<T>(ns: string, key: string): Promise<T | undefined> {
      return Promise.resolve(store.get(k(ns, key)) as T | undefined);
    },
    set<T>(ns: string, key: string, v: T): Promise<void> {
      store.set(k(ns, key), v);
      return Promise.resolve();
    },
    del(ns: string, key: string): Promise<void> {
      store.delete(k(ns, key));
      return Promise.resolve();
    },
  };
}

const manifest = (over: Partial<ExtManifest> = {}): ExtManifest => ({
  id: 'com.example.ext',
  name: 'Example',
  version: '1.0.0',
  apiVersion: '^1.0',
  permissions: ['telemetry:read', 'command'],
  ...over,
});

/** Broker wired with a granted set + spies, sharing one {@link KvStore}. */
function makeBroker(opts?: { confirm?: ConfirmFn; recordEgress?: (info: EgressRecord) => void }): {
  broker: PermissionBroker;
  grants: GrantStore;
} {
  const grants = createGrantStore(fakeKv());
  const broker = createPermissionBroker({
    grants,
    audit: createAuditLog(),
    confirm: opts?.confirm ?? vi.fn<ConfirmFn>(() => Promise.resolve(true)),
    ...(opts?.recordEgress ? { recordEgress: opts.recordEgress } : {}),
  });
  return { broker, grants };
}

describe('grant store', () => {
  it('grants, revokes, and persists across instances', async () => {
    const kv = fakeKv();
    const grants = createGrantStore(kv);
    await grants.grant('a', ['command', 'telemetry:read']);
    expect(await grants.isGranted('a', 'command')).toBe(true);
    expect([...(await grants.list('a'))].sort()).toEqual(['command', 'telemetry:read']);

    await grants.revoke('a', ['command']);
    expect(await grants.isGranted('a', 'command')).toBe(false);
    expect(await grants.list('a')).toEqual(['telemetry:read']);

    // A fresh store over the same KvStore reads back the persisted grants.
    const reopened = createGrantStore(kv);
    expect(await reopened.list('a')).toEqual(['telemetry:read']);
  });

  it('set replaces the whole granted set; clear forgets it', async () => {
    const grants = createGrantStore(fakeKv());
    await grants.grant('a', ['command']);
    await grants.set('a', ['map', 'notify']);
    expect([...(await grants.list('a'))].sort()).toEqual(['map', 'notify']);
    await grants.clear('a');
    expect(await grants.list('a')).toEqual([]);
  });
});

describe('requestGrants (install prompt flow)', () => {
  it('persists the prompt result, clamped to requested scopes', async () => {
    const grants = createGrantStore(fakeKv());
    const m = manifest({ permissions: ['telemetry:read', 'command', 'mission:write'] });
    // Prompt approves a subset and (maliciously) an un-requested scope.
    const prompt = vi.fn<GrantPrompt>(() =>
      Promise.resolve<Permission[]>(['command', 'storage' as Permission]),
    );

    const granted = await requestGrants(m, { prompt, grants });

    expect(prompt).toHaveBeenCalledTimes(1);
    // Un-requested 'storage' is dropped; only requested+approved 'command' kept.
    expect(granted).toEqual(['command']);
    expect(await grants.list(m.id)).toEqual(['command']);
  });

  it('flags high-risk scopes in the requests passed to the prompt', async () => {
    const grants = createGrantStore(fakeKv());
    const m = manifest({ permissions: ['telemetry:read', 'command', 'mavlink:send'] });
    const prompt = vi.fn<GrantPrompt>((_, requests) => {
      const highRisk = requests.filter((r) => r.highRisk).map((r) => r.permission);
      expect(highRisk.sort()).toEqual(['command', 'mavlink:send']);
      return Promise.resolve<Permission[]>([]);
    });
    await requestGrants(m, { prompt, grants });
    expect(prompt).toHaveBeenCalled();
    expect(isHighRiskPermission('command')).toBe(true);
    expect(isHighRiskPermission('telemetry:read')).toBe(false);
  });
});

describe('broker permission gating', () => {
  it('rejects an unregistered method', async () => {
    const { broker } = makeBroker();
    await expect(broker.invoke('a', 'nope.method', [])).rejects.toBeInstanceOf(ExtPermissionError);
  });

  it('rejects a method whose required permission is not granted', async () => {
    const { broker } = makeBroker();
    const handler = vi.fn(() => Promise.resolve('ran'));
    broker.registerApi('telemetry.latest', 'telemetry:read', handler);
    // No grant for 'a'.
    await expect(broker.invoke('a', 'telemetry.latest', [])).rejects.toMatchObject({
      reason: 'not-granted',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs a granted method's handler and returns its result", async () => {
    const { broker, grants } = makeBroker();
    await grants.grant('a', ['telemetry:read']);
    const handler = vi.fn((extId: string, args: readonly unknown[]) =>
      Promise.resolve({ extId, args }),
    );
    broker.registerApi('telemetry.latest', 'telemetry:read', handler);
    const out = await broker.invoke('a', 'telemetry.latest', ['HEARTBEAT']);
    expect(out).toEqual({ extId: 'a', args: ['HEARTBEAT'] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('isolates a thrown handler as a rejection without crashing the broker', async () => {
    const { broker, grants } = makeBroker();
    await grants.grant('a', ['telemetry:read']);
    broker.registerApi('telemetry.boom', 'telemetry:read', () =>
      Promise.reject(new Error('handler exploded')),
    );
    broker.registerApi('telemetry.ok', 'telemetry:read', () => Promise.resolve('ok'));
    await expect(broker.invoke('a', 'telemetry.boom', [])).rejects.toThrow('handler exploded');
    // Broker still serves other calls.
    expect(await broker.invoke('a', 'telemetry.ok', [])).toBe('ok');
  });
});

describe('broker vehicle-affecting confirm + audit', () => {
  it('blocks a declined high-risk call and records it as cancelled', async () => {
    const confirm = vi.fn<ConfirmFn>(() => Promise.resolve(false));
    const grants = createGrantStore(fakeKv());
    const audit = createAuditLog();
    const broker = createPermissionBroker({ grants, audit, confirm });
    await grants.grant('a', ['command']);
    const handler = vi.fn(() => Promise.resolve('armed'));
    broker.registerApi('command.arm', 'command', handler);

    await expect(broker.invoke('a', 'command.arm', [true])).rejects.toMatchObject({
      reason: 'declined',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    const opts = confirm.mock.calls[0]?.[0] as ConfirmOptions;
    expect(opts.armedAware).toBe(true);
    expect(opts.destructive).toBe(true);

    const entries = audit.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.origin).toBe('a');
    expect(entries[0]?.kind).toBe('command');
    expect(entries[0]?.status).toBe('cancelled');
  });

  it('runs an accepted high-risk call and writes an ok audit entry with the ext id', async () => {
    const confirm = vi.fn<ConfirmFn>(() => Promise.resolve(true));
    const grants = createGrantStore(fakeKv());
    const audit = createAuditLog();
    const broker = createPermissionBroker({ grants, audit, confirm });
    await grants.grant('com.example.ext', ['params:write']);
    const handler = vi.fn(() => Promise.resolve('set'));
    broker.registerApi('params.set', 'params:write', handler);

    const out = await broker.invoke('com.example.ext', 'params.set', ['PSC_POSXY_P', 1.0]);
    expect(out).toBe('set');
    expect(handler).toHaveBeenCalledTimes(1);

    const entries = audit.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.origin).toBe('com.example.ext');
    expect(entries[0]?.kind).toBe('param-set');
    expect(entries[0]?.status).toBe('ok');
  });

  it('records an error audit entry when an accepted high-risk handler throws', async () => {
    const grants = createGrantStore(fakeKv());
    const audit = createAuditLog();
    const broker = createPermissionBroker({
      grants,
      audit,
      confirm: vi.fn<ConfirmFn>(() => Promise.resolve(true)),
    });
    await grants.grant('a', ['mission:write']);
    broker.registerApi('mission.write', 'mission:write', () =>
      Promise.reject(new Error('upload failed')),
    );
    await expect(broker.invoke('a', 'mission.write', [])).rejects.toThrow('upload failed');
    const entries = audit.list();
    expect(entries[0]?.status).toBe('error');
    expect(entries[0]?.result).toBe('upload failed');
  });
});

describe('broker net:<host> egress gating', () => {
  it('allows a granted host and records the egress; blocks others', async () => {
    const egress: EgressRecord[] = [];
    const { broker, grants } = makeBroker({ recordEgress: (info) => egress.push(info) });
    await grants.grant('a', ['net:example.com' as Permission]);
    const handler = vi.fn(() => Promise.resolve('fetched'));
    broker.registerApi('net.fetch', null, handler, { net: true });

    const ok = await broker.invoke('a', 'net.fetch', ['https://example.com/data.json']);
    expect(ok).toBe('fetched');
    expect(egress).toHaveLength(1);
    expect(egress[0]?.host).toBe('example.com');

    await expect(
      broker.invoke('a', 'net.fetch', ['https://evil.test/steal']),
    ).rejects.toMatchObject({ reason: 'egress-blocked' });
    // Only the allowed call ran + recorded.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(egress).toHaveLength(1);
  });

  it('rejects a malformed URL for a net method', async () => {
    const { broker, grants } = makeBroker();
    await grants.grant('a', ['net:*' as Permission]);
    broker.registerApi('net.fetch', null, () => Promise.resolve('x'), { net: true });
    await expect(broker.invoke('a', 'net.fetch', ['not a url'])).rejects.toMatchObject({
      reason: 'bad-request',
    });
  });
});

describe('broker capabilitiesFor', () => {
  it('reflects grants: only granted (and null-required) methods are available', async () => {
    const { broker, grants } = makeBroker();
    broker.registerApi('telemetry.latest', 'telemetry:read', () => Promise.resolve(0));
    broker.registerApi('command.arm', 'command', () => Promise.resolve(0));
    broker.registerApi('params.set', 'params:write', () => Promise.resolve(0));
    broker.registerApi('log.info', null, () => Promise.resolve(0));
    broker.registerApi('net.fetch', null, () => Promise.resolve(0), { net: true });

    await grants.grant('a', ['telemetry:read', 'command']);
    const caps = await broker.capabilitiesFor('a');
    expect([...caps].sort()).toEqual(['command.arm', 'log.info', 'telemetry.latest']);

    await grants.grant('a', ['net:example.com' as Permission]);
    const caps2 = await broker.capabilitiesFor('a');
    expect(caps2.has('net.fetch')).toBe(true);
    expect(caps2.has('params.set')).toBe(false);
  });
});
