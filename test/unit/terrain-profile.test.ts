/**
 * Pure terrain-profile geometry unit tests (task T4.8; spec plan/04 §4.3 terrain
 * following). Covers path densification, the collision / low-clearance check,
 * terrain-frame (AGL↔AMSL) conversion and the metre offset helper.
 */
import { describe, expect, it } from 'vitest';
import {
  aglToAmsl,
  amslToAgl,
  collisionCheck,
  haversineMeters,
  M_PER_DEG_LAT,
  offsetLatLon,
  samplePath,
  type TerrainProfilePoint,
} from '../../src/geo/terrain';
import type { LatLon } from '../../src/geo/format';

describe('samplePath', () => {
  it('returns nothing for an empty path and the vertex for a single point', () => {
    expect(samplePath([], 10)).toEqual([]);
    expect(samplePath([{ lat: 1, lon: 2 }], 10)).toEqual([
      { at: { lat: 1, lon: 2 }, distanceM: 0 },
    ]);
  });

  it('densifies a segment at ~spacing and always includes both endpoints', () => {
    const a: LatLon = { lat: 0, lon: 0 };
    const b: LatLon = { lat: 0, lon: 0.01 }; // ~1113 m east
    const total = haversineMeters(a, b);
    const out = samplePath([a, b], 250);
    expect(out[0]?.distanceM).toBe(0);
    expect(out[out.length - 1]?.distanceM).toBeCloseTo(total, 3);
    // Monotonic non-decreasing chainage.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.distanceM).toBeGreaterThanOrEqual(out[i - 1]!.distanceM);
    }
    // Roughly total/spacing interior samples + the final endpoint.
    expect(out.length).toBeGreaterThanOrEqual(Math.floor(total / 250));
  });

  it('collapses a zero-length path to its first vertex', () => {
    const p: LatLon = { lat: 5, lon: 5 };
    expect(samplePath([p, p, p], 10)).toEqual([{ at: p, distanceM: 0 }]);
  });
});

describe('offsetLatLon', () => {
  it('moves north by metres / metres-per-degree', () => {
    const out = offsetLatLon({ lat: 0, lon: 0 }, M_PER_DEG_LAT, 0);
    expect(out.lat).toBeCloseTo(1, 9);
    expect(out.lon).toBeCloseTo(0, 9);
  });

  it('scales the east offset by cos(latitude)', () => {
    const out = offsetLatLon({ lat: 60, lon: 0 }, 0, M_PER_DEG_LAT);
    // cos(60°) = 0.5 → one metre-per-degree east is ~2° of longitude.
    expect(out.lon).toBeCloseTo(2, 6);
  });
});

describe('aglToAmsl / amslToAgl', () => {
  it('round-trips terrain-frame altitude through the ground elevation', () => {
    expect(aglToAmsl(50, 1200)).toBe(1250);
    expect(amslToAgl(1250, 1200)).toBe(50);
  });
});

describe('collisionCheck', () => {
  const points: TerrainProfilePoint[] = [
    { distanceM: 0, terrainM: 100, plannedAmslM: 150 }, // clearance 50
    { distanceM: 100, terrainM: 145, plannedAmslM: 150 }, // clearance 5 (warn)
    { distanceM: 200, terrainM: 200, plannedAmslM: 150 }, // clearance -50 (collision)
    { distanceM: 300, terrainM: 100 }, // no planned altitude → skipped
  ];

  it('flags points within the clearance threshold and below ground', () => {
    const markers = collisionCheck(points, 10);
    expect(markers.map((m) => m.distanceM)).toEqual([100, 200]);
    expect(markers[0]?.clearanceM).toBe(5);
    expect(markers[1]?.clearanceM).toBe(-50);
  });

  it('returns no markers when every point clears the threshold', () => {
    expect(collisionCheck(points, 0)).toHaveLength(1); // only the -50 collision
    expect(collisionCheck([{ distanceM: 0, terrainM: 0, plannedAmslM: 100 }], 10)).toEqual([]);
  });
});
