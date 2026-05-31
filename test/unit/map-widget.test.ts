/**
 * Map widget tests (task T2.3; spec plan/05 §5.8). Mounts {@link MapWidget} over
 * a real engine + fake cache and asserts the accessible scaffolding (focusable
 * application region, aria-label, zoom buttons, live readout) renders and reacts
 * to engine camera changes. Canvas pixels are not asserted (happy-dom's 2d
 * context is `null`); that is the canvas-deferred path.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { MapWidget, createRasterMapEngine, type RasterMapEngine } from '../../src/ui/widgets/map';
import type { TileCache } from '../../src/geo/tiles';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function fakeCache(): TileCache {
  return {
    get: async () => undefined,
    getCached: async () => undefined,
    put: async () => undefined,
    has: async () => false,
    prefetch: async (_s, tiles) => ({
      requested: tiles.length,
      fetched: 0,
      cached: 0,
      failed: 0,
    }),
    evict: async () => 0,
    clear: async () => undefined,
  };
}

function newEngine(): RasterMapEngine {
  return createRasterMapEngine({
    cache: fakeCache(),
    view: { lat: 10, lon: 20, zoom: 5 },
    requestFrame: (cb) => {
      cb();
      return 0;
    },
    cancelFrame: () => undefined,
    isOnline: () => false,
  });
}

afterEach(() => cleanup());

describe('MapWidget', () => {
  it('renders an accessible application region with an aria-label', async () => {
    const { container } = render(() => createComponent(MapWidget, { engine: newEngine() }));
    await settle();
    const root = container.querySelector('.mvp-map');
    expect(root?.getAttribute('role')).toBe('application');
    expect(root?.getAttribute('tabindex')).toBe('0');
    expect(root?.getAttribute('aria-label')).toContain('arrow keys');
  });

  it('shows the center/zoom readout in a live region', async () => {
    const { container } = render(() => createComponent(MapWidget, { engine: newEngine() }));
    await settle();
    const readout = container.querySelector('.mvp-map__readout');
    expect(readout?.getAttribute('aria-live')).toBe('polite');
    expect(readout?.textContent).toContain('10.00000');
    expect(readout?.textContent).toContain('20.00000');
    expect(readout?.textContent).toContain('zoom 5.0');
  });

  it('zoom buttons drive the engine and update the readout', async () => {
    const engine = newEngine();
    const { container, getByLabelText } = render(() => createComponent(MapWidget, { engine }));
    await settle();
    fireEvent.click(getByLabelText('Zoom in'));
    await settle();
    expect(engine.getView().zoom).toBeGreaterThan(5);
    expect(container.querySelector('.mvp-map__readout')?.textContent).toContain('zoom 5.5');
  });

  it('keyboard arrows pan the map via the engine', async () => {
    const engine = newEngine();
    const { container } = render(() => createComponent(MapWidget, { engine }));
    await settle();
    const root = container.querySelector('.mvp-map') as HTMLElement;
    const before = engine.getView().lon;
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    await settle();
    expect(engine.getView().lon).toBeGreaterThan(before);
  });

  it('exposes labelled zoom controls', async () => {
    const { getByLabelText } = render(() => createComponent(MapWidget, { engine: newEngine() }));
    await settle();
    expect(getByLabelText('Zoom in')).toBeTruthy();
    expect(getByLabelText('Zoom out')).toBeTruthy();
  });
});
