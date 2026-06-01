/**
 * Pure photogrammetry math for `geo/survey` (task T4.5; spec plan/04 §4.3).
 *
 * Standard pinhole-camera survey formulas. Every function is deterministic and
 * dependency-free (unit-tested in `test/unit/survey.test.ts`). Linear quantities
 * are **metres**, overlaps **percent** (`0–100`), pixel counts are integers.
 *
 * The mm units of `sensorWidthMm`/`focalLengthMm` cancel, so the GSD comes out
 * in metres-per-pixel when the altitude is in metres:
 *
 * ```text
 * GSD = (sensorWidthMm · altitudeM) / (focalLengthMm · imageWidthPx)
 * ```
 */
import type { CameraModel } from './types';

/** Assert a finite, strictly-positive value, else throw with `label`. */
function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`survey/camera: ${label} must be a positive finite number (got ${value})`);
  }
  return value;
}

/** Validate a camera model's dimensions are positive and finite. */
function checkCamera(camera: CameraModel): void {
  positive(camera.sensorWidthMm, 'sensorWidthMm');
  positive(camera.sensorHeightMm, 'sensorHeightMm');
  positive(camera.focalLengthMm, 'focalLengthMm');
  positive(camera.imageWidthPx, 'imageWidthPx');
  positive(camera.imageHeightPx, 'imageHeightPx');
}

/**
 * Ground sample distance (metres/pixel) for a `camera` flown at `altitudeM`
 * above the ground. Uses the across-track (`sensorWidthMm`/`imageWidthPx`) axis.
 */
export function gsdFromAltitude(camera: CameraModel, altitudeM: number): number {
  checkCamera(camera);
  positive(altitudeM, 'altitudeM');
  return (camera.sensorWidthMm * altitudeM) / (camera.focalLengthMm * camera.imageWidthPx);
}

/**
 * Survey altitude (metres above ground) required to achieve `gsdM` with
 * `camera`. The inverse of {@link gsdFromAltitude}.
 */
export function altitudeFromGsd(camera: CameraModel, gsdM: number): number {
  checkCamera(camera);
  positive(gsdM, 'gsdM');
  return (gsdM * camera.focalLengthMm * camera.imageWidthPx) / camera.sensorWidthMm;
}

/**
 * Ground footprint of one frame (metres) for `camera` at the given `gsdM`:
 * `width = gsd · imageWidthPx`, `height = gsd · imageHeightPx`.
 */
export function groundFootprint(
  camera: CameraModel,
  gsdM: number,
): { widthM: number; heightM: number } {
  checkCamera(camera);
  positive(gsdM, 'gsdM');
  return { widthM: gsdM * camera.imageWidthPx, heightM: gsdM * camera.imageHeightPx };
}

/**
 * Across-track spacing between adjacent flight lines (metres) for a given
 * across-track `footprintM` and `sidelapPct` (`0–100`):
 * `spacing = footprint · (1 − sidelap/100)`.
 */
export function lineSpacingFromSidelap(footprintM: number, sidelapPct: number): number {
  positive(footprintM, 'footprintM');
  if (!Number.isFinite(sidelapPct) || sidelapPct < 0 || sidelapPct >= 100) {
    throw new Error(`survey/camera: sidelapPct must be in [0, 100) (got ${sidelapPct})`);
  }
  return footprintM * (1 - sidelapPct / 100);
}

/**
 * Along-track distance between camera triggers (metres) for a given along-track
 * `footprintM` and `frontlapPct` (`0–100`):
 * `trigger = footprint · (1 − frontlap/100)`.
 */
export function triggerDistanceFromFrontlap(footprintM: number, frontlapPct: number): number {
  positive(footprintM, 'footprintM');
  if (!Number.isFinite(frontlapPct) || frontlapPct < 0 || frontlapPct >= 100) {
    throw new Error(`survey/camera: frontlapPct must be in [0, 100) (got ${frontlapPct})`);
  }
  return footprintM * (1 - frontlapPct / 100);
}

/** A sensible default sensor (DJI Phantom 4 Pro 1″ CMOS) for UI defaults. */
export const DEFAULT_CAMERA: CameraModel = {
  sensorWidthMm: 13.2,
  sensorHeightMm: 8.8,
  focalLengthMm: 8.8,
  imageWidthPx: 5472,
  imageHeightPx: 3648,
};
