/**
 * Flight services tests (task T2.11; spec plan/04 §4.2, plan/07 §7.4, plan/08
 * §8.2). Exercises {@link createFlightServices} over a fake host + store: the
 * STATUSTEXT accumulator bounds + orders entries, the command client is bound to
 * the host send/tap + store active vehicle, and the tlog recorder auto-starts on
 * connect. No Worker is spun.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot } from 'solid-js';
import type { AppState, DecodedMessage, Store } from '../../src/contracts';
import type { AppStorage } from '../../src/data/storage';
import { createAppStore } from '../../src/core/store';
import { createFlightServices, type FlightHost } from '../../src/ui/screens/flight';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface MessageTap {
  readonly names: ReadonlySet<string>;
  readonly cb: (msg: DecodedMessage) => void;
}

interface FakeHostHandle {
  readonly host: FlightHost;
  emitMessage(msg: DecodedMessage): void;
  emitState(kind: string): void;
  readonly sent: Array<{ name: string; fields: Record<string, unknown> }>;
}

function fakeHost(): FakeHostHandle {
  const taps: MessageTap[] = [];
  const stateTaps: Array<(s: { kind: string }) => void> = [];
  const sent: Array<{ name: string; fields: Record<string, unknown> }> = [];
  const host: FlightHost = {
    sendMessage: (name, fields) => {
      sent.push({ name, fields });
      return Promise.resolve();
    },
    onMessage: (names, cb) => {
      const tap: MessageTap = { names: new Set(names), cb };
      taps.push(tap);
      return () => {
        const i = taps.indexOf(tap);
        if (i >= 0) taps.splice(i, 1);
      };
    },
    onRawFrame: () => () => undefined,
    onState: (cb) => {
      stateTaps.push(cb);
      return () => undefined;
    },
  };
  return {
    host,
    emitMessage(msg) {
      for (const tap of taps) if (tap.names.has(msg.name)) tap.cb(msg);
    },
    emitState(kind) {
      for (const cb of stateTaps) cb({ kind });
    },
    sent,
  };
}

function statusText(text: string, severity = 6, seq = 0): DecodedMessage {
  return {
    sysid: 1,
    compid: 1,
    seq,
    msgId: 253,
    name: 'STATUSTEXT',
    fields: { severity, text },
    crcOk: true,
    signed: false,
    rxTimeUs: 0,
    raw: new Uint8Array(0),
  };
}

/** A minimal {@link AppStorage} stub (only blobs/files are touched here). */
function fakeStorage(): AppStorage {
  const stub = {
    kv: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
    blobs: {
      put: async () => undefined,
      getRange: async () => new Uint8Array(0),
      size: async () => 0,
      list: async () => [],
      del: async () => undefined,
    },
    files: { openForRead: async () => undefined, saveAs: async () => undefined },
    open: async () => ({}) as never,
    close: async () => undefined,
  };
  return stub as unknown as AppStorage;
}

interface Built {
  handle: FakeHostHandle;
  store: Store<AppState>;
  services: ReturnType<typeof createFlightServices>['services'];
  dispose: () => Promise<void>;
  teardownRoot: () => void;
}

function build(): Built {
  const handle = fakeHost();
  const store = createAppStore();
  let built!: ReturnType<typeof createFlightServices>;
  const teardownRoot = createRoot((dispose) => {
    built = createFlightServices({ host: handle.host, store, storage: fakeStorage() });
    return dispose;
  });
  return { handle, store, services: built.services, dispose: built.dispose, teardownRoot };
}

afterEach(() => undefined);

describe('createFlightServices — STATUSTEXT accumulator', () => {
  it('accumulates STATUSTEXT messages into the reactive buffer, oldest-first', async () => {
    const { handle, services, dispose, teardownRoot } = build();
    expect(services.statusMessages()).toEqual([]);

    handle.emitMessage(statusText('first', 4));
    handle.emitMessage(statusText('second', 6));
    const list = services.statusMessages();
    expect(list.map((m) => m.text)).toEqual(['first', 'second']);
    expect(list[0]?.severity).toBe(4);
    // Monotonic per-entry seq for stable render keys.
    expect(list[0]?.seq).toBe(0);
    expect(list[1]?.seq).toBe(1);

    await dispose();
    teardownRoot();
  });

  it('bounds the buffer to maxStatusMessages (oldest evicted)', () => {
    const handle = fakeHost();
    const store = createAppStore();
    const teardown = createRoot((dispose) => {
      const built = createFlightServices({
        host: handle.host,
        store,
        storage: fakeStorage(),
        maxStatusMessages: 3,
      });
      handle.emitMessage(statusText('a'));
      handle.emitMessage(statusText('b'));
      handle.emitMessage(statusText('c'));
      handle.emitMessage(statusText('d'));
      expect(built.services.statusMessages().map((m) => m.text)).toEqual(['b', 'c', 'd']);
      return dispose;
    });
    teardown();
  });
});

describe('createFlightServices — command binding', () => {
  it('binds the command client to host send + store active vehicle', async () => {
    const { handle, store, services, dispose, teardownRoot } = build();

    // No active vehicle → the command client rejects with `no-vehicle`.
    await expect(services.command.arm(true)).rejects.toMatchObject({ reason: 'no-vehicle' });

    store.patch((s) => {
      s.vehicles[7] = {
        sysid: 7,
        compid: 1,
        mavType: 2,
        autopilot: 3,
        vehicleClass: 'copter',
        armed: false,
        mode: 'GUIDED',
        attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
        link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false },
        lastHeartbeatMs: 0,
      };
      s.activeSysid = 7;
    });
    await settle();

    // setCurrentWp is fire-and-forget: it sends to the active vehicle's sysid.
    await services.command.setCurrentWp(3);
    const wp = handle.sent.find((m) => m.name === 'MISSION_SET_CURRENT');
    expect(wp?.fields).toMatchObject({ target_system: 7, seq: 3 });

    await dispose();
    teardownRoot();
  });
});

describe('createFlightServices — recorder auto-start-on-connect', () => {
  it('starts the recorder on open and stops it on close', async () => {
    const { handle, services, dispose, teardownRoot } = build();
    expect(services.recorder.isRecording).toBe(false);

    handle.emitState('open');
    await settle();
    expect(services.recorder.isRecording).toBe(true);

    handle.emitState('closed');
    await settle();
    expect(services.recorder.isRecording).toBe(false);

    await dispose();
    teardownRoot();
  });
});
