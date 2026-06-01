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
import type { TerrainProfilePoint } from '../../src/geo/terrain';

afterEach(() => cleanup());

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
