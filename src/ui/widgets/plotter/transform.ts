/**
 * Pure transform helpers for the log plotter (T6.4).
 *
 * DataFlash queries may return min/max buckets. For v1 the plotter renders a
 * single value line per selected series: `value` for full-resolution points and
 * `mean` for buckets. Bucket `min`/`max` remain available on the original
 * samples for a future band renderer, but are intentionally not expanded here.
 */
import uPlot from 'uplot';
import type { LogQueryPoint } from '../../../data/log-query';
import type {
  NormalizedPlotterMarker,
  PlotterAlignedSeries,
  PlotterMarker,
  PlotterMarkerKind,
  PlotterModel,
  PlotterSeriesInput,
  PlotterUPlotData,
} from './types';

const DEFAULT_AXIS_ID = 'value';
const X_SCALE = 'x';
const AXIS_RIGHT: uPlot.Axis.Side = 1;
const AXIS_BOTTOM: uPlot.Axis.Side = 2;
const AXIS_LEFT: uPlot.Axis.Side = 3;
const PALETTE = [
  '#4cc9f0',
  '#f72585',
  '#b8f35a',
  '#ffd166',
  '#b388ff',
  '#ff8c42',
  '#2ec4b6',
  '#f8f9fa',
] as const;

const MARKER_COLORS: Readonly<Record<PlotterMarkerKind, string>> = {
  event: '#ffd166',
  mode: '#4cc9f0',
  error: '#ff4d6d',
};

/** Return the y value rendered for a query point. */
export function plottedValue(point: LogQueryPoint): number | undefined {
  const candidate = point.value ?? point.mean;
  return Number.isFinite(candidate) ? candidate : undefined;
}

/** Convert a logical y-axis id into the internal uPlot scale key. */
export function scaleKeyForAxis(axisId: string): string {
  const trimmed = axisId.trim();
  return `y:${trimmed.length > 0 ? trimmed : DEFAULT_AXIS_ID}`;
}

/** Align multiple possibly-downsampled series onto one sorted unique x array. */
export function alignSeriesToCommonX(series: readonly PlotterSeriesInput[]): PlotterAlignedSeries {
  const times = new Set<number>();
  const perSeries = series.map((entry) => {
    const values = new Map<number, number>();
    for (const point of entry.samples) {
      if (!Number.isFinite(point.t)) continue;
      const y = plottedValue(point);
      if (y === undefined) continue;
      values.set(point.t, y);
      times.add(point.t);
    }
    return values;
  });

  const x = [...times].sort((a, b) => a - b);
  const y = perSeries.map((values) => {
    const row: (number | null)[] = [];
    for (let index = 0; index < x.length; index++) {
      const t = x[index];
      if (t === undefined) throw new RangeError(`x index ${index} out of bounds`);
      row.push(values.get(t) ?? null);
    }
    return row;
  });

  return { x, y };
}

/** Build uPlot data from selected log series. */
export function buildPlotterModel(series: readonly PlotterSeriesInput[]): PlotterModel {
  const aligned = alignSeriesToCommonX(series);
  const x = [...aligned.x];
  const y = aligned.y.map((row) => [...row]);
  const data: PlotterUPlotData = [x, ...y];
  return { aligned, data, structureKey: seriesStructureKey(series) };
}

/** Build uPlot scales, axes, and series options for the selected log series. */
export function buildPlotterOptions(
  series: readonly PlotterSeriesInput[],
  width: number,
  height: number,
): uPlot.Options {
  const axisIds = uniqueAxisIds(series);
  const scales: uPlot.Scales = { [X_SCALE]: { time: false } };
  for (const axisId of axisIds) scales[scaleKeyForAxis(axisId)] = { auto: true };

  const axes: uPlot.Axis[] = [
    {
      scale: X_SCALE,
      side: AXIS_BOTTOM,
      label: 'Time',
      values: (_self, splits) => splits.map((split) => formatTimeUs(split)),
      grid: { stroke: 'rgba(148, 163, 184, 0.22)', width: 1 },
      ticks: { stroke: 'rgba(148, 163, 184, 0.45)', width: 1 },
      stroke: 'rgba(226, 232, 240, 0.78)',
    },
  ];

  for (let index = 0; index < axisIds.length; index++) {
    const axisId = axisIds[index];
    if (axisId === undefined) throw new RangeError(`axis index ${index} out of bounds`);
    axes.push({
      scale: scaleKeyForAxis(axisId),
      side: index % 2 === 0 ? AXIS_LEFT : AXIS_RIGHT,
      label: axisId,
      grid: index === 0 ? { stroke: 'rgba(148, 163, 184, 0.16)', width: 1 } : { show: false },
      ticks: { stroke: 'rgba(148, 163, 184, 0.45)', width: 1 },
      stroke: 'rgba(226, 232, 240, 0.78)',
    });
  }

  const uSeries: uPlot.Series[] = [
    {
      label: 'Time',
      value: (_self, rawValue) => formatTimeUs(rawValue),
    },
  ];

  for (let index = 0; index < series.length; index++) {
    const entry = series[index];
    if (entry === undefined) throw new RangeError(`series index ${index} out of bounds`);
    uSeries.push({
      label: entry.label,
      scale: scaleKeyForAxis(entry.axisId),
      stroke: entry.color ?? colorForSeries(index),
      width: 1.6,
      spanGaps: true,
      points: { show: false },
      value: (_self, rawValue) => formatValue(rawValue),
    });
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    series: uSeries,
    scales,
    axes,
    cursor: {
      show: true,
      x: true,
      y: false,
      drag: { x: true, y: false, setScale: true },
      hover: { prox: 24 },
    },
    legend: { show: true, live: true },
  };
}

/** Find the nearest x index for a cursor timestamp in microseconds. */
export function cursorTimeToIndex(timesUs: readonly number[], timeUs: number): number | null {
  if (timesUs.length === 0 || !Number.isFinite(timeUs)) return null;
  let lo = 0;
  let hi = timesUs.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const value = timesUs[mid];
    if (value === undefined) throw new RangeError(`time index ${mid} out of bounds`);
    if (value < timeUs) lo = mid + 1;
    else hi = mid;
  }
  if (lo <= 0) return 0;
  if (lo >= timesUs.length) return timesUs.length - 1;
  const beforeIndex = lo - 1;
  const afterIndex = lo;
  const before = timesUs[beforeIndex];
  const after = timesUs[afterIndex];
  if (before === undefined || after === undefined)
    throw new RangeError('cursor index out of bounds');
  return timeUs - before <= after - timeUs ? beforeIndex : afterIndex;
}

/** Resolve a uPlot cursor/data index back to the aligned timestamp. */
export function cursorIndexToTime(timesUs: readonly number[], index: number | null): number | null {
  if (index === null || !Number.isInteger(index) || index < 0 || index >= timesUs.length)
    return null;
  const t = timesUs[index];
  return t === undefined ? null : t;
}

/** Validate markers and assign default colors. Invalid/non-finite markers are skipped. */
export function normalizePlotterMarkers(
  markers: readonly PlotterMarker[] = [],
): readonly NormalizedPlotterMarker[] {
  const out: NormalizedPlotterMarker[] = [];
  for (const marker of markers) {
    if (!Number.isFinite(marker.startUs)) continue;
    const color = marker.color ?? MARKER_COLORS[marker.kind];
    const normalized: NormalizedPlotterMarker = {
      id: marker.id,
      label: marker.label,
      kind: marker.kind,
      startUs: marker.startUs,
      color,
    };
    if (
      marker.endUs !== undefined &&
      Number.isFinite(marker.endUs) &&
      marker.endUs > marker.startUs
    ) {
      out.push({ ...normalized, endUs: marker.endUs });
    } else {
      out.push(normalized);
    }
  }
  return out;
}

/** Summarize selected series for screen readers. */
export function plotterSummary(series: readonly PlotterSeriesInput[]): string {
  if (series.length === 0) return 'Log plotter with no selected series.';
  return `Log plotter showing ${series.length} series: ${series.map((entry) => entry.label).join(', ')}.`;
}

/** Format a log timestamp in microseconds as elapsed time. */
export function formatTimeUs(timeUs: number): string {
  if (!Number.isFinite(timeUs)) return '—';
  const sign = timeUs < 0 ? '-' : '';
  const totalMs = Math.round(Math.abs(timeUs) / 1_000);
  const ms = totalMs % 1_000;
  const totalSeconds = Math.floor(totalMs / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const fraction = ms.toString().padStart(3, '0');
  if (hours > 0)
    return `${sign}${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}.${fraction}`;
  return `${sign}${minutes}:${seconds.toString().padStart(2, '0')}.${fraction}`;
}

/** Deterministic color from the locked palette. */
export function colorForSeries(index: number): string {
  const color = PALETTE[index % PALETTE.length];
  if (color === undefined) throw new RangeError(`palette index ${index} out of bounds`);
  return color;
}

function uniqueAxisIds(series: readonly PlotterSeriesInput[]): readonly string[] {
  const ids = new Set<string>();
  for (const entry of series)
    ids.add(entry.axisId.trim().length > 0 ? entry.axisId : DEFAULT_AXIS_ID);
  return [...ids];
}

function seriesStructureKey(series: readonly PlotterSeriesInput[]): string {
  return series
    .map(
      (entry, index) => `${index}:${entry.id}:${entry.label}:${entry.axisId}:${entry.color ?? ''}`,
    )
    .join('|');
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 100_000 || abs < 0.001)) return value.toExponential(3);
  return Number.isInteger(value) ? value.toString() : value.toFixed(3);
}
