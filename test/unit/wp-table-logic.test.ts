/**
 * Waypoint table pure-logic tests (task T4.3; spec plan/04 §4.3, plan/05 §5.7).
 *
 * Covers the DOM-free cores: row derivation ({@link toRows}), totals formatting
 * ({@link missionTotals} / {@link formatDurationS}) and the bounded undo/redo
 * history ({@link record} / {@link undo} / {@link redo}).
 */
import { describe, expect, it } from 'vitest';
import { addWaypoint, createMission, setItem, type MissionModel } from '../../src/geo/mission';
import {
  canRedo,
  canUndo,
  emptyHistory,
  formatDurationS,
  missionTotals,
  record,
  redo,
  toRows,
  undo,
} from '../../src/ui/screens/plan/table';

/** A two-waypoint mission ~111 m apart (1e-3° of latitude). */
function twoWp(): MissionModel {
  let m = createMission('mission', { defaultAlt: 30 });
  m = addWaypoint(m, { lat: 47.0, lon: 8.0 });
  m = addWaypoint(m, { lat: 47.001, lon: 8.0 });
  return m;
}

describe('toRows', () => {
  it('projects items with seq, command name, frame and current flag', () => {
    const rows = toRows(twoWp());
    expect(rows).toHaveLength(2);
    expect(rows[0]?.seq).toBe(0);
    expect(rows[0]?.commandName).toBe('NAV_WAYPOINT');
    expect(rows[0]?.altFrame).toBe('relative');
    expect(rows[0]?.hasPosition).toBe(true);
    expect(rows[0]?.isCurrent).toBe(true);
    expect(rows[1]?.isCurrent).toBe(false);
  });

  it('falls back to the numeric id for an unknown command', () => {
    let m = createMission();
    m = addWaypoint(m, { lat: 0, lon: 0 });
    m = setItem(m, 0, { command: 999999 });
    expect(toRows(m)[0]?.commandName).toBe('999999');
  });
});

describe('formatDurationS', () => {
  it('formats sub-hour as m:ss and longer as h:mm:ss', () => {
    expect(formatDurationS(0)).toBe('0:00');
    expect(formatDurationS(65)).toBe('1:05');
    expect(formatDurationS(3661)).toBe('1:01:01');
    expect(formatDurationS(-5)).toBe('0:00');
  });
});

describe('missionTotals', () => {
  it('formats distance, time and waypoint count from estimateMission', () => {
    const totals = missionTotals(twoWp(), { units: 'metric', cruiseSpeedMps: 5 });
    expect(totals.waypoints).toBe(2);
    // ~111 m between the two points → metric short unit (m).
    expect(totals.distance).toMatch(/m$/);
    expect(totals.time).toMatch(/^\d+:\d{2}$/);
  });
});

describe('undo history', () => {
  it('records edits and undo/redo round-trips', () => {
    const a = twoWp();
    const b = addWaypoint(a, { lat: 47.002, lon: 8.0 });

    let history = emptyHistory<MissionModel>();
    expect(canUndo(history)).toBe(false);

    // Edit a → b: record the prior present (a).
    history = record(history, a, 50);
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);

    // Undo from present b → a.
    const back = undo(history, b);
    expect(back?.value).toBe(a);
    history = back!.history;
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(true);

    // Redo from present a → b.
    const fwd = redo(history, a, 50);
    expect(fwd?.value).toBe(b);
    history = fwd!.history;
    expect(canRedo(history)).toBe(false);
  });

  it('clears the redo future on a fresh edit', () => {
    const a = twoWp();
    const b = addWaypoint(a, { lat: 47.002, lon: 8.0 });
    const c = addWaypoint(a, { lat: 47.003, lon: 8.0 });

    let history = record(emptyHistory<MissionModel>(), a, 50);
    history = undo(history, b)!.history; // future now holds b
    expect(canRedo(history)).toBe(true);
    history = record(history, a, 50); // new edit a → c
    expect(canRedo(history)).toBe(false);
    expect(redo(history, c, 50)).toBeUndefined();
  });

  it('bounds the past stack to the limit', () => {
    let history = emptyHistory<MissionModel>();
    const m = twoWp();
    for (let i = 0; i < 5; i++) history = record(history, m, 3);
    expect(history.past.length).toBe(3);
  });

  it('returns undefined when there is nothing to undo/redo', () => {
    const history = emptyHistory<MissionModel>();
    expect(undo(history, twoWp())).toBeUndefined();
    expect(redo(history, twoWp(), 50)).toBeUndefined();
  });
});
