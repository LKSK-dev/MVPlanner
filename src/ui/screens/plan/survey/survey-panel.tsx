/**
 * Survey / grid configuration panel (task T4.5; spec plan/04 §4.3 survey/grid,
 * plan/05 §5.3 Plan).
 *
 * Edits the camera/sensor model, overlap, altitude and grid angle and shows the
 * **live** survey estimates (GSD, line spacing, trigger distance, line/photo
 * count, area, path length, flight time) computed purely by `geo/survey`. The
 * survey **polygon** is owned by the map editor (T4.4) and injected via
 * {@link SurveyPanelProps.polygon}; the **Generate** action hands the resulting
 * {@link Mission} back via {@link SurveyPanelProps.onGenerate}. Both are injected
 * so the panel unit-tests without a map or mission service.
 */
import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { t as defaultT } from '../../../../core/i18n';
import type { Mission } from '../../../../contracts';
import type { LatLon } from '../../../../geo/format';
import {
  DEFAULT_CAMERA,
  generateGrid,
  surveyToMission,
  type CameraModel,
  type SurveyGrid,
  type SurveyOptions,
} from '../../../../geo/survey';
import './messages';
import './survey.css';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** {@link SurveyPanel} props. */
export interface SurveyPanelProps {
  /** Survey polygon (WGS84), supplied by the map editor; `< 3` disables generate. */
  polygon: LatLon[];
  /** Called with the generated mission when the user clicks Generate. */
  onGenerate: (mission: Mission) => void;
  /** i18n translate function (default the app `t`). */
  t?: TFn;
  /** Optional initial camera/coverage/layout values. */
  initial?: Partial<SurveyConfig>;
}

/** The editable survey configuration backing the panel inputs. */
export interface SurveyConfig {
  camera: CameraModel;
  altitudeM: number;
  frontlapPct: number;
  sidelapPct: number;
  angleDeg: number;
  speedMs: number;
  cameraTrigger: boolean;
}

/** Built-in defaults (DJI Phantom 4 Pro camera, typical mapping overlaps). */
const DEFAULT_CONFIG: SurveyConfig = {
  camera: { ...DEFAULT_CAMERA },
  altitudeM: 100,
  frontlapPct: 75,
  sidelapPct: 65,
  angleDeg: 0,
  speedMs: 10,
  cameraTrigger: true,
};

/** Parse a numeric input, falling back to `prev` when the text is not finite. */
function num(raw: string, prev: number): number {
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) ? v : prev;
}

/** Round to `digits` decimals for display. */
function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** The Survey / grid configuration panel. */
export const SurveyPanel: Component<SurveyPanelProps> = (props) => {
  const t = props.t ?? defaultT;
  const [config, setConfig] = createSignal<SurveyConfig>({
    ...DEFAULT_CONFIG,
    ...props.initial,
    camera: { ...DEFAULT_CONFIG.camera, ...props.initial?.camera },
  });

  const patch = (mutate: (draft: SurveyConfig) => void): void => {
    setConfig((prev) => {
      const next: SurveyConfig = { ...prev, camera: { ...prev.camera } };
      mutate(next);
      return next;
    });
  };
  const patchCamera = (key: keyof CameraModel, raw: string): void => {
    patch((c) => {
      c.camera[key] = num(raw, c.camera[key]);
    });
  };

  /** Options derived from the current config for `geo/survey`. */
  const options = createMemo<SurveyOptions>(() => {
    const c = config();
    return {
      sensor: { kind: 'camera', camera: c.camera, altitudeM: c.altitudeM },
      frontlapPct: c.frontlapPct,
      sidelapPct: c.sidelapPct,
      angleDeg: c.angleDeg,
      speedMs: c.speedMs,
    };
  });

  /** The live grid, or an error message when generation is not possible. */
  const result = createMemo<{ grid: SurveyGrid } | { error: string }>(() => {
    if (props.polygon.length < 3) return { error: t('survey.needPolygon') };
    try {
      return { grid: generateGrid(props.polygon, options()) };
    } catch {
      return { error: t('survey.invalid') };
    }
  });

  const grid = (): SurveyGrid | undefined => {
    const r = result();
    return 'grid' in r ? r.grid : undefined;
  };

  const onGenerate = (): void => {
    const g = grid();
    if (g === undefined) return;
    props.onGenerate(surveyToMission(g, { cameraTrigger: config().cameraTrigger }));
  };

  // --- field descriptors --------------------------------------------------
  const cameraFields: Array<{ key: keyof CameraModel; label: string; step: string }> = [
    { key: 'sensorWidthMm', label: 'survey.camera.sensorWidth', step: '0.1' },
    { key: 'sensorHeightMm', label: 'survey.camera.sensorHeight', step: '0.1' },
    { key: 'focalLengthMm', label: 'survey.camera.focalLength', step: '0.1' },
    { key: 'imageWidthPx', label: 'survey.camera.imageWidth', step: '1' },
    { key: 'imageHeightPx', label: 'survey.camera.imageHeight', step: '1' },
  ];

  return (
    <section class="mvp-survey" role="region" aria-label={t('survey.region.label')}>
      {/* Camera ------------------------------------------------------------ */}
      <section class="mvp-survey__section" aria-label={t('survey.section.camera')}>
        <h2 class="mvp-survey__heading">{t('survey.section.camera')}</h2>
        <For each={cameraFields}>
          {(field) => (
            <label class="mvp-survey__field">
              <span class="mvp-survey__label">{t(field.label)}</span>
              <input
                type="number"
                min="0"
                step={field.step}
                class="mvp-survey__input"
                data-testid={`survey-${field.key}`}
                value={config().camera[field.key]}
                onInput={(e) => patchCamera(field.key, e.currentTarget.value)}
              />
            </label>
          )}
        </For>
      </section>

      {/* Coverage ---------------------------------------------------------- */}
      <section class="mvp-survey__section" aria-label={t('survey.section.coverage')}>
        <h2 class="mvp-survey__heading">{t('survey.section.coverage')}</h2>
        <label class="mvp-survey__field">
          <span class="mvp-survey__label">{t('survey.coverage.altitude')}</span>
          <input
            type="number"
            min="0"
            step="1"
            class="mvp-survey__input"
            data-testid="survey-altitude"
            value={config().altitudeM}
            onInput={(e) => patch((c) => (c.altitudeM = num(e.currentTarget.value, c.altitudeM)))}
          />
        </label>
        <label class="mvp-survey__field">
          <span class="mvp-survey__label">{t('survey.coverage.frontlap')}</span>
          <input
            type="number"
            min="0"
            max="99"
            step="1"
            class="mvp-survey__input"
            data-testid="survey-frontlap"
            value={config().frontlapPct}
            onInput={(e) => patch((c) => (c.frontlapPct = num(e.currentTarget.value, c.frontlapPct)))}
          />
        </label>
        <label class="mvp-survey__field">
          <span class="mvp-survey__label">{t('survey.coverage.sidelap')}</span>
          <input
            type="number"
            min="0"
            max="99"
            step="1"
            class="mvp-survey__input"
            data-testid="survey-sidelap"
            value={config().sidelapPct}
            onInput={(e) => patch((c) => (c.sidelapPct = num(e.currentTarget.value, c.sidelapPct)))}
          />
        </label>
      </section>

      {/* Layout ------------------------------------------------------------ */}
      <section class="mvp-survey__section" aria-label={t('survey.section.layout')}>
        <h2 class="mvp-survey__heading">{t('survey.section.layout')}</h2>
        <label class="mvp-survey__field">
          <span class="mvp-survey__label">{t('survey.layout.angle')}</span>
          <input
            type="number"
            step="1"
            class="mvp-survey__input"
            data-testid="survey-angle"
            value={config().angleDeg}
            onInput={(e) => patch((c) => (c.angleDeg = num(e.currentTarget.value, c.angleDeg)))}
          />
        </label>
        <label class="mvp-survey__field">
          <span class="mvp-survey__label">{t('survey.layout.speed')}</span>
          <input
            type="number"
            min="0"
            step="0.5"
            class="mvp-survey__input"
            data-testid="survey-speed"
            value={config().speedMs}
            onInput={(e) => patch((c) => (c.speedMs = num(e.currentTarget.value, c.speedMs)))}
          />
        </label>
        <label class="mvp-survey__check">
          <input
            type="checkbox"
            data-testid="survey-trigger"
            checked={config().cameraTrigger}
            onChange={(e) => patch((c) => (c.cameraTrigger = e.currentTarget.checked))}
          />
          <span class="mvp-survey__label">{t('survey.layout.cameraTrigger')}</span>
        </label>
      </section>

      {/* Estimates --------------------------------------------------------- */}
      <section class="mvp-survey__section" aria-label={t('survey.section.estimates')}>
        <h2 class="mvp-survey__heading">{t('survey.section.estimates')}</h2>
        <Show
          when={grid()}
          fallback={
            <p class="mvp-survey__hint" data-testid="survey-status">
              {'error' in result() ? (result() as { error: string }).error : ''}
            </p>
          }
        >
          {(g) => (
            <dl class="mvp-survey__estimates" data-testid="survey-estimates">
              <dt>{t('survey.estimate.gsd')}</dt>
              <dd data-testid="survey-est-gsd">
                {t('survey.estimate.gsdValue', { cm: round(g().estimates.gsdM * 100, 2) })}
              </dd>
              <dt>{t('survey.estimate.lineSpacing')}</dt>
              <dd>{t('survey.estimate.meters', { n: round(g().estimates.lineSpacingM) })}</dd>
              <dt>{t('survey.estimate.triggerDistance')}</dt>
              <dd>{t('survey.estimate.meters', { n: round(g().estimates.triggerDistanceM) })}</dd>
              <dt>{t('survey.estimate.lineCount')}</dt>
              <dd data-testid="survey-est-lines">{g().estimates.lineCount}</dd>
              <dt>{t('survey.estimate.photoCount')}</dt>
              <dd data-testid="survey-est-photos">{g().estimates.photoCount}</dd>
              <dt>{t('survey.estimate.area')}</dt>
              <dd>{t('survey.estimate.hectares', { n: round(g().estimates.coveredAreaM2 / 1e4, 2) })}</dd>
              <dt>{t('survey.estimate.pathLength')}</dt>
              <dd>{t('survey.estimate.meters', { n: round(g().estimates.pathLengthM) })}</dd>
              <dt>{t('survey.estimate.duration')}</dt>
              <dd>{t('survey.estimate.minutes', { n: round(g().estimates.durationS / 60) })}</dd>
            </dl>
          )}
        </Show>
      </section>

      <div class="mvp-survey__actions">
        <button
          type="button"
          class="mvp-survey__btn"
          data-testid="survey-generate"
          disabled={grid() === undefined}
          onClick={onGenerate}
        >
          {t('survey.generate')}
        </button>
      </div>
    </section>
  );
};
