/**
 * Terrain profile chart component tests (task T4.8; spec plan/04 §4.3 terrain
 * following, plan/05 §5.3 Plan). Mounts {@link TerrainProfile} with injected
 * profile points, asserting the empty state, the rendered ground + planned
 * paths, and that collision points produce markers + a warning status.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { TerrainProfile } from '../../src/ui/screens/plan/terrain';
import { PAD } from '../../src/ui/screens/plan/terrain/terrain-profile';
import type { TerrainProfilePoint } from '../../src/geo/terrain';

afterEach(() => cleanup());

/** Extract every `x,y` coordinate pair from an SVG path `d` string. */
function coordsOf(d: string): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const re = /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
  for (let m = re.exec(d); m !== null; m = re.exec(d)) {
    out.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  return out;
}

// Planned altitude well below the terrain (and below ~50 m), the case the bug
// report calls out: the chart must stay fully within its plot box.
const LOW_PLANNED: TerrainProfilePoint[] = [
  { distanceM: 0, terrainM: 40, plannedAmslM: 5 },
  { distanceM: 100, terrainM: 45, plannedAmslM: 5 },
  { distanceM: 200, terrainM: 30, plannedAmslM: 5 },
];

const SAFE: TerrainProfilePoint[] = [
  { distanceM: 0, terrainM: 100, plannedAmslM: 200 },
  { distanceM: 100, terrainM: 120, plannedAmslM: 200 },
  { distanceM: 200, terrainM: 110, plannedAmslM: 200 },
];

const COLLIDING: TerrainProfilePoint[] = [
  { distanceM: 0, terrainM: 100, plannedAmslM: 150 },
  { distanceM: 100, terrainM: 160, plannedAmslM: 150 }, // below ground → collision
  { distanceM: 200, terrainM: 100, plannedAmslM: 150 },
];

describe('TerrainProfile', () => {
  it('shows an empty hint with no points', () => {
    const { getByTestId, queryByTestId } = render(() =>
      createComponent(TerrainProfile, { points: [] }),
    );
    expect(getByTestId('terrain-empty')).toBeTruthy();
    expect(queryByTestId('terrain-chart')).toBeNull();
  });

  it('renders the ground + planned paths and an OK status for safe clearance', () => {
    const { getByTestId } = render(() => createComponent(TerrainProfile, { points: SAFE }));
    expect(getByTestId('terrain-chart')).toBeTruthy();
    expect(getByTestId('terrain-ground').getAttribute('d')).not.toBe('');
    expect(getByTestId('terrain-planned').getAttribute('d')).not.toBe('');
    expect(getByTestId('terrain-status').getAttribute('role')).toBeNull(); // OK span, not alert
  });

  it('keeps all plotted geometry inside the plot box for a low planned altitude', () => {
    const width = 600;
    const height = 200;
    const { getByTestId, getAllByTestId } = render(() =>
      createComponent(TerrainProfile, {
        points: LOW_PLANNED,
        minClearanceM: 10,
        width,
        height,
      }),
    );
    const xMin = PAD.left;
    const xMax = width - PAD.right;
    const yMin = PAD.top;
    const yMax = height - PAD.bottom;

    const ground = coordsOf(getByTestId('terrain-ground').getAttribute('d') ?? '');
    const planned = coordsOf(getByTestId('terrain-planned').getAttribute('d') ?? '');
    expect(ground.length).toBeGreaterThan(0);
    expect(planned.length).toBeGreaterThan(0);
    for (const c of [...ground, ...planned]) {
      expect(c.x).toBeGreaterThanOrEqual(xMin);
      expect(c.x).toBeLessThanOrEqual(xMax);
      expect(c.y).toBeGreaterThanOrEqual(yMin);
      expect(c.y).toBeLessThanOrEqual(yMax);
    }

    // Collision markers (planned below terrain) must also stay in the box.
    for (const marker of getAllByTestId('terrain-marker')) {
      const cx = Number(marker.getAttribute('cx'));
      const cy = Number(marker.getAttribute('cy'));
      expect(cx).toBeGreaterThanOrEqual(xMin);
      expect(cx).toBeLessThanOrEqual(xMax);
      expect(cy).toBeGreaterThanOrEqual(yMin);
      expect(cy).toBeLessThanOrEqual(yMax);
    }
  });

  it('marks collisions and shows a warning status', () => {
    const { getAllByTestId, getByTestId } = render(() =>
      createComponent(TerrainProfile, { points: COLLIDING, minClearanceM: 10 }),
    );
    expect(getAllByTestId('terrain-marker').length).toBe(1);
    const status = getByTestId('terrain-status');
    expect(status.getAttribute('role')).toBe('alert');
    expect(status.textContent).toContain('1');
  });
});
