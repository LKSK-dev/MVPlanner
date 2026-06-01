/**
 * Pure-helper tests for the parameter grid (task T3.4; spec plan/04 §4.5).
 *
 * Covers editor selection, grouping, search/filtering, modified / out-of-range
 * detection, sorting, per-type value parsing, bitmask arithmetic and the
 * two-set diff — all DOM-free, no component mount.
 */
import { describe, it, expect } from 'vitest';
import {
  bitmaskEntries,
  buildRows,
  computeDiff,
  editorKindFor,
  enumEntries,
  filterRows,
  groupPrefix,
  groupRows,
  hasBit,
  isModified,
  isOutOfRange,
  parseEditorValue,
  sortRows,
  toggleBit,
  toValueMap,
} from '../../src/ui/widgets/paramgrid';
import type { Param, ParamMeta, ParamMetaResolver } from '../../src/ui/widgets/paramgrid';
import { MAV_PARAM_TYPE } from '../../src/mavlink/microservices/param';

const REAL = MAV_PARAM_TYPE.REAL32;
const INT = MAV_PARAM_TYPE.INT32;

function param(name: string, value: number, type = REAL, meta?: ParamMeta): Param {
  return meta ? { name, value, type, meta } : { name, value, type };
}

/** A resolver backed by a plain record (the `ParamMetaStore` shape). */
function resolver(table: Record<string, ParamMeta>): ParamMetaResolver {
  return { get: (name) => table[name] };
}

describe('editorKindFor', () => {
  it('prefers bitmask then enum metadata', () => {
    expect(editorKindFor({ bitmask: { 0: 'a' } }, REAL)).toBe('bitmask');
    expect(editorKindFor({ values: { 0: 'Off', 1: 'On' } }, INT)).toBe('enum');
    // bitmask wins over values when both present.
    expect(editorKindFor({ bitmask: { 0: 'a' }, values: { 0: 'x' } }, REAL)).toBe('bitmask');
  });

  it('falls back to int/float by wire type and increment', () => {
    expect(editorKindFor(undefined, INT)).toBe('int');
    expect(editorKindFor(undefined, REAL)).toBe('float');
    // a fractional increment forces a float editor even for an int type.
    expect(editorKindFor({ increment: 0.01 }, INT)).toBe('float');
  });
});

describe('groupPrefix', () => {
  it('takes the prefix up to the first underscore', () => {
    expect(groupPrefix('ATC_RAT_RLL_P')).toBe('ATC');
    expect(groupPrefix('RC1_MIN')).toBe('RC1');
  });
  it('returns the whole name when there is no underscore', () => {
    expect(groupPrefix('WPNAV')).toBe('WPNAV');
    expect(groupPrefix('_LEAD')).toBe('_LEAD');
  });
});

describe('modified / out-of-range', () => {
  it('isModified is true only when a staged value differs from base', () => {
    const pending = new Map([['A', 5]]);
    expect(isModified(5, pending, 'A')).toBe(false); // equal → not modified
    expect(isModified(4, pending, 'A')).toBe(true);
    expect(isModified(4, pending, 'B')).toBe(false); // not staged
  });

  it('isOutOfRange respects min/max bounds', () => {
    const meta: ParamMeta = { min: 0, max: 10 };
    expect(isOutOfRange(-1, meta)).toBe(true);
    expect(isOutOfRange(11, meta)).toBe(true);
    expect(isOutOfRange(5, meta)).toBe(false);
    expect(isOutOfRange(5, undefined)).toBe(false);
  });
});

describe('buildRows', () => {
  const meta = resolver({ ATC_RAT_RLL_P: { min: 0, max: 0.35, increment: 0.005 } });

  it('marks modified + out-of-range and resolves editor/meta', () => {
    const params = [param('ATC_RAT_RLL_P', 0.1), param('FLTMODE1', 2, INT)];
    const pending = new Map([['ATC_RAT_RLL_P', 0.9]]); // above max 0.35
    const rows = buildRows(params, pending, meta);

    const atc = rows[0]!;
    expect(atc.editor).toBe('float');
    expect(atc.modified).toBe(true);
    expect(atc.effective).toBe(0.9);
    expect(atc.outOfRange).toBe(true);

    const flt = rows[1]!;
    expect(flt.editor).toBe('int');
    expect(flt.modified).toBe(false);
    expect(flt.effective).toBe(2);
  });

  it('falls back to param.meta when the resolver misses', () => {
    const params = [param('X', 1, INT, { values: { 1: 'One' } })];
    const rows = buildRows(params, new Map(), resolver({}));
    expect(rows[0]!.editor).toBe('enum');
  });
});

describe('filterRows', () => {
  const meta = resolver({ ATC_RAT_RLL_P: { description: 'Roll axis rate P gain' } });
  const rows = buildRows(
    [param('ATC_RAT_RLL_P', 0.1), param('WPNAV_SPEED', 500, INT)],
    new Map(),
    meta,
  );

  it('matches name and description, case-insensitively', () => {
    expect(filterRows(rows, 'wpnav').map((r) => r.param.name)).toEqual(['WPNAV_SPEED']);
    // description hit
    expect(filterRows(rows, 'roll axis').map((r) => r.param.name)).toEqual(['ATC_RAT_RLL_P']);
    // blank keeps all
    expect(filterRows(rows, '  ')).toHaveLength(2);
  });
});

describe('sortRows', () => {
  const rows = buildRows(
    [param('B', 3, INT), param('A', 9, INT), param('C', 1, INT)],
    new Map(),
    resolver({}),
  );
  it('sorts by name asc/desc', () => {
    expect(sortRows(rows, 'name', 'asc').map((r) => r.param.name)).toEqual(['A', 'B', 'C']);
    expect(sortRows(rows, 'name', 'desc').map((r) => r.param.name)).toEqual(['C', 'B', 'A']);
  });
  it('sorts by effective value', () => {
    expect(sortRows(rows, 'value', 'asc').map((r) => r.effective)).toEqual([1, 3, 9]);
  });
});

describe('groupRows', () => {
  it('groups by prefix and counts modified/out-of-range members', () => {
    const meta = resolver({ ATC_RAT_RLL_P: { min: 0, max: 1 } });
    const rows = buildRows(
      [param('ATC_RAT_RLL_P', 0.1), param('ATC_RAT_PIT_P', 0.1), param('RC1_MIN', 1100, INT)],
      new Map([['ATC_RAT_RLL_P', 5]]), // modified + out of range (max 1)
      meta,
    );
    const groups = groupRows(rows);
    const atc = groups.find((g) => g.prefix === 'ATC')!;
    expect(atc.rows).toHaveLength(2);
    expect(atc.modifiedCount).toBe(1);
    expect(atc.outOfRangeCount).toBe(1);
    expect(groups.map((g) => g.prefix)).toEqual(['ATC', 'RC1']); // sorted
  });
});

describe('parseEditorValue', () => {
  it('parses floats with full precision', () => {
    expect(parseEditorValue('float', '0.125')).toBe(0.125);
  });
  it('rounds int/enum/bitmask editors', () => {
    expect(parseEditorValue('int', '3.7')).toBe(4);
    expect(parseEditorValue('enum', '2')).toBe(2);
    expect(parseEditorValue('bitmask', '5')).toBe(5);
  });
  it('rejects blank and non-finite input', () => {
    expect(parseEditorValue('float', '   ')).toBeUndefined();
    expect(parseEditorValue('int', 'abc')).toBeUndefined();
  });
});

describe('bitmask arithmetic', () => {
  it('hasBit / toggleBit work above bit 30', () => {
    expect(hasBit(0b101, 0)).toBe(true);
    expect(hasBit(0b101, 1)).toBe(false);
    expect(toggleBit(0, 2, true)).toBe(4);
    expect(toggleBit(5, 0, false)).toBe(4);
    expect(toggleBit(5, 0, true)).toBe(5); // no-op when already set
    expect(toggleBit(0, 31, true)).toBe(2 ** 31);
  });

  it('entries are sorted numerically', () => {
    expect(bitmaskEntries({ bitmask: { 2: 'c', 0: 'a', 1: 'b' } })).toEqual([
      [0, 'a'],
      [1, 'b'],
      [2, 'c'],
    ]);
    expect(enumEntries({ values: { 10: 'ten', 2: 'two' } })).toEqual([
      [2, 'two'],
      [10, 'ten'],
    ]);
  });
});

describe('computeDiff / toValueMap', () => {
  it('accepts arrays and records', () => {
    expect([...toValueMap([param('A', 1, INT)])]).toEqual([['A', 1]]);
    expect([...toValueMap({ A: 1 })]).toEqual([['A', 1]]);
  });

  it('reports only differences with deltas, sorted by name', () => {
    const current = [param('A', 5, INT), param('B', 2, INT), param('C', 9, INT)];
    const other = { A: 5, B: 7, D: 1 };
    const diff = computeDiff(current, other);
    // A equal → omitted; B differs; C only in current; D only in other.
    expect(diff.map((d) => d.name)).toEqual(['B', 'C', 'D']);
    const b = diff.find((d) => d.name === 'B')!;
    expect(b).toEqual({ name: 'B', current: 2, other: 7, delta: -5 });
    const c = diff.find((d) => d.name === 'C')!;
    expect(c.current).toBe(9);
    expect(c.other).toBeUndefined();
    expect(c.delta).toBeUndefined();
    const d = diff.find((x) => x.name === 'D')!;
    expect(d.other).toBe(1);
    expect(d.current).toBeUndefined();
  });
});
