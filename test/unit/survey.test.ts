/**
 * Survey / grid generator tests (task T4.5; spec plan/04 §4.3 survey/grid).
 *
 * Pure photogrammetry math (GSD / line spacing / trigger distance), grid
 * generation over a simple rectangle (line count + lawn-mower ordering +
 * plausible estimates), angle rotation and the mission-waypoint conversion. No
 * DOM, no network — everything here is deterministic.
 */
import { describe, expect, it } from 'vitest';
import {
  CMD_DO_SET_CAM_TRIGG_DIST,
  CMD_NAV_WAYPOINT,
  DEFAULT_SURVEY_SPEED_MS,
  altitudeFromGsd,
  generateGrid,
  groundFootprint,
  gsdFromAltitude,
  lineSpacingFromSidelap,
  surveyToMission,
  toPlanar,
  triggerDistanceFromFrontlap,
  type CameraModel,
  type SurveyOptions,
} from '../../src/geo/survey';
import type { LatLon } from '../../src/geo/format';

/** Clean test camera: GSD/footprint come out to round numbers at 100 m. */
const CAMERA: CameraModel = {
  sensorWidthMm: 36,
  sensorHeightMm: 24,
  focalLengthMm: 50,
  imageWidthPx: 6000,
  imageHeightPx: 4000,
};

describe('camera photogrammetry math', () => {
  it('computes GSD from a known camera + altitude', () => {
    // 36 * 100 / (50 * 6000) = 0.012 m/px
    expect(gsdFromAltitude(CAMERA, 100)).toBeCloseTo(0.012, 9);
  });

  it('inverts GSD ↔ altitude', () => {
    const gsd = gsdFromAltitude(CAMERA, 100);
    expect(altitudeFromGsd(CAMERA, gsd)).toBeCloseTo(100, 6);
  });

  it('computes the ground footprint', () => {
    const fp = groundFootprint(CAMERA, 0.012);
    expect(fp.widthM).toBeCloseTo(72, 6); // 0.012 * 6000
    expect(fp.heightM).toBeCloseTo(48, 6); // 0.012 * 4000
  });

  it('computes line spacing from sidelap', () => {
    // 72 m footprint, 60% sidelap → 28.8 m spacing
    expect(lineSpacingFromSidelap(72, 60)).toBeCloseTo(28.8, 9);
  });

  it('computes trigger distance from frontlap', () => {
    // 48 m footprint, 75% frontlap → 12 m
    expect(triggerDistanceFromFrontlap(48, 75)).toBeCloseTo(12, 9);
  });

  it('rejects out-of-range overlaps and bad dimensions', () => {
    expect(() => lineSpacingFromSidelap(72, 100)).toThrow();
    expect(() => triggerDistanceFromFrontlap(48, -1)).toThrow();
    expect(() => gsdFromAltitude(CAMERA, 0)).toThrow();
  });
});

/**
 * A ~580 m (E-W) × ~370 m (N-S) rectangle near the equator. At lat 0 a degree of
 * longitude ≈ 111320 m, so we size the box from metres for predictable spans.
 */
const ORIGIN: LatLon = { lat: 0, lon: 0 };
function rectFromMeters(halfWidthM: number, halfHeightM: number): LatLon[] {
  const mPerDeg = 111319.49079327357; // EARTH_RADIUS_M * PI/180
  const dLon = halfWidthM / mPerDeg;
  const dLat = halfHeightM / mPerDeg;
  return [
    { lat: ORIGIN.lat - dLat, lon: ORIGIN.lon - dLon },
    { lat: ORIGIN.lat - dLat, lon: ORIGIN.lon + dLon },
    { lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon },
    { lat: ORIGIN.lat + dLat, lon: ORIGIN.lon - dLon },
  ];
}

const BASE_OPTS: SurveyOptions = {
  sensor: { kind: 'camera', camera: CAMERA, altitudeM: 100 },
  frontlapPct: 75,
  sidelapPct: 60,
  angleDeg: 0,
  speedMs: 10,
};

describe('generateGrid over a rectangle', () => {
  // 290 m half-width (580 m E-W), 185 m half-height (370 m N-S).
  const polygon = rectFromMeters(290, 185);

  it('produces the expected line count for north-south lines', () => {
    const grid = generateGrid(polygon, BASE_OPTS);
    // Lines run N-S (angle 0); spacing 28.8 m across the 580 m E-W span:
    // floor(580 / 28.8) + 1 = 20 + 1 = 21.
    expect(grid.estimates.lineCount).toBe(21);
    expect(grid.lines.length).toBe(21);
  });

  it('orders the sweep lines boustrophedon (lawn-mower)', () => {
    const grid = generateGrid(polygon, BASE_OPTS);
    // Each line spans the full N-S height; consecutive lines reverse direction,
    // so the end of one line is close to the start of the next (short connector).
    for (let i = 1; i < grid.lines.length; i += 1) {
      const prev = grid.lines[i - 1];
      const cur = grid.lines[i];
      if (prev === undefined || cur === undefined) throw new Error('missing line');
      const prevEnd = toPlanar(prev.end, ORIGIN);
      const curStart = toPlanar(cur.start, ORIGIN);
      const connector = Math.hypot(prevEnd.x - curStart.x, prevEnd.y - curStart.y);
      // The connector is roughly one line-spacing (≈28.8 m), never a full line.
      expect(connector).toBeLessThan(40);
    }
    // Direction alternates: line 0 goes south→north, line 1 north→south.
    const l0 = grid.lines[0];
    const l1 = grid.lines[1];
    if (l0 === undefined || l1 === undefined) throw new Error('missing line');
    expect(Math.sign(l0.end.lat - l0.start.lat)).toBe(-Math.sign(l1.end.lat - l1.start.lat));
  });

  it('reports plausible estimates', () => {
    const grid = generateGrid(polygon, BASE_OPTS);
    const e = grid.estimates;
    expect(e.gsdM).toBeCloseTo(0.012, 9);
    expect(e.altitudeM).toBe(100);
    expect(e.lineSpacingM).toBeCloseTo(28.8, 6);
    expect(e.triggerDistanceM).toBeCloseTo(12, 6);
    // Covered area ≈ 580 m × 370 m = 214600 m² (within projection tolerance).
    expect(e.coveredAreaM2).toBeGreaterThan(213000);
    expect(e.coveredAreaM2).toBeLessThan(216000);
    // 21 lines × ~370 m each = ~7770 m of lines, plus connectors.
    expect(e.pathLengthM).toBeGreaterThan(7770);
    expect(e.pathLengthM).toBeLessThan(9500);
    expect(e.durationS).toBeCloseTo(e.pathLengthM / 10, 6);
    // Photos: ~ (370/12 + 1) ≈ 32 per line × 21 ≈ 670+.
    expect(e.photoCount).toBeGreaterThan(600);
  });

  it('rotates the grid 90° so lines run east-west', () => {
    const grid = generateGrid(polygon, { ...BASE_OPTS, angleDeg: 90 });
    // Lines now run E-W; spacing 28.8 m across the 370 m N-S span:
    // floor(370 / 28.8) + 1 = 12 + 1 = 13.
    expect(grid.estimates.lineCount).toBe(13);
    const l0 = grid.lines[0];
    if (l0 === undefined) throw new Error('missing line');
    // A horizontal (E-W) line keeps latitude ~constant and changes longitude.
    expect(Math.abs(l0.end.lat - l0.start.lat)).toBeLessThan(1e-6);
    expect(Math.abs(l0.end.lon - l0.start.lon)).toBeGreaterThan(1e-3);
  });

  it('honours a direct (camera-less) sensor spec', () => {
    const grid = generateGrid(polygon, {
      sensor: {
        kind: 'direct',
        groundAltitudeM: 120,
        gsdM: 0.02,
        footprintWidthM: 72,
        footprintHeightM: 48,
      },
      frontlapPct: 75,
      sidelapPct: 60,
    });
    expect(grid.altitudeM).toBe(120);
    expect(grid.estimates.lineSpacingM).toBeCloseTo(28.8, 6);
    expect(grid.estimates.lineCount).toBe(21);
  });

  it('appends entry/exit waypoints when provided', () => {
    const entry: LatLon = { lat: -0.01, lon: -0.01 };
    const exit: LatLon = { lat: 0.01, lon: 0.01 };
    const grid = generateGrid(polygon, { ...BASE_OPTS, entry, exit });
    expect(grid.waypoints[0]).toEqual(entry);
    expect(grid.waypoints[grid.waypoints.length - 1]).toEqual(exit);
  });

  it('rejects degenerate polygons and bad sensor specs', () => {
    expect(() => generateGrid([{ lat: 0, lon: 0 }], BASE_OPTS)).toThrow();
    expect(() =>
      generateGrid(polygon, { ...BASE_OPTS, sensor: { kind: 'camera', camera: CAMERA } }),
    ).toThrow();
  });

  it('defaults the time estimate speed', () => {
    const grid = generateGrid(polygon, {
      sensor: { kind: 'camera', camera: CAMERA, altitudeM: 100 },
      frontlapPct: 75,
      sidelapPct: 60,
    });
    expect(grid.estimates.durationS).toBeCloseTo(
      grid.estimates.pathLengthM / DEFAULT_SURVEY_SPEED_MS,
      6,
    );
  });
});

describe('surveyToMission', () => {
  const polygon = rectFromMeters(290, 185);
  const grid = generateGrid(polygon, BASE_OPTS);

  it('builds NAV_WAYPOINT items bracketed by camera-trigger items', () => {
    const mission = surveyToMission(grid, { altitudeM: 100 });
    expect(mission.type).toBe('mission');
    const first = mission.items[0];
    const last = mission.items[mission.items.length - 1];
    if (first === undefined || last === undefined) throw new Error('empty mission');
    // First + last are the enable/disable camera-trigger items.
    expect(first.command).toBe(CMD_DO_SET_CAM_TRIGG_DIST);
    expect(first.params[0]).toBeCloseTo(grid.estimates.triggerDistanceM, 6);
    expect(last.command).toBe(CMD_DO_SET_CAM_TRIGG_DIST);
    expect(last.params[0]).toBe(0);

    const waypoints = mission.items.filter((i) => i.command === CMD_NAV_WAYPOINT);
    expect(waypoints.length).toBe(grid.waypoints.length);
    const wp0 = waypoints[0];
    if (wp0 === undefined) throw new Error('no waypoint');
    expect(wp0.z).toBe(100);
    expect(wp0.frame).toBe(3);
    // seq numbers are sequential from 0.
    mission.items.forEach((it, i) => expect(it.seq).toBe(i));
  });

  it('omits camera-trigger items when disabled', () => {
    const mission = surveyToMission(grid, { cameraTrigger: false });
    expect(mission.items.every((i) => i.command === CMD_NAV_WAYPOINT)).toBe(true);
    expect(mission.items.length).toBe(grid.waypoints.length);
  });
});
