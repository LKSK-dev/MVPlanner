/**
 * Pure Web-Mercator + viewport + source tests (task T2.3). No DOM, no network:
 * projection round-trips, tile coverage for a viewport, screen projection and
 * URL templating. Cache tests live in `tiles-cache.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_XYZ_SOURCE,
  MERCATOR_EXTENT,
  TILE_SIZE,
  lonLatToTile,
  lonLatToWorld,
  projectToScreen,
  tileExtent3857,
  tileScreenRect,
  tileUrl,
  tileZoomFor,
  tilesInBbox,
  unprojectScreen,
  visibleTiles,
  wmsSource,
  worldToLonLat,
  type Viewport,
} from '../../src/geo/tiles';
import type { BasemapSource } from '../../src/contracts';

const SAMPLES: [number, number][] = [
  [0, 0],
  [-122.4194, 37.7749], // San Francisco
  [151.2093, -33.8688], // Sydney
  [13.405, 52.52], // Berlin
  [179.9, 85], // near the antimeridian / pole limit
  [-180, -85],
];

describe('mercator projection', () => {
  it('places lon/lat 0,0 at the world centre', () => {
    expect(lonLatToWorld(0, 0, 0)).toEqual([TILE_SIZE / 2, TILE_SIZE / 2]);
  });

  it('round-trips lon/lat → world → lon/lat across zooms', () => {
    for (const z of [0, 5, 12, 18]) {
      for (const [lon, lat] of SAMPLES) {
        const [x, y] = lonLatToWorld(lon, lat, z);
        const [lon2, lat2] = worldToLonLat(x, y, z);
        expect(lon2).toBeCloseTo(lon, 6);
        // latitudes are clamped to the Mercator limit before projection
        expect(lat2).toBeCloseTo(Math.max(-85.05112877980659, Math.min(85.05112877980659, lat)), 6);
      }
    }
  });

  it('computes the containing tile (wrapped + clamped)', () => {
    expect(lonLatToTile(0, 0, 1)).toEqual({ z: 1, x: 1, y: 1 });
    expect(lonLatToTile(-180, 85.05112877980659, 0)).toEqual({ z: 0, x: 0, y: 0 });
    const t = lonLatToTile(0, 0, 4);
    expect(t.x).toBe(8);
    expect(t.y).toBe(8);
  });

  it('reports the EPSG:3857 extent of a tile', () => {
    expect(tileExtent3857({ z: 0, x: 0, y: 0 })).toEqual([
      -MERCATOR_EXTENT,
      -MERCATOR_EXTENT,
      MERCATOR_EXTENT,
      MERCATOR_EXTENT,
    ]);
    const [minX, minY, maxX, maxY] = tileExtent3857({ z: 1, x: 1, y: 0 });
    expect(minX).toBeCloseTo(0, 3);
    expect(maxX).toBeCloseTo(MERCATOR_EXTENT, 3);
    expect(maxY).toBeCloseTo(MERCATOR_EXTENT, 3);
    expect(minY).toBeCloseTo(0, 3);
  });
});

describe('viewport math', () => {
  const vp: Viewport = { lat: 0, lon: 0, zoom: 4, width: 512, height: 512 };

  it('projects the centre to the canvas centre and inverts', () => {
    expect(projectToScreen(vp.lat, vp.lon, vp)).toEqual([256, 256]);
    const back = unprojectScreen(256, 256, vp);
    expect(back.lat).toBeCloseTo(0, 9);
    expect(back.lon).toBeCloseTo(0, 9);
  });

  it('screen project ↔ unproject round-trips an off-centre point', () => {
    const [sx, sy] = projectToScreen(37.7749, -122.4194, vp);
    const ll = unprojectScreen(sx, sy, vp);
    expect(ll.lat).toBeCloseTo(37.7749, 6);
    expect(ll.lon).toBeCloseTo(-122.4194, 6);
  });

  it('picks a clamped integer tile zoom', () => {
    expect(tileZoomFor(4.2, 0, 19)).toBe(4);
    expect(tileZoomFor(4.6, 0, 19)).toBe(5);
    expect(tileZoomFor(25, 0, 19)).toBe(19);
    expect(tileZoomFor(-3, 0, 19)).toBe(0);
  });

  it('covers the viewport with the expected tile block', () => {
    // 512×512 view at z4 centred on 0,0 ⇒ a 3×3 block straddling tile (8,8).
    const tiles = visibleTiles(vp, 4);
    const xs = [...new Set(tiles.map((t) => t.x))].sort((a, b) => a - b);
    const ys = [...new Set(tiles.map((t) => t.y))].sort((a, b) => a - b);
    expect(xs).toContain(8);
    expect(ys).toContain(8);
    expect(tiles.every((t) => t.z === 4)).toBe(true);
    // every tile is unique
    const keys = new Set(tiles.map((t) => `${t.x}/${t.y}`));
    expect(keys.size).toBe(tiles.length);
  });

  it('does not emit rows outside the valid range', () => {
    const polar: Viewport = { lat: 85, lon: 0, zoom: 1, width: 1024, height: 1024 };
    const tiles = visibleTiles(polar, 1);
    expect(tiles.every((t) => t.y >= 0 && t.y < 2)).toBe(true);
  });

  it('places a tile rectangle at the canvas centre when it is the centre tile', () => {
    const rect = tileScreenRect(
      { z: 0, x: 0, y: 0 },
      { lat: 0, lon: 0, zoom: 0, width: 256, height: 256 },
      0,
    );
    expect(rect.size).toBe(256);
    expect(rect.x).toBeCloseTo(0, 6);
    expect(rect.y).toBeCloseTo(0, 6);
  });

  it('lists tiles intersecting a bbox', () => {
    const tiles = tilesInBbox([-1, -1, 1, 1], 4);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.z === 4)).toBe(true);
  });
});

describe('basemap source URLs', () => {
  it('substitutes XYZ placeholders and wraps the column', () => {
    expect(tileUrl(DEFAULT_XYZ_SOURCE, { z: 3, x: 2, y: 5 })).toBe(
      'https://tile.openstreetmap.org/3/2/5.png',
    );
    // x = -1 at z3 wraps to 7
    expect(tileUrl(DEFAULT_XYZ_SOURCE, { z: 3, x: -1, y: 5 })).toBe(
      'https://tile.openstreetmap.org/3/7/5.png',
    );
  });

  it('rotates {s} subdomains and substitutes {-y} (TMS) and api keys', () => {
    const src: BasemapSource = {
      id: 'k',
      kind: 'xyz',
      url: 'https://{s}.tiles.example/{z}/{x}/{-y}.png?key={apiKey}',
      apiKey: 'SECRET',
    };
    const url = tileUrl(src, { z: 2, x: 1, y: 0 }, { subdomains: ['a', 'b'] });
    expect(url).toBe('https://b.tiles.example/2/1/3.png?key=SECRET');
  });

  it('builds a WMS request with the tile bbox in EPSG:3857', () => {
    const src = wmsSource({ id: 'w', baseUrl: 'https://wms.example/service', layers: 'topo' });
    const url = tileUrl(src, { z: 0, x: 0, y: 0 });
    expect(url).toContain('SERVICE=WMS');
    expect(url).toContain('CRS=EPSG%3A3857');
    expect(url).toContain('WIDTH=256&HEIGHT=256');
    expect(url).toContain(
      `BBOX=${-MERCATOR_EXTENT},${-MERCATOR_EXTENT},${MERCATOR_EXTENT},${MERCATOR_EXTENT}`,
    );
  });

  it('uses SRS for WMS 1.1.x and keeps an api key on the source', () => {
    const src = wmsSource({
      id: 'w11',
      baseUrl: 'https://wms.example/service?token=1',
      layers: 'a,b',
      version: '1.1.1',
      apiKey: 'XYZ',
    });
    expect(src.apiKey).toBe('XYZ');
    const url = tileUrl(src, { z: 1, x: 0, y: 1 });
    expect(url).toContain('&SRS=EPSG%3A3857');
    expect(url.startsWith('https://wms.example/service?token=1&')).toBe(true);
  });
});
