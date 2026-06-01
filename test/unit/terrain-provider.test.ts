/**
 * Elevation provider unit tests (task T4.8; spec plan/04 §4.3 terrain following,
 * plan/07 §7.8 offline). Drives the provider with a mock tile source + an
 * injected decoder so bilinear sampling and `pathProfile` run without IndexedDB,
 * a browser image decoder, or the network. Also asserts graceful offline misses.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createElevationProvider,
  type TerrainTileSource,
  type TilePixels,
} from '../../src/geo/terrain';
import { lonLatToWorld } from '../../src/geo/tiles';
import type { BasemapSource } from '../../src/contracts';

/**
 * A 256×256 tile whose decoded elevation equals the pixel **x** index (via the
 * G channel: `R=128, G=x` ⇒ `(128·256 + x) − 32768 = x`). With a field linear in
 * x, exact bilinear interpolation at world coordinate `wx` is `wx − 0.5` (the
 * pixel-centre convention the provider uses).
 */
function rampTile(): TilePixels {
  const w = 256;
  const h = 256;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 128;
      data[i + 1] = x;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** A tile source that always yields a sentinel blob (decoder ignores its bytes). */
function presentSource(spy?: () => void): TerrainTileSource {
  return {
    get: vi.fn(async () => {
      spy?.();
      return new Blob([new Uint8Array([1])]);
    }),
  };
}

const SENTINEL: BasemapSource = { id: 'terrarium', kind: 'xyz', url: 'http://x/{z}/{x}/{y}.png' };

describe('createElevationProvider — bilinear sampling', () => {
  it('interpolates a ramp field to wx − 0.5 at the sample point', async () => {
    const tiles = presentSource();
    const provider = createElevationProvider({
      tiles,
      decode: async () => rampTile(),
      source: SENTINEL,
    });
    // zoom 0: the whole world is one 256² tile; lon/lat 0 → world pixel (128,128).
    const [wx] = lonLatToWorld(0, 0, 0);
    const e = await provider.sampleElevation(0, 0, 0);
    expect(e).toBeCloseTo(wx - 0.5, 6);
    expect(e).toBeCloseTo(127.5, 6);
  });

  it('memoises decoded tiles (decode once across nearby samples)', async () => {
    const decode = vi.fn(async () => rampTile());
    const provider = createElevationProvider({ tiles: presentSource(), decode, source: SENTINEL });
    await provider.sampleElevation(0, 0, 0);
    await provider.sampleElevation(0.5, 0.5, 0);
    // All four bilinear corners fall in the single zoom-0 tile → decoded once.
    expect(decode).toHaveBeenCalledTimes(1);
  });
});

describe('createElevationProvider — offline / unavailable', () => {
  it('resolves undefined (never throws) when no tile is available', async () => {
    const tiles: TerrainTileSource = { get: async () => undefined };
    const provider = createElevationProvider({
      tiles,
      decode: async () => rampTile(),
      source: SENTINEL,
      online: false,
    });
    expect(await provider.sampleElevation(10, 20, 0)).toBeUndefined();
  });

  it('resolves undefined when the decoder throws', async () => {
    const provider = createElevationProvider({
      tiles: presentSource(),
      decode: async () => {
        throw new Error('bad png');
      },
      source: SENTINEL,
    });
    expect(await provider.sampleElevation(0, 0, 0)).toBeUndefined();
  });
});

describe('createElevationProvider — pathProfile', () => {
  it('returns one sample per densified point with chainage + elevation', async () => {
    const provider = createElevationProvider({
      tiles: presentSource(),
      decode: async () => rampTile(),
      source: SENTINEL,
      zoom: 0,
    });
    const profile = await provider.pathProfile(
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 0.02 },
      ],
      500,
    );
    expect(profile.length).toBeGreaterThan(1);
    expect(profile[0]?.distanceM).toBe(0);
    expect(profile.every((p) => typeof p.elevationM === 'number')).toBe(true);
    // Chainage is monotonic non-decreasing.
    for (let i = 1; i < profile.length; i++) {
      expect(profile[i]!.distanceM).toBeGreaterThanOrEqual(profile[i - 1]!.distanceM);
    }
  });
});
