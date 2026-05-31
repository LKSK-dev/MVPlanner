/**
 * Bounded live-track ring buffer (task T2.4; spec plan/04 §4.2 "live track").
 * Keeps the most recent N vehicle positions in insertion order, dropping the
 * oldest as new ones arrive, and optionally coalescing samples closer than a
 * spacing threshold so a stationary vehicle does not flood the buffer. Pure data
 * structure — no DOM, no reactivity; the Flight screen (T2.11) pushes positions
 * from the vehicle store and passes {@link TrackRing.points} to the track layer.
 */
import { haversineMeters, type LatLon } from './geometry';

/** Options for {@link createTrackRing}. */
export interface TrackRingOptions {
  /** Maximum retained positions (oldest dropped past this). */
  capacity: number;
  /**
   * Minimum great-circle spacing (metres) between retained samples; a new point
   * closer than this to the last retained one is ignored. Default `0` (keep
   * every push).
   */
  minSpacingM?: number;
}

/** A bounded, ordered buffer of recent track positions. */
export interface TrackRing {
  /** Append a position (subject to the spacing/capacity bounds). */
  push(p: LatLon): void;
  /** A copy of the retained positions, oldest → newest. */
  points(): LatLon[];
  /** Current retained count. */
  size(): number;
  /** Drop all positions. */
  clear(): void;
  /** Configured maximum capacity. */
  readonly capacity: number;
}

/**
 * Create a {@link TrackRing}. `capacity` is clamped to at least 1. Pushes that
 * fall within `minSpacingM` of the last retained sample are skipped; otherwise
 * the point is appended and the oldest dropped once capacity is exceeded.
 */
export function createTrackRing(options: TrackRingOptions): TrackRing {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const minSpacingM = Math.max(0, options.minSpacingM ?? 0);
  const buffer: LatLon[] = [];

  return {
    capacity,
    push(p: LatLon): void {
      const last = buffer[buffer.length - 1];
      if (last && minSpacingM > 0 && haversineMeters(last, p) < minSpacingM) return;
      buffer.push({ lat: p.lat, lon: p.lon });
      if (buffer.length > capacity) buffer.splice(0, buffer.length - capacity);
    },
    points(): LatLon[] {
      return buffer.map((p) => ({ lat: p.lat, lon: p.lon }));
    },
    size(): number {
      return buffer.length;
    },
    clear(): void {
      buffer.length = 0;
    },
  };
}
