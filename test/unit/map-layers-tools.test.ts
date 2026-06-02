/**
 * Map tools + click-intent surface (task T2.4). Asserts the pure tool state
 * machine: click routing by mode, measure distance/area accumulation, markers,
 * and the guided click-intent relay. The render layer's draw is canvas-deferred;
 * we only assert it projects without a 2D context.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppSettings, MapLayer, MapRenderCtx } from '../../src/contracts';
import type { LatLon } from '../../src/ui/widgets/map/layers/geometry';
import {
  createMapTools,
  measureFormatters,
  type MapToolHost,
} from '../../src/ui/widgets/map/tools';
import { unitFormatterFor } from '../../src/core/units';

/** A fake engine host capturing the click handler + layer for the tests. */
function fakeHost(): {
  host: MapToolHost;
  click: (e: LatLon) => void;
  layer: () => MapLayer | undefined;
  redraws: () => number;
  layerDisposed: () => boolean;
} {
  let clickCb: ((e: LatLon) => void) | undefined;
  let layer: MapLayer | undefined;
  let disposed = false;
  let redraws = 0;
  const host: MapToolHost = {
    on(_ev, cb) {
      clickCb = cb;
      return () => {
        clickCb = undefined;
      };
    },
    addLayer(l) {
      layer = l;
      return () => {
        disposed = true;
      };
    },
    requestRedraw() {
      redraws++;
    },
  };
  return {
    host,
    click: (e) => clickCb?.(e),
    layer: () => layer,
    redraws: () => redraws,
    layerDisposed: () => disposed,
  };
}

const idGen = (): (() => string) => {
  let n = 0;
  return () => `m${++n}`;
};

describe('tool mode routing', () => {
  it('defaults to none and relays clicks as guided intents', () => {
    const h = fakeHost();
    const tools = createMapTools(h.host, { genId: idGen() });
    const intents: LatLon[] = [];
    tools.onClickIntent((e) => intents.push(e));

    h.click({ lat: 1, lon: 2 });
    expect(tools.mode()).toBe('none');
    expect(intents).toEqual([{ lat: 1, lon: 2 }]);
    expect(tools.latestClick()).toEqual({ lat: 1, lon: 2 });
    expect(tools.measurePoints()).toHaveLength(0);
    expect(tools.markers()).toHaveLength(0);
  });

  it('does not relay intents while a tool is active', () => {
    const h = fakeHost();
    const tools = createMapTools(h.host, { genId: idGen() });
    const intents: LatLon[] = [];
    tools.onClickIntent((e) => intents.push(e));

    tools.setMode('measure-distance');
    h.click({ lat: 0, lon: 0 });
    expect(intents).toHaveLength(0);
    expect(tools.measurePoints()).toHaveLength(1);
    // latestClick still tracks every click regardless of mode
    expect(tools.latestClick()).toEqual({ lat: 0, lon: 0 });
  });
});

describe('measure tools', () => {
  it('accumulates running great-circle distance', () => {
    const h = fakeHost();
    const tools = createMapTools(h.host, { genId: idGen() });
    tools.setMode('measure-distance');
    h.click({ lat: 0, lon: 0 });
    h.click({ lat: 0, lon: 1 });
    h.click({ lat: 0, lon: 2 });
    expect(tools.measurePoints()).toHaveLength(3);
    const d = tools.measureDistanceM();
    expect(d).toBeGreaterThan(222_000);
    expect(d).toBeLessThan(223_000);
    expect(tools.measureSummary()).toContain('km');
  });

  it('renders imperial units in the summary when an imperial formatter is injected', () => {
    const imperial: AppSettings = {
      units: 'imperial',
      coordinateFormat: 'dd',
      theme: 'dark',
      language: 'en',
      audioAlerts: false,
      confirmDestructive: true,
    };
    const fmt = measureFormatters(unitFormatterFor(imperial));
    const h = fakeHost();
    const tools = createMapTools(h.host, {
      genId: idGen(),
      formatLength: fmt.formatLength,
      formatArea: fmt.formatArea,
    });

    // Distance readout: ~222 km reads in miles, never metric km/m.
    tools.setMode('measure-distance');
    h.click({ lat: 0, lon: 0 });
    h.click({ lat: 0, lon: 1 });
    h.click({ lat: 0, lon: 2 });
    const distance = tools.measureSummary();
    expect(distance).toMatch(/mi/);
    expect(distance).not.toMatch(/km/);

    // Area readout: imperial square units (ft² / mi²), never m².
    tools.setMode('measure-area');
    for (const p of [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01 },
      { lat: 0.01, lon: 0.01 },
      { lat: 0.01, lon: 0 },
    ]) {
      h.click(p);
    }
    const area = tools.measureSummary();
    expect(area).toMatch(/ft\u00b2|mi\u00b2/);
    expect(area).not.toMatch(/ m\u00b2/);
  });

  it('computes polygon area in area mode', () => {
    const h = fakeHost();
    const tools = createMapTools(h.host, { genId: idGen() });
    tools.setMode('measure-area');
    for (const p of [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01 },
      { lat: 0.01, lon: 0.01 },
      { lat: 0.01, lon: 0 },
    ]) {
      h.click(p);
    }
    expect(tools.measureAreaM2()).toBeGreaterThan(1_000_000);
    expect(tools.measureSummary()).toMatch(/Area/);
  });

  it('switching to a measure tool starts a fresh session; undo/clear work', () => {
    const h = fakeHost();
    const tools = createMapTools(h.host, { genId: idGen() });
    tools.setMode('measure-distance');
    h.click({ lat: 0, lon: 0 });
    h.click({ lat: 0, lon: 1 });
    expect(tools.measurePoints()).toHaveLength(2);

    tools.undoLastPoint();
    expect(tools.measurePoints()).toHaveLength(1);

    tools.setMode('measure-area'); // fresh session
    expect(tools.measurePoints()).toHaveLength(0);

    h.click({ lat: 0, lon: 0 });
    tools.clearMeasure();
    expect(tools.measurePoints()).toHaveLength(0);
    expect(tools.measureSummary()).toBe('Click the map to measure');
  });
});

describe('drop-marker tool', () => {
  it('places, lists and removes markers; markers persist across modes', () => {
    const h = fakeHost();
    const tools = createMapTools(h.host, { genId: idGen() });
    tools.setMode('drop-marker');
    h.click({ lat: 1, lon: 1 });
    h.click({ lat: 2, lon: 2 });
    const markers = tools.markers();
    expect(markers.map((m) => m.id)).toEqual(['m1', 'm2']);

    // markers survive switching to a measure tool
    tools.setMode('measure-distance');
    expect(tools.markers()).toHaveLength(2);

    tools.removeMarker('m1');
    expect(tools.markers().map((m) => m.id)).toEqual(['m2']);
    tools.clearMarkers();
    expect(tools.markers()).toHaveLength(0);
  });
});

describe('change + redraw + dispose', () => {
  it('notifies onChange and requests redraws on mutation', () => {
    const h = fakeHost();
    const tools = createMapTools(h.host, { genId: idGen() });
    const change = vi.fn();
    tools.onChange(change);
    tools.setMode('measure-distance');
    h.click({ lat: 0, lon: 0 });
    expect(change).toHaveBeenCalledTimes(2); // setMode + click
    expect(h.redraws()).toBeGreaterThanOrEqual(2);
  });

  it('the tools layer projects measure points without a 2D context', () => {
    const h = fakeHost();
    const tools = createMapTools(h.host, { genId: idGen() });
    tools.setMode('measure-distance');
    h.click({ lat: 5, lon: 6 });
    h.click({ lat: 7, lon: 8 });

    const project = vi.fn((lat: number, lon: number): [number, number] => [lon, lat]);
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    const ctx: MapRenderCtx = { canvas, project };
    h.layer()!.render(ctx);
    expect(project).toHaveBeenCalledWith(5, 6);
    expect(project).toHaveBeenCalledWith(7, 8);
  });

  it('dispose tears down the click sub + layer', () => {
    const h = fakeHost();
    const tools = createMapTools(h.host, { genId: idGen() });
    const intents: LatLon[] = [];
    tools.onClickIntent((e) => intents.push(e));
    tools.dispose();
    expect(h.layerDisposed()).toBe(true);
    h.click({ lat: 0, lon: 0 });
    expect(intents).toHaveLength(0); // click handler removed
  });
});
