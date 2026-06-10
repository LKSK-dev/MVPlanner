/**
 * Shared unit-test helpers (refactor: canonical implementations — replaced
 * dozens of per-file copies of `settle`, the in-memory KvStore/BlobStore/FileIo
 * fakes, and the `makeVehicle` fixture). Import from `../helpers`.
 */
import type { BlobStore, FileIo, KvStore, VehicleState } from '../../src/contracts';

/** Flush the store's coalesced patch microtask / pending timers (one tick). */
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** In-memory {@link KvStore} with a synchronous `peek` for assertions. */
export function fakeKv(): KvStore & { peek<T>(ns: string, key: string): T | undefined } {
  const map = new Map<string, unknown>();
  return {
    get: async <T>(ns: string, key: string): Promise<T | undefined> =>
      map.get(`${ns}/${key}`) as T | undefined,
    set: async <T>(ns: string, key: string, v: T): Promise<void> => {
      map.set(`${ns}/${key}`, v);
    },
    del: async (ns: string, key: string): Promise<void> => {
      map.delete(`${ns}/${key}`);
    },
    peek: <T>(ns: string, key: string): T | undefined => map.get(`${ns}/${key}`) as T | undefined,
  };
}

/** In-memory {@link BlobStore} backed by `Uint8Array`s. */
export function fakeBlobs(): BlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    put: async (ns, key, data): Promise<void> => {
      map.set(`${ns}/${key}`, new Uint8Array(await data.arrayBuffer()));
    },
    getRange: async (ns, key, start, end): Promise<Uint8Array> => {
      const d = map.get(`${ns}/${key}`);
      if (d === undefined) throw new Error(`fakeBlobs: missing ${ns}/${key}`);
      return d.slice(start, end);
    },
    size: async (ns, key): Promise<number> => map.get(`${ns}/${key}`)?.byteLength ?? 0,
    list: async (ns): Promise<{ key: string; bytes: number }[]> =>
      [...map.entries()]
        .filter(([k]) => k.startsWith(`${ns}/`))
        .map(([k, v]) => ({ key: k.slice(ns.length + 1), bytes: v.byteLength })),
    del: async (ns, key): Promise<void> => {
      map.delete(`${ns}/${key}`);
    },
  };
}

/** No-op {@link FileIo} (openForRead yields nothing; saveAs records calls). */
export function fakeFiles(): FileIo & { saved: { name: string; blob: Blob }[] } {
  const saved: { name: string; blob: Blob }[] = [];
  return {
    saved,
    openForRead: async () => undefined,
    saveAs: async (blob: Blob, name: string): Promise<void> => {
      saved.push({ name, blob });
    },
  };
}

/** A minimal valid {@link VehicleState} fixture (override fields as needed). */
export function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    sysid: 1,
    compid: 1,
    mavType: 2,
    autopilot: 3,
    vehicleClass: 'copter',
    armed: false,
    mode: 'STABILIZE',
    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
    link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false },
    lastHeartbeatMs: 0,
    ...overrides,
  };
}
