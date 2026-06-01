/**
 * Logs & analysis screen (task T6.8 assembly + T6.5 map track; spec plan/04
 * §4.7/§4.8/§4.9, plan/05 §5.4 Logs).
 *
 * The M6 keystone: composes the committed log widgets into the Logs layout —
 *  - a SOURCE picker (open a DataFlash `.bin`/`.log` → decoded into a
 *    {@link LogQueryIndex}; open a `.tlog` → the playback path);
 *  - the {@link Plotter} (dominant) fed by {@link LogQueryIndex.querySeries} /
 *    {@link LogQueryIndex.evaluateDerived};
 *  - the {@link SeriesPicker} (searchable message.field tree + derived input);
 *  - the T6.5 MAP TRACK: a raster map with the GPS/POS flight track and a
 *    cursor-synced marker (plot cursor ⇄ map position via {@link interpolateTrackAt}
 *    / {@link nearestTrackTime});
 *  - the live MAVLink {@link Inspector} and the {@link MessageSender} (bound to
 *    the host send seam);
 *  - the tlog {@link PlaybackControls} + preset-analysis selector;
 *  - a CSV export of the plotted series via {@link seriesToCsv} / {@link saveCsv}.
 *
 * Everything is injected (decode seam, map-engine seam, replay-transport seam,
 * file I/O, host send + inspector source) so the screen unit-tests with no
 * Worker, no canvas pixels, and a synthetic decoded log.
 */
import { Show, createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import { t as defaultT } from '../../../core/i18n';
import type { BlobStore, FileIo } from '../../../contracts';
import type { LogQueryIndex } from '../../../data/log-query';
import { saveCsv, seriesToCsv } from '../../../data/export';
import {
  MapWidget,
  createRasterMapEngine,
  createTileCache,
  type RasterMapEngine,
} from '../../../ui/widgets/map';
import { createTrackLayer, type LatLon } from '../../../ui/widgets/map/layers';
import {
  Plotter,
  colorForSeries,
  plottedValue,
  type PlotterSeriesInput,
} from '../../../ui/widgets/plotter';
import { Inspector, type InspectorSource } from '../../../ui/widgets/inspector';
import { MessageSender, type MsgSenderSend } from '../../../ui/widgets/msg-sender';
import {
  PlaybackControls,
  openTlog,
  tlogTotalUs,
  type AnalysisFieldSpec,
  type OpenableReplayTransport,
  type PlaybackController,
  type PlaybackProgress,
  type ReplayController,
} from './playback';
import { ReplayTransport } from '../../../transport/replay';
import { SeriesPicker, type SelectedSeriesSummary } from './series-picker';
import { decodeDataFlashInWorker } from './source';
import {
  buildTrackFromSeries,
  createTrackCursorLayer,
  findTrackSource,
  interpolateTrackAt,
  nearestTrackTime,
  type TrackSample,
} from './track';
import './messages';

import '../../../ui/widgets/map/map.css';
import '../../../ui/widgets/inspector/inspector.css';
import '../../../ui/widgets/msg-sender/msg-sender.css';
import './logs.css';

/** The i18n translate function (matches `core/i18n` `t` / `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Max points per plotted series (≈ plot width; the engine downsamples to this). */
const MAX_PLOT_POINTS = 1200;
/** Zoom level applied when recentring the map on a freshly loaded track. */
const TRACK_ZOOM = 15;

/** Kind of plotted series: a raw field or a derived expression. */
type SeriesKind = 'field' | 'derived';

/** A selected series with the data needed to (re)query it. */
interface SelectedSeries extends SelectedSeriesSummary {
  /** Logical y-axis id; series sharing an id share a plot axis. */
  readonly axisId: string;
  /** Whether this is a raw field or a derived expression. */
  readonly kind: SeriesKind;
  /** DataFlash message name (raw-field series only). */
  readonly message?: string;
  /** Field name within the message (raw-field series only). */
  readonly field?: string;
  /** Derived arithmetic expression (derived series only). */
  readonly expr?: string;
}

/** {@link LogsScreen} props. */
export interface LogsScreenProps {
  /** File picker I/O for opening logs + saving CSV. */
  readonly files: FileIo;
  /** Blob store backing the map tile cache. */
  readonly blobs: BlobStore;
  /** Host send seam for the {@link MessageSender}. */
  readonly send: MsgSenderSend;
  /** Live inspector stream source (omitted when no host is connected). */
  readonly inspectorSource?: InspectorSource;
  /** i18n translate function (default the app `t`). */
  readonly t?: TFn;
  /**
   * Decode a DataFlash `.bin`/`.log` blob into a query index. Defaults to the
   * inlined log worker (off-main-thread); tests inject a main-thread decoder.
   */
  readonly decodeBin?: (source: Blob) => Promise<LogQueryIndex>;
  /** Build the map engine. Defaults to a raster engine over a tile cache. */
  readonly createEngine?: (blobs: BlobStore) => RasterMapEngine;
  /** Build the replay transport for the tlog path (default a real one). */
  readonly createReplayTransport?: () => OpenableReplayTransport;
}

/** Wrap the platform `fetch` as the tile cache's injected fetch seam. */
function platformFetch(url: string, init?: { signal?: AbortSignal }): Promise<Response> {
  return fetch(url, init);
}

/** Build the default raster map engine with a storage-backed tile cache. */
function defaultCreateEngine(blobs: BlobStore): RasterMapEngine {
  const cache = createTileCache({ blobs, fetch: platformFetch });
  return createRasterMapEngine({ cache });
}

/** A stable playback controller that re-targets a fresh tlog controller on open. */
interface ScreenPlayback {
  /** The stable controller handed to {@link PlaybackControls}. */
  readonly controller: PlaybackController;
  /** Re-target the inner replay controller when a tlog is opened. */
  attach(inner: ReplayController): void;
  /** Dispose any inner subscription. */
  dispose(): void;
}

/**
 * Build the screen's stable {@link PlaybackController}. {@link PlaybackControls}
 * subscribes once at mount, so we keep a fixed outer controller and swap the
 * inner replay controller (from {@link openTlog}) underneath it on each open.
 */
function createScreenPlayback(): ScreenPlayback {
  const listeners = new Set<(p: PlaybackProgress) => void>();
  let inner: ReplayController | undefined;
  let detach: (() => void) | undefined;

  const emit = (progress: PlaybackProgress): void => {
    for (const listener of listeners) listener(progress);
  };

  const controller: PlaybackController = {
    play(): void {
      inner?.play();
    },
    pause(): void {
      inner?.pause();
    },
    step(): void {
      inner?.step();
    },
    seek(timeUs): void {
      inner?.seek(timeUs);
    },
    setSpeed(speed): void {
      inner?.setSpeed(speed);
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    controller,
    attach(next): void {
      detach?.();
      inner = next;
      detach = next.subscribe(emit);
    },
    dispose(): void {
      detach?.();
      detach = undefined;
      inner = undefined;
      listeners.clear();
    },
  };
}

/** The composed Logs & analysis screen. */
export const LogsScreen: Component<LogsScreenProps> = (props) => {
  const t = props.t ?? defaultT;
  const decodeBin = props.decodeBin ?? decodeDataFlashInWorker;

  // --- log source state -----------------------------------------------------
  const [index, setIndex] = createSignal<LogQueryIndex | undefined>();
  const [selected, setSelected] = createSignal<readonly SelectedSeries[]>([]);
  const [cursorUs, setCursorUs] = createSignal<number | null>(null);
  const [status, setStatus] = createSignal<string>(t('logs.source.empty'));
  const [loading, setLoading] = createSignal(false);
  const [tlogBytes, setTlogBytes] = createSignal<Uint8Array | undefined>();

  const descriptors = createMemo(() => index()?.listSeries() ?? []);

  // --- flight track (GPS/POS) + cursor sync ---------------------------------
  const track = createMemo<readonly TrackSample[]>(() => {
    const idx = index();
    if (idx === undefined) return [];
    const source = findTrackSource(idx.listSeries());
    if (source === undefined) return [];
    const lat = idx.getSeries(source.message, source.latField);
    const lon = idx.getSeries(source.message, source.lonField);
    return buildTrackFromSeries(lat, lon);
  });

  const trackLatLon = createMemo<readonly LatLon[]>(() =>
    track().map((sample) => ({ lat: sample.lat, lon: sample.lon })),
  );

  const cursorPosition = createMemo<TrackSample | undefined>(() => {
    const at = cursorUs();
    if (at === null) return undefined;
    return interpolateTrackAt(track(), at);
  });

  // --- map engine + track + cursor-marker layers ----------------------------
  const engine = (props.createEngine ?? defaultCreateEngine)(props.blobs);
  const layerDisposers = [
    engine.addLayer(createTrackLayer(() => trackLatLon())),
    engine.addLayer(createTrackCursorLayer(() => cursorPosition())),
  ];
  const offClick = engine.on('click', ({ lat, lon }) => {
    const at = nearestTrackTime(track(), lat, lon);
    if (at !== undefined) setCursorUs(at);
  });
  onCleanup(() => {
    offClick();
    for (const off of layerDisposers) off();
  });

  // Recentre the map on a freshly loaded track and repaint on track changes.
  createEffect(() => {
    const first = track()[0];
    if (first !== undefined) engine.setView({ lat: first.lat, lon: first.lon, zoom: TRACK_ZOOM });
    engine.requestRedraw();
  });
  // Move the cursor marker whenever the synced position changes.
  createEffect(() => {
    cursorPosition();
    engine.requestRedraw();
  });

  // --- plotter series (queried from the index) ------------------------------
  const plotterSeries = createMemo<readonly PlotterSeriesInput[]>(() => {
    const idx = index();
    if (idx === undefined) return [];
    const out: PlotterSeriesInput[] = [];
    const list = selected();
    for (let i = 0; i < list.length; i++) {
      const series = list[i];
      if (series === undefined) continue;
      try {
        const samples =
          series.kind === 'derived' && series.expr !== undefined
            ? idx.evaluateDerived(series.expr, undefined, MAX_PLOT_POINTS)
            : series.message !== undefined && series.field !== undefined
              ? idx.querySeries(series.message, series.field, undefined, MAX_PLOT_POINTS)
              : [];
        out.push({
          id: series.id,
          label: series.label,
          axisId: series.axisId,
          samples,
          color: colorForSeries(i),
        });
      } catch {
        // Skip a series that can no longer be queried (defensive; shouldn't happen).
      }
    }
    return out;
  });

  const summaries = createMemo<readonly SelectedSeriesSummary[]>(() =>
    selected().map((series) => ({ id: series.id, label: series.label })),
  );

  // --- series add/remove + derived + preset ---------------------------------
  const addSeries = (message: string, field: string): void => {
    const id = `field:${message}.${field}`;
    if (selected().some((s) => s.id === id)) return;
    const descriptor = descriptors().find((d) => d.message === message && d.field === field);
    const axisId = descriptor?.unit ?? field;
    setSelected((prev) => [
      ...prev,
      { id, label: `${message}.${field}`, axisId, kind: 'field', message, field },
    ]);
  };

  const removeSeries = (id: string): void => {
    setSelected((prev) => prev.filter((s) => s.id !== id));
  };

  const addDerived = (expr: string): boolean => {
    const idx = index();
    if (idx === undefined) return false;
    try {
      idx.evaluateDerived(expr, undefined, 1);
    } catch {
      return false;
    }
    const id = `derived:${expr}`;
    if (selected().some((s) => s.id === id)) return true;
    setSelected((prev) => [...prev, { id, label: expr, axisId: 'derived', kind: 'derived', expr }]);
    return true;
  };

  const applyPreset = (spec: AnalysisFieldSpec | undefined): void => {
    if (spec === undefined) return;
    const idx = index();
    if (idx === undefined) return;
    const list = idx.listSeries();
    setSelected((prev) => {
      const next = [...prev];
      for (const presetSeries of spec.series) {
        for (const ref of presetSeries.fields) {
          const exists = list.some((d) => d.message === ref.message && d.field === ref.field);
          if (!exists) continue;
          const id = `field:${ref.message}.${ref.field}`;
          if (next.some((s) => s.id === id)) continue;
          next.push({
            id,
            label: `${ref.message}.${ref.field}`,
            axisId: presetSeries.axis,
            kind: 'field',
            message: ref.message,
            field: ref.field,
          });
        }
      }
      return next;
    });
  };

  // --- source open handlers -------------------------------------------------
  const openBin = async (): Promise<void> => {
    const picked = await props.files.openForRead(['.bin', '.log']);
    if (picked === undefined) return;
    setLoading(true);
    setStatus(t('logs.source.loading'));
    try {
      const idx = await decodeBin(picked.blob);
      setIndex(idx);
      setSelected([]);
      setCursorUs(null);
      setTlogBytes(undefined);
      setStatus(t('logs.source.loaded', { name: picked.name, series: idx.listSeries().length }));
    } catch {
      setStatus(t('logs.source.error'));
    } finally {
      setLoading(false);
    }
  };

  const playback = createScreenPlayback();
  onCleanup(() => playback.dispose());

  const openTlogFile = async (): Promise<void> => {
    const picked = await props.files.openForRead(['.tlog']);
    if (picked === undefined) return;
    setLoading(true);
    setStatus(t('logs.source.loading'));
    try {
      const data = new Uint8Array(await picked.blob.arrayBuffer());
      const transport = (props.createReplayTransport ?? (() => new ReplayTransport()))();
      const controller = await openTlog({ data, transport });
      playback.attach(controller);
      controller.seek(0);
      setTlogBytes(data);
      setStatus(t('logs.source.tlogLoaded', { name: picked.name }));
    } catch {
      setStatus(t('logs.source.error'));
    } finally {
      setLoading(false);
    }
  };

  // --- CSV export -----------------------------------------------------------
  const exportCsv = async (): Promise<void> => {
    const series = plotterSeries();
    if (series.length > 0) {
      const rows: Array<{ series: string; time_us: number; value: number }> = [];
      for (const entry of series) {
        for (const point of entry.samples) {
          const value = plottedValue(point);
          if (value === undefined) continue;
          rows.push({ series: entry.label, time_us: point.t, value });
        }
      }
      const csv = seriesToCsv(rows, [
        { header: 'series', value: 'series' },
        { header: 'time_us', value: 'time_us' },
        { header: 'value', value: 'value' },
      ]);
      await props.files.saveAs(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        'log-series.csv',
      );
      return;
    }
    const tlog = tlogBytes();
    if (tlog !== undefined) {
      const { tlogToCsv } = await import('../../../data/export');
      const files = tlogToCsv(tlog);
      const first = files[0];
      if (first !== undefined) await saveCsv(props.files, `${first.name}.csv`, first.csv);
    }
  };

  const canExport = createMemo<boolean>(
    () => plotterSeries().length > 0 || tlogBytes() !== undefined,
  );
  const playbackTotalUs = createMemo<number>(() => {
    const tlog = tlogBytes();
    return tlog === undefined ? 0 : tlogTotalUs(tlog);
  });

  return (
    <section class="mvp-logs" role="region" aria-label={t('logs.region')}>
      <header class="mvp-logs__source" aria-label={t('logs.source.label')}>
        <button
          type="button"
          class="mvp-logs__btn"
          data-testid="logs-open-bin"
          disabled={loading()}
          onClick={() => void openBin()}
        >
          {t('logs.source.openBin')}
        </button>
        <button
          type="button"
          class="mvp-logs__btn"
          data-testid="logs-open-tlog"
          disabled={loading()}
          onClick={() => void openTlogFile()}
        >
          {t('logs.source.openTlog')}
        </button>
        <button
          type="button"
          class="mvp-logs__btn"
          data-testid="logs-export"
          disabled={!canExport()}
          onClick={() => void exportCsv()}
        >
          {t('logs.source.export')}
        </button>
        <span class="mvp-logs__status" aria-live="polite" data-testid="logs-status">
          {status()}
        </span>
      </header>

      <div class="mvp-logs__stage">
        <div class="mvp-logs__plot" aria-label={t('logs.plotter.label')}>
          <Plotter
            series={plotterSeries()}
            cursorUs={cursorUs()}
            onCursor={(at) => setCursorUs(at)}
          />
        </div>

        <aside class="mvp-logs__sidebar">
          <SeriesPicker
            descriptors={descriptors}
            selected={summaries}
            onAdd={addSeries}
            onRemove={removeSeries}
            onAddDerived={addDerived}
            t={t}
          />
        </aside>

        <div class="mvp-logs__map" aria-label={t('logs.map.label')}>
          <MapWidget engine={engine} t={t} />
        </div>
      </div>

      <section class="mvp-logs__playback" aria-label={t('logs.playbackBar.label')}>
        <PlaybackControls
          controller={playback.controller}
          totalUs={playbackTotalUs()}
          t={t}
          onSelectPreset={(spec) => applyPreset(spec)}
        />
      </section>

      <section class="mvp-logs__tools">
        <div class="mvp-logs__inspector" aria-label={t('logs.inspector.label')}>
          <Show
            when={props.inspectorSource}
            fallback={<p class="mvp-logs__hint">{t('logs.inspector.label')}</p>}
          >
            {(source) => <Inspector source={source()} t={t} />}
          </Show>
        </div>
        <div class="mvp-logs__sender" aria-label={t('logs.sender.label')}>
          <MessageSender send={props.send} t={t} />
        </div>
      </section>
    </section>
  );
};
