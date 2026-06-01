/** Range slicing and min/max downsampling helpers for log series. */
import type { LogQueryPoint, LogQueryRange } from './types';

/** Return the first index whose value is greater than or equal to `target`. */
export function lowerBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    const value = checkedAt(values, mid);
    if (value < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Return the first index whose value is greater than `target`. */
export function upperBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    const value = checkedAt(values, mid);
    if (value <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Convert a query range to half-open array bounds using binary search. */
export function rangeBounds(
  timesUs: Float64Array,
  range?: LogQueryRange,
): readonly [number, number] {
  const from = range?.fromUs ?? Number.NEGATIVE_INFINITY;
  const to = range?.toUs ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(from) && !Number.isFinite(to)) return [0, timesUs.length];
  if (from > to) return [0, 0];
  const start = Number.isFinite(from) ? lowerBound(timesUs, from) : 0;
  const end = Number.isFinite(to) ? upperBound(timesUs, to) : timesUs.length;
  return [start, Math.max(start, end)];
}

/** Build plotter points for an already sliced series, downsampling when requested. */
export function pointsForSlice(
  timesUs: Float64Array,
  values: Float64Array,
  start: number,
  end: number,
  maxPoints?: number,
): readonly LogQueryPoint[] {
  const count = Math.max(0, end - start);
  if (count === 0) return [];
  const limit = maxPoints === undefined ? undefined : Math.floor(maxPoints);
  if (limit === undefined || limit <= 0 || count <= limit)
    return fullResolution(timesUs, values, start, end);
  return downsampleMinMax(timesUs, values, start, end, limit);
}

/** Read a typed-array element after the caller has established bounds. */
export function checkedAt(values: Float64Array, index: number): number {
  const value = values[index];
  if (value === undefined) throw new RangeError(`typed-array index ${index} out of bounds`);
  return value;
}

function fullResolution(
  timesUs: Float64Array,
  values: Float64Array,
  start: number,
  end: number,
): readonly LogQueryPoint[] {
  const out: LogQueryPoint[] = [];
  for (let index = start; index < end; index++) {
    const t = checkedAt(timesUs, index);
    const value = checkedAt(values, index);
    out.push({
      t,
      min: value,
      max: value,
      first: value,
      last: value,
      mean: value,
      count: 1,
      value,
    });
  }
  return out;
}

function downsampleMinMax(
  timesUs: Float64Array,
  values: Float64Array,
  start: number,
  end: number,
  maxPoints: number,
): readonly LogQueryPoint[] {
  const rawCount = end - start;
  const bucketCount = Math.max(1, Math.min(maxPoints, rawCount));
  const out: LogQueryPoint[] = [];

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const bucketStart = start + Math.floor((bucket * rawCount) / bucketCount);
    const bucketEnd = start + Math.floor(((bucket + 1) * rawCount) / bucketCount);
    if (bucketStart >= bucketEnd) continue;

    const first = checkedAt(values, bucketStart);
    let last = first;
    let min = first;
    let max = first;
    let sum = 0;
    let finiteCount = 0;

    for (let index = bucketStart; index < bucketEnd; index++) {
      const value = checkedAt(values, index);
      if (value < min) min = value;
      if (value > max) max = value;
      if (Number.isFinite(value)) {
        sum += value;
        finiteCount += 1;
      }
      last = value;
    }

    const firstT = checkedAt(timesUs, bucketStart);
    const lastT = checkedAt(timesUs, bucketEnd - 1);
    const t = (firstT + lastT) / 2;
    const count = bucketEnd - bucketStart;
    const mean = finiteCount === 0 ? Number.NaN : sum / finiteCount;
    out.push({ t, min, max, first, last, mean, count });
  }

  return out;
}
