/**
 * Plan map-editor reducer tests (task T4.4; spec plan/04 §4.3 map editing).
 * Exercises the PURE {@link dispatchMapEdit} reducer (add waypoint / draw fence
 * polygon + circle / place rally / draw survey polygon on click; drag-to-move;
 * delete; mode switching), the overlay derivations, and {@link hitTest}. No DOM
 * and no map engine.
 */
import { describe, expect, it } from 'vitest';
import {
  dispatchMapEdit,
  hitTest,
  toFenceOverlay,
  toMissionOverlay,
  toRallyOverlay,
  type EditState,
} from '../../src/ui/screens/plan/map-edit';
import { createMission, type MissionModel } from '../../src/geo/mission';
import { createFence } from '../../src/geo/fence';
import { createRally } from '../../src/geo/rally';

function baseState(): EditState {
  return {
    mission: createMission('mission'),
    fence: createFence(),
    rally: createRally(),
    surveyPolygon: [],
  };
}

describe('dispatchMapEdit — click per tool mode', () => {
  it('appends a waypoint at the click in add-waypoint mode', () => {
    const next = dispatchMapEdit(baseState(), 'add-waypoint', {
      kind: 'click',
      at: { lat: -35.36, lon: 149.16 },
    });
    expect(next.mission.items).toHaveLength(1);
    expect(next.mission.items[0]?.lat).toBeCloseTo(-35.36);
    expect(next.mission.items[0]?.lon).toBeCloseTo(149.16);
  });

  it('is a no-op in select and measure modes', () => {
    const state = baseState();
    expect(dispatchMapEdit(state, 'select', { kind: 'click', at: { lat: 1, lon: 2 } })).toBe(state);
    expect(dispatchMapEdit(state, 'measure', { kind: 'click', at: { lat: 1, lon: 2 } })).toBe(
      state,
    );
  });

  it('appends vertices to the active fence polygon (creating one on first click)', () => {
    let state = baseState();
    state = dispatchMapEdit(state, 'draw-fence-polygon', { kind: 'click', at: { lat: 0, lon: 0 } });
    state = dispatchMapEdit(state, 'draw-fence-polygon', { kind: 'click', at: { lat: 0, lon: 1 } });
    state = dispatchMapEdit(state, 'draw-fence-polygon', { kind: 'click', at: { lat: 1, lon: 1 } });
    expect(state.fence.shapes).toHaveLength(1);
    const shape = state.fence.shapes[0];
    expect(shape?.kind).toBe('polygon');
    expect(shape?.kind === 'polygon' && shape.vertices).toHaveLength(3);
  });

  it('sets the fence circle centre on click', () => {
    const next = dispatchMapEdit(baseState(), 'draw-fence-circle', {
      kind: 'click',
      at: { lat: 2, lon: 3 },
    });
    const shape = next.fence.shapes[0];
    expect(shape?.kind).toBe('circle');
    expect(shape?.kind === 'circle' && shape.center).toEqual({ lat: 2, lon: 3 });
  });

  it('places a rally point on click', () => {
    const next = dispatchMapEdit(baseState(), 'place-rally', {
      kind: 'click',
      at: { lat: 4, lon: 5 },
    });
    expect(next.rally.points).toHaveLength(1);
    expect(next.rally.points[0]).toMatchObject({ lat: 4, lon: 5 });
  });

  it('appends survey polygon vertices on click', () => {
    let state = baseState();
    state = dispatchMapEdit(state, 'draw-survey-polygon', {
      kind: 'click',
      at: { lat: 0, lon: 0 },
    });
    state = dispatchMapEdit(state, 'draw-survey-polygon', {
      kind: 'click',
      at: { lat: 1, lon: 0 },
    });
    expect(state.surveyPolygon).toHaveLength(2);
    expect(state.surveyPolygon[1]).toEqual({ lat: 1, lon: 0 });
  });
});

describe('dispatchMapEdit — drag moves a feature', () => {
  it('moves a waypoint to the drag position', () => {
    let state = dispatchMapEdit(baseState(), 'add-waypoint', {
      kind: 'click',
      at: { lat: 1, lon: 1 },
    });
    state = dispatchMapEdit(state, 'select', {
      kind: 'drag',
      ref: { kind: 'waypoint', index: 0 },
      at: { lat: 9, lon: 8 },
    });
    expect(state.mission.items[0]?.lat).toBeCloseTo(9);
    expect(state.mission.items[0]?.lon).toBeCloseTo(8);
  });

  it('moves a fence vertex', () => {
    let state = baseState();
    state = dispatchMapEdit(state, 'draw-fence-polygon', { kind: 'click', at: { lat: 0, lon: 0 } });
    state = dispatchMapEdit(state, 'draw-fence-polygon', { kind: 'click', at: { lat: 0, lon: 1 } });
    state = dispatchMapEdit(state, 'select', {
      kind: 'drag',
      ref: { kind: 'fence-vertex', shapeIndex: 0, vertexIndex: 1 },
      at: { lat: 5, lon: 5 },
    });
    const shape = state.fence.shapes[0];
    expect(shape?.kind === 'polygon' && shape.vertices[1]).toEqual({ lat: 5, lon: 5 });
  });
});

describe('dispatchMapEdit — delete + radius', () => {
  it('deletes a waypoint by ref', () => {
    let state = dispatchMapEdit(baseState(), 'add-waypoint', {
      kind: 'click',
      at: { lat: 1, lon: 1 },
    });
    state = dispatchMapEdit(state, 'add-waypoint', { kind: 'click', at: { lat: 2, lon: 2 } });
    state = dispatchMapEdit(state, 'select', {
      kind: 'delete',
      ref: { kind: 'waypoint', index: 0 },
    });
    expect(state.mission.items).toHaveLength(1);
    expect(state.mission.items[0]?.lat).toBeCloseTo(2);
  });

  it('sets a fence circle radius', () => {
    let state = dispatchMapEdit(baseState(), 'draw-fence-circle', {
      kind: 'click',
      at: { lat: 0, lon: 0 },
    });
    state = dispatchMapEdit(state, 'select', {
      kind: 'set-fence-radius',
      shapeIndex: 0,
      radiusM: 250,
    });
    const shape = state.fence.shapes[0];
    expect(shape?.kind === 'circle' && shape.radiusM).toBe(250);
  });

  it('never mutates the input state', () => {
    const state = baseState();
    const next = dispatchMapEdit(state, 'add-waypoint', { kind: 'click', at: { lat: 1, lon: 1 } });
    expect(state.mission.items).toHaveLength(0);
    expect(next).not.toBe(state);
  });
});

describe('overlay derivations', () => {
  it('maps a mission to a labelled overlay', () => {
    const mission: MissionModel = dispatchMapEdit(baseState(), 'add-waypoint', {
      kind: 'click',
      at: { lat: 1, lon: 2 },
    }).mission;
    const overlay = toMissionOverlay(mission);
    expect(overlay.waypoints).toHaveLength(1);
    expect(overlay.waypoints[0]).toMatchObject({ seq: 0, lat: 1, lon: 2, nav: true, label: '1' });
  });

  it('maps fence shapes to polygons + circles', () => {
    let state = baseState();
    state = dispatchMapEdit(state, 'draw-fence-circle', { kind: 'click', at: { lat: 1, lon: 1 } });
    const overlay = toFenceOverlay(state.fence);
    expect(overlay.circles).toHaveLength(1);
    expect(overlay.circles[0]).toMatchObject({ lat: 1, lon: 1 });
  });

  it('maps rally points to an overlay', () => {
    const state = dispatchMapEdit(baseState(), 'place-rally', {
      kind: 'click',
      at: { lat: 3, lon: 4 },
    });
    const overlay = toRallyOverlay(state.rally);
    expect(overlay.points[0]).toMatchObject({ lat: 3, lon: 4, label: '1' });
  });
});

describe('hitTest', () => {
  // A trivial projection: lat/lon → pixels (1 unit = 1 px), centred at origin.
  const project = (lat: number, lon: number): [number, number] => [lon, lat];

  it('returns the nearest waypoint within the radius', () => {
    let state = dispatchMapEdit(baseState(), 'add-waypoint', {
      kind: 'click',
      at: { lat: 10, lon: 10 },
    });
    state = dispatchMapEdit(state, 'add-waypoint', { kind: 'click', at: { lat: 50, lon: 50 } });
    const ref = hitTest(state, project, 11, 11, 16);
    expect(ref).toEqual({ kind: 'waypoint', index: 0 });
  });

  it('returns undefined when nothing is within the radius', () => {
    const state = dispatchMapEdit(baseState(), 'add-waypoint', {
      kind: 'click',
      at: { lat: 10, lon: 10 },
    });
    expect(hitTest(state, project, 200, 200, 16)).toBeUndefined();
  });
});
