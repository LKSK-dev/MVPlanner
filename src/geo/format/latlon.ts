/**
 * Coordinate-format dispatcher (task T3.8; spec plan/05 §5.9). Maps the frozen
 * {@link CoordinateFormat} setting (`'dd' | 'dms' | 'utm' | 'mgrs'`) to the
 * concrete formatter, and parses the round-trippable text formats (DD/DMS).
 */
import type { CoordinateFormat } from '../../contracts';
import { formatDD, parseDD } from './dd';
import { formatDMS, parseDMS } from './dms';
import { formatMGRS } from './mgrs';
import { formatUTM } from './utm';
import type { LatLon } from './types';

/**
 * Format a WGS84 `lat`/`lon` in the requested {@link CoordinateFormat}, using
 * each format's sensible defaults. For finer control (precision, hemisphere
 * style, MGRS accuracy) call the per-format functions directly.
 */
export function formatLatLon(lat: number, lon: number, format: CoordinateFormat): string {
  switch (format) {
    case 'dd':
      return formatDD(lat, lon);
    case 'dms':
      return formatDMS(lat, lon);
    case 'utm':
      return formatUTM(lat, lon);
    case 'mgrs':
      return formatMGRS(lat, lon);
  }
}

/**
 * Parse a coordinate string into a {@link LatLon}, or `null` when it cannot be
 * parsed. Only the text formats are parseable: `'dd'` and `'dms'`. When
 * `format` is omitted, DMS is tried first (it is the more specific grammar),
 * then DD. UTM/MGRS parsing is not supported and throws.
 */
export function parseLatLon(text: string, format?: CoordinateFormat): LatLon | null {
  switch (format) {
    case 'dd':
      return parseDD(text);
    case 'dms':
      return parseDMS(text);
    case 'utm':
    case 'mgrs':
      throw new Error(`parseLatLon: parsing '${format}' coordinates is not supported`);
    case undefined:
      return parseDMS(text) ?? parseDD(text);
  }
}
