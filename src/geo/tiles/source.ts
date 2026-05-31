/**
 * Basemap source URL templating (task T2.3; spec plan/04 §4.2 "custom tile/XYZ/
 * WMS sources", plan/07 §7.2). Turns a frozen {@link BasemapSource} plus a
 * {@link TileCoord} into a fetchable URL. Pure and unit-tested.
 *
 * Supported placeholders in {@link BasemapSource.url} (all user-configurable):
 * - XYZ: `{z}` `{x}` `{y}` `{-y}` (TMS row), `{s}` (subdomain rotation),
 *   `{apiKey}` / `{key}` (from {@link BasemapSource.apiKey}).
 * - WMS: `{bbox-epsg-3857}` / `{bbox}` (tile extent in metres), `{width}`,
 *   `{height}`. Build a ready-made template with {@link wmsSource}.
 *
 * The default source ({@link DEFAULT_XYZ_SOURCE}) is OSM-style and is meant to
 * be overridden by the user in Settings (T3.7) — it is documented, not hard-wired.
 */
import { TILE_SIZE, tileExtent3857, wrapTileX } from './mercator';
import type { BasemapSource } from '../../contracts';
import type { TileCoord } from './types';

/** Default subdomains substituted for `{s}` when a template omits its own list. */
export const DEFAULT_SUBDOMAINS: readonly string[] = ['a', 'b', 'c'];

/**
 * A sensible default raster basemap (OSM-style XYZ). User-configurable: the app
 * Settings (T3.7) can replace this with any XYZ/WMS template + API key. Shipped
 * as the fallback so the map renders something out of the box when online.
 */
export const DEFAULT_XYZ_SOURCE: BasemapSource = {
  id: 'osm',
  kind: 'xyz',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
};

/** Options for {@link tileUrl}. */
export interface TileUrlOptions {
  /** Tile edge length substituted for WMS `{width}`/`{height}` (default 256). */
  tileSize?: number;
  /** Subdomain list for `{s}` rotation (default {@link DEFAULT_SUBDOMAINS}). */
  subdomains?: readonly string[];
}

/**
 * Resolve the fetch URL for `tile` from `source`, substituting every supported
 * placeholder. The tile column is wrapped into `[0, 2^z)` first.
 */
export function tileUrl(
  source: BasemapSource,
  tile: TileCoord,
  options: TileUrlOptions = {},
): string {
  const n = 2 ** tile.z;
  const x = wrapTileX(tile.x, n);
  const y = tile.y;
  let url = source.url;

  if (url.includes('{s}')) {
    const subs = options.subdomains ?? DEFAULT_SUBDOMAINS;
    const sub = subs.length > 0 ? (subs[(x + y) % subs.length] ?? '') : '';
    url = url.replaceAll('{s}', sub);
  }

  url = url
    .replaceAll('{z}', String(tile.z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y));

  if (url.includes('{-y}')) {
    url = url.replaceAll('{-y}', String(n - 1 - y));
  }

  if (url.includes('{apiKey}') || url.includes('{key}')) {
    const k = source.apiKey ?? '';
    url = url.replaceAll('{apiKey}', k).replaceAll('{key}', k);
  }

  if (
    url.includes('{bbox-epsg-3857}') ||
    url.includes('{bbox}') ||
    url.includes('{width}') ||
    url.includes('{height}')
  ) {
    const size = options.tileSize ?? TILE_SIZE;
    const [minX, minY, maxX, maxY] = tileExtent3857({ z: tile.z, x, y });
    const bbox = `${minX},${minY},${maxX},${maxY}`;
    url = url
      .replaceAll('{bbox-epsg-3857}', bbox)
      .replaceAll('{bbox}', bbox)
      .replaceAll('{width}', String(size))
      .replaceAll('{height}', String(size));
  }

  return url;
}

/** Options for {@link wmsSource}. */
export interface WmsSourceOptions {
  /** Stable source id. */
  id: string;
  /** WMS endpoint base URL (with or without an existing query string). */
  baseUrl: string;
  /** Comma-separated `LAYERS` value. */
  layers: string;
  /** WMS version (default `1.3.0`; `1.1.x` uses `SRS` instead of `CRS`). */
  version?: string;
  /** Image format (default `image/png`). */
  format?: string;
  /** Coordinate reference system (default `EPSG:3857`). */
  crs?: string;
  /** Transparent background (default `true`). */
  transparent?: boolean;
  /** Optional API key (kept on the source, not embedded in the template). */
  apiKey?: string;
}

/**
 * Build a {@link BasemapSource} of kind `wms` whose URL template carries the
 * `{bbox-epsg-3857}`/`{width}`/`{height}` placeholders {@link tileUrl} fills in.
 * Query values are encoded but the placeholders are left literal.
 */
export function wmsSource(options: WmsSourceOptions): BasemapSource {
  const version = options.version ?? '1.3.0';
  const crsParam = version.startsWith('1.1') ? 'SRS' : 'CRS';
  const crs = options.crs ?? 'EPSG:3857';
  const format = options.format ?? 'image/png';
  const transparent = options.transparent ?? true;
  const sep = options.baseUrl.includes('?') ? '&' : '?';
  const query =
    `SERVICE=WMS&REQUEST=GetMap&VERSION=${version}` +
    `&LAYERS=${encodeURIComponent(options.layers)}&STYLES=` +
    `&${crsParam}=${encodeURIComponent(crs)}&FORMAT=${encodeURIComponent(format)}` +
    `&TRANSPARENT=${transparent ? 'TRUE' : 'FALSE'}` +
    `&WIDTH={width}&HEIGHT={height}&BBOX={bbox-epsg-3857}`;
  const url = `${options.baseUrl}${sep}${query}`;
  return options.apiKey !== undefined
    ? { id: options.id, kind: 'wms', url, apiKey: options.apiKey }
    : { id: options.id, kind: 'wms', url };
}
