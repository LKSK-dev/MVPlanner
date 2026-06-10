/**
 * Flight Plan screen (task T4.10; spec plan/04 §4.3, plan/05 §5.4 Plan).
 *
 * The M4 keystone: composes the committed plan widgets — the raster map with
 * editable mission/fence/rally overlays + the map editor (T4.4), the waypoint
 * table (T4.3), the survey / fence / rally editor drawer (T4.5/§4.6/§4.7), the
 * terrain elevation profile (T4.8) and an upload/download/file toolbar — into
 * the Plan layout (map dominant, right-side table, left tool rail, bottom
 * profile).
 *
 * It OWNS the shared plan state as three one-per-kind signals — the mission
 * {@link MissionModel}, the {@link Fence} and the {@link Rally} — plus the
 * survey polygon. The table, the map editor and the fence/rally/survey panels
 * all read+write these same signals, so a table edit and a map edit (or a
 * downloaded mission) are always in sync.
 *
 * Transfers use the app/connection-scoped {@link MissionClient}: Upload runs
 * `upload(missionToWire(model), { verify })` with progress; Download replaces
 * the model from `download(type)`. Fence upload also writes the `FENCE_*`
 * parameters via the {@link ParamClient}. File open/save go through
 * `data/missionfile`. The terrain profile samples the injected
 * {@link ElevationProvider} along the mission path.
 *
 * The screen is service-injected (and takes an offline `createEngine` seam) so
 * it unit-tests with a mock mission client + an offline map engine.
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
import type { AppState, Mission, Store, VehicleState } from '../../../contracts';
import {
  MapWidget,
  basemapFromSettings,
  createRasterMapEngine,
  createTileCache,
  type RasterMapEngine,
} from '../../widgets/map';
import { createMapTools, measureFormatters, type MapTools, type MapToolsOptions } from '../../widgets/map/tools';
import { resolveUnits, unitFormatterFor } from '../../../core/units';
import {
  commandHasPosition,
  haversineMeters,
  mavFrameToAltFrame,
  missionFromWire,
  missionToWire,
  type MissionModel,
} from '../../../geo/mission';
import { fenceParams, fenceToMission } from '../../../geo/fence';
import { rallyToMission } from '../../../geo/rally';
import { createPlanSession, type PlanSession } from './plan-session';
import {
  MISSION_FILE_ACCEPT,
  PLAN_MIME,
  WPL_MIME,
  buildPlan,
  parseMissionContent,
  serializePlan,
  serializeWpl,
} from '../../../data/missionfile';
import type { RecentsStore } from '../../../core/recents';
import { aglToAmsl, type ElevationSample, type TerrainProfilePoint } from '../../../geo/terrain';
import type { LatLon } from '../../../geo/format';
import { WaypointTable } from './table';
import { FencePanel } from './fence';
import { RallyPanel } from './rally';
import { SurveyPanel } from './survey';
import { TerrainProfile } from './terrain';
import { ToolRail } from './tool-rail';
import { createMapEditController, type EditState, type PlanToolMode } from './map-edit';
import type { FlightServices } from '../flight/services';
import './messages';

import '../../widgets/map/map.css';
import './table/wp-table.css';
import './fence/fence.css';
import './rally/rally.css';
import './survey/survey.css';
import './terrain/terrain.css';
import './plan.css';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Path-sampling spacing (metres) for the terrain profile. */
const PROFILE_SPACING_M = 30;

/** Which editor the drawer shows. */
type DrawerTab = 'fence' | 'rally' | 'survey';

/** {@link PlanScreen} props. */
export interface PlanScreenProps {
  /** App/connection-scoped services (mission client, params, files, terrain). */
  services: FlightServices;
  /** i18n translate function (default the app `t`). */
  t?: TFn;
  /**
   * Optional app store. When supplied, the plan map auto-centers on the active
   * vehicle (or its home) the first time a real position is known, so drawing
   * surveys/fences/rally points happens at the vehicle's location instead of at
   * null island (0,0), and `settings.mapSource` reaches the engine basemap.
   */
  store?: Store<AppState>;
  /**
   * Optional recents store. When supplied, opening/saving a mission file records
   * a `plan` recent (with the file blob) for the App Settings → Recents launcher.
   */
  recents?: RecentsStore;
  /**
   * Optional pending-open accessor (App Settings → Recents “Open”). When it
   * yields a `plan` blob the screen loads it (parsing like {@link openFile}) and
   * then calls {@link PlanScreenProps.onPendingConsumed} to clear it.
   */
  pendingOpen?: Accessor<{ name: string; blob: Blob } | undefined>;
  /** Clear the pending-open entry once it has been loaded. */
  onPendingConsumed?: () => void;
  /**
   * Optional session-scoped plan state. When supplied, the in-progress
   * mission/fence/rally/survey persist across Plan-tab switches (the dock
   * re-mounts the screen). When omitted the screen keeps local signals.
   */
  session?: PlanSession;
  /**
   * Optional destructive-replace confirmation seam (the shell
   * `UiRegistry.confirm`). When supplied, replacing a non-empty edited mission
   * (download / file open / pending open / survey generate) asks first —
   * honouring `settings.confirmDestructive` when a store is supplied.
   */
  confirm?: (opts: { title: string; body: string; destructive?: boolean }) => Promise<boolean>;
  /**
   * Test seam: build the map engine. Defaults to a raster engine over a
   * storage-backed tile cache; tests inject an offline engine.
   */
  createEngine?: (services: FlightServices) => RasterMapEngine;
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

/** A nav waypoint with its cumulative chainage + planned AMSL for the profile. */
interface PlannedVertex {
  readonly chainageM: number;
  readonly amslM: number;
}

/** Planned altitude (AMSL) of a mission item given a ground reference. */
function plannedAmsl(altM: number, frame: number, groundRefM: number): number {
  const altFrame = mavFrameToAltFrame(frame);
  if (altFrame === 'amsl') return altM;
  // relative + terrain: height above the (home/terrain) ground reference.
  return aglToAmsl(altM, groundRefM);
}

/**
 * Build terrain-profile points from the mission path and its sampled ground
 * elevations: ground AMSL per sample plus the planned path altitude (AMSL)
 * linearly interpolated between nav waypoints. Pure given the samples.
 */
function buildProfile(mission: MissionModel, samples: readonly ElevationSample[]): TerrainProfilePoint[] {
  const groundRef = samples.find((s) => s.elevationM !== undefined)?.elevationM ?? 0;
  const navItems = mission.items.filter(
    (it) => commandHasPosition(it.command) && (it.lat !== 0 || it.lon !== 0),
  );
  const planned: PlannedVertex[] = [];
  let chainage = 0;
  for (let i = 0; i < navItems.length; i++) {
    const cur = navItems[i];
    if (cur === undefined) continue;
    if (i > 0) {
      const prev = navItems[i - 1];
      if (prev !== undefined) chainage += haversineMeters(prev, cur);
    }
    planned.push({ chainageM: chainage, amslM: plannedAmsl(cur.alt, cur.frame, groundRef) });
  }

  const plannedAt = (distanceM: number): number | undefined => {
    if (planned.length === 0) return undefined;
    const first = planned[0];
    const last = planned[planned.length - 1];
    if (first === undefined || last === undefined) return undefined;
    if (distanceM <= first.chainageM) return first.amslM;
    if (distanceM >= last.chainageM) return last.amslM;
    for (let i = 1; i < planned.length; i++) {
      const a = planned[i - 1];
      const b = planned[i];
      if (a === undefined || b === undefined) continue;
      if (distanceM >= a.chainageM && distanceM <= b.chainageM) {
        const span = b.chainageM - a.chainageM;
        const f = span > 0 ? (distanceM - a.chainageM) / span : 0;
        return a.amslM + (b.amslM - a.amslM) * f;
      }
    }
    return last.amslM;
  };

  const points: TerrainProfilePoint[] = [];
  for (const s of samples) {
    if (s.elevationM === undefined) continue;
    const amsl = plannedAt(s.distanceM);
    points.push({
      distanceM: s.distanceM,
      terrainM: s.elevationM,
      ...(amsl !== undefined ? { plannedAmslM: amsl } : {}),
    });
  }
  return points;
}

/** The composed Flight Plan screen. */
export const PlanScreen: Component<PlanScreenProps> = (props) => {
  const t = props.t ?? defaultT;
  const services = props.services;

  // --- shared plan state: one signal per kind -------------------------------
  // Plan data signals: use the injected session (persists across tab switches)
  // when supplied, else local signals.
  const session = props.session ?? createPlanSession();
  const { mission, setMission, fence, setFence, rally, setRally, surveyPolygon, setSurveyPolygon } =
    session;

  const [toolMode, setToolMode] = createSignal<PlanToolMode>('select');
  const [drawerTab, setDrawerTab] = createSignal<DrawerTab>('fence');
  const [verify, setVerify] = createSignal(true);
  const [status, setStatus] = createSignal<string>(t('plan.status.idle'));
  // E7: one transfer at a time — buttons disable while a transfer is in flight.
  const [transferBusy, setTransferBusy] = createSignal(false);
  const [profilePoints, setProfilePoints] = createSignal<readonly TerrainProfilePoint[]>([]);

  // --- map engine + editor + measure tools ----------------------------------
  const engine = (props.createEngine ?? defaultCreateEngine)(services);

  // Live basemap: repaint when the Maps setting changes (spec §5.6/§7.4). Only
  // when an app store is supplied (additive; mounts without a store are skipped).
  const planStore = props.store;
  if (planStore !== undefined) {
    const mapSource = planStore.select((s) => s.settings.mapSource);
    createEffect(() => {
      engine.setBasemap(basemapFromSettings(mapSource()));
    });
  }

  const getState = (): EditState => ({
    mission: mission(),
    fence: fence(),
    rally: rally(),
    surveyPolygon: surveyPolygon(),
  });
  const setState = (next: EditState): void => {
    setMission(next.mission);
    setFence(next.fence);
    setRally(next.rally);
    setSurveyPolygon(next.surveyPolygon);
  };

  const editor = createMapEditController({
    host: engine,
    getState,
    setState,
    getMode: () => toolMode(),
  });

  // Reactive settings selector (when a store is supplied): `store.select`
  // tracks updates, so the Measure readout honours the selected units live;
  // without a store everything stays metric.
  const settingsSel = planStore !== undefined ? planStore.select((s) => s.settings) : undefined;
  const unitFmt =
    settingsSel !== undefined ? createMemo(() => unitFormatterFor(settingsSel())) : undefined;
  // Map scale-bar unit system ('metric' | 'imperial'); metric without a store.
  const mapUnits = createMemo(() =>
    settingsSel !== undefined ? resolveUnits(settingsSel()).system : 'metric',
  );
  const toolsOptions: MapToolsOptions = {
    t,
    ...(unitFmt !== undefined
      ? {
          formatLength: (m: number): string => measureFormatters(unitFmt()).formatLength(m),
          formatArea: (m2: number): string => measureFormatters(unitFmt()).formatArea(m2),
        }
      : {}),
  };
  const tools: MapTools = createMapTools(engine, toolsOptions);

  // One-shot: center the plan map on the active vehicle/home (or the first real
  // mission/geofence point) so drawing surveys/fences happens at the vehicle's
  // location, not at null island (0,0). Needs the optional app store.
  const activeVehicle: Accessor<VehicleState | undefined> =
    props.store?.select((s) => (s.activeSysid === undefined ? undefined : s.vehicles[s.activeSysid])) ??
    ((): VehicleState | undefined => undefined);
  const autoCenterTarget = (): LatLon | undefined => {
    const v = activeVehicle();
    const loc = v?.position ?? v?.home;
    if (loc !== undefined && (loc.lat !== 0 || loc.lon !== 0)) return { lat: loc.lat, lon: loc.lon };
    for (const it of mission().items) {
      if (Number.isFinite(it.lat) && Number.isFinite(it.lon) && (it.lat !== 0 || it.lon !== 0)) {
        return { lat: it.lat, lon: it.lon };
      }
    }
    return undefined;
  };
  let didAutoCenter = false;
  createEffect(() => {
    if (didAutoCenter) return;
    const target = autoCenterTarget();
    if (target === undefined) return;
    engine.setView({ lat: target.lat, lon: target.lon, zoom: 16 });
    didAutoCenter = true;
  });

  // Measure tool drives the map-tools controller; all other modes leave it idle.
  createEffect(() => {
    tools.setMode(toolMode() === 'measure' ? 'measure-distance' : 'none');
  });

  const [measureSummary, setMeasureSummary] = createSignal(tools.measureSummary());
  const offToolsChange = tools.onChange(() => setMeasureSummary(tools.measureSummary()));
  // Refresh the readout when the selected units change (not just on point edits).
  if (unitFmt !== undefined) {
    createEffect(() => {
      unitFmt();
      setMeasureSummary(tools.measureSummary());
    });
  }

  let mapContainer!: HTMLDivElement;
  onMount(() => {
    editor.attach(mapContainer);
    engine.requestRedraw();
  });

  onCleanup(() => {
    offToolsChange();
    tools.dispose();
    editor.dispose();
    engine.detach();
  });

  // --- terrain profile: resample when the mission path changes --------------
  let profileToken = 0;
  createEffect(() => {
    const m = mission();
    const navPath: LatLon[] = m.items
      .filter((it) => commandHasPosition(it.command) && (it.lat !== 0 || it.lon !== 0))
      .map((it) => ({ lat: it.lat, lon: it.lon }));
    if (navPath.length < 2) {
      setProfilePoints([]);
      return;
    }
    const token = ++profileToken;
    void services.terrainProvider
      .pathProfile(navPath, PROFILE_SPACING_M)
      .then((samples) => {
        if (token !== profileToken) return;
        setProfilePoints(buildProfile(m, samples));
      })
      .catch(() => {
        if (token === profileToken) setProfilePoints([]);
      });
  });

  // --- transfer + file helpers ----------------------------------------------
  const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  // E7: refuse to start a transfer when the link is not open (store-supplied
  // mounts only); without a store the mock/offline path stays permissive.
  const transferReady = (): boolean => {
    if (planStore !== undefined && planStore.get().connection.kind !== 'open') {
      setStatus(t('plan.status.notConnected'));
      return false;
    }
    return true;
  };

  // E8: ask before replacing a non-empty edited mission. Permissive when no
  // confirm seam is wired, or when the user disabled destructive confirms.
  const confirmReplace = async (): Promise<boolean> => {
    const confirm = props.confirm;
    if (confirm === undefined) return true;
    if (mission().items.length === 0) return true;
    if (planStore !== undefined && !planStore.get().settings.confirmDestructive) return true;
    return confirm({
      title: t('plan.confirm.replaceTitle'),
      body: t('plan.confirm.replaceBody'),
      destructive: true,
    });
  };

  const uploadMission = (): void => {
    if (transferBusy() || !transferReady()) return;
    const wire = missionToWire(mission());
    setStatus(t('plan.status.uploading', { what: t('plan.what.mission'), i: 0, n: wire.items.length }));
    setTransferBusy(true);
    void services.mission
      .upload(wire, {
        verify: verify(),
        onProgress: (i, n) =>
          setStatus(t('plan.status.uploading', { what: t('plan.what.mission'), i, n })),
      })
      .then(() =>
        setStatus(t('plan.status.uploaded', { what: t('plan.what.mission'), n: wire.items.length })),
      )
      .catch((e: unknown) =>
        setStatus(t('plan.status.error', { what: t('plan.what.mission'), message: errMsg(e) })),
      )
      .finally(() => setTransferBusy(false));
  };

  const downloadMission = (): void => {
    if (transferBusy() || !transferReady()) return;
    setTransferBusy(true);
    void confirmReplace()
      .then(async (ok) => {
        if (!ok) {
          setStatus(t('plan.status.idle'));
          return;
        }
        setStatus(t('plan.status.downloading', { what: t('plan.what.mission'), i: 0, n: 0 }));
        const m = await services.mission.download('mission', (i, n) =>
          setStatus(t('plan.status.downloading', { what: t('plan.what.mission'), i, n })),
        );
        setMission(missionFromWire(m));
        setStatus(t('plan.status.downloaded', { what: t('plan.what.mission'), n: m.items.length }));
      })
      .catch((e: unknown) =>
        setStatus(t('plan.status.error', { what: t('plan.what.mission'), message: errMsg(e) })),
      )
      .finally(() => setTransferBusy(false));
  };

  const uploadFence = (): void => {
    if (transferBusy() || !transferReady()) return;
    const f = fence();
    const wire = fenceToMission(f);
    setStatus(t('plan.status.uploading', { what: t('plan.what.fence'), i: 0, n: wire.items.length }));
    setTransferBusy(true);
    void services.mission
      .upload(wire, { verify: verify() })
      .then(async () => {
        // E9: count failed FENCE_* parameter writes and surface them instead of
        // claiming an unconditional success.
        let failed = 0;
        for (const p of fenceParams(f)) {
          await services.param.set(p.name, p.value).catch(() => {
            failed += 1;
          });
        }
        const uploaded = t('plan.status.uploaded', { what: t('plan.what.fence'), n: wire.items.length });
        setStatus(
          failed > 0 ? `${uploaded} — ${t('plan.status.fenceParamsFailed', { n: failed })}` : uploaded,
        );
      })
      .catch((e: unknown) =>
        setStatus(t('plan.status.error', { what: t('plan.what.fence'), message: errMsg(e) })),
      )
      .finally(() => setTransferBusy(false));
  };

  const uploadRally = (): void => {
    if (transferBusy() || !transferReady()) return;
    const wire = rallyToMission(rally());
    setStatus(t('plan.status.uploading', { what: t('plan.what.rally'), i: 0, n: wire.items.length }));
    setTransferBusy(true);
    void services.mission
      .upload(wire, { verify: verify() })
      .then(() =>
        setStatus(t('plan.status.uploaded', { what: t('plan.what.rally'), n: wire.items.length })),
      )
      .catch((e: unknown) =>
        setStatus(t('plan.status.error', { what: t('plan.what.rally'), message: errMsg(e) })),
      )
      .finally(() => setTransferBusy(false));
  };

  // Parse an in-hand mission blob into the shared mission signal (the common
  // core for the file picker and the Recents pending-open path).
  const loadMissionBlob = async (name: string, blob: Blob): Promise<void> => {
    const text = await blob.text();
    const loaded = parseMissionContent(name, text);
    setMission(missionFromWire(loaded.mission));
    setStatus(t('plan.status.loaded', { name: loaded.name, n: loaded.mission.items.length }));
  };

  const openFile = (): void => {
    void (async (): Promise<void> => {
      if (!(await confirmReplace())) return;
      const picked = await services.files.openForRead([...MISSION_FILE_ACCEPT]);
      if (picked === undefined) return;
      await loadMissionBlob(picked.name, picked.blob);
      // Record the opened mission (with its blob) for App Settings → Recents.
      void props.recents?.record({ kind: 'plan', name: picked.name, blob: picked.blob });
    })().catch((e: unknown) =>
      setStatus(t('plan.status.error', { what: t('plan.what.mission'), message: errMsg(e) })),
    );
  };

  const saveFile = (format: 'wpl' | 'plan'): void => {
    const name = format === 'plan' ? 'mission.plan' : 'mission.waypoints';
    const wire = missionToWire(mission());
    const text = format === 'plan' ? serializePlan(buildPlan(wire)) : serializeWpl(wire);
    const blob = new Blob([text], { type: format === 'plan' ? PLAN_MIME : WPL_MIME });
    void services.files
      .saveAs(blob, name)
      .then(() => {
        setStatus(t('plan.status.saved', { name }));
        // Record the saved mission (with its blob) for App Settings → Recents.
        void props.recents?.record({ kind: 'plan', name, blob });
      })
      .catch((e: unknown) =>
        setStatus(t('plan.status.error', { what: t('plan.what.mission'), message: errMsg(e) })),
      );
  };

  // App Settings → Recents “Open”: load a cached `plan` blob when it appears,
  // then clear it so re-selecting the same entry re-triggers the load.
  createEffect(() => {
    const pending = props.pendingOpen?.();
    if (pending === undefined) return;
    void (async (): Promise<void> => {
      if (!(await confirmReplace())) return;
      await loadMissionBlob(pending.name, pending.blob);
    })()
      .catch((e: unknown) =>
        setStatus(t('plan.status.error', { what: t('plan.what.mission'), message: errMsg(e) })),
      )
      .finally(() => props.onPendingConsumed?.());
  });

  const onSurveyGenerate = (m: Mission): void => {
    void confirmReplace().then((ok) => {
      if (ok) setMission(missionFromWire(m));
    });
  };

  const hintKey = (): string => {
    const map: Record<PlanToolMode, string> = {
      select: 'plan.tool.hint.select',
      'add-waypoint': 'plan.tool.hint.addWaypoint',
      'draw-survey-polygon': 'plan.tool.hint.survey',
      'draw-fence-polygon': 'plan.tool.hint.fencePolygon',
      'draw-fence-circle': 'plan.tool.hint.fenceCircle',
      'place-rally': 'plan.tool.hint.rally',
      measure: 'plan.tool.hint.measure',
    };
    return map[toolMode()];
  };

  const surveyPolygonArray: Accessor<LatLon[]> = createMemo(() => surveyPolygon().map((v) => ({ ...v })));

  return (
    <section class="mvp-plan" role="region" aria-label={t('plan.screen.region.label')}>
      <header class="mvp-plan__toolbar" role="toolbar" aria-label={t('plan.toolbar.label')}>
        <label class="mvp-plan__verify">
          <input
            type="checkbox"
            data-testid="plan-verify"
            checked={verify()}
            onChange={(e) => setVerify(e.currentTarget.checked)}
          />
          <span>{t('plan.toolbar.verify')}</span>
        </label>
        <button type="button" class="mvp-plan__btn mvp-plan__btn--primary" data-testid="plan-upload-mission" disabled={transferBusy()} onClick={uploadMission}>
          {t('plan.toolbar.uploadMission')}
        </button>
        <button type="button" class="mvp-plan__btn" data-testid="plan-download-mission" disabled={transferBusy()} onClick={downloadMission}>
          {t('plan.toolbar.downloadMission')}
        </button>
        <button type="button" class="mvp-plan__btn" data-testid="plan-upload-fence" disabled={transferBusy()} onClick={uploadFence}>
          {t('plan.toolbar.uploadFence')}
        </button>
        <button type="button" class="mvp-plan__btn" data-testid="plan-upload-rally" disabled={transferBusy()} onClick={uploadRally}>
          {t('plan.toolbar.uploadRally')}
        </button>
        <span class="mvp-plan__sep" aria-hidden="true" />
        <button type="button" class="mvp-plan__btn" data-testid="plan-open" onClick={openFile}>
          {t('plan.toolbar.open')}
        </button>
        <button type="button" class="mvp-plan__btn" data-testid="plan-save-wpl" onClick={() => saveFile('wpl')}>
          {t('plan.toolbar.saveWpl')}
        </button>
        <button type="button" class="mvp-plan__btn" data-testid="plan-save-plan" onClick={() => saveFile('plan')}>
          {t('plan.toolbar.savePlan')}
        </button>
        <span class="mvp-plan__status" role="status" aria-live="polite" data-testid="plan-status">
          {status()}
        </span>
      </header>

      <div class="mvp-plan__body">
        <ToolRail mode={toolMode} onMode={setToolMode} onImport={openFile} t={t} />

        <div class="mvp-plan__map" ref={mapContainer} aria-label={t('plan.screen.map.label')}>
          <MapWidget engine={engine} t={t} units={mapUnits()} />
          <p class="mvp-plan__hint" data-testid="plan-hint">
            {t(hintKey())}
          </p>
          {/*
           * Only surface the measure summary/hint while the measure tool is
           * active; in select / edit / draw modes the bottom-left status would
           * otherwise linger with a stale "Click the map to measure" prompt.
           * The <p> stays mounted as an empty `aria-live` region so entering
           * and leaving measure mode is announced (and cleared) correctly.
           */}
          <p class="mvp-plan__measure" data-testid="plan-measure" aria-live="polite">
            {toolMode() === 'measure' ? t('plan.toolbar.measure', { value: measureSummary() }) : ''}
          </p>
        </div>

        <aside class="mvp-plan__side" aria-label={t('plan.screen.table.label')}>
          <div class="mvp-plan__table" data-testid="plan-table">
            <WaypointTable model={mission} onChange={setMission} t={t} />
          </div>

          <div class="mvp-plan__drawer" aria-label={t('plan.screen.drawer.label')}>
            <div class="mvp-plan__tabs" role="tablist" aria-label={t('plan.screen.drawer.label')}>
              <button
                type="button"
                role="tab"
                class="mvp-plan__tab"
                classList={{ 'mvp-plan__tab--active': drawerTab() === 'fence' }}
                aria-selected={drawerTab() === 'fence'}
                data-testid="plan-tab-fence"
                onClick={() => setDrawerTab('fence')}
              >
                {t('plan.drawer.fence')}
              </button>
              <button
                type="button"
                role="tab"
                class="mvp-plan__tab"
                classList={{ 'mvp-plan__tab--active': drawerTab() === 'rally' }}
                aria-selected={drawerTab() === 'rally'}
                data-testid="plan-tab-rally"
                onClick={() => setDrawerTab('rally')}
              >
                {t('plan.drawer.rally')}
              </button>
              <button
                type="button"
                role="tab"
                class="mvp-plan__tab"
                classList={{ 'mvp-plan__tab--active': drawerTab() === 'survey' }}
                aria-selected={drawerTab() === 'survey'}
                data-testid="plan-tab-survey"
                onClick={() => setDrawerTab('survey')}
              >
                {t('plan.drawer.survey')}
              </button>
            </div>

            <div class="mvp-plan__drawer-body">
              {drawerTab() === 'fence' && <FencePanel value={fence} onChange={setFence} t={t} />}
              {drawerTab() === 'rally' && <RallyPanel model={rally} onChange={setRally} t={t} />}
              {drawerTab() === 'survey' && (
                <SurveyPanel
                  polygon={surveyPolygonArray()}
                  onGenerate={onSurveyGenerate}
                  t={t}
                  config={session.surveyConfig}
                  setConfig={session.setSurveyConfig}
                />
              )}
            </div>
          </div>
        </aside>
      </div>

      <section class="mvp-plan__profile" aria-label={t('plan.screen.profile.label')}>
        <TerrainProfile points={profilePoints()} t={t} />
      </section>
    </section>
  );
};
