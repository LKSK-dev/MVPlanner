/**
 * `ui/screens/logs/track` public surface (task T6.5; spec plan/04 §4.8).
 *
 * The log flight-track core: GPS/POS series detection, the plot-cursor ⇄
 * map-position mapping (pure), and the map cursor-marker layer. Cross-module
 * consumers (the Logs screen assembly T6.8) import from here, never deep paths
 * (conventions plan/implementation/00 §0.3).
 *
 * @see ./track.ts for the geometry + layer and what is pure-tested vs
 *   canvas-deferred.
 */
export {
  buildTrackFromSeries,
  createTrackCursorLayer,
  findTrackSource,
  interpolateTrackAt,
  nearestTrackTime,
  type TrackCursorLayerOptions,
  type TrackSample,
  type TrackSource,
} from './track';
