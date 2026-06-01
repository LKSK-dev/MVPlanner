/**
 * Log flight-track core + map cursor marker (task T6.5; spec plan/04 §4.8 "map
 * the flight track from the log (GPS/POS) … and correlate map position with plot
 * cursor").
 *
 * This module owns the PURE plot-cursor ⇄ map-position mapping and the map
 * marker layer:
 *
 *  - {@link findTrackSource} picks the log's GPS/POS lat+lon series from the
 *    {@link LogQueryIndex} descriptors;
 *  - {@link buildTrackFromSeries} pairs the lat/lon columns (same message ⇒ same
 *    timestamps) into an ordered {@link TrackSample} polyline;
 *  - {@link interpolateTrackAt} linearly interpolates the track at a plot-cursor
 *    `timeUs` (the cursor→map-position direction) — guarded for every array
 *    index per `noUncheckedIndexedAccess`;
 *  - {@link nearestTrackTime} maps a map click lat/lon back to the nearest track
 *    `timeUs` (the optional map→plot-cursor direction);
 *  - {@link createTrackCursorLayer} draws the synced marker on the map.
 *
 * The geometry is pure + unit-tested; the `<canvas>` stroke is canvas-deferred
 * (happy-dom has no 2d context), mirroring the map widget's layers.
 */
import type { MapLayer } from '../../../../contracts';
import type { LogSeriesData, LogSeriesDescriptor } from '../../../../data/log-query';

/** One interpolated/sampled point on the flight track. */
export interface TrackSample {
  /** Timestamp in log microseconds. */
  readonly timeUs: number;
  /** Latitude in decimal degrees. */
  readonly lat: number;
  /** Longitude in decimal degrees. */
  readonly lon: number;
}

/** A resolved GPS/POS series pair used to build the track. */
export interface TrackSource {
  /** DataFlash message name (for example `GPS` or `POS`). */
  readonly message: string;
  /** Latitude field name. */
  readonly latField: string;
  /** Longitude field name. */
  readonly lonField: string;
}

/**
 * Candidate GPS/POS message + lat/lon field names, in preference order. The
 * DataFlash decoder scales `L`-typed fields to decimal degrees already, so the
 * paired values are plain lat/lon.
 */
const TRACK_CANDIDATES: readonly TrackSource[] = [
  { message: 'GPS', latField: 'Lat', lonField: 'Lng' },
  { message: 'POS', latField: 'Lat', lonField: 'Lng' },
  { message: 'GPS2', latField: 'Lat', lonField: 'Lng' },
  { message: 'GPA', latField: 'Lat', lonField: 'Lng' },
];

/**
 * Resolve the best available GPS/POS lat+lon series pair from the log's series
 * descriptors, or `undefined` when none is present.
 */
export function findTrackSource(
  descriptors: readonly LogSeriesDescriptor[],
  candidates: readonly TrackSource[] = TRACK_CANDIDATES,
): TrackSource | undefined {
  const has = (message: string, field: string): boolean =>
    descriptors.some((d) => d.message === message && d.field === field);
  for (const candidate of candidates) {
    if (has(candidate.message, candidate.latField) && has(candidate.message, candidate.lonField)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Pair lat/lon columns into an ordered track polyline. The two columns come from
 * the same DataFlash message, so their timestamps line up index-for-index; we
 * pair up to the shorter length and drop non-finite or `(0, 0)` "no-fix" rows.
 */
export function buildTrackFromSeries(lat: LogSeriesData, lon: LogSeriesData): TrackSample[] {
  const count = Math.min(lat.timesUs.length, lat.values.length, lon.values.length);
  const out: TrackSample[] = [];
  for (let i = 0; i < count; i++) {
    const t = lat.timesUs[i];
    const la = lat.values[i];
    const lo = lon.values[i];
    if (t === undefined || la === undefined || lo === undefined) continue;
    if (!Number.isFinite(t) || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
    if (la === 0 && lo === 0) continue;
    out.push({ timeUs: t, lat: la, lon: lo });
  }
  return out;
}

/**
 * Linearly interpolate the flight track at a plot-cursor `timeUs` — the core of
 * the cursor→map-position sync. Returns the endpoint sample when the cursor is
 * before/after the track, or `undefined` for an empty track.
 */
export function interpolateTrackAt(
  track: readonly TrackSample[],
  timeUs: number,
): TrackSample | undefined {
  const n = track.length;
  if (n === 0) return undefined;
  const first = track[0];
  const last = track[n - 1];
  if (first === undefined || last === undefined) return undefined;
  if (!Number.isFinite(timeUs) || timeUs <= first.timeUs) return first;
  if (timeUs >= last.timeUs) return last;

  // Binary search for the first sample at/after `timeUs`.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const sample = track[mid];
    if (sample === undefined) return undefined;
    if (sample.timeUs < timeUs) lo = mid + 1;
    else hi = mid;
  }
  const after = track[lo];
  const before = track[lo - 1];
  if (after === undefined) return before;
  if (before === undefined) return after;

  const span = after.timeUs - before.timeUs;
  const frac = span <= 0 ? 0 : (timeUs - before.timeUs) / span;
  return {
    timeUs,
    lat: before.lat + (after.lat - before.lat) * frac,
    lon: before.lon + (after.lon - before.lon) * frac,
  };
}

/**
 * Map a clicked lat/lon back to the nearest track sample's `timeUs` (the
 * optional map→plot-cursor direction). Uses a cheap squared-degree distance,
 * which is monotonic enough for picking the closest vertex at log scales.
 */
export function nearestTrackTime(
  track: readonly TrackSample[],
  lat: number,
  lon: number,
): number | undefined {
  let bestTime: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const sample of track) {
    const dLat = sample.lat - lat;
    const dLon = sample.lon - lon;
    const distance = dLat * dLat + dLon * dLon;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTime = sample.timeUs;
    }
  }
  return bestTime;
}

/** Visual options for {@link createTrackCursorLayer}. */
export interface TrackCursorLayerOptions {
  /** Layer id (default `'logs-track-cursor'`). */
  readonly id?: string;
  /** Marker fill colour (default an opaque amber). */
  readonly color?: string;
  /** Marker radius in device pixels (default 6). */
  readonly radiusPx?: number;
}

/**
 * Create the {@link MapLayer} that draws the cursor-synced marker at the
 * interpolated track position. The position is read each frame from a pure
 * accessor (the screen feeds it the interpolated sample), so the layer is
 * store-agnostic. The `<canvas>` stroke is canvas-deferred.
 */
export function createTrackCursorLayer(
  position: () => TrackSample | undefined,
  options: TrackCursorLayerOptions = {},
): MapLayer {
  const id = options.id ?? 'logs-track-cursor';
  const color = options.color ?? 'rgba(255, 176, 32, 0.95)';
  const radiusPx = options.radiusPx ?? 6;

  return {
    id,
    render(ctx): void {
      const sample = position();
      if (sample === undefined) return;
      const g = ctx.canvas.getContext('2d');
      if (!g) return;
      const [x, y] = ctx.project(sample.lat, sample.lon);
      g.save();
      g.beginPath();
      g.arc(x, y, radiusPx, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = '#ffffff';
      g.stroke();
      g.restore();
    },
  };
}
