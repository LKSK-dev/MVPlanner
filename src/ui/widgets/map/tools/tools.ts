/**
 * Map tools + click-intent surface (task T2.4; spec plan/04 §4.2 "map tools:
 * measure distance/area, drop ... target, ... draw temporary markers"). These
 * are the tools deferred from the T2.3 engine. A single controller owns one
 * `engine.on('click')` subscription and routes each tap by the active tool mode:
 *
 * - `measure-distance` / `measure-area`: append a point; the running
 *   great-circle distance / spherical area updates (pure math from
 *   `../layers/geometry`).
 * - `drop-marker`: place a temporary marker.
 * - `none` (default): the click is relayed as a **map click intent** for the
 *   Flight screen / actions (T2.7/T2.11) to consume for guided "fly here" /
 *   set-ROI. This module never imports a `CommandClient` — it only emits the
 *   lat/lon; wiring to commands is the screen's job.
 *
 * The controller also contributes a {@link MapLayer} that renders the in-progress
 * measurement + markers, and exposes plain accessors (+ an `onChange`
 * subscription) so a Solid screen can mirror the state into a signal and an
 * `aria-live` readout. State mutation is pure/testable; only the layer's draw is
 * canvas-deferred.
 */
import type { MapLayer } from '../../../../contracts';
import { t as defaultT } from '../../../../core/i18n';
import { drawDisc, drawLabel, strokePath } from '../layers/draw';
import {
  formatAreaM2,
  formatDistanceM,
  pathLengthMeters,
  polygonAreaMeters2,
  projectPath,
  type LatLon,
} from '../layers/geometry';
import '../layers/messages';

/** The active map-tool mode. `none` means clicks are guided-intent relays. */
export type ToolMode = 'none' | 'measure-distance' | 'measure-area' | 'drop-marker';

/** A temporary user-dropped marker. */
export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  label?: string;
}

/**
 * The slice of the map engine the tools need. {@link RasterMapEngine} satisfies
 * this structurally, so the controller never imports the concrete engine and
 * stays unit-testable with a tiny fake.
 */
export interface MapToolHost {
  on(ev: 'click', cb: (e: LatLon) => void): () => void;
  addLayer(layer: MapLayer): () => void;
  requestRedraw(): void;
}

/** Translate function shape (matches `core/i18n`'s `t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Options for {@link createMapTools}. */
export interface MapToolsOptions {
  /** Translator (default the app `t`); injectable for tests. */
  t?: TFn;
  /** Unique marker id generator (default a monotonic counter). */
  genId?: () => string;
  /** Measurement stroke colour (default amber). */
  measureColor?: string;
  /** Marker fill colour (default amber). */
  markerColor?: string;
  /** Layer id (default `'map-tools'`). */
  layerId?: string;
}

/** The tools controller returned by {@link createMapTools}. */
export interface MapTools {
  /** The current tool mode. */
  mode(): ToolMode;
  /** Switch tools. Entering a measure tool starts a fresh measurement. */
  setMode(mode: ToolMode): void;
  /** Points clicked in the active measurement (empty outside measure modes). */
  measurePoints(): LatLon[];
  /** Running great-circle length of the measurement, metres. */
  measureDistanceM(): number;
  /** Spherical area of the measurement polygon, square metres (area mode). */
  measureAreaM2(): number;
  /** A localized, screen-reader-friendly summary of the active measurement. */
  measureSummary(): string;
  /** Remove the last measurement point (no-op when empty). */
  undoLastPoint(): void;
  /** Clear the active measurement. */
  clearMeasure(): void;
  /** All dropped markers. */
  markers(): MapMarker[];
  /** Remove a marker by id. */
  removeMarker(id: string): void;
  /** Remove all markers. */
  clearMarkers(): void;
  /** The most recent map click (any mode), or `undefined` before the first. */
  latestClick(): LatLon | undefined;
  /**
   * Subscribe to **map click intents**: clicks that occur while no tool is
   * active (mode `none`). The Flight screen/actions consume these for guided
   * "fly here" / set-ROI. Returns an unsubscribe function.
   */
  onClickIntent(cb: (e: LatLon) => void): () => void;
  /** Subscribe to any tools-state change (mode/points/markers). */
  onChange(cb: () => void): () => void;
  /** The {@link MapLayer} that renders the measurement + markers. */
  readonly layer: MapLayer;
  /** Remove the click subscription + layer and drop all listeners. */
  dispose(): void;
}

/**
 * Create a {@link MapTools} controller bound to a map engine. It registers the
 * click listener and a render layer immediately; call {@link MapTools.dispose}
 * to tear both down.
 */
export function createMapTools(host: MapToolHost, options: MapToolsOptions = {}): MapTools {
  const t = options.t ?? defaultT;
  const measureColor = options.measureColor ?? '#f5a623';
  const markerColor = options.markerColor ?? '#f5a623';
  const layerId = options.layerId ?? 'map-tools';

  let counter = 0;
  const genId = options.genId ?? ((): string => `marker-${++counter}`);

  let mode: ToolMode = 'none';
  let latest: LatLon | undefined;
  const points: LatLon[] = [];
  const markerList: MapMarker[] = [];
  const intentListeners = new Set<(e: LatLon) => void>();
  const changeListeners = new Set<() => void>();

  function notify(): void {
    host.requestRedraw();
    for (const cb of changeListeners) cb();
  }

  function handleClick(e: LatLon): void {
    latest = { lat: e.lat, lon: e.lon };
    if (mode === 'measure-distance' || mode === 'measure-area') {
      points.push({ lat: e.lat, lon: e.lon });
      notify();
    } else if (mode === 'drop-marker') {
      markerList.push({ id: genId(), lat: e.lat, lon: e.lon });
      notify();
    } else {
      // mode === 'none': relay as a guided click intent.
      for (const cb of intentListeners) cb({ lat: e.lat, lon: e.lon });
      notify();
    }
  }

  const offClick = host.on('click', handleClick);

  const layer: MapLayer = {
    id: layerId,
    render(ctx): void {
      const screenPts = projectPath(points, ctx.project);
      const markerPts = markerList.map((m) => ({
        point: ctx.project(m.lat, m.lon),
        label: m.label,
      }));

      const g = ctx.canvas.getContext('2d');
      if (!g) return;
      if (screenPts.length >= 2) {
        const isArea = mode === 'measure-area';
        strokePath(g, screenPts, {
          stroke: measureColor,
          width: 2,
          dash: [6, 4],
          close: isArea,
          ...(isArea ? { fill: 'rgba(245, 166, 35, 0.15)' } : {}),
        });
      }
      for (const p of screenPts) {
        drawDisc(g, p, 3, { fill: measureColor, stroke: '#ffffff', width: 1 });
      }
      for (const m of markerPts) {
        drawDisc(g, m.point, 6, { fill: markerColor, stroke: '#ffffff', width: 2 });
        if (m.label) drawLabel(g, m.point, m.label, { color: markerColor });
      }
    },
  };
  const offLayer = host.addLayer(layer);

  return {
    layer,
    mode: () => mode,
    setMode(next: ToolMode): void {
      if (next === mode) return;
      // Entering a measure tool starts a fresh measurement session.
      if (next === 'measure-distance' || next === 'measure-area') points.length = 0;
      mode = next;
      notify();
    },
    measurePoints: () => points.map((p) => ({ lat: p.lat, lon: p.lon })),
    measureDistanceM: () => pathLengthMeters(points),
    measureAreaM2: () => polygonAreaMeters2(points),
    measureSummary(): string {
      if (points.length < 2) return t('mapoverlay.measure.empty');
      if (mode === 'measure-area') {
        return t('mapoverlay.measure.area', { value: formatAreaM2(polygonAreaMeters2(points)) });
      }
      return t('mapoverlay.measure.distance', {
        value: formatDistanceM(pathLengthMeters(points)),
      });
    },
    undoLastPoint(): void {
      if (points.length === 0) return;
      points.pop();
      notify();
    },
    clearMeasure(): void {
      if (points.length === 0) return;
      points.length = 0;
      notify();
    },
    markers: () => markerList.map((m) => ({ ...m })),
    removeMarker(removeId: string): void {
      const i = markerList.findIndex((m) => m.id === removeId);
      if (i < 0) return;
      markerList.splice(i, 1);
      notify();
    },
    clearMarkers(): void {
      if (markerList.length === 0) return;
      markerList.length = 0;
      notify();
    },
    latestClick: () => (latest ? { lat: latest.lat, lon: latest.lon } : undefined),
    onClickIntent(cb: (e: LatLon) => void): () => void {
      intentListeners.add(cb);
      return (): void => {
        intentListeners.delete(cb);
      };
    },
    onChange(cb: () => void): () => void {
      changeListeners.add(cb);
      return (): void => {
        changeListeners.delete(cb);
      };
    },
    dispose(): void {
      offClick();
      offLayer();
      intentListeners.clear();
      changeListeners.clear();
    },
  };
}
