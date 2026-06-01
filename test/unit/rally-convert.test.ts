/**
 * Rally ↔ Mission(rally) conversion tests (task T4.7; spec plan/04 §4.3 rally).
 *
 * Exercises the pure mapping: `MAV_CMD_NAV_RALLY_POINT`, the 1e7 lat/lon scale,
 * the break-alt / land-dir / flags param packing, read-back filtering, and the
 * Rally → Mission → Rally round-trip.
 */
import { describe, it, expect } from 'vitest';
import type { Mission, MissionItem } from '../../src/contracts';
import {
  DEFAULT_RALLY_FRAME,
  MAV_CMD_NAV_RALLY_POINT,
  RALLY_LATLON_SCALE,
  addRallyPoint,
  createRally,
  degToScaled,
  emptyRallyMission,
  rallyFromMission,
  rallyPointFromItem,
  rallyPointToItem,
  rallyToMission,
  scaledToDeg,
  type Rally,
} from '../../src/geo/rally';

describe('rally — scale + item mapping', () => {
  it('scales degrees to/from 1e7 integers', () => {
    expect(degToScaled(-35.363261)).toBe(-353632610);
    expect(scaledToDeg(1492932400)).toBeCloseTo(149.29324, 5);
    expect(RALLY_LATLON_SCALE).toBe(1e7);
  });

  it('emits a NAV_RALLY_POINT MISSION_ITEM_INT with lat/lon in x/y (1e7), alt in z', () => {
    const item = rallyPointToItem({ lat: -35.363261, lon: 149.16523, alt: 100 }, 0);
    expect(item.command).toBe(MAV_CMD_NAV_RALLY_POINT);
    expect(item.command).toBe(5100);
    expect(item.frame).toBe(DEFAULT_RALLY_FRAME);
    expect(item.x).toBe(-353632610);
    expect(item.y).toBe(1491652300);
    expect(item.z).toBe(100);
    expect(item.seq).toBe(0);
    expect(item.params).toEqual([0, 0, 0, 0]);
  });

  it('packs break alt / land dir / flags into param1..param3', () => {
    const item = rallyPointToItem(
      { lat: 1, lon: 2, alt: 80, breakAlt: 40, landDir: 270, flags: 2 },
      3,
    );
    expect(item.params).toEqual([40, 270, 2, 0]);
    expect(item.seq).toBe(3);
  });

  it('reads back only non-zero extras', () => {
    const base: MissionItem = {
      seq: 0,
      frame: DEFAULT_RALLY_FRAME,
      command: MAV_CMD_NAV_RALLY_POINT,
      current: 0,
      autocontinue: 1,
      params: [0, 0, 0, 0],
      x: degToScaled(10),
      y: degToScaled(20),
      z: 55,
    };
    const plain = rallyPointFromItem(base);
    expect(plain).toEqual({ lat: 10, lon: 20, alt: 55 });
    expect('breakAlt' in plain).toBe(false);

    const withExtras = rallyPointFromItem({ ...base, params: [40, 270, 1, 0] });
    expect(withExtras).toEqual({
      lat: 10,
      lon: 20,
      alt: 55,
      breakAlt: 40,
      landDir: 270,
      flags: 1,
    });
  });
});

describe('rally — mission mapping', () => {
  it('serialises a Rally to a MISSION_TYPE_RALLY mission with sequential seq', () => {
    let rally = createRally({ defaultAlt: 60 });
    rally = addRallyPoint(rally, { lat: 1, lon: 2 });
    rally = addRallyPoint(rally, { lat: 3, lon: 4 }, { alt: 90, breakAlt: 30 });

    const mission = rallyToMission(rally);
    expect(mission.type).toBe('rally');
    expect(mission.items).toHaveLength(2);
    expect(mission.items.map((i) => i.seq)).toEqual([0, 1]);
    expect(mission.items.every((i) => i.command === MAV_CMD_NAV_RALLY_POINT)).toBe(true);
    expect(mission.items[1]?.z).toBe(90);
    expect(mission.items[1]?.params[0]).toBe(30);
  });

  it('ignores non-rally commands when reading a mission back', () => {
    const mission: Mission = {
      type: 'rally',
      items: [
        rallyPointToItem({ lat: 1, lon: 2, alt: 50 }, 0),
        {
          seq: 1,
          frame: 3,
          command: 16,
          current: 0,
          autocontinue: 1,
          params: [0, 0, 0, 0],
          x: 0,
          y: 0,
          z: 0,
        },
        rallyPointToItem({ lat: 3, lon: 4, alt: 70 }, 2),
      ],
    };
    const rally = rallyFromMission(mission);
    expect(rally.points).toHaveLength(2);
    expect(rally.points.map((p) => p.alt)).toEqual([50, 70]);
    expect(rally.defaultAlt).toBe(50);
  });

  it('round-trips Rally → Mission → Rally losslessly', () => {
    let rally: Rally = createRally({ defaultAlt: 45 });
    rally = addRallyPoint(rally, { lat: -35.363261, lon: 149.16523 });
    rally = addRallyPoint(
      rally,
      { lat: 12.345678, lon: -98.765432 },
      { alt: 120, breakAlt: 50, landDir: 90, flags: 3 },
    );

    const round = rallyFromMission(rallyToMission(rally));
    expect(round.points).toEqual(rally.points);
  });

  it('builds an empty rally mission', () => {
    const mission = emptyRallyMission();
    expect(mission).toEqual({ type: 'rally', items: [] });
    expect(rallyFromMission(mission).points).toHaveLength(0);
  });
});
