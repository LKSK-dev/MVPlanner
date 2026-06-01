/** Unit tests for the T6.3 DataFlash log query engine. */
import { describe, expect, it } from 'vitest';
import { buildLogQueryIndex, type LogQueryPoint } from '../../src/data/log-query';
import type { DataFlashMetadata, DataFlashRecord, DataFlashValue } from '../../src/data/dataflash';

describe('DataFlash log query engine', () => {
  it('lists numeric series from decoded records with unit metadata', () => {
    const index = buildLogQueryIndex(buildBasicLog(), { metadata: unitMetadata() });

    expect(index.listSeries()).toEqual([
      { message: 'A', field: 'TimeUS', unit: 's' },
      { message: 'A', field: 'x', unit: 'deg' },
      { message: 'B', field: 'TimeUS', unit: 's' },
      { message: 'B', field: 'y', unit: 'm/s' },
      { message: 'GPS', field: 'Spd' },
      { message: 'GPS', field: 'TimeUS' },
    ]);
  });

  it('returns full-resolution points for small windows', () => {
    const index = buildLogQueryIndex(buildBasicLog());

    const points = index.querySeries('A', 'x');

    expect(
      points.map((point) => [point.t, point.value, point.min, point.max, point.count]),
    ).toEqual([
      [0, 0, 0, 0, 1],
      [10, 10, 10, 10, 1],
      [20, 20, 20, 20, 1],
      [30, 30, 30, 30, 1],
    ]);
  });

  it('uses binary-searched range windows', () => {
    const index = buildLogQueryIndex(buildBasicLog());

    const points = index.querySeries('A', 'x', { fromUs: 10, toUs: 20 });

    expect(points.map((point) => point.t)).toEqual([10, 20]);
    expect(points.map((point) => point.value)).toEqual([10, 20]);
  });

  it('downsamples with min/max buckets so peaks are retained', () => {
    const records: DataFlashRecord[] = [];
    const values = [0, 1, 100, 2, 3, -50, 4, 5, 6, 7];
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value === undefined) continue;
      records.push(record('P', i, { TimeUS: i, v: value }));
    }
    const index = buildLogQueryIndex(records);

    const points = index.querySeries('P', 'v', undefined, 3);

    expect(points).toHaveLength(3);
    expect(points.map((point) => point.max)).toEqual([100, 3, 7]);
    expect(points.map((point) => point.min)).toEqual([0, -50, 4]);
    expect(points.reduce((sum, point) => sum + point.count, 0)).toBe(values.length);
  });

  it('evaluates derived subtraction with nearest-timestamp alignment', () => {
    const index = buildLogQueryIndex(buildBasicLog());

    const points = index.evaluateDerived('A.x - B.y');

    expect(points.map((point) => [point.t, point.value])).toEqual([
      [0, -100],
      [10, -90],
      [20, -180],
      [30, -170],
    ]);
  });

  it('evaluates scaling, division, and parentheses safely', () => {
    const index = buildLogQueryIndex(buildBasicLog());

    const points = index.evaluateDerived('(GPS.Spd * 3.6) / 2');

    expect(pointValues(points)).toEqual([18, 27]);
  });

  it('uses a synthetic monotonic counter when TimeUS is absent', () => {
    const index = buildLogQueryIndex([
      record('NO', 0, { v: 4 }),
      record('NO', 0, { v: 5 }),
      record('NO', 0, { v: 6 }),
    ]);

    expect(index.querySeries('NO', 'v').map((point) => point.t)).toEqual([0, 1, 2]);
  });
});

function buildBasicLog(): readonly DataFlashRecord[] {
  return [
    record('A', 0, { TimeUS: 0, x: 0 }, '\u0001\u0002'),
    record('B', 5, { TimeUS: 5, y: 100 }, '\u0001\u0003'),
    record('A', 10, { TimeUS: 10, x: 10 }, '\u0001\u0002'),
    record('A', 20, { TimeUS: 20n, x: 20 }, '\u0001\u0002'),
    record('B', 25, { TimeUS: 25, y: 200 }, '\u0001\u0003'),
    record('A', 30, { TimeUS: 30, x: 30 }, '\u0001\u0002'),
    record('GPS', 40, { TimeUS: 40, Spd: 10 }),
    record('GPS', 50, { TimeUS: 50, Spd: 15 }),
  ];
}

function record(
  name: string,
  offset: number,
  fields: Readonly<Record<string, DataFlashValue>>,
  unitIds?: string,
): DataFlashRecord {
  return unitIds === undefined
    ? { type: name.charCodeAt(0), name, offset, length: 0, fields }
    : { type: name.charCodeAt(0), name, offset, length: 0, fields, unitIds };
}

function unitMetadata(): DataFlashMetadata {
  return {
    units: [
      { id: 1, label: 's' },
      { id: 2, label: 'deg' },
      { id: 3, label: 'm/s' },
    ],
    multipliers: [],
    formatUnits: [],
  };
}

function pointValues(points: readonly LogQueryPoint[]): readonly number[] {
  return points.map((point) => point.value ?? point.mean);
}
