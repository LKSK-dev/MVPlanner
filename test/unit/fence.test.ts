/**
 * Geofence model + conversion tests (task T4.6; spec plan/04 §4.3 Geofence).
 *
 * Pure model edit ops, the `FENCE_*` parameter mapping and the
 * `Fence` ↔ `MISSION_TYPE_FENCE` conversion: correct ArduPilot fence `MAV_CMD`s,
 * shared polygon vertex-count `param1`, `1e7`-scaled `x`/`y`, and a geometry
 * round-trip. No DOM, no network — everything here is deterministic.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FENCE_ACTION,
  FenceBreachAction,
  NAV_FENCE_CIRCLE_EXCLUSION,
  NAV_FENCE_CIRCLE_INCLUSION,
  NAV_FENCE_POLYGON_VERTEX_EXCLUSION,
  NAV_FENCE_POLYGON_VERTEX_INCLUSION,
  NAV_FENCE_RETURN_POINT,
  addCircle,
  addPolygon,
  addShape,
  createFence,
  fenceFromMission,
  fenceParams,
  fenceToMission,
  removeShape,
  setBreachAction,
  setCircleRadius,
  setInclusion,
  type Fence,
} from '../../src/geo/fence';

/** A 4-vertex inclusion polygon (square around the origin). */
const SQUARE: Fence = addShape(createFence(), {
  kind: 'polygon',
  inclusion: 'inclusion',
  vertices: [
    { lat: 1, lon: 1 },
    { lat: 1, lon: 2 },
    { lat: 2, lon: 2 },
    { lat: 2, lon: 1 },
  ],
});

describe('fence model edit ops', () => {
  it('creates an empty fence with default limits', () => {
    const f = createFence();
    expect(f.shapes).toHaveLength(0);
    expect(f.breachAction).toBe(DEFAULT_FENCE_ACTION);
    expect(f.minAltM).toBeLessThan(f.maxAltM);
  });

  it('adds, edits and removes shapes immutably', () => {
    const f0 = createFence();
    const f1 = addPolygon(f0, 'inclusion');
    const f2 = addCircle(f1, 'exclusion', { lat: 10, lon: 20 }, 50);
    expect(f0.shapes).toHaveLength(0); // original untouched
    expect(f2.shapes).toHaveLength(2);

    const f3 = setInclusion(f2, 0, 'exclusion');
    expect(f3.shapes[0]?.inclusion).toBe('exclusion');

    const f4 = setCircleRadius(f3, 1, 75);
    const circle = f4.shapes[1];
    expect(circle?.kind === 'circle' && circle.radiusM).toBe(75);

    const f5 = removeShape(f4, 0);
    expect(f5.shapes).toHaveLength(1);
    expect(f5.shapes[0]?.kind).toBe('circle');
  });

  it('exposes limits + action as FENCE_* params', () => {
    const f = setBreachAction(
      createFence({ minAltM: 5, maxAltM: 120 }),
      FenceBreachAction.AlwaysLand,
    );
    const params = fenceParams(f);
    expect(params).toEqual([
      { name: 'FENCE_ALT_MIN', value: 5 },
      { name: 'FENCE_ALT_MAX', value: 120 },
      { name: 'FENCE_ACTION', value: FenceBreachAction.AlwaysLand },
    ]);
  });
});

describe('fenceToMission', () => {
  it('emits polygon vertices sharing the vertex-count param1 with 1e7 coords', () => {
    const m = fenceToMission(SQUARE);
    expect(m.type).toBe('fence');
    expect(m.items).toHaveLength(4);
    for (const item of m.items) {
      expect(item.command).toBe(NAV_FENCE_POLYGON_VERTEX_INCLUSION);
      expect(item.params[0]).toBe(4); // total vertex count shared by all
    }
    const first = m.items[0];
    expect(first?.x).toBe(10_000_000); // lat 1 → 1e7
    expect(first?.y).toBe(10_000_000); // lon 1 → 1e7
    expect(m.items[1]?.y).toBe(20_000_000); // lon 2 → 2e7
  });

  it('uses exclusion command for exclusion polygons', () => {
    const f = addPolygon(createFence(), 'exclusion');
    const withVerts = setInclusion(
      addShape(createFence(), {
        kind: 'polygon',
        inclusion: 'exclusion',
        vertices: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
          { lat: 1, lon: 0 },
        ],
      }),
      0,
      'exclusion',
    );
    void f;
    const m = fenceToMission(withVerts);
    expect(m.items).toHaveLength(3);
    expect(m.items.every((i) => i.command === NAV_FENCE_POLYGON_VERTEX_EXCLUSION)).toBe(true);
    expect(m.items[0]?.params[0]).toBe(3);
  });

  it('emits circle items with the radius in param1', () => {
    const f = addCircle(createFence(), 'inclusion', { lat: 5, lon: -5 }, 250);
    const m = fenceToMission(f);
    expect(m.items).toHaveLength(1);
    const item = m.items[0];
    expect(item?.command).toBe(NAV_FENCE_CIRCLE_INCLUSION);
    expect(item?.params[0]).toBe(250);
    expect(item?.x).toBe(50_000_000);
    expect(item?.y).toBe(-50_000_000);
  });

  it('emits a return point first and uses 5004 for exclusion circles', () => {
    let f = createFence();
    f = { ...f, returnPoint: { lat: 3, lon: 4 } };
    f = addCircle(f, 'exclusion', { lat: 1, lon: 1 }, 30);
    const m = fenceToMission(f);
    expect(m.items[0]?.command).toBe(NAV_FENCE_RETURN_POINT);
    expect(m.items[0]?.x).toBe(30_000_000);
    expect(m.items[1]?.command).toBe(NAV_FENCE_CIRCLE_EXCLUSION);
    // seq is the item index.
    expect(m.items.map((i) => i.seq)).toEqual([0, 1]);
  });

  it('skips empty polygons and non-positive-radius circles', () => {
    let f = addPolygon(createFence(), 'inclusion'); // empty polygon
    f = addCircle(f, 'inclusion', { lat: 0, lon: 0 }, 0); // zero radius
    expect(fenceToMission(f).items).toHaveLength(0);
  });
});

describe('fence round-trip', () => {
  it('round-trips polygons + circles + return point through a mission', () => {
    let f = createFence();
    f = { ...f, returnPoint: { lat: 12.5, lon: -7.25 } };
    f = addShape(f, {
      kind: 'polygon',
      inclusion: 'inclusion',
      vertices: [
        { lat: 1, lon: 1 },
        { lat: 1, lon: 2 },
        { lat: 2, lon: 1.5 },
      ],
    });
    f = addShape(f, {
      kind: 'polygon',
      inclusion: 'exclusion',
      vertices: [
        { lat: 5, lon: 5 },
        { lat: 5, lon: 6 },
        { lat: 6, lon: 6 },
        { lat: 6, lon: 5 },
      ],
    });
    f = addCircle(f, 'inclusion', { lat: 9, lon: 9 }, 80);
    f = addCircle(f, 'exclusion', { lat: -3, lon: 3 }, 40);

    const back = fenceFromMission(fenceToMission(f), {
      minAltM: f.minAltM,
      maxAltM: f.maxAltM,
      breachAction: f.breachAction,
    });

    expect(back.returnPoint?.lat).toBeCloseTo(12.5, 6);
    expect(back.returnPoint?.lon).toBeCloseTo(-7.25, 6);
    expect(back.shapes).toHaveLength(4);
    expect(back.shapes[0]?.kind).toBe('polygon');
    expect(back.shapes[0]?.inclusion).toBe('inclusion');
    const poly0 = back.shapes[0];
    expect(poly0?.kind === 'polygon' && poly0.vertices).toHaveLength(3);
    const excl = back.shapes[1];
    expect(excl?.kind === 'polygon' && excl.vertices).toHaveLength(4);
    expect(excl?.inclusion).toBe('exclusion');
    const inclCircle = back.shapes[2];
    expect(inclCircle?.kind === 'circle' && inclCircle.radiusM).toBe(80);
    const exclCircle = back.shapes[3];
    expect(exclCircle?.kind).toBe('circle');
    expect(exclCircle?.inclusion).toBe('exclusion');
    expect(exclCircle?.kind === 'circle' && exclCircle.center.lat).toBeCloseTo(-3, 6);

    expect(fenceParams(back)).toEqual(fenceParams(f));
  });

  it('defaults limits + action when decoding a bare mission', () => {
    const back = fenceFromMission(fenceToMission(SQUARE));
    expect(back.breachAction).toBe(DEFAULT_FENCE_ACTION);
    expect(back.shapes).toHaveLength(1);
  });
});
