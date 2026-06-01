/**
 * Lawn-mower survey grid generator for `geo/survey` (task T4.5; spec plan/04
 * §4.3 survey/grid).
 *
 * {@link generateGrid} turns a survey polygon plus a camera/overlap/altitude
 * specification into ordered boustrophedon sweep lines and the derived survey
 * estimates. Pure and DOM-free — the UI panel (`ui/screens/plan/survey`) and the
 * waypoint converter (`./waypoints`) build on top of it.
 */
import type { LatLon } from '../format';
import {
  altitudeFromGsd,
  gsdFromAltitude,
  groundFootprint,
  lineSpacingFromSidelap,
  triggerDistanceFromFrontlap,
} from './camera';
import {
  distance,
  polygonAreaM2,
  polygonCentroid,
  scanLineSegments,
  toLatLon,
  toPlanar,
  uvToPlanar,
  type PlanarPoint,
} from './geometry';
import type {
  GridLine,
  ResolvedSensor,
  SensorSpec,
  SurveyEstimates,
  SurveyGrid,
  SurveyOptions,
} from './types';

/** Default ground speed (m/s) used for the time estimate when unspecified. */
export const DEFAULT_SURVEY_SPEED_MS = 10;

/**
 * Resolve a {@link SensorSpec} to concrete GSD / altitude / footprint metres.
 *
 * @throws if a camera spec supplies neither (or both) of `altitudeM`/`gsdM`.
 */
export function resolveSensor(sensor: SensorSpec): ResolvedSensor {
  if (sensor.kind === 'direct') {
    return {
      gsdM: sensor.gsdM,
      altitudeM: sensor.groundAltitudeM,
      footprintWidthM: sensor.footprintWidthM,
      footprintHeightM: sensor.footprintHeightM,
    };
  }
  const hasAlt = sensor.altitudeM !== undefined;
  const hasGsd = sensor.gsdM !== undefined;
  if (hasAlt === hasGsd) {
    throw new Error('generateGrid: camera sensor needs exactly one of altitudeM or gsdM');
  }
  const altitudeM = hasAlt
    ? (sensor.altitudeM as number)
    : altitudeFromGsd(sensor.camera, sensor.gsdM as number);
  const gsdM = hasGsd ? (sensor.gsdM as number) : gsdFromAltitude(sensor.camera, altitudeM);
  const footprint = groundFootprint(sensor.camera, gsdM);
  return {
    gsdM,
    altitudeM,
    footprintWidthM: footprint.widthM,
    footprintHeightM: footprint.heightM,
  };
}

/**
 * Generate a lawn-mower (boustrophedon) survey grid over `polygon`.
 *
 * Sweep lines run along `opts.angleDeg` (compass bearing, `0` = north), spaced
 * by the sidelap-derived line spacing and clipped to the polygon. Lines are
 * ordered so consecutive lines reverse direction, minimising connector travel.
 * Photos are estimated from the frontlap-derived trigger distance along each
 * line; covered area is the polygon area; time is `pathLength / speed`.
 *
 * @throws if the polygon has fewer than three vertices, the sensor spec is
 * inconsistent, or the overlaps yield a non-positive spacing.
 */
export function generateGrid(polygon: readonly LatLon[], opts: SurveyOptions): SurveyGrid {
  if (polygon.length < 3) {
    throw new Error('generateGrid: polygon needs at least three vertices');
  }
  const sensor = resolveSensor(opts.sensor);
  const lineSpacingM = lineSpacingFromSidelap(sensor.footprintWidthM, opts.sidelapPct);
  const triggerDistanceM = triggerDistanceFromFrontlap(sensor.footprintHeightM, opts.frontlapPct);

  const origin = polygonCentroid(polygon);
  const planar = polygon.map((p) => toPlanar(p, origin));
  const coveredAreaM2 = polygonAreaM2(planar);

  const angleRad = (opts.angleDeg ?? 0) * (Math.PI / 180);
  const along: PlanarPoint = { x: Math.sin(angleRad), y: Math.cos(angleRad) };
  const across: PlanarPoint = { x: Math.cos(angleRad), y: -Math.sin(angleRad) };

  // Across-coordinate (v) extent of the polygon.
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of planar) {
    const v = p.x * across.x + p.y * across.y;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const span = vMax - vMin;
  const lineCount = Math.max(1, Math.floor(span / lineSpacingM) + 1);
  // Centre the line bundle within the polygon's across-extent.
  const firstV = vMin + (span - (lineCount - 1) * lineSpacingM) / 2;

  const lines: GridLine[] = [];
  const waypoints: LatLon[] = [];
  let photoCount = 0;

  for (let k = 0; k < lineCount; k += 1) {
    const vLine = firstV + k * lineSpacingM;
    const segments = scanLineSegments(planar, along, across, vLine);
    if (segments.length === 0) continue;
    const reverse = k % 2 === 1;
    const ordered = reverse ? [...segments].reverse() : segments;
    for (const seg of ordered) {
      const lo = reverse ? seg.uHi : seg.uLo;
      const hi = reverse ? seg.uLo : seg.uHi;
      const start = toLatLon(uvToPlanar(lo, vLine, along, across), origin);
      const end = toLatLon(uvToPlanar(hi, vLine, along, across), origin);
      lines.push({ start, end });
      waypoints.push(start, end);
      const segLen = Math.abs(seg.uHi - seg.uLo);
      photoCount += Math.floor(segLen / triggerDistanceM) + 1;
    }
  }

  if (opts.entry !== undefined) waypoints.unshift(opts.entry);
  if (opts.exit !== undefined) waypoints.push(opts.exit);

  // Path length over the ordered waypoints (connectors included).
  let pathLengthM = 0;
  for (let i = 1; i < waypoints.length; i += 1) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    if (a === undefined || b === undefined) continue;
    pathLengthM += distance(toPlanar(a, origin), toPlanar(b, origin));
  }

  const speedMs = opts.speedMs ?? DEFAULT_SURVEY_SPEED_MS;
  const estimates: SurveyEstimates = {
    lineCount: lines.length,
    pathLengthM,
    photoCount,
    coveredAreaM2,
    durationS: speedMs > 0 ? pathLengthM / speedMs : 0,
    gsdM: sensor.gsdM,
    altitudeM: sensor.altitudeM,
    lineSpacingM,
    triggerDistanceM,
    footprintWidthM: sensor.footprintWidthM,
    footprintHeightM: sensor.footprintHeightM,
  };

  return { waypoints, lines, estimates, altitudeM: sensor.altitudeM };
}
