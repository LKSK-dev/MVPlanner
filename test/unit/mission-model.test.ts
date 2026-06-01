/**
 * Mission editing model tests (task T4.2; spec plan/04 §4.3).
 *
 * Exercises the pure model: add/insert/delete/reorder, distance + time
 * estimates for a known waypoint list, altitude-frame mapping, and the
 * model↔`MissionItem` 1e7 round-trip.
 */
import { describe, it, expect } from 'vitest';
import type { Mission, MissionItem } from '../../src/contracts';
import {
  ALT_FRAMES,
  DEFAULT_MISSION_FRAME,
  MAV_FRAME_GLOBAL_INT,
  MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
  MAV_FRAME_GLOBAL_TERRAIN_ALT,
  NAV_WAYPOINT,
  addWaypoint,
  altFrameToMavFrame,
  createMission,
  degToScaled,
  deleteItem,
  estimateMission,
  insertItem,
  itemFromWire,
  itemToWire,
  makeWaypoint,
  mavFrameToAltFrame,
  missionFromWire,
  missionToWire,
  reorder,
  scaledToDeg,
  setDefaultAlt,
  setItem,
  type MissionItemModel,
} from '../../src/geo/mission';

const DO_CHANGE_SPEED = 178;

function withWaypoints(): ReturnType<typeof createMission> {
  // Off null-island so all three count: two ~111195 m legs (1° at the equator).
  let m = createMission('mission', { defaultAlt: 50 });
  m = addWaypoint(m, { lat: 0, lon: 10 });
  m = addWaypoint(m, { lat: 0, lon: 11 });
  m = addWaypoint(m, { lat: 1, lon: 11 });
  return m;
}

describe('mission model — edit ops', () => {
  it('creates an empty mission with defaults', () => {
    const m = createMission('mission', { defaultAlt: 42 });
    expect(m.items).toHaveLength(0);
    expect(m.defaultAlt).toBe(42);
    expect(m.defaultFrame).toBe(DEFAULT_MISSION_FRAME);
    expect(m.type).toBe('mission');
  });

  it('addWaypoint appends a NAV waypoint with the default alt/frame', () => {
    const m = addWaypoint(createMission('mission', { defaultAlt: 30 }), { lat: 10, lon: 20 });
    expect(m.items).toHaveLength(1);
    const item = m.items[0]!;
    expect(item.command).toBe(NAV_WAYPOINT);
    expect(item.frame).toBe(DEFAULT_MISSION_FRAME);
    expect(item.alt).toBe(30);
    expect(item.lat).toBe(10);
    expect(item.lon).toBe(20);
    expect(item.autocontinue).toBe(true);
  });

  it('is immutable: ops return a new model', () => {
    const m0 = createMission();
    const m1 = addWaypoint(m0, { lat: 1, lon: 2 });
    expect(m0.items).toHaveLength(0);
    expect(m1.items).toHaveLength(1);
    expect(m1).not.toBe(m0);
  });

  it('insertItem inserts at the given index and shifts current', () => {
    const m = withWaypoints();
    const extra = makeWaypoint(m, { lat: 5, lon: 5 }, { command: DO_CHANGE_SPEED });
    const out = insertItem(m, 1, extra);
    expect(out.items).toHaveLength(4);
    expect(out.items[1]!.command).toBe(DO_CHANGE_SPEED);
    expect(out.items[2]!.lon).toBe(11);
  });

  it('insertItem clamps an out-of-range index to the end', () => {
    const m = withWaypoints();
    const extra = makeWaypoint(m, { lat: 9, lon: 9 });
    const out = insertItem(m, 99, extra);
    expect(out.items).toHaveLength(4);
    expect(out.items[3]!.lat).toBe(9);
  });

  it('deleteItem removes the item and keeps current valid', () => {
    const m = withWaypoints();
    const out = deleteItem(m, 1);
    expect(out.items).toHaveLength(2);
    expect(out.items.map((i) => i.lon)).toEqual([10, 11]);
  });

  it('deleteItem ignores an out-of-range index', () => {
    const m = withWaypoints();
    expect(deleteItem(m, 99).items).toHaveLength(3);
    expect(deleteItem(m, -1).items).toHaveLength(3);
  });

  it('reorder moves an item', () => {
    const m = withWaypoints();
    const out = reorder(m, 0, 2);
    expect(out.items.map((i) => i.lon)).toEqual([11, 11, 10]);
  });

  it('reorder is a no-op for equal indices', () => {
    const m = withWaypoints();
    expect(reorder(m, 1, 1)).toBe(m);
  });

  it('setItem patches fields only at the index', () => {
    const m = withWaypoints();
    const out = setItem(m, 1, { alt: 123, command: DO_CHANGE_SPEED });
    expect(out.items[1]!.alt).toBe(123);
    expect(out.items[1]!.command).toBe(DO_CHANGE_SPEED);
    expect(out.items[0]!.alt).toBe(50);
  });

  it('setDefaultAlt only affects subsequently added waypoints', () => {
    let m = setDefaultAlt(createMission(), 80);
    expect(m.defaultAlt).toBe(80);
    m = addWaypoint(m, { lat: 1, lon: 1 });
    expect(m.items[0]!.alt).toBe(80);
  });
});

describe('mission model — estimates', () => {
  it('sums great-circle distance over the position waypoints', () => {
    const m = withWaypoints();
    const est = estimateMission(m, { cruiseSpeedMps: 5 });
    // 1° at the equator ≈ 111195 m (R = 6371008.8 m); two equal legs.
    expect(est.waypointCount).toBe(3);
    expect(est.distanceM).toBeGreaterThan(222000);
    expect(est.distanceM).toBeLessThan(222800);
    expect(est.timeS).toBeCloseTo(est.distanceM / 5, 6);
  });

  it('skips non-position commands (DO_*) for distance and count', () => {
    let m = withWaypoints();
    const speed = makeWaypoint(m, { lat: 0, lon: 0 }, { command: DO_CHANGE_SPEED });
    m = insertItem(m, 1, speed);
    const est = estimateMission(m);
    expect(est.waypointCount).toBe(3);
    expect(est.distanceM).toBeGreaterThan(222000);
    expect(est.distanceM).toBeLessThan(222800);
  });

  it('skips all-zero null-island waypoints', () => {
    let m = createMission();
    m = addWaypoint(m, { lat: 0, lon: 0 });
    m = addWaypoint(m, { lat: 0, lon: 0 });
    const est = estimateMission(m);
    expect(est.waypointCount).toBe(0);
    expect(est.distanceM).toBe(0);
    expect(est.timeS).toBe(0);
  });

  it('uses the default cruise speed when none is given', () => {
    const m = withWaypoints();
    const est = estimateMission(m);
    expect(est.timeS).toBeCloseTo(est.distanceM / 5, 6);
  });
});

describe('mission model — altitude frames', () => {
  it('maps semantic frames to MAV_FRAME values', () => {
    expect(altFrameToMavFrame('relative')).toBe(MAV_FRAME_GLOBAL_RELATIVE_ALT_INT);
    expect(altFrameToMavFrame('amsl')).toBe(MAV_FRAME_GLOBAL_INT);
    expect(altFrameToMavFrame('terrain')).toBe(MAV_FRAME_GLOBAL_TERRAIN_ALT);
  });

  it('maps MAV_FRAME values back to semantic frames', () => {
    expect(mavFrameToAltFrame(6)).toBe('relative');
    expect(mavFrameToAltFrame(5)).toBe('amsl');
    expect(mavFrameToAltFrame(0)).toBe('amsl');
    expect(mavFrameToAltFrame(10)).toBe('terrain');
    expect(mavFrameToAltFrame(11)).toBe('terrain');
    // Unknown frames degrade to the default (relative).
    expect(mavFrameToAltFrame(99)).toBe('relative');
  });

  it('round-trips every semantic frame', () => {
    for (const frame of ALT_FRAMES) {
      expect(mavFrameToAltFrame(altFrameToMavFrame(frame))).toBe(frame);
    }
  });
});

describe('mission model — contracts mapping (1e7 scaling)', () => {
  it('scales degrees to MISSION_ITEM_INT integers and back', () => {
    expect(degToScaled(12.3456789)).toBe(123456789);
    expect(degToScaled(-0.0000001)).toBe(-1);
    expect(scaledToDeg(123456789)).toBeCloseTo(12.3456789, 7);
  });

  it('itemToWire scales lat/lon by 1e7 and preserves params', () => {
    const model: MissionItemModel = {
      command: NAV_WAYPOINT,
      frame: MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
      params: [1, 2, 3, 4],
      lat: 47.397742,
      lon: 8.545594,
      alt: 30,
      autocontinue: true,
    };
    const wire: MissionItem = itemToWire(model, 0, true);
    expect(wire.x).toBe(Math.round(47.397742 * 1e7));
    expect(wire.y).toBe(Math.round(8.545594 * 1e7));
    expect(wire.z).toBe(30);
    expect(wire.params).toEqual([1, 2, 3, 4]);
    expect(wire.current).toBe(1);
    expect(wire.autocontinue).toBe(1);
    expect(wire.seq).toBe(0);
  });

  it('itemFromWire reverses the scaling', () => {
    const wire: MissionItem = {
      seq: 3,
      frame: MAV_FRAME_GLOBAL_INT,
      command: NAV_WAYPOINT,
      current: 0,
      autocontinue: 0,
      params: [5, 6, 7, 8],
      x: 473977420,
      y: 85455940,
      z: 100,
    };
    const model = itemFromWire(wire);
    expect(model.lat).toBeCloseTo(47.397742, 7);
    expect(model.lon).toBeCloseTo(8.545594, 7);
    expect(model.alt).toBe(100);
    expect(model.params).toEqual([5, 6, 7, 8]);
    expect(model.autocontinue).toBe(false);
  });

  it('round-trips a mission through wire form', () => {
    const m = withWaypoints();
    const wire: Mission = missionToWire(m);
    expect(wire.type).toBe('mission');
    expect(wire.items).toHaveLength(3);
    expect(wire.items[0]!.current).toBe(1);
    expect(wire.items[1]!.current).toBe(0);

    const back = missionFromWire(wire);
    expect(back.items).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(back.items[i]!.lat).toBeCloseTo(m.items[i]!.lat, 6);
      expect(back.items[i]!.lon).toBeCloseTo(m.items[i]!.lon, 6);
      expect(back.items[i]!.command).toBe(m.items[i]!.command);
    }
  });
});
