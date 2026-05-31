/**
 * Decimal-degrees (DD) coordinate formatting + parsing (task T3.8; spec
 * plan/05 §5.9 — `CoordinateFormat = 'dd'`). Pure, DOM-free.
 *
 * Coordinates are rendered with a canonical `.` decimal point (not locale digit
 * grouping) so the output round-trips through {@link parseDD}. Two styles:
 * signed (`-76.072090°`) or hemisphere-suffixed (`76.072090° W`).
 */
import type { LatLon } from './types';

/** Options for {@link formatDD}. */
export interface DdFormatOptions {
  /** Fraction digits for each degree value (default `6`, ≈ 0.1 m). */
  fractionDigits?: number;
  /** Use `N/S`/`E/W` hemisphere suffixes with unsigned magnitudes. */
  hemisphere?: boolean;
  /** String placed between the latitude and longitude (default `', '`). */
  separator?: string;
}

/** Render a single signed degree value as `"<num>°"` or `"<num>° <hemi>"`. */
function component(value: number, isLat: boolean, opts: Required<DdFormatOptions>): string {
  const digits = opts.fractionDigits;
  if (!opts.hemisphere) return `${value.toFixed(digits)}°`;
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(digits)}° ${hemi}`;
}

/** Format a `lat`/`lon` pair as decimal degrees. */
export function formatDD(lat: number, lon: number, opts?: DdFormatOptions): string {
  const o: Required<DdFormatOptions> = {
    fractionDigits: opts?.fractionDigits ?? 6,
    hemisphere: opts?.hemisphere ?? false,
    separator: opts?.separator ?? ', ',
  };
  return component(lat, true, o) + o.separator + component(lon, false, o);
}

/** A single number with an optional `N/S/E/W` hemisphere letter. */
const TOKEN_RE = /(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?/gi;

/**
 * Parse a decimal-degrees string into a {@link LatLon}, or `null` when it does
 * not contain a valid lat/lon pair. Accepts signed values, an optional degree
 * symbol, and `N/S/E/W` suffixes in either order (`"38.95° N, 76.07° W"` or
 * `"38.9594, -76.07209"`). Out-of-range results return `null`.
 */
export function parseDD(text: string): LatLon | null {
  let lat: number | undefined;
  let lon: number | undefined;
  const positional: number[] = [];

  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[1];
    if (raw === undefined) continue;
    const magnitude = Number(raw);
    if (!Number.isFinite(magnitude)) continue;
    const hemi = m[2]?.toUpperCase();
    if (hemi === 'N' || hemi === 'S') {
      lat = hemi === 'S' ? -Math.abs(magnitude) : Math.abs(magnitude);
    } else if (hemi === 'E' || hemi === 'W') {
      lon = hemi === 'W' ? -Math.abs(magnitude) : Math.abs(magnitude);
    } else {
      positional.push(magnitude);
    }
  }

  if (lat === undefined) lat = positional.shift();
  if (lon === undefined) lon = positional.shift();
  if (lat === undefined || lon === undefined) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}
