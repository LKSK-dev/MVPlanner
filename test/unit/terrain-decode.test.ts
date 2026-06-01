/**
 * Terrarium RGB decode + pixel read unit tests (task T4.8; spec plan/04 §4.3
 * terrain following). Verifies the documented `(R·256 + G + B/256) − 32768`
 * formula on known triples and the bounded pixel reader.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeTerrarium,
  elevationAtPixel,
  TERRARIUM_OFFSET_M,
  type TilePixels,
} from '../../src/geo/terrain';

describe('decodeTerrarium', () => {
  it('decodes sea level (R=128) to 0 m', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
  });

  it('adds 256 m per R step and 1 m per G step', () => {
    expect(decodeTerrarium(129, 0, 0)).toBe(256);
    expect(decodeTerrarium(128, 10, 0)).toBe(10);
  });

  it('uses B as the sub-metre fractional channel', () => {
    expect(decodeTerrarium(128, 10, 128)).toBeCloseTo(10.5, 6);
    expect(decodeTerrarium(128, 0, 64)).toBeCloseTo(0.25, 6);
  });

  it('represents bathymetry via the -32768 offset', () => {
    expect(decodeTerrarium(0, 0, 0)).toBe(-TERRARIUM_OFFSET_M);
  });

  it('clamps out-of-range channels into the byte range', () => {
    expect(decodeTerrarium(-5, 300, 0)).toBe(decodeTerrarium(0, 255, 0));
  });
});

/** Build a `w×h` RGBA image from a per-pixel elevation-encoder. */
function image(
  w: number,
  h: number,
  enc: (x: number, y: number) => [number, number, number],
): TilePixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = enc(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

describe('elevationAtPixel', () => {
  const px = image(2, 2, (x, y) => [128 + x, y * 2, 0]);

  it('reads the decoded elevation at integer pixels', () => {
    expect(elevationAtPixel(px, 0, 0)).toBe(0);
    expect(elevationAtPixel(px, 1, 0)).toBe(256);
    expect(elevationAtPixel(px, 0, 1)).toBe(2);
    expect(elevationAtPixel(px, 1, 1)).toBe(258);
  });

  it('clamps out-of-bounds reads to the edge pixel', () => {
    expect(elevationAtPixel(px, -5, 0)).toBe(0);
    expect(elevationAtPixel(px, 99, 99)).toBe(258);
  });
});
