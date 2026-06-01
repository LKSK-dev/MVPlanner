/**
 * TERRAIN microservice + grid-geometry unit tests (task T4.8; spec plan/03 §3.4
 * Terrain). Drives {@link TerrainService} with a mock host (`sendMessage` /
 * `onMessage`) and a mock elevation provider, asserting it answers a
 * `TERRAIN_REQUEST` with correctly-structured `TERRAIN_DATA` (echoed corner,
 * spacing, gridbit, 16 int16 cells in `data[x·4 + y]` order) and tracks
 * `TERRAIN_REPORT`.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  CELLS_PER_BLOCK,
  createTerrainService,
  encodeElevation,
  gridbitOrigin,
  maskBits,
  TERRAIN_NODATA,
  type TerrainElevationSource,
  type TerrainMessageTap,
} from '../../src/mavlink/microservices/terrain';
import { M_PER_DEG_LAT } from '../../src/geo/terrain';
import type { DecodedMessage, FieldValue } from '../../src/contracts';

/** A minimal decoded message for the terrain taps. */
function msg(name: string, fields: Record<string, FieldValue>): DecodedMessage {
  return {
    sysid: 1,
    compid: 1,
    seq: 0,
    msgId: 0,
    name,
    fields,
    crcOk: true,
    signed: false,
    rxTimeUs: 0,
    raw: new Uint8Array(0),
  };
}

/** A mock host: capture the tap callback and the outgoing messages. */
function mockHost(): {
  onMessage: TerrainMessageTap;
  sendMessage: Mock<(name: string, fields: Record<string, unknown>) => void>;
  sent: Array<{ name: string; fields: Record<string, unknown> }>;
  emit: (m: DecodedMessage) => void;
} {
  let cb: ((m: DecodedMessage) => void) | undefined;
  const sent: Array<{ name: string; fields: Record<string, unknown> }> = [];
  return {
    onMessage: (_names, handler) => {
      cb = handler;
      return () => {
        cb = undefined;
      };
    },
    sendMessage: vi.fn((name: string, fields: Record<string, unknown>) => {
      sent.push({ name, fields });
    }),
    sent,
    emit: (m) => cb?.(m),
  };
}

/** Flush the service's sequential per-cell awaits. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('terrain grid geometry', () => {
  it('enumerates set mask bits (0..55)', () => {
    expect(maskBits(0n)).toEqual([]);
    expect(maskBits(1n)).toEqual([0]);
    expect(maskBits(0b101n)).toEqual([0, 2]);
    expect(maskBits((1n << 55n) | 1n)).toEqual([0, 55]);
  });

  it('maps a gridbit to its sub-block post origin (idxX north, idxY east)', () => {
    expect(gridbitOrigin(0)).toEqual({ idxX: 0, idxY: 0 });
    expect(gridbitOrigin(1)).toEqual({ idxX: 0, idxY: 4 });
    expect(gridbitOrigin(8)).toEqual({ idxX: 4, idxY: 0 });
    expect(gridbitOrigin(9)).toEqual({ idxX: 4, idxY: 4 });
  });

  it('encodes elevations to clamped int16 with a no-data sentinel', () => {
    expect(encodeElevation(123.4)).toBe(123);
    expect(encodeElevation(undefined)).toBe(TERRAIN_NODATA);
    expect(encodeElevation(99999)).toBe(32767);
    expect(encodeElevation(-99999)).toBe(-32768);
  });
});

describe('TerrainService — TERRAIN_REQUEST → TERRAIN_DATA', () => {
  /** Provider returning the point's metres north of the equator (= northM here). */
  const elevation: TerrainElevationSource = {
    sampleElevation: vi.fn(async (lat: number) => lat * M_PER_DEG_LAT),
  };

  it('answers a single-bit request with one structured TERRAIN_DATA', async () => {
    const host = mockHost();
    createTerrainService({ sendMessage: host.sendMessage, onMessage: host.onMessage, elevation });

    host.emit(msg('TERRAIN_REQUEST', { lat: 0, lon: 0, grid_spacing: 100, mask: 1n }));
    await flush();

    expect(host.sent).toHaveLength(1);
    const data = host.sent[0];
    expect(data?.name).toBe('TERRAIN_DATA');
    expect(data?.fields.lat).toBe(0);
    expect(data?.fields.lon).toBe(0);
    expect(data?.fields.grid_spacing).toBe(100);
    expect(data?.fields.gridbit).toBe(0);

    // data[x·4 + y] with the provider returning ~northM = (idxX + x)·spacing,
    // idxX = 0 for gridbit 0 → rows 0,100,200,300 (east index y has no effect).
    const cells = data?.fields.data as number[];
    expect(cells).toHaveLength(CELLS_PER_BLOCK);
    expect(cells).toEqual([0, 0, 0, 0, 100, 100, 100, 100, 200, 200, 200, 200, 300, 300, 300, 300]);
  });

  it('sends one TERRAIN_DATA per set mask bit with the right gridbit', async () => {
    const host = mockHost();
    createTerrainService({ sendMessage: host.sendMessage, onMessage: host.onMessage, elevation });

    host.emit(msg('TERRAIN_REQUEST', { lat: 0, lon: 0, grid_spacing: 100, mask: 0b1011n }));
    await flush();

    expect(host.sent.map((s) => s.fields.gridbit)).toEqual([0, 1, 3]);
    expect(host.sent.every((s) => (s.fields.data as number[]).length === CELLS_PER_BLOCK)).toBe(
      true,
    );
  });

  it('ignores requests with a non-positive grid spacing', async () => {
    const host = mockHost();
    createTerrainService({ sendMessage: host.sendMessage, onMessage: host.onMessage, elevation });
    host.emit(msg('TERRAIN_REQUEST', { lat: 0, lon: 0, grid_spacing: 0, mask: 1n }));
    await flush();
    expect(host.sent).toHaveLength(0);
  });

  it('fills unavailable cells with the no-data sentinel', async () => {
    const host = mockHost();
    const missing: TerrainElevationSource = { sampleElevation: async () => undefined };
    createTerrainService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      elevation: missing,
    });
    host.emit(msg('TERRAIN_REQUEST', { lat: 0, lon: 0, grid_spacing: 100, mask: 1n }));
    await flush();
    const cells = host.sent[0]?.fields.data as number[];
    expect(cells.every((c) => c === TERRAIN_NODATA)).toBe(true);
  });

  it('stops serving after dispose', async () => {
    const host = mockHost();
    const svc = createTerrainService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      elevation,
    });
    svc.dispose();
    host.emit(msg('TERRAIN_REQUEST', { lat: 0, lon: 0, grid_spacing: 100, mask: 1n }));
    await flush();
    expect(host.sent).toHaveLength(0);
  });
});

describe('TerrainService — TERRAIN_REPORT', () => {
  it('tracks the latest report and notifies listeners', () => {
    const host = mockHost();
    const elevation: TerrainElevationSource = { sampleElevation: async () => 0 };
    const svc = createTerrainService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      elevation,
    });
    const seen = vi.fn();
    svc.onReport(seen);

    host.emit(
      msg('TERRAIN_REPORT', {
        lat: 100000000,
        lon: 200000000,
        terrain_height: 540.5,
        current_height: 80,
        spacing: 100,
        pending: 3,
        loaded: 42,
      }),
    );

    const report = svc.lastReport();
    expect(report?.lat).toBeCloseTo(10, 6);
    expect(report?.lon).toBeCloseTo(20, 6);
    expect(report?.terrainHeightM).toBe(540.5);
    expect(report?.currentHeightM).toBe(80);
    expect(report?.pending).toBe(3);
    expect(report?.loaded).toBe(42);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
