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
  Show,
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
import {
  createAdsbTrafficLayer,
  pickTrafficTarget,
  projectTrafficTargets,
  trafficDetails,
  type TrafficDetails,
} from '../../../ui/widgets/map/layers/adsb';
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
/** ADS-B stale-eviction + repaint cadence (ms). */
const ADSB_POLL_MS = 1000;

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

  // --- ADS-B traffic (T8.8): display-only layer + click-to-select ------------
  const [selectedIcao, setSelectedIcao] = createSignal<number | undefined>(undefined);
  const adsbLayer = createAdsbTrafficLayer(() => services.traffic.all(), {
    selectedIcaoAddress: () => selectedIcao(),
  });

  const layerDisposers = [
    engine.addLayer(createTrackLayer(() => trackRing.points())),
    engine.addLayer(createHomeLayer(homeOverlay, { label: t('mapoverlay.home.label') })),
    engine.addLayer(createVehicleLayer(vehicleOverlay)),
    engine.addLayer(adsbLayer),
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

  // One-shot: center the map on the vehicle (or its home) the first time a real
  // position is known, so the map does not sit at null island (0,0) on connect.
  let didAutoCenter = false;
  createEffect(() => {
    if (didAutoCenter) return;
    const v = activeVehicle();
    const loc = v?.position ?? v?.home;
    if (loc === undefined || (loc.lat === 0 && loc.lon === 0)) return;
    engine.setView({ lat: loc.lat, lon: loc.lon, zoom: 16 });
    didAutoCenter = true;
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
    // A click that lands on an ADS-B aircraft SELECTS it (display-only) and does
    // NOT issue a guided command; this gives traffic inspection priority over
    // the guided fly-here / ROI path on the same click.
    const projectFor = (lat: number, lon: number): [number, number] => engine.project(lat, lon);
    const targets = projectTrafficTargets(services.traffic.all(), projectFor);
    const hit = pickTrafficTarget(targets, engine.project(e.lat, e.lon));
    if (hit !== undefined) {
      setSelectedIcao(hit.aircraft.icaoAddress);
      return;
    }
    setSelectedIcao(undefined);
    const altM = activeVehicle()?.position?.altRelM ?? DEFAULT_GUIDED_ALT_M;
    const action = guidedMode() === 'roi' ? 'setRoi' : 'guidedGoto';
    void runAction(actionDeps(), action, { lat: e.lat, lon: e.lon, altM });
  });
  onCleanup(offIntent);

  // Selected-aircraft details popover (display-only).
  const adsbNow = props.now ?? ((): number => Date.now());
  const selectedDetails = createMemo<TrafficDetails | undefined>(() => {
    const icao = selectedIcao();
    if (icao === undefined) return undefined;
    const aircraft = services.traffic.get(icao);
    return aircraft === undefined ? undefined : trafficDetails(aircraft, adsbNow());
  });

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
  let adsbTimer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    statsTimer = setInterval(refreshStats, STATS_POLL_MS);
    // Evict stale ADS-B traffic + repaint so faded aircraft drop off the map.
    adsbTimer = setInterval(() => {
      services.traffic.evictStale();
      engine.requestRedraw();
    }, ADSB_POLL_MS);
  });
  onCleanup(() => {
    if (statsTimer !== undefined) clearInterval(statsTimer);
    if (adsbTimer !== undefined) clearInterval(adsbTimer);
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

          <Show when={selectedDetails()}>
            {(details) => (
              <aside
                class="mvp-flight__adsb"
                role="status"
                aria-label={t('flight.adsb.label')}
                data-testid="flight-adsb-details"
              >
                <div class="mvp-flight__adsb-head">
                  <span class="mvp-flight__adsb-title">{details().title}</span>
                  <button
                    type="button"
                    class="mvp-flight__adsb-close"
                    aria-label={t('flight.adsb.close')}
                    onClick={() => setSelectedIcao(undefined)}
                  >
                    ×
                  </button>
                </div>
                <ul class="mvp-flight__adsb-rows">
                  {details().rows.map((row) => (
                    <li class="mvp-flight__adsb-row">{row}</li>
                  ))}
                </ul>
              </aside>
            )}
          </Show>
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
