/**
 * Terrarium (Mapzen / AWS "Terrain Tiles") RGB elevation decoding (task T4.8;
 * spec plan/04 §4.3 terrain following, plan/03 §3.4 Terrain, plan/07 §7.8
 * offline terrain). Pure + dependency-free decode plus an injectable PNG
 * decoder seam so the provider runs in the browser (via `createImageBitmap` /
 * `OffscreenCanvas`) and unit-tests with a mock decoder (no DOM).
 *
 * The Terrarium encoding packs metre elevation into 8-bit RGB:
 *   `elevation_m = (R · 256 + G + B / 256) − 32768`.
 * The −32768 offset lets it carry bathymetry (negative) and high mountains in a
 * single byte triple; B is the fractional (sub-metre) channel.
 */

/** Terrarium decode offset (metres) — values are stored biased by +32768. */
export const TERRARIUM_OFFSET_M = 32768;

/**
 * Decode one Terrarium RGB triple to metres above sea level.
 * `elevation_m = (R·256 + G + B/256) − 32768`. Channels are clamped to `[0,255]`.
 */
export function decodeTerrarium(r: number, g: number, b: number): number {
  const rc = clampByte(r);
  const gc = clampByte(g);
  const bc = clampByte(b);
  return rc * 256 + gc + bc / 256 - TERRARIUM_OFFSET_M;
}

/** Clamp + round a value into the `[0, 255]` byte range. */
function clampByte(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Decoded RGBA pixel data for one tile (origin top-left, row-major). */
export interface TilePixels {
  /** Image width in pixels. */
  readonly width: number;
  /** Image height in pixels. */
  readonly height: number;
  /** Tightly-packed RGBA bytes, length `width · height · 4`. */
  readonly data: Uint8ClampedArray;
}

/** Decode an encoded tile image {@link Blob} into raw {@link TilePixels}. */
export type TileDecoder = (blob: Blob) => Promise<TilePixels>;

/**
 * Read the Terrarium elevation (metres) at integer pixel `(px, py)` of a decoded
 * tile. Coordinates are clamped into range; out-of-bounds reads return the edge
 * pixel (so a sample at a tile border degrades gracefully rather than throwing).
 */
export function elevationAtPixel(pixels: TilePixels, px: number, py: number): number {
  const x = Math.max(0, Math.min(pixels.width - 1, Math.trunc(px)));
  const y = Math.max(0, Math.min(pixels.height - 1, Math.trunc(py)));
  const idx = (y * pixels.width + x) * 4;
  const data = pixels.data;
  const r = data[idx] ?? 0;
  const g = data[idx + 1] ?? 0;
  const b = data[idx + 2] ?? 0;
  return decodeTerrarium(r, g, b);
}

/**
 * The subset of the browser's offscreen-raster surface the default decoder
 * needs. Declared structurally so the runtime feature-detect ({@link
 * isImageDecoderAvailable}) stays type-safe without DOM lib assumptions.
 */
interface OffscreenLike {
  getContext(id: '2d'): {
    drawImage(image: ImageBitmap, dx: number, dy: number): void;
    getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
  } | null;
}

type CreateImageBitmapFn = (blob: Blob) => Promise<ImageBitmap>;
type OffscreenCanvasCtor = new (width: number, height: number) => OffscreenLike;

interface DecoderGlobals {
  createImageBitmap?: CreateImageBitmapFn;
  OffscreenCanvas?: OffscreenCanvasCtor;
}

/** Whether the running environment can decode tiles without an injected decoder. */
export function isImageDecoderAvailable(): boolean {
  const g = globalThis as unknown as DecoderGlobals;
  return typeof g.createImageBitmap === 'function' && typeof g.OffscreenCanvas === 'function';
}

/**
 * The browser {@link TileDecoder}: decodes via `createImageBitmap` and rasterises
 * into an `OffscreenCanvas` to read back RGBA. Throws if neither global is
 * present — callers in non-browser contexts (tests, workers without the API)
 * must inject their own decoder. Use {@link isImageDecoderAvailable} to pick.
 */
export function createImageDecoder(): TileDecoder {
  const g = globalThis as unknown as DecoderGlobals;
  const create = g.createImageBitmap;
  const Offscreen = g.OffscreenCanvas;
  if (typeof create !== 'function' || typeof Offscreen !== 'function') {
    throw new Error('createImageDecoder: createImageBitmap/OffscreenCanvas unavailable');
  }
  return async (blob: Blob): Promise<TilePixels> => {
    const bitmap = await create(blob);
    const canvas = new Offscreen(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('createImageDecoder: 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, data: img.data };
  };
}
