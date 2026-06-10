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
import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
  type Component,
} from 'solid-js';
import { t as defaultT, type TFn } from '../../../core/i18n';
import { resolveUnits } from '../../../core/units';
import type { AppState, BlobStore, FileIo, Store } from '../../../contracts';
import type { RecentsStore } from '../../../core/recents';
import type { LogQueryIndex } from '../../../data/log-query';
import { saveCsv, seriesToCsv } from '../../../data/export';
import {
  MapWidget,
  basemapFromSettings,
  createRasterMapEngine,
  createTileCache,
  type RasterMapEngine,
} from '../../widgets/map';
import { createTrackLayer, type LatLon } from '../../widgets/map/layers';
import {
  Plotter,
  colorForSeries,
  plottedValue,
  type PlotterSeriesInput,
} from '../../widgets/plotter';
import { Inspector, type InspectorSource } from '../../widgets/inspector';
import { MessageSender, type MsgSenderSend } from '../../widgets/msg-sender';
import { ResizableSplit } from '../../widgets/split';
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
import { ReplayTransport, parseTlog, type TlogFrame } from '../../../transport/replay';
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

import '../../widgets/map/map.css';
import '../../widgets/inspector/inspector.css';
import '../../widgets/msg-sender/msg-sender.css';
import './logs.css';

export type { TFn };

/** Max points per plotted series (≈ plot width; the engine downsamples to this). */
const MAX_PLOT_POINTS = 1200;
/** Zoom level applied when recentring the map on a freshly loaded track. */
const TRACK_ZOOM = 15;

/** Minimum/maximum plot/map split ratio (plot row `fr`) for the stage splitter. */
const SPLIT_MIN = 0.3;
const SPLIT_MAX = 4;

/**
 * The Logs plot/map split ratio (the plot row's `fr`), kept at module scope so
 * a user's drag persists across the screen's lifetime (and re-mounts within the
 * session). Default `1.3fr` matches the stage's CSS fallback.
 */
const [logsSplitRatio, setLogsSplitRatio] = createSignal(1.3);

/** Commit a new (already-clamped) Logs plot/map split ratio. */
const applySplitRatio = (next: number): void => {
  setLogsSplitRatio(next);
};

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
  /**
   * Optional app store. When supplied, `settings.mapSource` reaches the map
   * track engine basemap live (spec §5.6/§7.4).
   */
  readonly store?: Store<AppState>;
  /**
   * Optional recents store. When supplied, opening a `.bin`/`.log` records a
   * `log` recent and opening a `.tlog` records a `tlog` recent (with the blob).
   */
  readonly recents?: RecentsStore;
  /**
   * Optional pending-open accessor (App Settings → Recents “Open”). A `.tlog`
   * name loads via the playback path; any other name decodes as DataFlash. The
   * screen calls {@link LogsScreenProps.onPendingConsumed} once loaded.
   */
  readonly pendingOpen?: Accessor<{ name: string; blob: Blob } | undefined>;
  /** Clear the pending-open entry once it has been loaded. */
  readonly onPendingConsumed?: () => void;
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

/** Compare two byte chunks for exact equality. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A running replay session: the open transport plus its cancellable reader loop. */
interface ReplaySession {
  /** Cancel the reader loop and pause/close the transport. */
  stop(): Promise<void>;
}

/**
 * Start the frame-report loop for an open replay transport (fix F1): read the
 * transport's frame stream (one chunk per tlog frame), map each chunk back to
 * its parsed frame (the chunk is an exact copy of `frame.bytes`; matching scans
 * forward from the last position and wraps once to survive seeks), and feed
 * `controller.report(frameTimeUs, atEnd)` so the scrub slider and timecode
 * track playback. Reports `ended` when the stream completes. The returned
 * session's `stop()` cancels the loop and pauses/closes the transport (fix F2).
 */
function startReplaySession(
  transport: OpenableReplayTransport,
  controller: ReplayController,
  frames: readonly TlogFrame[],
): ReplaySession {
  const readable = transport.readable;
  const lastUs = frames[frames.length - 1]?.timeUs ?? 0;
  let cancelled = false;

  const closeTransport = async (): Promise<void> => {
    transport.pause();
    await transport.close?.();
  };

  if (readable === undefined) {
    // Test doubles without a frame stream: nothing to report, only cleanup.
    return { stop: closeTransport };
  }

  const reader = readable.getReader();
  let pointer = 0;
  const matchFrame = (chunk: Uint8Array): TlogFrame | undefined => {
    // Frames replay in order; a seek may jump the pointer, so scan forward
    // first and wrap to the start once on a miss.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = pass === 0 ? pointer : 0; i < frames.length; i++) {
        const frame = frames[i];
        if (frame !== undefined && bytesEqual(frame.bytes, chunk)) {
          pointer = i + 1;
          return frame;
        }
      }
    }
    return undefined;
  };

  const loop = (async (): Promise<void> => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || cancelled) break;
        const frame = matchFrame(value);
        if (frame !== undefined) controller.report(frame.timeUs, pointer >= frames.length);
      }
      if (!cancelled) controller.report(lastUs, true);
    } catch {
      // Reader cancelled or transport torn down mid-read: nothing to report.
    }
  })();

  return {
    stop: async (): Promise<void> => {
      cancelled = true;
      try {
        await reader.cancel();
      } catch {
        // Already closed/errored; cancellation is best-effort.
      }
      await loop;
      await closeTransport();
    },
  };
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

  // --- log source state -----------------------------------------------------
  const [index, setIndex] = createSignal<LogQueryIndex | undefined>();
  const [selected, setSelected] = createSignal<readonly SelectedSeries[]>([]);
  const [cursorUs, setCursorUs] = createSignal<number | null>(null);
  const [status, setStatus] = createSignal<string>(t('logs.source.empty'));
  const [loading, setLoading] = createSignal(false);
  const [tlogBytes, setTlogBytes] = createSignal<Uint8Array | undefined>();

  const descriptors = createMemo(() => index()?.listSeries() ?? []);

  // Default decode path: the inlined log worker, with streamed record-count
  // progress surfacing in the status line (fix F4).
  const decodeBin = (blob: Blob): Promise<LogQueryIndex> =>
    props.decodeBin !== undefined
      ? props.decodeBin(blob)
      : decodeDataFlashInWorker(blob, (n) => setStatus(t('logs.source.loadingProgress', { n })));

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

  // Live basemap: repaint when the Maps setting changes (spec §5.6/§7.4). Only
  // when an app store is supplied (additive; mounts without a store are skipped).
  const logStore = props.store;
  if (logStore !== undefined) {
    const mapSource = logStore.select((s) => s.settings.mapSource);
    createEffect(() => {
      engine.setBasemap(basemapFromSettings(mapSource()));
    });
  }
  // Reactive map scale-bar unit system; metric when no app store is supplied.
  const logSettings = logStore !== undefined ? logStore.select((s) => s.settings) : undefined;
  const mapUnits = createMemo(() =>
    logSettings !== undefined ? resolveUnits(logSettings()).system : 'metric',
  );
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

  const playback = createScreenPlayback();
  onCleanup(() => playback.dispose());

  // The active replay session (transport + reader loop); swapped on each open
  // and torn down on unmount so no ghost replay keeps running (fix F2).
  let replaySession: ReplaySession | undefined;
  const stopReplaySession = async (): Promise<void> => {
    const session = replaySession;
    replaySession = undefined;
    if (session !== undefined) await session.stop();
  };
  onCleanup(() => void stopReplaySession());

  // --- source loaders (shared by the file picker + Recents pending-open) -----
  // Decode an in-hand DataFlash `.bin`/`.log` blob; returns `true` on success.
  const loadBinBlob = async (name: string, blob: Blob): Promise<boolean> => {
    setLoading(true);
    setStatus(t('logs.source.loading'));
    try {
      const idx = await decodeBin(blob);
      setIndex(idx);
      setSelected([]);
      setCursorUs(null);
      setTlogBytes(undefined);
      setStatus(t('logs.source.loaded', { name, series: idx.listSeries().length }));
      return true;
    } catch (err) {
      const detail = err instanceof Error && err.message !== '' ? ` (${err.message})` : '';
      setStatus(t('logs.source.error') + detail);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Open an in-hand `.tlog` blob into the playback path; returns `true` on success.
  const loadTlogBlob = async (name: string, blob: Blob): Promise<boolean> => {
    setLoading(true);
    setStatus(t('logs.source.loading'));
    try {
      // Tear down any previous replay before attaching a new one (fix F2).
      await stopReplaySession();
      const data = new Uint8Array(await blob.arrayBuffer());
      const transport = (props.createReplayTransport ?? (() => new ReplayTransport()))();
      const controller = await openTlog({ data, transport });
      playback.attach(controller);
      // Feed live frame timestamps into the controller (fix F1).
      replaySession = startReplaySession(transport, controller, parseTlog(data));
      controller.seek(0);
      setTlogBytes(data);
      setStatus(t('logs.source.tlogLoaded', { name }));
      return true;
    } catch (err) {
      const detail = err instanceof Error && err.message !== '' ? ` (${err.message})` : '';
      setStatus(t('logs.source.error') + detail);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // --- source open handlers -------------------------------------------------
  const openBin = async (): Promise<void> => {
    const picked = await props.files.openForRead(['.bin', '.log']);
    if (picked === undefined) return;
    if (await loadBinBlob(picked.name, picked.blob)) {
      // Record the opened log (with its blob) for App Settings → Recents.
      void props.recents?.record({ kind: 'log', name: picked.name, blob: picked.blob });
    }
  };

  const openTlogFile = async (): Promise<void> => {
    const picked = await props.files.openForRead(['.tlog']);
    if (picked === undefined) return;
    if (await loadTlogBlob(picked.name, picked.blob)) {
      // Record the opened tlog (with its blob) for App Settings → Recents.
      void props.recents?.record({ kind: 'tlog', name: picked.name, blob: picked.blob });
    }
  };

  // App Settings → Recents “Open”: load a cached `log`/`tlog` blob when it
  // appears (a `.tlog` name uses the playback path; otherwise DataFlash decode),
  // then clear it so re-selecting the same entry re-triggers the load.
  let startedPending: { name: string; blob: Blob } | undefined;
  createEffect(() => {
    const pending = props.pendingOpen?.();
    if (pending === undefined || pending === startedPending) return;
    // This effect reads `loading()` so it re-runs when a load finishes; never
    // start a second decode while one is in flight (fix F15).
    if (loading()) return;
    startedPending = pending;
    const isTlog = pending.name.toLowerCase().endsWith('.tlog');
    const load = isTlog ? loadTlogBlob : loadBinBlob;
    void load(pending.name, pending.blob).finally(() => props.onPendingConsumed?.());
  });

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

      <div class="mvp-logs__stage" style={{ '--mvp-logs-split': `${logsSplitRatio()}fr` }}>
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

        <ResizableSplit
          class="mvp-logs__split"
          ratio={logsSplitRatio}
          onRatio={applySplitRatio}
          min={SPLIT_MIN}
          max={SPLIT_MAX}
          label={t('logs.split.label')}
        />

        <div class="mvp-logs__map" aria-label={t('logs.map.label')}>
          <MapWidget engine={engine} t={t} units={mapUnits()} />
        </div>
      </div>

      <section class="mvp-logs__playback" aria-label={t('logs.playbackBar.label')}>
        <PlaybackControls
          controller={playback.controller}
          totalUs={playbackTotalUs()}
          disabled={loading()}
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
