/**
 * {@link TerrainService} — the MAVLink TERRAIN microservice (task T4.8; spec
 * plan/03 §3.4 Terrain). It answers the vehicle's `TERRAIN_REQUEST` (msg 133)
 * with `TERRAIN_DATA` (msg 134) sourced from an injected elevation provider, and
 * tracks `TERRAIN_REPORT` (msg 136) so the UI can show terrain-database load
 * progress and the under-vehicle AGL the autopilot computes.
 *
 * The wire seam (`sendMessage` / `onMessage`, bound by the caller to the worker
 * host's taps) and the elevation source are injected, so the service unit-tests
 * against a mock host + a mock provider with no worker and no network.
 *
 * ## TERRAIN_REQUEST → TERRAIN_DATA
 *
 * A request names one `28 × 32`-post block (SW corner `lat`/`lon` degE7, posts
 * `grid_spacing` m apart) and a 56-bit `mask` of which `4 × 4` sub-blocks it
 * needs. For each set bit the service samples 16 elevations from the provider at
 * the sub-block's post positions (see `./grid.ts`) and sends one `TERRAIN_DATA`
 * carrying the request corner (echoed), `grid_spacing`, the `gridbit`, and the
 * 16 `int16` heights (`data[x·4 + y]`, `x` north / `y` east). Missing elevations
 * become the `-32768` no-data sentinel. Mirrors `AP_Terrain`.
 */
import { CELLS_PER_BLOCK, encodeElevation, maskBits, subBlockSamplePoints } from './grid';
import type { LatLon } from '../../../geo/format';
import type { DecodedMessage, FieldValue } from '../../../contracts';
import { numField as num } from '../fields';

/** Encode + send a message out the active link (bound to host `sendMessage`). */
export type TerrainSendFn = (name: string, fields: Record<string, unknown>) => void | Promise<void>;

/** Subscribe a selective decoded-message tap (bound to host `onMessage`). */
export type TerrainMessageTap = (
  names: readonly string[],
  cb: (msg: DecodedMessage) => void,
) => () => void;

/**
 * The elevation surface the service samples. The `geo/terrain`
 * {@link ElevationProvider} satisfies it structurally (its `sampleElevation`
 * accepts an optional `zoom`); tests pass a mock.
 */
export interface TerrainElevationSource {
  /** Ground elevation (metres AMSL) at `lat`/`lon`, or `undefined` if unknown. */
  sampleElevation(lat: number, lon: number): Promise<number | undefined>;
}

/** A decoded `TERRAIN_REPORT` (msg 136): the autopilot's terrain-DB status. */
export interface TerrainReport {
  /** Reported latitude, degrees (decoded from degE7). */
  readonly lat: number;
  /** Reported longitude, degrees (decoded from degE7). */
  readonly lon: number;
  /** Terrain elevation under the vehicle, metres AMSL. */
  readonly terrainHeightM: number;
  /** Vehicle height above terrain (AGL), metres. */
  readonly currentHeightM: number;
  /** Grid spacing of the loaded terrain, metres. */
  readonly spacingM: number;
  /** Grid blocks still pending download from the GCS. */
  readonly pending: number;
  /** Grid blocks loaded on the vehicle. */
  readonly loaded: number;
}

/** Construction dependencies for {@link TerrainService}. */
export interface TerrainServiceDeps {
  /** Encode + send a message (host `sendMessage`). */
  readonly sendMessage: TerrainSendFn;
  /** Subscribe a decoded-message tap (host `onMessage`). */
  readonly onMessage: TerrainMessageTap;
  /** Elevation source sampled to fill `TERRAIN_DATA`. */
  readonly elevation: TerrainElevationSource;
}

/** Read a field as a `bigint` (the `uint64` mask); `0n` when absent/non-numeric. */
function bigintOf(fields: Record<string, FieldValue>, key: string): bigint {
  const v = fields[key];
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  return 0n;
}

/**
 * Serves terrain to the vehicle and tracks its terrain reports. Construct with
 * {@link createTerrainService}; see the file header and ./README.md.
 */
export class TerrainService {
  private readonly sendMessage: TerrainSendFn;
  private readonly elevation: TerrainElevationSource;
  private readonly unsubscribe: () => void;
  private readonly reportListeners = new Set<(r: TerrainReport) => void>();
  private report: TerrainReport | undefined;
  /** Blocks served since construction (diagnostics). */
  private servedBlocks = 0;
  private disposed = false;

  constructor(deps: TerrainServiceDeps) {
    this.sendMessage = deps.sendMessage;
    this.elevation = deps.elevation;
    this.unsubscribe = deps.onMessage(['TERRAIN_REQUEST', 'TERRAIN_REPORT'], (msg) =>
      this.onMessage(msg),
    );
  }

  /** The most recently received `TERRAIN_REPORT`, or `undefined`. */
  lastReport(): TerrainReport | undefined {
    return this.report;
  }

  /** Number of `TERRAIN_DATA` sub-blocks sent since construction. */
  blocksServed(): number {
    return this.servedBlocks;
  }

  /** Subscribe to decoded `TERRAIN_REPORT`s; returns an unsubscribe fn. */
  onReport(cb: (r: TerrainReport) => void): () => void {
    this.reportListeners.add(cb);
    return () => {
      this.reportListeners.delete(cb);
    };
  }

  /** Tear down: unsubscribe the tap and drop listeners. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.reportListeners.clear();
  }

  // --- message dispatch ---------------------------------------------------

  private onMessage(msg: DecodedMessage): void {
    if (this.disposed) return;
    if (msg.name === 'TERRAIN_REQUEST') {
      void this.handleRequest(msg);
    } else if (msg.name === 'TERRAIN_REPORT') {
      this.handleReport(msg);
    }
  }

  /**
   * Answer a `TERRAIN_REQUEST`: for each set mask bit, sample the 16 sub-block
   * elevations and send a `TERRAIN_DATA`. Sub-blocks are served sequentially to
   * bound provider concurrency; a per-sample provider failure becomes no-data.
   */
  private async handleRequest(msg: DecodedMessage): Promise<void> {
    const latE7 = num(msg.fields, 'lat');
    const lonE7 = num(msg.fields, 'lon');
    const spacing = num(msg.fields, 'grid_spacing');
    if (latE7 === undefined || lonE7 === undefined || spacing === undefined || spacing <= 0) return;
    const corner: LatLon = { lat: latE7 * 1e-7, lon: lonE7 * 1e-7 };
    const bits = maskBits(bigintOf(msg.fields, 'mask'));
    for (const gridbit of bits) {
      if (this.disposed) return;
      const data = await this.sampleSubBlock(corner, spacing, gridbit);
      if (this.disposed) return;
      this.send('TERRAIN_DATA', {
        lat: latE7,
        lon: lonE7,
        grid_spacing: spacing,
        gridbit,
        data,
      });
      this.servedBlocks++;
    }
  }

  /** Sample the 16 `int16` heights for one sub-block (`data[x·4 + y]` order). */
  private async sampleSubBlock(
    corner: LatLon,
    spacingM: number,
    gridbit: number,
  ): Promise<number[]> {
    const points = subBlockSamplePoints(corner, spacingM, gridbit);
    const data: number[] = new Array<number>(CELLS_PER_BLOCK).fill(0);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      let elevation: number | undefined;
      if (p !== undefined) {
        try {
          elevation = await this.elevation.sampleElevation(p.lat, p.lon);
        } catch {
          elevation = undefined;
        }
      }
      data[i] = encodeElevation(elevation);
    }
    return data;
  }

  /** Decode + store a `TERRAIN_REPORT`, notifying listeners. */
  private handleReport(msg: DecodedMessage): void {
    const latE7 = num(msg.fields, 'lat') ?? 0;
    const lonE7 = num(msg.fields, 'lon') ?? 0;
    const report: TerrainReport = {
      lat: latE7 * 1e-7,
      lon: lonE7 * 1e-7,
      terrainHeightM: num(msg.fields, 'terrain_height') ?? 0,
      currentHeightM: num(msg.fields, 'current_height') ?? 0,
      spacingM: num(msg.fields, 'spacing') ?? 0,
      pending: num(msg.fields, 'pending') ?? 0,
      loaded: num(msg.fields, 'loaded') ?? 0,
    };
    this.report = report;
    for (const cb of this.reportListeners) cb(report);
  }

  /** Fire-and-forget send; a send failure is swallowed (serving is best-effort). */
  private send(name: string, fields: Record<string, unknown>): void {
    try {
      Promise.resolve(this.sendMessage(name, fields)).catch(() => {
        /* serving is best-effort; the vehicle re-requests unfilled blocks */
      });
    } catch {
      /* synchronous send failure — ignored, vehicle will re-request */
    }
  }
}

/** Construct a {@link TerrainService} (ergonomic factory mirroring sibling services). */
export function createTerrainService(deps: TerrainServiceDeps): TerrainService {
  return new TerrainService(deps);
}
