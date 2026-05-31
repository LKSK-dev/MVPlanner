/**
 * Military Grid Reference System (MGRS) formatting (task T3.8; spec plan/05 §5.9
 * — `CoordinateFormat = 'mgrs'`). Pure, DOM-free, no external dependency.
 *
 * Built on the WGS84 UTM forward conversion in {@link ./utm}. The 100 km square
 * column/row lettering follows the standard MGRS lettering scheme (the same
 * `AA`-origin algorithm used by the canonical proj4/NGA implementations),
 * including the `I`/`O`/`Z` exclusions.
 */
import { latBand, latLonToUtm } from './utm';

const A = 'A'.charCodeAt(0); // 65
const I = 'I'.charCodeAt(0); // 73
const O = 'O'.charCodeAt(0); // 79
const V = 'V'.charCodeAt(0); // 86
const Z = 'Z'.charCodeAt(0); // 90

/** Column-letter origin per 100k set (zones cycle 1..6). */
const SET_ORIGIN_COLUMN_LETTERS = 'AJSAJS';
/** Row-letter origin per 100k set. */
const SET_ORIGIN_ROW_LETTERS = 'AFAFAF';

/** The 100 km set (1..6) a UTM zone belongs to. */
function setForZone(zone: number): number {
  return ((zone - 1) % 6) + 1;
}

/**
 * The two-letter 100 km square identifier for a UTM column/row index within a
 * zone's 100k set, applying the `I`/`O` letter skips and `A..Z`/`A..V` rollover.
 */
function letter100kId(column: number, row: number, parm: number): string {
  const index = parm - 1;
  const colOrigin = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(index);
  const rowOrigin = SET_ORIGIN_ROW_LETTERS.charCodeAt(index);

  let colInt = colOrigin + column - 1;
  let rowInt = rowOrigin + row;
  let rollover = false;

  if (colInt > Z) {
    colInt = colInt - Z + A - 1;
    rollover = true;
  }

  if (
    colInt === I ||
    (colOrigin < I && colInt > I) ||
    ((colInt > I || colOrigin < I) && rollover)
  ) {
    colInt++;
  }
  if (
    colInt === O ||
    (colOrigin < O && colInt > O) ||
    ((colInt > O || colOrigin < O) && rollover)
  ) {
    colInt++;
    if (colInt === I) colInt++;
  }
  if (colInt > Z) {
    colInt = colInt - Z + A - 1;
  }

  if (rowInt > V) {
    rowInt = rowInt - V + A - 1;
    rollover = true;
  } else {
    rollover = false;
  }

  if (
    rowInt === I ||
    (rowOrigin < I && rowInt > I) ||
    ((rowInt > I || rowOrigin < I) && rollover)
  ) {
    rowInt++;
  }
  if (
    rowInt === O ||
    (rowOrigin < O && rowInt > O) ||
    ((rowInt > O || rowOrigin < O) && rollover)
  ) {
    rowInt++;
    if (rowInt === I) rowInt++;
  }
  if (rowInt > V) {
    rowInt = rowInt - V + A - 1;
  }

  return String.fromCharCode(colInt) + String.fromCharCode(rowInt);
}

/** Options for {@link formatMGRS}. */
export interface MgrsFormatOptions {
  /**
   * Easting/northing digits per axis, `1`–`5` (5 = 1 m, 4 = 10 m, …). Default
   * `5`.
   */
  accuracy?: number;
  /** Insert spaces between the grid-zone, 100k square and digits. Default `false`. */
  spaces?: boolean;
}

/**
 * Convert a WGS84 `lat`/`lon` to an MGRS string, e.g.
 * `latLonToMgrs(48.24949, 16.41450)` → `"33UXP0500444996"`.
 */
export function latLonToMgrs(lat: number, lon: number, opts?: MgrsFormatOptions): string {
  const accuracy = Math.min(Math.max(Math.trunc(opts?.accuracy ?? 5), 1), 5);
  const utm = latLonToUtm(lat, lon);
  const band = latBand(lat);

  const easting = Math.floor(utm.easting);
  const northing = Math.floor(utm.northing);
  const column = Math.floor(easting / 100000);
  const row = Math.floor(northing / 100000) % 20;
  const square = letter100kId(column, row, setForZone(utm.zone));

  const eStr = String(easting % 100000)
    .padStart(5, '0')
    .slice(0, accuracy);
  const nStr = String(northing % 100000)
    .padStart(5, '0')
    .slice(0, accuracy);

  if (opts?.spaces) return `${utm.zone}${band} ${square} ${eStr} ${nStr}`;
  return `${utm.zone}${band}${square}${eStr}${nStr}`;
}

/** Format a `lat`/`lon` as MGRS (alias of {@link latLonToMgrs}). */
export function formatMGRS(lat: number, lon: number, opts?: MgrsFormatOptions): string {
  return latLonToMgrs(lat, lon, opts);
}
