/** Columnar query engine over decoded DataFlash records. */
import type { DataFlashMetadata, DataFlashRecord, DataFlashValue } from '../dataflash';
import { checkedAt, lowerBound, pointsForSlice, rangeBounds } from './downsample';
import {
  collectSeriesRefs,
  evaluateExpression,
  parseExpression,
  type ExpressionNode,
  type SeriesRef,
} from './expression';
import type { LogQueryPoint, LogQueryRange, LogSeriesData, LogSeriesDescriptor } from './types';

const KEY_SEPARATOR = '\u0000';
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

/** Optional metadata used while building a log query index. */
export interface LogQueryIndexOptions {
  /** UNIT/MULT/FMTU metadata captured by the DataFlash decoder, when available. */
  readonly metadata?: DataFlashMetadata;
}

interface MutableSeries {
  readonly message: string;
  readonly field: string;
  readonly times: number[];
  readonly values: number[];
  ordered: boolean;
  lastTime?: number;
  unit?: string;
}

interface FrozenSeries {
  readonly descriptor: LogSeriesDescriptor;
  readonly timesUs: Float64Array;
  readonly values: Float64Array;
}

interface DerivedRawPoint {
  readonly t: number;
  readonly value: number;
}

/** Build a memory-conscious columnar query index from decoded DataFlash records. */
export function buildLogQueryIndex(
  records: Iterable<DataFlashRecord>,
  options: LogQueryIndexOptions = {},
): LogQueryIndex {
  return LogQueryIndex.fromRecords(records, options);
}

/** Columnar store/query engine for decoded DataFlash logs. */
export class LogQueryIndex {
  private readonly series = new Map<string, FrozenSeries>();
  private readonly descriptors: readonly LogSeriesDescriptor[];

  private constructor(series: readonly FrozenSeries[]) {
    for (const entry of series)
      this.series.set(seriesKey(entry.descriptor.message, entry.descriptor.field), entry);
    this.descriptors = series
      .map((entry) => entry.descriptor)
      .sort((a, b) =>
        a.message === b.message
          ? a.field.localeCompare(b.field)
          : a.message.localeCompare(b.message),
      );
  }

  /** Build an index from decoded records and release all temporary row storage. */
  static fromRecords(
    records: Iterable<DataFlashRecord>,
    options: LogQueryIndexOptions = {},
  ): LogQueryIndex {
    const units = unitLookup(options.metadata);
    const mutable = new Map<string, MutableSeries>();
    let syntheticTimeUs = 0;

    for (const record of records) {
      const t = timestampUs(record, syntheticTimeUs);
      syntheticTimeUs += 1;
      const fieldEntries = Object.entries(record.fields);

      for (let fieldIndex = 0; fieldIndex < fieldEntries.length; fieldIndex++) {
        const entry = fieldEntries[fieldIndex];
        if (entry === undefined) continue;
        const [field, rawValue] = entry;
        const value = dataValueToNumber(rawValue);
        if (value === undefined) continue;
        const key = seriesKey(record.name, field);
        let bucket = mutable.get(key);
        if (bucket === undefined) {
          bucket = { message: record.name, field, times: [], values: [], ordered: true };
          mutable.set(key, bucket);
        }
        if (bucket.lastTime !== undefined && t < bucket.lastTime) bucket.ordered = false;
        bucket.lastTime = t;
        const unit = unitForField(record, fieldIndex, units);
        if (bucket.unit === undefined && unit !== undefined) bucket.unit = unit;
        bucket.times.push(t);
        bucket.values.push(value);
      }
    }

    const frozen = [...mutable.values()].map((entry) => freezeSeries(entry));
    return new LogQueryIndex(frozen);
  }

  /** List all indexed numeric message fields. */
  listSeries(): readonly LogSeriesDescriptor[] {
    return this.descriptors;
  }

  /** Return full-resolution or min/max-downsampled points for one series. */
  querySeries(
    message: string,
    field: string,
    range?: LogQueryRange,
    maxPoints?: number,
  ): readonly LogQueryPoint[] {
    const series = this.requireSeries(message, field);
    const [start, end] = rangeBounds(series.timesUs, range);
    return pointsForSlice(series.timesUs, series.values, start, end, maxPoints);
  }

  /** Evaluate a safe arithmetic expression over nearest-timestamp-aligned series. */
  evaluateDerived(
    expr: string,
    range?: LogQueryRange,
    maxPoints?: number,
  ): readonly LogQueryPoint[] {
    const parsed = parseExpression(expr);
    const refs = collectSeriesRefs(parsed);
    if (refs.length === 0) throw new Error('Derived expression must reference at least one series');

    const baseRef = refs[0];
    if (baseRef === undefined)
      throw new Error('Derived expression must reference at least one series');
    const base = this.requireSeries(baseRef.message, baseRef.field);
    const [start, end] = rangeBounds(base.timesUs, range);
    if (start >= end) return [];

    const lookup = this.buildReferenceLookup(refs);
    const derived = evaluateOnBase(parsed, lookup, base.timesUs, start, end);
    if (derived.length === 0) return [];
    const times = new Float64Array(derived.length);
    const values = new Float64Array(derived.length);
    for (let i = 0; i < derived.length; i++) {
      const point = derived[i];
      if (point === undefined) throw new RangeError(`derived point ${i} out of bounds`);
      times[i] = point.t;
      values[i] = point.value;
    }
    return pointsForSlice(times, values, 0, times.length, maxPoints);
  }

  /** Return typed arrays for advanced callers without exposing mutable internals. */
  getSeries(message: string, field: string): LogSeriesData {
    const series = this.requireSeries(message, field);
    return { timesUs: series.timesUs, values: series.values };
  }

  private requireSeries(message: string, field: string): FrozenSeries {
    const series = this.series.get(seriesKey(message, field));
    if (series === undefined) throw new Error(`Unknown log series ${message}.${field}`);
    return series;
  }

  private buildReferenceLookup(refs: readonly SeriesRef[]): ReadonlyMap<string, FrozenSeries> {
    const lookup = new Map<string, FrozenSeries>();
    for (const ref of refs) {
      const key = seriesKey(ref.message, ref.field);
      lookup.set(key, this.requireSeries(ref.message, ref.field));
    }
    return lookup;
  }
}

function freezeSeries(entry: MutableSeries): FrozenSeries {
  const descriptor: LogSeriesDescriptor =
    entry.unit === undefined
      ? { message: entry.message, field: entry.field }
      : { message: entry.message, field: entry.field, unit: entry.unit };

  if (entry.ordered) {
    return {
      descriptor,
      timesUs: Float64Array.from(entry.times),
      values: Float64Array.from(entry.values),
    };
  }

  const indices = entry.times
    .map((_time, index) => index)
    .sort((a, b) => {
      const at = entry.times[a];
      const bt = entry.times[b];
      if (at === undefined || bt === undefined)
        throw new RangeError('series sort index out of bounds');
      return at - bt;
    });
  const timesUs = new Float64Array(indices.length);
  const values = new Float64Array(indices.length);
  for (let out = 0; out < indices.length; out++) {
    const source = indices[out];
    if (source === undefined) throw new RangeError('series index out of bounds');
    const t = entry.times[source];
    const value = entry.values[source];
    if (t === undefined || value === undefined) throw new RangeError('series value out of bounds');
    timesUs[out] = t;
    values[out] = value;
  }
  return { descriptor, timesUs, values };
}

function timestampUs(record: DataFlashRecord, synthetic: number): number {
  const timeUs = record.fields.TimeUS;
  const converted = timeUs === undefined ? undefined : dataValueToNumber(timeUs);
  return converted ?? synthetic;
}

function dataValueToNumber(value: DataFlashValue): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'bigint') return undefined;
  if (value > MAX_SAFE_BIGINT || value < MIN_SAFE_BIGINT) return undefined;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : undefined;
}

function seriesKey(message: string, field: string): string {
  return `${message}${KEY_SEPARATOR}${field}`;
}

function unitLookup(metadata?: DataFlashMetadata): ReadonlyMap<number, string> {
  const units = new Map<number, string>();
  for (const unit of metadata?.units ?? []) units.set(unit.id, unit.label);
  return units;
}

function unitForField(
  record: DataFlashRecord,
  fieldIndex: number,
  units: ReadonlyMap<number, string>,
): string | undefined {
  const unitIds = record.unitIds;
  if (unitIds === undefined) return undefined;
  const idChar = unitIds[fieldIndex];
  if (idChar === undefined || idChar.length === 0) return undefined;
  return units.get(idChar.charCodeAt(0)) ?? idChar;
}

function evaluateOnBase(
  expr: ExpressionNode,
  lookup: ReadonlyMap<string, FrozenSeries>,
  baseTimes: Float64Array,
  start: number,
  end: number,
): readonly DerivedRawPoint[] {
  const out: DerivedRawPoint[] = [];
  for (let index = start; index < end; index++) {
    const t = checkedAt(baseTimes, index);
    const value = evaluateExpression(expr, (message, field) => {
      const series = lookup.get(seriesKey(message, field));
      if (series === undefined) throw new Error(`Unknown log series ${message}.${field}`);
      return nearestValue(series, t);
    });
    if (Number.isFinite(value)) out.push({ t, value });
  }
  return out;
}

function nearestValue(series: FrozenSeries, t: number): number {
  const length = series.timesUs.length;
  if (length === 0)
    throw new Error(`Empty log series ${series.descriptor.message}.${series.descriptor.field}`);
  const insertion = lowerBound(series.timesUs, t);
  if (insertion <= 0) return checkedAt(series.values, 0);
  if (insertion >= length) return checkedAt(series.values, length - 1);
  const beforeIndex = insertion - 1;
  const afterIndex = insertion;
  const beforeT = checkedAt(series.timesUs, beforeIndex);
  const afterT = checkedAt(series.timesUs, afterIndex);
  return t - beforeT <= afterT - t
    ? checkedAt(series.values, beforeIndex)
    : checkedAt(series.values, afterIndex);
}
