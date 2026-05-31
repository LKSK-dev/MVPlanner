/**
 * Universal Transverse Mercator (UTM) conversion + formatting on the WGS84
 * ellipsoid (task T3.8; spec plan/05 §5.9 — `CoordinateFormat = 'utm'`). Pure,
 * DOM-free, no external dependency.
 *
 * Forward/inverse use the standard truncated series (Snyder, *Map Projections —
 * A Working Manual*, USGS PP 1395), accurate to the millimetre within a zone —
 * the same formulation MGRS builds on ({@link ./mgrs}).
 */
import type { LatLon } from './types';

/** WGS84 semi-major axis, metres. */
const A = 6378137;
/** WGS84 flattening. */
const F = 1 / 298.257223563;
/** First eccentricity squared, `e² = f(2 − f)`. */
const E2 = F * (2 - F);
/** Second eccentricity squared, `e'² = e²/(1 − e²)`. */
const EP2 = E2 / (1 - E2);
/** UTM scale factor on the central meridian. */
const K0 = 0.9996;
/** False easting applied to every zone, metres. */
const FALSE_EASTING = 500000;
/** False northing applied in the southern hemisphere, metres. */
const FALSE_NORTHING = 10000000;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Latitude bands `C`–`X` (omitting `I`,`O`); `X` spans 72°–84°. */
const LAT_BANDS = 'CDEFGHJKLMNPQRSTUVWXX';

/** A point expressed in UTM. */
export interface UtmCoord {
  /** UTM zone number, `1`–`60`. */
  zone: number;
  /** MGRS latitude band letter (`C`–`X`). */
  band: string;
  /** `'N'` for the northern hemisphere, `'S'` for the southern. */
  hemisphere: 'N' | 'S';
  /** `true` when in the northern hemisphere (band ≥ `N`). */
  northern: boolean;
  /** Easting in metres (false-easting 500000 applied). */
  easting: number;
  /** Northing in metres (false-northing 10 000 000 applied when southern). */
  northing: number;
}

/**
 * The UTM zone number for `lat`/`lon`, including the Norway (32V) and Svalbard
 * (31/33/35/37X) exceptions.
 */
export function utmZone(lat: number, lon: number): number {
  let zone = Math.floor((lon + 180) / 6) + 1;
  // The antimeridian (lon === 180) lands in zone 61; clamp it back to 60.
  if (zone > 60) zone = 60;

  // Norway: zone 32 is widened across 3°–12°E for the 56°–64°N band.
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;

  // Svalbard: 72°–84°N uses zones 31/33/35/37.
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}

/** The MGRS latitude-band letter for `lat` (`'Z'` outside the UTM range). */
export function latBand(lat: number): string {
  if (lat < -80 || lat > 84) return 'Z';
  const idx = Math.min(Math.floor((lat + 80) / 8), LAT_BANDS.length - 1);
  return LAT_BANDS.charAt(idx);
}

/** The central-meridian longitude (degrees) for a UTM `zone`. */
function centralMeridian(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

/** Convert a WGS84 `lat`/`lon` to {@link UtmCoord}. */
export function latLonToUtm(lat: number, lon: number): UtmCoord {
  const zone = utmZone(lat, lon);
  const lonOrigin = centralMeridian(zone);
  const latRad = lat * D2R;
  const lonRad = lon * D2R;
  const lonOriginRad = lonOrigin * D2R;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);

  const N = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const C = EP2 * cosLat * cosLat;
  const Aa = cosLat * (lonRad - lonOriginRad);

  const M =
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256) * latRad -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 * E2 * E2) / 1024) * Math.sin(2 * latRad) +
      ((15 * E2 * E2) / 256 + (45 * E2 * E2 * E2) / 1024) * Math.sin(4 * latRad) -
      ((35 * E2 * E2 * E2) / 3072) * Math.sin(6 * latRad));

  const easting =
    K0 *
      N *
      (Aa +
        ((1 - T + C) * Aa ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5) / 120) +
    FALSE_EASTING;

  let northing =
    K0 *
    (M +
      N *
        tanLat *
        ((Aa * Aa) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Aa ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6) / 720));

  const northern = lat >= 0;
  if (!northern) northing += FALSE_NORTHING;

  return {
    zone,
    band: latBand(lat),
    hemisphere: northern ? 'N' : 'S',
    northern,
    easting,
    northing,
  };
}

/** Convert a {@link UtmCoord} back to a WGS84 {@link LatLon} (inverse Snyder). */
export function utmToLatLon(utm: UtmCoord): LatLon {
  const x = utm.easting - FALSE_EASTING;
  const y = utm.northern ? utm.northing : utm.northing - FALSE_NORTHING;
  const lonOrigin = centralMeridian(utm.zone);

  const M = y / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256));

  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const N1 = A / Math.sqrt(1 - E2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = EP2 * cosPhi1 * cosPhi1;
  const R1 = (A * (1 - E2)) / (1 - E2 * sinPhi1 * sinPhi1) ** 1.5;
  const D = x / (N1 * K0);

  const lat =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);

  const lon =
    lonOrigin * D2R +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) /
      cosPhi1;

  return { lat: lat * R2D, lon: lon * R2D };
}

/** Options for {@link formatUTM}. */
export interface UtmFormatOptions {
  /** Fraction digits on easting/northing (default `0` — whole metres). */
  fractionDigits?: number;
}

/**
 * Format a `lat`/`lon` as a UTM string, e.g. `"33U 605004 5344996"`
 * (`zone band easting northing`, metres).
 */
export function formatUTM(lat: number, lon: number, opts?: UtmFormatOptions): string {
  const u = latLonToUtm(lat, lon);
  const d = opts?.fractionDigits ?? 0;
  return `${u.zone}${u.band} ${u.easting.toFixed(d)} ${u.northing.toFixed(d)}`;
}
