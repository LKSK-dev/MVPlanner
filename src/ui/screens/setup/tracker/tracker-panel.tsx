/**
 * Antenna-tracker panel (task T8.9; spec plan/04 §4.12).
 *
 * Renders the tracker status (connection, system id, pointing solution), a
 * compass-style pointing display (a needle toward the active vehicle plus the
 * tracker's actual heading), a position-feed toggle, and a config form bound to
 * the {@link TrackerService}'s `ParamClient`. All logic lives in the service;
 * this component is presentational + wiring.
 */
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
  type JSX,
} from 'solid-js';
import { t as defaultT } from '../../../../core/i18n';
import type { TFn } from '../framework';
import { TRACKER_CONFIG_FIELDS, type TrackerConfig, type TrackerParamName } from './config';
import type { TrackerService, TrackerState } from './tracker-service';
import './messages';
import './tracker.css';

/** Props for {@link TrackerPanel}. */
export interface TrackerPanelProps {
  /** The antenna-tracker service (detection / pointing / feed / config). */
  readonly service: TrackerService;
  /** Optional translator; defaults to the app i18n `t`. */
  readonly t?: TFn;
  /** Position-feed cadence in Hz while the feed is enabled (default 1 Hz). */
  readonly feedHz?: number;
}

/** Parse a finite number from an input/select value; `undefined` otherwise. */
function parseNumber(raw: string): number | undefined {
  const value = Number.parseFloat(raw.trim());
  return Number.isFinite(value) ? value : undefined;
}

/** Format a value for a controlled numeric input without trailing zeroes. */
function formatInputNumber(value: number): string {
  return Number(value.toPrecision(8)).toString();
}

/** Antenna-tracker status + compass + feed + config panel. */
export const TrackerPanel: Component<TrackerPanelProps> = (props) => {
  const t = props.t ?? defaultT;
  const feedHz = props.feedHz ?? 1;

  const [state, setState] = createSignal<TrackerState>(props.service.getState());
  const [feeding, setFeeding] = createSignal(false);
  const [config, setConfig] = createSignal<TrackerConfig | undefined>(
    props.service.canConfigure ? props.service.getConfig() : undefined,
  );
  const [configStatus, setConfigStatus] = createSignal(
    props.service.canConfigure
      ? t('tracker.config.status.ready')
      : t('tracker.config.status.noParams'),
  );

  const offChange = props.service.onChange(setState);
  onCleanup(offChange);

  // Re-evaluate connection staleness on a slow timer so a silent tracker drops.
  onMount(() => {
    const id = setInterval((): void => props.service.refreshConnection(), 1000);
    onCleanup(() => clearInterval(id));
  });

  // Position feed: a rate-limited interval calling the service while enabled.
  let feedTimer: ReturnType<typeof setInterval> | undefined;
  const stopFeed = (): void => {
    if (feedTimer !== undefined) {
      clearInterval(feedTimer);
      feedTimer = undefined;
    }
  };
  onCleanup(stopFeed);
  const toggleFeed = (on: boolean): void => {
    setFeeding(on);
    stopFeed();
    if (on) {
      const periodMs = Math.max(50, Math.round(1000 / feedHz));
      feedTimer = setInterval((): void => void props.service.feedVehiclePosition(), periodMs);
    }
  };

  const writeConfig = (param: TrackerParamName, value: number): void => {
    setConfig((prev) => (prev !== undefined ? { ...prev, [param]: value } : prev));
    void props.service
      .setConfig(param, value)
      .then(() => setConfigStatus(t('tracker.config.status.wrote', { param })))
      .catch((err: unknown) =>
        setConfigStatus(
          t('tracker.config.status.error', {
            message: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
  };

  const solution = createMemo(() => state().solution);
  const targetLabel = createMemo(() => {
    const target = state().target;
    return target !== undefined
      ? t('tracker.status.system', { sysid: target.sysid, compid: target.compid })
      : '';
  });

  const degrees = (value: number): string =>
    t('tracker.units.degrees', { value: value.toFixed(1) });
  const metres = (value: number): string => t('tracker.units.metres', { value: value.toFixed(0) });

  const metric = (labelKey: string, value: string, testId: string): JSX.Element => (
    <div class="mvp-tracker__metric">
      <span class="mvp-tracker__metric-label">{t(labelKey)}</span>
      <span class="mvp-tracker__metric-value" data-testid={testId}>
        {value}
      </span>
    </div>
  );

  return (
    <section class="mvp-tracker" aria-label={t('tracker.title')}>
      <p class="mvp-tracker__intro">{t('tracker.description')}</p>

      <div class="mvp-tracker__section" data-testid="tracker-status">
        <h3 class="mvp-tracker__section-title">{t('tracker.status.title')}</h3>
        <p>
          <span
            class={`mvp-tracker__badge ${state().connected ? 'mvp-tracker__badge--on' : 'mvp-tracker__badge--off'}`}
            data-testid="tracker-connected"
          >
            {state().connected ? t('tracker.status.connected') : t('tracker.status.disconnected')}
          </span>
          <Show when={targetLabel().length > 0}>
            {' '}
            <span data-testid="tracker-system">{targetLabel()}</span>
          </Show>
        </p>

        <Show
          when={solution()}
          fallback={<p class="mvp-tracker__empty">{t('tracker.status.noVehicle')}</p>}
        >
          {(sol) => (
            <>
              <div class="mvp-tracker__readout">
                {metric('tracker.status.azimuth', degrees(sol().azimuthDeg), 'tracker-azimuth')}
                {metric(
                  'tracker.status.elevation',
                  degrees(sol().elevationDeg),
                  'tracker-elevation',
                )}
                {metric('tracker.status.distance', metres(sol().distanceM), 'tracker-distance')}
              </div>
              <div
                class="mvp-tracker__compass"
                role="img"
                aria-label={t('tracker.compass.label')}
                data-testid="tracker-compass"
              >
                <span class="mvp-tracker__north">N</span>
                <div
                  class="mvp-tracker__needle"
                  style={{ transform: `rotate(${sol().azimuthDeg}deg)` }}
                  data-testid="tracker-needle-solution"
                />
                <Show when={state().attitude}>
                  {(att) => (
                    <div
                      class="mvp-tracker__needle mvp-tracker__needle--target"
                      style={{ transform: `rotate(${att().azimuthDeg}deg)` }}
                      data-testid="tracker-needle-actual"
                    />
                  )}
                </Show>
              </div>
            </>
          )}
        </Show>
      </div>

      <div class="mvp-tracker__section" data-testid="tracker-feed">
        <h3 class="mvp-tracker__section-title">{t('tracker.feed.title')}</h3>
        <label class="mvp-tracker__toggle">
          <input
            type="checkbox"
            data-testid="tracker-feed-toggle"
            checked={feeding()}
            onChange={(event): void => toggleFeed(event.currentTarget.checked)}
          />
          <span>{t('tracker.feed.enable')}</span>
        </label>
        <p class="mvp-tracker__status" role="status" aria-live="polite">
          {feeding() ? t('tracker.feed.on', { hz: feedHz }) : t('tracker.feed.off')}
        </p>
      </div>

      <div class="mvp-tracker__section" data-testid="tracker-config">
        <h3 class="mvp-tracker__section-title">{t('tracker.config.title')}</h3>
        <Show
          when={config()}
          fallback={<p class="mvp-tracker__empty">{t('tracker.config.status.noParams')}</p>}
        >
          {(values) => (
            <div class="mvp-tracker__grid">
              <For each={TRACKER_CONFIG_FIELDS}>
                {(field) => (
                  <label class="mvp-tracker__field">
                    <span class="mvp-tracker__label">{t(field.labelKey)}</span>
                    <Show
                      when={field.kind === 'enum' && field.options !== undefined}
                      fallback={
                        <input
                          class="mvp-tracker__input"
                          type="number"
                          step={field.step ?? '1'}
                          data-testid={`tracker-config-${field.param}`}
                          value={formatInputNumber(values()[field.param])}
                          onChange={(event): void => {
                            const value = parseNumber(event.currentTarget.value);
                            if (value !== undefined) writeConfig(field.param, value);
                          }}
                        />
                      }
                    >
                      <select
                        class="mvp-tracker__select"
                        data-testid={`tracker-config-${field.param}`}
                        value={String(values()[field.param])}
                        onChange={(event): void => {
                          const value = parseNumber(event.currentTarget.value);
                          if (value !== undefined) writeConfig(field.param, value);
                        }}
                      >
                        <For each={field.options ?? []}>
                          {(opt) => <option value={String(opt.value)}>{t(opt.labelKey)}</option>}
                        </For>
                      </select>
                    </Show>
                  </label>
                )}
              </For>
            </div>
          )}
        </Show>
        <p class="mvp-tracker__status" role="status" aria-live="polite">
          {configStatus()}
        </p>
      </div>
    </section>
  );
};
