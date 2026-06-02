/**
 * Map overlay layers — pure geometry + `project()` usage (task T2.4). The
 * imperative `<canvas>` draw is canvas-deferred: under happy-dom
 * `getContext('2d')` is `null`, so layers compute geometry (always calling
 * `project`) and bail before drawing. These tests assert the pure math and that
 * each layer drives `project()` for its geometry, using a stub `MapRenderCtx`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MapLayer, MapRenderCtx } from '../../src/contracts';
import {
  createGeofenceLayer,
  createHomeLayer,
  createMissionLayer,
  createRallyLayer,
  createTrackLayer,
  createTrackRing,
  createVehicleLayer,
  decimateTrack,
  formatAreaM2,
  formatDistanceM,
  haversineMeters,
  headingVectorEnd,
  pathLengthMeters,
  polygonAreaMeters2,
  projectPath,
  radiusToPixels,
  vehicleIconPolygon,
  type LatLon,
  type Project,
} from '../../src/ui/widgets/map/layers';

/**
 * A null-canvas `MapRenderCtx` with a spy `project`. `getContext('2d')` returns
 * `null` (the happy-dom reality), so layers exercise their pure geometry path
 * but never draw — exactly what we assert.
 */
function stubCtx(project: Project = (lat, lon) => [lon, lat]): {
  ctx: MapRenderCtx;
  project: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(project);
  const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
  return { ctx: { canvas, project: spy as unknown as Project }, project: spy };
}

function renderLayer(layer: MapLayer, project?: Project): ReturnType<typeof vi.fn> {
  const { ctx, project: spy } = stubCtx(project);
  layer.render(ctx);
  return spy;
}

describe('great-circle distance', () => {
  it('is zero for identical points and symmetric', () => {
    const a: LatLon = { lat: 10, lon: 20 };
    expect(haversineMeters(a, a)).toBe(0);
    const b: LatLon = { lat: 10.5, lon: 20.5 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('matches a known one-degree-of-latitude separation (~111 km)', () => {
    const d = haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('sums a polyline length', () => {
    const pts: LatLon[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 0, lon: 2 },
    ];
    const single = haversineMeters(pts[0]!, pts[1]!);
    expect(pathLengthMeters(pts)).toBeCloseTo(single * 2, 3);
    expect(pathLengthMeters([{ lat: 0, lon: 0 }])).toBe(0);
  });
});

describe('spherical polygon area', () => {
  it('is zero for degenerate rings', () => {
    expect(polygonAreaMeters2([])).toBe(0);
    expect(
      polygonAreaMeters2([
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ]),
    ).toBe(0);
  });

  it('is orientation-independent and ~ a small square near the equator', () => {
    const cw: LatLon[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01 },
      { lat: 0.01, lon: 0.01 },
      { lat: 0.01, lon: 0 },
    ];
    const ccw = [...cw].reverse();
    const area = polygonAreaMeters2(cw);
    expect(polygonAreaMeters2(ccw)).toBeCloseTo(area, 6);
    // ~1.11 km per 0.01° ⇒ ≈ 1.23e6 m²
    expect(area).toBeGreaterThan(1_100_000);
    expect(area).toBeLessThan(1_350_000);
  });
});

describe('vehicle icon transform', () => {
  it('points the nose north (-y) at heading 0', () => {
    const poly = vehicleIconPolygon([100, 100], 0, 20);
    expect(poly).toHaveLength(4);
    const nose = poly[0]!;
    expect(nose[0]).toBeCloseTo(100, 6);
    expect(nose[1]).toBeCloseTo(90, 6); // 100 - half(10)
  });

  it('rotates the nose east (+x) at heading 90', () => {
    const nose = vehicleIconPolygon([100, 100], 90, 20)[0]!;
    expect(nose[0]).toBeCloseTo(110, 6);
    expect(nose[1]).toBeCloseTo(100, 6);
  });

  it('heading vector end points along the heading', () => {
    expect(headingVectorEnd([0, 0], 0, 30)).toEqual([expect.closeTo(0, 6), expect.closeTo(-30, 6)]);
    const east = headingVectorEnd([0, 0], 90, 30);
    expect(east[0]).toBeCloseTo(30, 6);
    expect(east[1]).toBeCloseTo(0, 6);
  });
});

describe('track decimation + ring', () => {
  it('keeps endpoints and drops near interior points', () => {
    const pts: LatLon[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.000001 }, // ~0.1 m from prev → dropped
      { lat: 0, lon: 1 },
    ];
    const out = decimateTrack(pts, 100);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(pts[0]);
    expect(out[1]).toEqual(pts[2]);
  });

  it('passes through short tracks and copies (no mutation)', () => {
    const pts: LatLon[] = [
      { lat: 1, lon: 2 },
      { lat: 3, lon: 4 },
    ];
    const out = decimateTrack(pts, 100);
    expect(out).toEqual(pts);
    expect(out).not.toBe(pts);
  });

  it('ring is bounded and order-preserving', () => {
    const ring = createTrackRing({ capacity: 3 });
    for (let i = 0; i < 5; i++) ring.push({ lat: i, lon: i });
    expect(ring.size()).toBe(3);
    expect(ring.points().map((p) => p.lat)).toEqual([2, 3, 4]);
  });

  it('ring coalesces samples within minSpacing', () => {
    const ring = createTrackRing({ capacity: 10, minSpacingM: 1000 });
    ring.push({ lat: 0, lon: 0 });
    ring.push({ lat: 0, lon: 0.0001 }); // ~11 m → skipped
    ring.push({ lat: 0, lon: 1 }); // ~111 km → kept
    expect(ring.size()).toBe(2);
  });
});

describe('radius → pixels', () => {
  it('scales a metre radius via project()', () => {
    // project: 1° lat → 1000 px (north is -y here). 100 m ≈ 0.000898° → ~0.898 px
    const project: Project = (lat, lon) => [lon * 1000, -lat * 1000];
    const px = radiusToPixels({ lat: 0, lon: 0 }, 100, project);
    expect(px).toBeGreaterThan(0.7);
    expect(px).toBeLessThan(1.1);
  });
});

describe('metric formatters', () => {
  it('formats distances', () => {
    expect(formatDistanceM(0)).toBe('0 m');
    expect(formatDistanceM(5.5)).toBe('5.5 m');
    expect(formatDistanceM(123)).toBe('123 m');
    expect(formatDistanceM(1500)).toBe('1.50 km');
  });

  it('formats areas', () => {
    expect(formatAreaM2(0)).toBe('0 m\u00b2');
    expect(formatAreaM2(500)).toBe('500 m\u00b2');
    expect(formatAreaM2(2_500_000)).toBe('2.50 km\u00b2');
  });

  it('formats distances + areas in imperial when asked (additive opt-in)', () => {
    expect(formatDistanceM(0, 'imperial')).toBe('0 ft');
    expect(formatDistanceM(304.8, 'imperial')).toBe('1000 ft');
    expect(formatDistanceM(1609.344, 'imperial')).toBe('1.00 mi');
    expect(formatAreaM2(0, 'imperial')).toBe('0 ft\u00b2');
    expect(formatAreaM2(100, 'imperial')).toMatch(/ft\u00b2$/);
    expect(formatAreaM2(5_000_000, 'imperial')).toMatch(/mi\u00b2$/);
  });

  it('projectPath maps each point through project', () => {
    const project = vi.fn<Project>((lat, lon) => [lon, lat]);
    const out = projectPath(
      [
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
      ],
      project,
    );
    expect(out).toEqual([
      [2, 1],
      [4, 3],
    ]);
    expect(project).toHaveBeenCalledTimes(2);
  });
});

describe('layer project() usage (canvas-deferred draw)', () => {
  it('vehicle layer projects position; empty accessor draws nothing', () => {
    const project = renderLayer(createVehicleLayer(() => ({ lat: 12, lon: 34, headingDeg: 45 })));
    expect(project).toHaveBeenCalledWith(12, 34);

    const none = renderLayer(createVehicleLayer(() => undefined));
    expect(none).not.toHaveBeenCalled();
  });

  it('home layer projects the home point', () => {
    const project = renderLayer(createHomeLayer(() => ({ lat: -5, lon: 7 })));
    expect(project).toHaveBeenCalledWith(-5, 7);
    expect(renderLayer(createHomeLayer(() => undefined))).not.toHaveBeenCalled();
  });

  it('track layer projects decimated points; <2 points draw nothing', () => {
    const pts: LatLon[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 0, lon: 2 },
    ];
    const project = renderLayer(createTrackLayer(() => pts, { minSpacingM: 0 }));
    expect(project).toHaveBeenCalledTimes(3);
    expect(renderLayer(createTrackLayer(() => [{ lat: 0, lon: 0 }]))).not.toHaveBeenCalled();
  });

  it('mission scaffold draws nothing when empty, projects waypoints otherwise', () => {
    expect(renderLayer(createMissionLayer(() => ({ waypoints: [] })))).not.toHaveBeenCalled();
    const project = renderLayer(
      createMissionLayer(() => ({
        waypoints: [
          { seq: 0, lat: 1, lon: 2, nav: true },
          { seq: 1, lat: 3, lon: 4, nav: true },
        ],
      })),
    );
    // projected once for the nav path point + once per marker
    expect(project).toHaveBeenCalledWith(1, 2);
    expect(project).toHaveBeenCalledWith(3, 4);
  });

  it('fence scaffold draws nothing when empty, projects geometry otherwise', () => {
    expect(
      renderLayer(createGeofenceLayer(() => ({ polygons: [], circles: [] }))),
    ).not.toHaveBeenCalled();
    const project = renderLayer(
      createGeofenceLayer(() => ({
        polygons: [
          [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
            { lat: 1, lon: 1 },
          ],
        ],
        circles: [{ lat: 2, lon: 3, radiusM: 100 }],
      })),
    );
    expect(project).toHaveBeenCalledWith(0, 0);
    expect(project).toHaveBeenCalledWith(2, 3);
  });

  it('rally scaffold draws nothing when empty, projects points otherwise', () => {
    expect(renderLayer(createRallyLayer(() => ({ points: [] })))).not.toHaveBeenCalled();
    const project = renderLayer(createRallyLayer(() => ({ points: [{ lat: 8, lon: 9 }] })));
    expect(project).toHaveBeenCalledWith(8, 9);
  });
});
