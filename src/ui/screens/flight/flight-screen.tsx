/**
 * Flight Data screen (task T2.11; spec plan/04 §4.2, plan/05 §5.4 Flight).
 *
 * The M2 keystone: composes the committed widgets — HUD, instruments rail, the
 * raster map with live overlays + tools, the quick-actions bar, the STATUSTEXT
 * console, quick-watch and a tlog record control — into the default Flight
 * layout (map dominant with the HUD as a resizable overlay card), and wires them
 * to live store + host services.
 *
 * It reads the app/connection-scoped {@link FlightServices} (so recording, audit
 * and STATUSTEXT survive screen switches) and a reactive active-vehicle accessor
 * `() => store.vehicles[store.activeSysid]`:
 *  - HUD + gauges bind to the active vehicle (incl. throttle + RC in/out);
 *  - the HUD ticker + console read the STATUSTEXT accumulator;
 *  - the map engine gets a storage-backed tile cache, vehicle/home/track overlay
 *    layers and the map tools, and a guided map click (fly-here / ROI) is routed
 *    through {@link runAction} so it shares the confirm + audit path;
 *  - the actions bar uses the real {@link CommandClient} + shell confirm + shared
 *    audit log; the audit viewer is reachable from a collapsible panel;
 *  - the record control drives the app-scoped {@link TlogRecorder} (size /
 *    duration / frame count + export).
 *
 * The screen is store-/service-injected so it unit-tests with a mock host +
 * command client and an offline engine seam (`createEngine`).
 */
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type Component,
} from 'solid-js';
import { t as defaultT } from '../../../core/i18n';
import type { AppState, Store, VehicleState } from '../../../contracts';
import { Hud } from '../../../ui/widgets/hud';
import { InstrumentPanel, type RcState } from '../../../ui/widgets/gauges';
import {
  MapWidget,
  createRasterMapEngine,
  createTileCache,
  type RasterMapEngine,
} from '../../../ui/widgets/map';
import {
  createHomeLayer,
  createTrackLayer,
  createTrackRing,
  createVehicleLayer,
  type LatLon,
  type VehicleOverlay,
} from '../../../ui/widgets/map/layers';
import { createMapTools, type MapTools, type ToolMode } from '../../../ui/widgets/map/tools';
import { MessagesConsole } from '../../../ui/widgets/messages';
import { QuickWatch } from '../../../ui/widgets/quickwatch';
import { ActionsBar, AuditPanel, runAction, type ActionsDeps, type ConfirmFn } from './actions';
import type { FlightServices } from './services';
import './messages';

import '../../../ui/widgets/hud/hud.css';
import '../../../ui/widgets/gauges/gauges.css';
import '../../../ui/widgets/map/map.css';
import '../../../ui/widgets/messages/messages.css';
import '../../../ui/widgets/quickwatch/quickwatch.css';
import './actions/actions.css';
import './flight.css';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Default guided-target altitude (m, relative) when the vehicle alt is unknown. */
const DEFAULT_GUIDED_ALT_M = 50;
/** Live-track ring capacity + minimum sample spacing. */
const TRACK_CAPACITY = 600;
const TRACK_MIN_SPACING_M = 2;
/** Record-stats poll cadence (ms). */
const STATS_POLL_MS = 500;

/** What a map click in `none` mode commands (shared confirm + audit path). */
type GuidedMode = 'goto' | 'roi';

/** {@link FlightScreen} props. */
export interface FlightScreenProps {
  /** App/connection-scoped services (command/audit/recorder/STATUSTEXT). */
  services: FlightServices;
  /** The shared app store (active-vehicle + telemetry source). */
  store: Store<AppState>;
  /** Safety-confirm seam (the shell `UiRegistry.confirm`). */
  confirm: ConfirmFn;
  /** i18n translate function (default the app `t`). */
  t?: TFn;
  /**
   * Test seam: build the map engine. Defaults to a raster engine over a
   * storage-backed tile cache; tests inject an offline engine.
   */
  createEngine?: (services: FlightServices) => RasterMapEngine;
  /** Clock for the HUD time + record stats (default `Date.now`). */
  now?: () => number;
}

/** Wrap the platform `fetch` as the tile cache's injected fetch seam. */
function platformFetch(url: string, init?: { signal?: AbortSignal }): Promise<Response> {
  return fetch(url, init);
}

/** Build the default raster map engine with a storage-backed tile cache. */
function defaultCreateEngine(services: FlightServices): RasterMapEngine {
  const cache = createTileCache({ blobs: services.blobs, fetch: platformFetch });
  return createRasterMapEngine({ cache });
}

/** Format a byte count as a compact human-readable size. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Format a microsecond span as seconds. */
function formatDuration(us: number): string {
  return `${(us / 1_000_000).toFixed(1)} s`;
}

/** The composed Flight Data screen. */
export const FlightScreen: Component<FlightScreenProps> = (props) => {
  const t = props.t ?? defaultT;
  const services = props.services;

  // --- reactive active vehicle: () => store.vehicles[store.activeSysid] -----
  const activeVehicle: Accessor<VehicleState | undefined> = props.store.select((s) => {
    if (s.activeSysid === undefined) return undefined;
    return s.vehicles[s.activeSysid];
  });

  // --- HUD STATUSTEXT ticker: latest accumulated message text ---------------
  const latestStatusText = createMemo<string | undefined>(() => {
    const list = services.statusMessages();
    return list.length > 0 ? list[list.length - 1]?.text : undefined;
  });

  // --- gauges RC source: map VehicleState.rcIn / rcOut → RcState ------------
  const rcState = createMemo<RcState | undefined>(() => {
    const v = activeVehicle();
    if (v === undefined) return undefined;
    const inputs = v.rcIn ?? [];
    const outputs = v.rcOut ?? [];
    if (inputs.length === 0 && outputs.length === 0) return undefined;
    return { inputs, outputs };
  });

  // --- map engine + overlays + tools ----------------------------------------
  const engine = (props.createEngine ?? defaultCreateEngine)(services);
  const trackRing = createTrackRing({
    capacity: TRACK_CAPACITY,
    minSpacingM: TRACK_MIN_SPACING_M,
  });

  const vehicleOverlay = (): VehicleOverlay | undefined => {
    const v = activeVehicle();
    if (v?.position === undefined) return undefined;
    const headingDeg = ((v.attitude.yawRad * 180) / Math.PI + 360) % 360;
    const overlay: VehicleOverlay = {
      lat: v.position.lat,
      lon: v.position.lon,
      headingDeg,
    };
    return overlay;
  };
  const homeOverlay = (): LatLon | undefined => {
    const home = activeVehicle()?.home;
    return home === undefined ? undefined : { lat: home.lat, lon: home.lon };
  };

  const layerDisposers = [
    engine.addLayer(createTrackLayer(() => trackRing.points())),
    engine.addLayer(createHomeLayer(homeOverlay, { label: t('mapoverlay.home.label') })),
    engine.addLayer(createVehicleLayer(vehicleOverlay)),
  ];
  const tools: MapTools = createMapTools(engine, { t });
  onCleanup(() => {
    tools.dispose();
    for (const off of layerDisposers) off();
  });

  // Push live positions into the track ring + repaint on every vehicle change.
  createEffect(() => {
    const pos = activeVehicle()?.position;
    if (pos !== undefined) trackRing.push({ lat: pos.lat, lon: pos.lon });
    engine.requestRedraw();
  });

  // --- guided map-click → runAction (shared confirm + audit) -----------------
  const [guidedMode, setGuidedMode] = createSignal<GuidedMode>('goto');
  const actionDeps = (): ActionsDeps => ({
    command: services.command,
    confirm: props.confirm,
    audit: services.audit,
    getActiveVehicle: activeVehicle,
    t,
    origin: 'map',
  });
  const offIntent = tools.onClickIntent((e) => {
    const altM = activeVehicle()?.position?.altRelM ?? DEFAULT_GUIDED_ALT_M;
    const action = guidedMode() === 'roi' ? 'setRoi' : 'guidedGoto';
    void runAction(actionDeps(), action, { lat: e.lat, lon: e.lon, altM });
  });
  onCleanup(offIntent);

  const [toolMode, setToolMode] = createSignal<ToolMode>('none');
  const onToolChange = (mode: ToolMode): void => {
    setToolMode(mode);
    tools.setMode(mode);
  };

  // --- dominance swap (map ⇆ HUD) -------------------------------------------
  const [hudDominant, setHudDominant] = createSignal(false);

  // --- tlog record control ---------------------------------------------------
  const recorder = services.recorder;
  const [recStats, setRecStats] = createSignal(recorder.stats());
  const refreshStats = (): void => {
    setRecStats(recorder.stats());
  };

  let statsTimer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    statsTimer = setInterval(refreshStats, STATS_POLL_MS);
  });
  onCleanup(() => {
    if (statsTimer !== undefined) clearInterval(statsTimer);
  });

  const toggleRecord = (): void => {
    const action = recorder.isRecording ? recorder.stop() : recorder.start();
    void action.then(refreshStats).catch(refreshStats);
  };
  const exportTlog = (): void => {
    void recorder.saveAs().catch(() => undefined);
  };

  const recStatsText = createMemo<string>(() => {
    const s = recStats();
    return t('flight.record.stats', {
      frames: s.frameCount,
      size: formatSize(s.sizeBytes),
      duration: formatDuration(s.durationUs),
    });
  });

  return (
    <section
      class="mvp-flight"
      classList={{ 'mvp-flight--hud-dominant': hudDominant() }}
      role="region"
      aria-label={t('flight.region.label')}
    >
      <div class="mvp-flight__stage">
        <div class="mvp-flight__map" aria-label={t('flight.map.label')}>
          <MapWidget engine={engine} t={t} />

          <div class="mvp-flight__map-toolbar" role="toolbar" aria-label={t('flight.tool.label')}>
            <label class="mvp-flight__field">
              <span class="mvp-flight__field-label">{t('flight.tool.label')}</span>
              <select
                class="mvp-flight__select"
                data-testid="flight-tool"
                aria-label={t('flight.tool.label')}
                value={toolMode()}
                onChange={(e) => onToolChange(e.currentTarget.value as ToolMode)}
              >
                <option value="none">{t('flight.tool.none')}</option>
                <option value="measure-distance">{t('flight.tool.measureDistance')}</option>
                <option value="measure-area">{t('flight.tool.measureArea')}</option>
                <option value="drop-marker">{t('flight.tool.marker')}</option>
              </select>
            </label>

            <label class="mvp-flight__field">
              <span class="mvp-flight__field-label">{t('flight.guided.label')}</span>
              <select
                class="mvp-flight__select"
                data-testid="flight-guided"
                aria-label={t('flight.guided.label')}
                disabled={toolMode() !== 'none'}
                value={guidedMode()}
                onChange={(e) => setGuidedMode(e.currentTarget.value as GuidedMode)}
              >
                <option value="goto">{t('flight.guided.goto')}</option>
                <option value="roi">{t('flight.guided.roi')}</option>
              </select>
            </label>

            <button
              type="button"
              class="mvp-flight__swap"
              aria-label={t('flight.swap')}
              aria-pressed={hudDominant()}
              onClick={() => setHudDominant((d) => !d)}
            >
              {t('flight.swap')}
            </button>
          </div>
        </div>

        <div class="mvp-flight__hud" aria-label={t('flight.hud.label')}>
          <Hud
            vehicle={activeVehicle}
            statusText={latestStatusText}
            t={t}
            {...(props.now !== undefined ? { now: props.now } : {})}
          />
        </div>
      </div>

      <aside class="mvp-flight__rail" aria-label={t('flight.instruments.label')}>
        <InstrumentPanel vehicle={activeVehicle} rc={rcState} t={t} />
      </aside>

      <div class="mvp-flight__actions">
        <ActionsBar
          command={services.command}
          confirm={props.confirm}
          audit={services.audit}
          vehicle={activeVehicle}
          t={t}
        />

        <section class="mvp-flight__record" aria-label={t('flight.record.title')}>
          <h2 class="mvp-flight__record-title">{t('flight.record.title')}</h2>
          <div class="mvp-flight__record-row">
            <button
              type="button"
              class="mvp-flight__btn"
              classList={{ 'mvp-flight__btn--danger': recStats().recording }}
              data-testid="flight-record"
              aria-pressed={recStats().recording}
              aria-label={recStats().recording ? t('flight.record.stop') : t('flight.record.start')}
              onClick={toggleRecord}
            >
              {recStats().recording ? t('flight.record.stop') : t('flight.record.start')}
            </button>
            <button
              type="button"
              class="mvp-flight__btn"
              data-testid="flight-export"
              aria-label={t('flight.record.export')}
              onClick={exportTlog}
            >
              {t('flight.record.export')}
            </button>
            <span class="mvp-flight__record-state" data-recording={recStats().recording}>
              {recStats().recording ? t('flight.record.recording') : t('flight.record.idle')}
            </span>
          </div>
          <p class="mvp-flight__record-stats" aria-live="polite">
            {recStatsText()}
          </p>
        </section>

        <details class="mvp-flight__audit">
          <summary class="mvp-flight__audit-summary">{t('flight.audit.toggle')}</summary>
          <AuditPanel audit={services.audit} t={t} />
        </details>
      </div>

      <section class="mvp-flight__console" aria-label={t('flight.console.label')}>
        <MessagesConsole
          messages={services.statusMessages}
          t={t}
          {...(props.now !== undefined ? { now: props.now } : {})}
        />
      </section>

      <section class="mvp-flight__quickwatch" aria-label={t('flight.quickwatch.label')}>
        <QuickWatch source={services.quickWatchSource} t={t} />
      </section>
    </section>
  );
};

/** Re-export for the screen barrel / register glue. */
export type { GuidedMode };
