/**
 * Elevation provider (task T4.8; spec plan/04 §4.3 terrain following, plan/03
 * §3.4 Terrain, plan/07 §7.8 offline terrain). Samples ground elevation (AMSL)
 * from Terrarium RGB terrain tiles, reusing the `geo/tiles` cache (cache-first,
 * online fetch on miss, never hard-fails offline) and an injected {@link
 * TileDecoder}. Bilinear interpolation between tile pixels smooths the sampled
 * surface; decoded tiles are memoised in a small bounded LRU.
 *
 * The terrain source URL template is configurable; the default is a documented
 * public Terrarium tileset (AWS "Terrain Tiles" open dataset). Per the offline
 * principle the provider only reaches the network when `online` (default `true`)
 * and a tile is not already cached.
 */
import { elevationAtPixel, type TileDecoder, type TilePixels } from './decode';
import { type ElevationSample, type PathSample, samplePath } from './profile';
import { TILE_SIZE, lonLatToWorld, wrapTileX } from '../tiles';
import type { LatLon } from '../format';
import type { BasemapSource } from '../../contracts';
import type { TileCoord } from '../tiles';

/**
 * The default public Terrarium terrain tileset (AWS Open Data "Terrain Tiles").
 * Documented, user-overridable (Settings, T3.7) — not hard-wired. `{z}/{x}/{y}`
 * XYZ addressing, PNG-encoded Terrarium RGB.
 */
export const DEFAULT_TERRAIN_SOURCE: BasemapSource = {
  id: 'terrarium',
  kind: 'xyz',
  url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
};

/** Default sampling zoom (≈ 30 m posts at the equator) when none is supplied. */
export const DEFAULT_TERRAIN_ZOOM = 12;

/** Default cap on memoised decoded tiles before LRU eviction. */
export const DEFAULT_MAX_DECODED_TILES = 32;

/**
 * The minimal tile-byte surface the provider needs: the `geo/tiles` {@link
 * TileCache} satisfies it structurally, and tests pass a mock that returns
 * encoded tile {@link Blob}s. Keeps the provider testable without IndexedDB.
 */
export interface TerrainTileSource {
  get(
    source: BasemapSource,
    tile: TileCoord,
    options?: { online?: boolean; signal?: AbortSignal },
  ): Promise<Blob | undefined>;
}

/** Construction dependencies for {@link createElevationProvider}. */
export interface ElevationProviderDeps {
  /** Tile-byte source (the `geo/tiles` cache, or a mock in tests). */
  readonly tiles: TerrainTileSource;
  /** Decode an encoded tile {@link Blob} to RGBA pixels (browser or injected). */
  readonly decode: TileDecoder;
  /** Terrain tileset (default {@link DEFAULT_TERRAIN_SOURCE}). */
  readonly source?: BasemapSource;
  /** Default sampling zoom (default {@link DEFAULT_TERRAIN_ZOOM}). */
  readonly zoom?: number;
  /** Whether network fetches are permitted (default `true`; `false` = offline). */
  readonly online?: boolean;
  /** Max memoised decoded tiles (default {@link DEFAULT_MAX_DECODED_TILES}). */
  readonly maxDecodedTiles?: number;
}

/** The elevation provider surface. */
export interface ElevationProvider {
  /**
   * Sample ground elevation (metres AMSL) at `lat`/`lon`, bilinearly
   * interpolated from the Terrarium tile at `zoom` (default the provider's).
   * Resolves `undefined` when the covering tile is unavailable (offline + not
   * cached, fetch failure, or decode error) — never throws.
   */
  sampleElevation(lat: number, lon: number, zoom?: number): Promise<number | undefined>;
  /**
   * Sample a terrain profile along `points` at ≈ `spacingM` spacing. Returns one
   * {@link ElevationSample} per densified point (chainage + elevation, the latter
   * `undefined` where unavailable).
   */
  pathProfile(points: readonly LatLon[], spacingM: number): Promise<ElevationSample[]>;
  /** The configured terrain source. */
  readonly source: BasemapSource;
  /** The default sampling zoom. */
  readonly zoom: number;
}

/** Create an {@link ElevationProvider}. */
export function createElevationProvider(deps: ElevationProviderDeps): ElevationProvider {
  const { tiles, decode } = deps;
  const source = deps.source ?? DEFAULT_TERRAIN_SOURCE;
  const zoom = deps.zoom ?? DEFAULT_TERRAIN_ZOOM;
  const online = deps.online ?? true;
  const maxDecoded = deps.maxDecodedTiles ?? DEFAULT_MAX_DECODED_TILES;

  /** Memoised decoded tiles, keyed by `z/x/y`; bounded LRU (insertion order). */
  const decoded = new Map<string, TilePixels | undefined>();

  async function tilePixels(z: number, tx: number, ty: number): Promise<TilePixels | undefined> {
    const n = 2 ** z;
    const wx = wrapTileX(tx, n);
    const key = `${z}/${wx}/${ty}`;
    const hit = decoded.get(key);
    if (hit !== undefined || decoded.has(key)) {
      // Refresh LRU recency on hit (including a remembered miss).
      decoded.delete(key);
      decoded.set(key, hit);
      return hit;
    }
    let pixels: TilePixels | undefined;
    try {
      const blob = await tiles.get(source, { z, x: wx, y: ty }, { online });
      if (blob !== undefined) pixels = await decode(blob);
    } catch {
      pixels = undefined;
    }
    decoded.set(key, pixels);
    if (decoded.size > maxDecoded) {
      const oldest = decoded.keys().next().value;
      if (oldest !== undefined) decoded.delete(oldest);
    }
    return pixels;
  }

  /** Elevation at an integer world-pixel position, or `undefined` if no tile. */
  async function elevationAtWorld(z: number, wx: number, wy: number): Promise<number | undefined> {
    const size = TILE_SIZE * 2 ** z;
    const cy = Math.max(0, Math.min(size - 1, wy));
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(cy / TILE_SIZE);
    const pixels = await tilePixels(z, tx, ty);
    if (pixels === undefined) return undefined;
    const localX = wx - tx * TILE_SIZE;
    const localY = cy - ty * TILE_SIZE;
    // Scale into the actual decoded image size (tiles need not be 256²).
    const sx = (localX / TILE_SIZE) * pixels.width;
    const sy = (localY / TILE_SIZE) * pixels.height;
    return elevationAtPixel(pixels, sx, sy);
  }

  async function sampleElevation(
    lat: number,
    lon: number,
    sampleZoom?: number,
  ): Promise<number | undefined> {
    const z = sampleZoom ?? zoom;
    const [wxF, wyF] = lonLatToWorld(lon, lat, z);
    // Pixel-centre convention: pixel i covers [i, i+1) with its centre at i+0.5.
    const fx = wxF - 0.5;
    const fy = wyF - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const e00 = await elevationAtWorld(z, x0, y0);
    const e10 = await elevationAtWorld(z, x0 + 1, y0);
    const e01 = await elevationAtWorld(z, x0, y0 + 1);
    const e11 = await elevationAtWorld(z, x0 + 1, y0 + 1);
    if (e00 === undefined || e10 === undefined || e01 === undefined || e11 === undefined) {
      // Fall back to nearest available corner rather than failing outright.
      return e00 ?? e10 ?? e01 ?? e11;
    }
    const top = e00 + (e10 - e00) * tx;
    const bottom = e01 + (e11 - e01) * tx;
    return top + (bottom - top) * ty;
  }

  async function pathProfile(
    points: readonly LatLon[],
    spacingM: number,
  ): Promise<ElevationSample[]> {
    const samples: readonly PathSample[] = samplePath(points, spacingM);
    const out: ElevationSample[] = [];
    for (const s of samples) {
      const elevationM = await sampleElevation(s.at.lat, s.at.lon);
      out.push({ distanceM: s.distanceM, elevationM });
    }
    return out;
  }

  return { sampleElevation, pathProfile, source, zoom };
}
