/**
 * Degrees/minutes/seconds (DMS) coordinate formatting + parsing (task T3.8;
 * spec plan/05 §5.9 — `CoordinateFormat = 'dms'`). Pure, DOM-free.
 *
 * Output uses the conventional symbols (`°`, `′`, `″`) with an `N/S/E/W`
 * hemisphere suffix, e.g. `38°57′33.84″N`. Degrees are zero-padded (2 for
 * latitude, 3 for longitude) so columns align.
 */
import type { LatLon } from './types';

/** Options for {@link formatDMS}. */
export interface DmsFormatOptions {
  /** Fraction digits on the seconds component (default `2`). */
  secondsFractionDigits?: number;
  /** String placed between the latitude and longitude (default `' '`). */
  separator?: string;
}

/** Render a single signed degree value as DMS with a hemisphere suffix. */
function component(value: number, isLat: boolean, secondsFractionDigits: number): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const total = Math.abs(value);
  let degrees = Math.floor(total);
  const minutesFloat = (total - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = (minutesFloat - minutes) * 60;

  // Carry rounding of the seconds component up through minutes/degrees so we
  // never emit `60″` / `60′`.
  if (Number(seconds.toFixed(secondsFractionDigits)) >= 60) {
    seconds = 0;
    minutes += 1;
    if (minutes >= 60) {
      minutes = 0;
      degrees += 1;
    }
  }

  // Zero-pad the seconds' integer part to two digits (`05.20`, `00.00`).
  const secFixed = seconds.toFixed(secondsFractionDigits);
  const dot = secFixed.indexOf('.');
  const finalSeconds =
    dot === -1
      ? secFixed.padStart(2, '0')
      : `${secFixed.slice(0, dot).padStart(2, '0')}${secFixed.slice(dot)}`;

  const degWidth = isLat ? 2 : 3;
  const deg = String(degrees).padStart(degWidth, '0');
  const min = String(minutes).padStart(2, '0');
  return `${deg}°${min}′${finalSeconds}″${hemi}`;
}

/** Format a `lat`/`lon` pair as degrees/minutes/seconds. */
export function formatDMS(lat: number, lon: number, opts?: DmsFormatOptions): string {
  const digits = opts?.secondsFractionDigits ?? 2;
  const sep = opts?.separator ?? ' ';
  return component(lat, true, digits) + sep + component(lon, false, digits);
}

/** `deg [°/space] min [′/'/space] sec [″/"/space] hemi` for one component. */
const DMS_RE =
  /(-?\d{1,3})\s*[°\s]\s*(\d{1,2})\s*[′'\s]\s*(\d{1,2}(?:\.\d+)?)\s*[″"\s]*\s*([NSEW])/gi;

/**
 * Parse a DMS string into a {@link LatLon}, or `null` when it does not contain a
 * valid lat/lon pair. Each component needs a hemisphere letter; the letters
 * decide which value is latitude vs longitude. Out-of-range results return
 * `null`.
 */
export function parseDMS(text: string): LatLon | null {
  let lat: number | undefined;
  let lon: number | undefined;

  for (const m of text.matchAll(DMS_RE)) {
    const [, dStr, mStr, sStr, hemiRaw] = m;
    if (dStr === undefined || mStr === undefined || sStr === undefined || hemiRaw === undefined) {
      continue;
    }
    const deg = Number(dStr);
    const min = Number(mStr);
    const sec = Number(sStr);
    if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) continue;
    const hemi = hemiRaw.toUpperCase();
    const sign = hemi === 'S' || hemi === 'W' ? -1 : 1;
    const magnitude = Math.abs(deg) + min / 60 + sec / 3600;
    const value = sign * magnitude;
    if (hemi === 'N' || hemi === 'S') lat = value;
    else lon = value;
  }

  if (lat === undefined || lon === undefined) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}
