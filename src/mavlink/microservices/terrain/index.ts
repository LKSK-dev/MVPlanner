/**
 * `mavlink/microservices/terrain` public surface (task T4.8; spec plan/03 §3.4
 * Terrain). The {@link TerrainService} answers the vehicle's `TERRAIN_REQUEST`
 * with `TERRAIN_DATA` sampled from an injected elevation provider and tracks
 * `TERRAIN_REPORT`. The pure grid geometry (sub-block mask, sample positions,
 * int16 encoding) is exported for reuse/testing. Cross-module consumers import
 * from here, never deep paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the protocol grid, encoding and how to test it.
 */
export {
  TerrainService,
  createTerrainService,
  type TerrainServiceDeps,
  type TerrainSendFn,
  type TerrainMessageTap,
  type TerrainElevationSource,
  type TerrainReport,
} from './terrain-service';

export {
  MAVLINK_GRID_SIZE,
  MUL_X,
  MUL_Y,
  BLOCK_SIZE_X,
  BLOCK_SIZE_Y,
  MASK_BITS,
  CELLS_PER_BLOCK,
  TERRAIN_NODATA,
  gridbitOrigin,
  maskBits,
  subBlockSamplePoints,
  encodeElevation,
  type SubBlockOrigin,
} from './grid';
