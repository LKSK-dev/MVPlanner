/**
 * `geo/format` public surface (task T3.8; spec plan/05 §5.9). Dependency-free
 * WGS84 coordinate formatting + parsing for every {@link CoordinateFormat}:
 * decimal degrees, degrees/minutes/seconds, UTM and MGRS. Cross-module consumers
 * import from here, never deep paths (conventions plan/implementation/00 §0.3).
 */
export type { LatLon } from './types';

export { formatLatLon, parseLatLon } from './latlon';

export { formatDD, parseDD, type DdFormatOptions } from './dd';
export { formatDMS, parseDMS, type DmsFormatOptions } from './dms';

export {
  utmZone,
  latBand,
  latLonToUtm,
  utmToLatLon,
  formatUTM,
  type UtmCoord,
  type UtmFormatOptions,
} from './utm';

export { latLonToMgrs, formatMGRS, type MgrsFormatOptions } from './mgrs';
