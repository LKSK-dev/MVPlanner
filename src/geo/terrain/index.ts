/**
 * `geo/terrain` public surface (task T4.8; spec plan/04 §4.3 terrain following,
 * plan/03 §3.4 Terrain, plan/07 §7.8 offline terrain).
 *
 * A Terrarium-RGB elevation provider over the `geo/tiles` cache (cache-first,
 * graceful offline), plus the pure profile / collision / terrain-frame math that
 * feeds the Plan-screen terrain profile chart and the TERRAIN microservice.
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3).
 *
 * @see ./README.md for the decode, sampling and collision details.
 */
export {
  TERRARIUM_OFFSET_M,
  decodeTerrarium,
  elevationAtPixel,
  isImageDecoderAvailable,
  createImageDecoder,
  type TilePixels,
  type TileDecoder,
} from './decode';

export {
  DEFAULT_TERRAIN_SOURCE,
  DEFAULT_TERRAIN_ZOOM,
  DEFAULT_MAX_DECODED_TILES,
  createElevationProvider,
  type ElevationProvider,
  type ElevationProviderDeps,
  type TerrainTileSource,
} from './provider';

export {
  EARTH_RADIUS_M,
  M_PER_DEG_LAT,
  haversineMeters,
  offsetLatLon,
  samplePath,
  aglToAmsl,
  amslToAgl,
  collisionCheck,
  type PathSample,
  type ElevationSample,
  type TerrainProfilePoint,
  type CollisionMarker,
} from './profile';
