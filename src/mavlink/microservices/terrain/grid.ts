/**
 * Pure geometry for the MAVLink TERRAIN protocol grid (task T4.8; spec plan/03
 * §3.4 Terrain). No I/O — the {@link TerrainService} uses these to turn a
 * `TERRAIN_REQUEST` into the set of 4×4 `TERRAIN_DATA` sub-blocks it must reply
 * with, and to map each sub-block cell back to a geographic sample point.
 *
 * ## Protocol grid (ArduPilot `AP_Terrain`)
 *
 * A `TERRAIN_REQUEST` names ONE grid block whose **south-west corner** is its
 * `lat`/`lon` (degE7) and whose posts are `grid_spacing` metres apart. The block
 * is `28 × 32` posts = `{@link MUL_X}·4` (north) × `{@link MUL_Y}·4` (east),
 * carved into `7 × 8 = 56` sub-blocks of `4 × 4` posts each. The request's 64-bit
 * `mask` has one bit per sub-block; each set bit needs one `TERRAIN_DATA` reply.
 *
 * For sub-block bit `b` (`0…55`):
 *   - `idxX = (b ÷ {@link MUL_Y})·4` — north (latitude) post offset of the block,
 *   - `idxY = (b mod {@link MUL_Y})·4` — east  (longitude) post offset,
 * and the 16 `int16` heights are row-major `data[x·4 + y]` for `x` (north, `0…3`)
 * and `y` (east, `0…3`), i.e. post `(idxX + x, idxY + y)` of the block. The reply
 * `lat`/`lon` echo the request corner; the receiver locates the sub-block from
 * `gridbit`. This mirrors `AP_Terrain::handle_terrain_data`.
 */
import { offsetLatLon } from '../../../geo/terrain';
import type { LatLon } from '../../../geo/format';

/** Posts per side of a `TERRAIN_DATA` sub-block (the `4 × 4` MAVLink grid). */
export const MAVLINK_GRID_SIZE = 4;
/** Sub-blocks along the north (latitude) axis of a request block. */
export const MUL_X = 7;
/** Sub-blocks along the east (longitude) axis of a request block. */
export const MUL_Y = 8;
/** Posts along the north axis of a request block (`MUL_X · 4 = 28`). */
export const BLOCK_SIZE_X = MAVLINK_GRID_SIZE * MUL_X;
/** Posts along the east axis of a request block (`MUL_Y · 4 = 32`). */
export const BLOCK_SIZE_Y = MAVLINK_GRID_SIZE * MUL_Y;
/** Number of sub-block mask bits (`MUL_X · MUL_Y = 56`). */
export const MASK_BITS = MUL_X * MUL_Y;
/** Cells per `TERRAIN_DATA` payload (`4 · 4 = 16`). */
export const CELLS_PER_BLOCK = MAVLINK_GRID_SIZE * MAVLINK_GRID_SIZE;

/** int16 sentinel ArduPilot uses for "no data" in a terrain cell. */
export const TERRAIN_NODATA = -32768;

/** The north/east post offset (in posts) of sub-block `gridbit`'s SW corner. */
export interface SubBlockOrigin {
  /** North (latitude) post offset within the request block. */
  readonly idxX: number;
  /** East (longitude) post offset within the request block. */
  readonly idxY: number;
}

/** Map a `gridbit` (`0…55`) to its sub-block post origin within the block. */
export function gridbitOrigin(gridbit: number): SubBlockOrigin {
  const gx = Math.trunc(gridbit / MUL_Y);
  const gy = gridbit % MUL_Y;
  return { idxX: gx * MAVLINK_GRID_SIZE, idxY: gy * MAVLINK_GRID_SIZE };
}

/** Enumerate the set bit indices (`0…55`) of a 56-bit request `mask`. */
export function maskBits(mask: bigint): number[] {
  const bits: number[] = [];
  for (let b = 0; b < MASK_BITS; b++) {
    if ((mask & (1n << BigInt(b))) !== 0n) bits.push(b);
  }
  return bits;
}

/**
 * The 16 sample positions (row-major `data[x·4 + y]`, `x` north / `y` east) for
 * sub-block `gridbit` of the block whose SW corner is `corner`, posts spaced
 * `gridSpacingM` apart. Index `i` of the result is the cell stored at
 * `TERRAIN_DATA.data[i]`.
 */
export function subBlockSamplePoints(
  corner: LatLon,
  gridSpacingM: number,
  gridbit: number,
): LatLon[] {
  const { idxX, idxY } = gridbitOrigin(gridbit);
  const points: LatLon[] = [];
  for (let x = 0; x < MAVLINK_GRID_SIZE; x++) {
    for (let y = 0; y < MAVLINK_GRID_SIZE; y++) {
      const northM = (idxX + x) * gridSpacingM;
      const eastM = (idxY + y) * gridSpacingM;
      points.push(offsetLatLon(corner, northM, eastM));
    }
  }
  return points;
}

/**
 * Clamp + round a metre elevation into the `int16` range used by `TERRAIN_DATA`,
 * mapping `undefined` (no elevation available) to the {@link TERRAIN_NODATA}
 * sentinel. Out-of-range finite values saturate at the int16 bounds.
 */
export function encodeElevation(elevationM: number | undefined): number {
  if (elevationM === undefined || !Number.isFinite(elevationM)) return TERRAIN_NODATA;
  return Math.max(-32768, Math.min(32767, Math.round(elevationM)));
}
