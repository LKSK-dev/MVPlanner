/**
 * `ui/widgets/map/layers` public surface (task T2.4; spec plan/04 §4.2 map
 * overlays, §4.3 plan-geometry display). The overlay layers that the map engine
 * renders each frame via `MapLayer.render(ctx)`:
 *
 * - **live** layers driven by reactive data accessors the Flight screen (T2.11)
 *   wires: {@link createVehicleLayer}, {@link createHomeLayer},
 *   {@link createTrackLayer} (+ {@link createTrackRing} for the bounded history);
 * - **scaffold** layers that render when data is present and draw nothing when
 *   empty — fed real data in M4: {@link createMissionLayer},
 *   {@link createGeofenceLayer}, {@link createRallyLayer}.
 *
 * Every layer takes a pure {@link DataAccessor} so it is store-agnostic and
 * unit-testable with a plain closure + a stub `MapRenderCtx`. The pure geometry
 * (icon transform, track decimation, great-circle distance, polygon area,
 * radius scaling) lives in {@link module:./geometry}; the `<canvas>` draw is
 * canvas-deferred ({@link module:./draw}).
 *
 * Importing this module registers the `mapoverlay.*` i18n strings.
 *
 * @see ./README.md for the layer set, the data-accessor API and what is
 *   pure-tested vs canvas-deferred.
 */
import './messages';

export {
  EARTH_RADIUS_M,
  METERS_PER_DEG_LAT,
  decimateTrack,
  formatAreaM2,
  formatDistanceM,
  haversineMeters,
  headingVectorEnd,
  pathLengthMeters,
  polygonAreaMeters2,
  projectPath,
  radiusToPixels,
  toRadians,
  vehicleIconPolygon,
  type LatLon,
  type Project,
  type ScreenPoint,
} from './geometry';

export { createTrackRing, type TrackRing, type TrackRingOptions } from './track-ring';

export type {
  DataAccessor,
  FenceCircle,
  GeofenceOverlay,
  MissionOverlay,
  MissionWaypoint,
  RallyOverlay,
  RallyPoint,
  VehicleOverlay,
} from './types';

export { createVehicleLayer, type VehicleLayerOptions } from './vehicle';
export { createHomeLayer, type HomeLayerOptions } from './home';
export { createTrackLayer, type TrackLayerOptions } from './track';
export { createMissionLayer, type MissionLayerOptions } from './mission';
export { createGeofenceLayer, type GeofenceLayerOptions } from './fence';
export { createRallyLayer, type RallyLayerOptions } from './rally';

export { MAP_OVERLAY_MESSAGES } from './messages';
