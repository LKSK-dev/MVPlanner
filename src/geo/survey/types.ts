/**
 * Shared types for `geo/survey` (task T4.5; spec plan/04 §4.3 survey/grid).
 *
 * Pure, DOM-free photogrammetry survey-grid types. Coordinates are WGS84
 * {@link LatLon} (degrees); all linear quantities are **metres**, overlaps are
 * **percent** (`0–100`), angles are **degrees** and speeds are **metres per
 * second** — units are explicit in identifiers per the coding standards
 * (conventions plan/implementation/00 §0.3).
 */
import type { LatLon } from '../format';

/**
 * A frame camera / sensor model. The `sensorWidthMm` axis is treated as the
 * **across-track** dimension (drives line spacing via sidelap) and
 * `sensorHeightMm` as the **along-track** dimension (drives trigger distance via
 * frontlap), matching a landscape-mounted camera flown along its long axis.
 */
export interface CameraModel {
  /** Physical sensor width (across-track), millimetres. */
  sensorWidthMm: number;
  /** Physical sensor height (along-track), millimetres. */
  sensorHeightMm: number;
  /** Lens focal length, millimetres. */
  focalLengthMm: number;
  /** Image width in pixels (across-track). */
  imageWidthPx: number;
  /** Image height in pixels (along-track). */
  imageHeightPx: number;
}

/**
 * Camera-driven sensor spec. Supply **exactly one** of `altitudeM` (compute the
 * GSD from it) or `gsdM` (compute the required altitude from it).
 */
export interface SurveyCameraSpec {
  readonly kind: 'camera';
  /** The camera/sensor model. */
  camera: CameraModel;
  /** Survey altitude above ground, metres — derives the GSD. */
  altitudeM?: number;
  /** Target ground sample distance, metres/pixel — derives the altitude. */
  gsdM?: number;
}

/**
 * Camera-less sensor spec: the ground footprint and GSD/altitude are supplied
 * directly (e.g. for a sensor without a simple pinhole model).
 */
export interface SurveyDirectSpec {
  readonly kind: 'direct';
  /** Survey altitude above ground, metres. */
  groundAltitudeM: number;
  /** Ground sample distance, metres/pixel. */
  gsdM: number;
  /** Across-track ground footprint of one frame, metres. */
  footprintWidthM: number;
  /** Along-track ground footprint of one frame, metres. */
  footprintHeightM: number;
}

/** A resolved or camera-less sensor specification. */
export type SensorSpec = SurveyCameraSpec | SurveyDirectSpec;

/** A sensor spec fully resolved to concrete photogrammetry quantities. */
export interface ResolvedSensor {
  /** Ground sample distance, metres/pixel. */
  gsdM: number;
  /** Survey altitude above ground, metres. */
  altitudeM: number;
  /** Across-track ground footprint, metres. */
  footprintWidthM: number;
  /** Along-track ground footprint, metres. */
  footprintHeightM: number;
}

/** Options controlling {@link generateGrid}. */
export interface SurveyOptions {
  /** Sensor / altitude / GSD specification. */
  sensor: SensorSpec;
  /** Forward (along-track) overlap, percent `0–100` → trigger distance. */
  frontlapPct: number;
  /** Side (across-track) overlap, percent `0–100` → line spacing. */
  sidelapPct: number;
  /** Compass bearing of the sweep lines, degrees (`0` = north). Default `0`. */
  angleDeg?: number;
  /** Ground speed for the time estimate, metres/second. Default `10`. */
  speedMs?: number;
  /** Optional waypoint flown before the first sweep line. */
  entry?: LatLon;
  /** Optional waypoint flown after the last sweep line. */
  exit?: LatLon;
}

/** A single sweep-line segment, ordered start → end in the flight path. */
export interface GridLine {
  /** Segment start in WGS84. */
  start: LatLon;
  /** Segment end in WGS84. */
  end: LatLon;
}

/** Derived survey metrics for display / planning. */
export interface SurveyEstimates {
  /** Number of sweep lines that intersect the polygon. */
  lineCount: number;
  /** Total flight-path length including connector legs, metres. */
  pathLengthM: number;
  /** Estimated number of photos triggered along the lines. */
  photoCount: number;
  /** Survey polygon area, square metres. */
  coveredAreaM2: number;
  /** Estimated flight time at `speedMs`, seconds. */
  durationS: number;
  /** Ground sample distance, metres/pixel. */
  gsdM: number;
  /** Survey altitude above ground, metres. */
  altitudeM: number;
  /** Across-track spacing between adjacent lines, metres. */
  lineSpacingM: number;
  /** Along-track distance between photo triggers, metres. */
  triggerDistanceM: number;
  /** Across-track frame footprint, metres. */
  footprintWidthM: number;
  /** Along-track frame footprint, metres. */
  footprintHeightM: number;
}

/** The result of {@link generateGrid}. */
export interface SurveyGrid {
  /** Ordered boustrophedon (lawn-mower) waypoint path, including entry/exit. */
  waypoints: LatLon[];
  /** The sweep-line segments in flight order. */
  lines: GridLine[];
  /** Derived survey metrics. */
  estimates: SurveyEstimates;
  /** Survey altitude above ground, metres (mirrors `estimates.altitudeM`). */
  altitudeM: number;
}
