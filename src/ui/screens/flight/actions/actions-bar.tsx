/**
 * {@link ActionsBar} — the Flight quick-actions bar (task T2.7; spec plan/04
 * §4.2 Actions, plan/05 §5.4/§5.8).
 *
 * Renders the spec §4.2 quick actions as labelled buttons (plus a vehicle-aware
 * mode picker), gathers any numeric arguments via an injected `prompt` seam, and
 * routes every press through {@link runAction} (confirm→command→audit). Gating
 * (`disabled`) is reactive off the active-vehicle accessor, so e.g. takeoff is
 * only enabled when armed and emergency-stop is always available with a vehicle.
 *
 * Fully injected ({@link ActionsBarProps}) so it unit-tests against a mock
 * command client, a mock confirm and a real audit log — no real host. The
 * coordinate-driven actions (`guidedGoto`, `setRoi`) are issued from the map
 * layer via {@link runAction}; the bar exposes their state-free siblings
 * (`changeAlt`, `clearRoi`) plus the buttons that need no map pick.
 */
import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { ACTIONS, modeNamesFor } from './catalog';
import { gateContextFor, runAction } from './run';
import type {
  ActionArgs,
  ActionId,
  ActionOutcome,
  ActionVehicle,
  ActionsDeps,
  ConfirmFn,
  TFn,
} from './types';
import type { AuditLog, AuditOrigin } from '../../../../core/audit';
import type { CommandClient } from '../../../../contracts';

/** Default takeoff altitude (m) offered in the prompt. */
const DEFAULT_TAKEOFF_ALT_M = 10;

/** A numeric-prompt seam (defaults to `window.prompt`). */
export type PromptFn = (message: string, defaultValue?: string) => string | null;

/** Props for {@link ActionsBar}. */
export interface ActionsBarProps {
  /** The command microservice (frozen {@link CommandClient} contract). */
  command: CommandClient;
  /** Safety-confirm seam ({@link import('../../../../contracts').UiRegistry.confirm}). */
  confirm: ConfirmFn;
  /** Audit log to record action start + result. */
  audit: AuditLog;
  /** Reactive accessor for the active vehicle (drives gating + armed-aware confirm). */
  vehicle: () => ActionVehicle | undefined;
  /** i18n translate function. */
  t: TFn;
  /** Audit origin (defaults to `'ui'`). */
  origin?: AuditOrigin;
  /** Clock for audit timestamps (defaults to `Date.now`). */
  now?: () => number;
  /** Numeric-prompt seam (defaults to `window.prompt`). */
  prompt?: PromptFn;
  /** Called after every dispatched action with its outcome. */
  onOutcome?: (id: ActionId, outcome: ActionOutcome) => void;
}

/** Plain (no-argument) actions rendered as buttons, in display order. */
const PLAIN_ACTIONS: readonly ActionId[] = [
  'arm',
  'disarm',
  'land',
  'rtl',
  'loiter',
  'auto',
  'pause',
  'resume',
  'restartMission',
  'clearRoi',
];

/** Default prompt seam backed by the host `window.prompt` (null when absent). */
const defaultPrompt: PromptFn = (message, defaultValue) =>
  typeof window !== 'undefined' && typeof window.prompt === 'function'
    ? window.prompt(message, defaultValue)
    : null;

/** The Flight quick-actions bar. */
export const ActionsBar: Component<ActionsBarProps> = (props) => {
  const t = props.t;
  const [selectedMode, setSelectedMode] = createSignal('');

  const deps = (): ActionsDeps => ({
    command: props.command,
    confirm: props.confirm,
    audit: props.audit,
    getActiveVehicle: props.vehicle,
    t: props.t,
    ...(props.now !== undefined ? { now: props.now } : {}),
    ...(props.origin !== undefined ? { origin: props.origin } : {}),
  });

  const gate = createMemo(() => gateContextFor(props.vehicle()));
  const enabled = (id: ActionId): boolean => ACTIONS[id].isEnabled(gate());
  const modes = createMemo<readonly string[]>(() => modeNamesFor(props.vehicle()?.vehicleClass));

  const promptFn = (): PromptFn => props.prompt ?? defaultPrompt;

  /** Prompt for a number; `undefined` when cancelled or not parseable. */
  const promptNumber = (key: string, defaultValue?: string): number | undefined => {
    const raw = promptFn()(t(key), defaultValue);
    if (raw === null) return undefined;
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : undefined;
  };

  const dispatch = (id: ActionId, args: ActionArgs = {}): void => {
    void runAction(deps(), id, args).then((outcome) => props.onOutcome?.(id, outcome));
  };

  const onTakeoff = (): void => {
    const altM = promptNumber('actions.prompt.takeoffAlt', String(DEFAULT_TAKEOFF_ALT_M));
    if (altM !== undefined) dispatch('takeoff', { altM });
  };

  const onChangeAlt = (): void => {
    const altM = promptNumber('actions.prompt.changeAlt');
    if (altM === undefined) return;
    const pos = props.vehicle()?.position;
    dispatch('guidedChangeAlt', {
      altM,
      ...(pos !== undefined ? { lat: pos.lat, lon: pos.lon } : {}),
    });
  };

  const onChangeSpeed = (): void => {
    const speedMs = promptNumber('actions.prompt.changeSpeed');
    if (speedMs !== undefined) dispatch('changeSpeed', { speedMs });
  };

  const onSetCurrentWp = (): void => {
    const seq = promptNumber('actions.prompt.setCurrentWp', '0');
    if (seq !== undefined) dispatch('setCurrentWp', { seq: Math.trunc(seq) });
  };

  const onApplyMode = (): void => {
    const mode = selectedMode();
    if (mode !== '') dispatch('setMode', { mode });
  };

  return (
    <section class="mvp-actions" role="region" aria-label={t('actions.region.label')}>
      <h2 class="mvp-actions__title">{t('actions.title')}</h2>

      <div class="mvp-actions__grid">
        <For each={PLAIN_ACTIONS}>
          {(id) => (
            <button
              type="button"
              class="mvp-actions__btn"
              data-action={id}
              disabled={!enabled(id)}
              aria-label={t(ACTIONS[id].labelKey)}
              onClick={() => dispatch(id)}
            >
              {t(ACTIONS[id].labelKey)}
            </button>
          )}
        </For>

        <button
          type="button"
          class="mvp-actions__btn"
          data-action="takeoff"
          disabled={!enabled('takeoff')}
          aria-label={t('actions.takeoff')}
          onClick={onTakeoff}
        >
          {t('actions.takeoff')}
        </button>

        <button
          type="button"
          class="mvp-actions__btn"
          data-action="changeSpeed"
          disabled={!enabled('changeSpeed')}
          aria-label={t('actions.changeSpeed')}
          onClick={onChangeSpeed}
        >
          {t('actions.changeSpeed')}
        </button>

        <button
          type="button"
          class="mvp-actions__btn"
          data-action="guidedChangeAlt"
          disabled={!enabled('guidedChangeAlt')}
          aria-label={t('actions.guidedChangeAlt')}
          onClick={onChangeAlt}
        >
          {t('actions.guidedChangeAlt')}
        </button>

        <button
          type="button"
          class="mvp-actions__btn"
          data-action="setCurrentWp"
          disabled={!enabled('setCurrentWp')}
          aria-label={t('actions.setCurrentWp')}
          onClick={onSetCurrentWp}
        >
          {t('actions.setCurrentWp')}
        </button>
      </div>

      <div class="mvp-actions__mode">
        <label class="mvp-actions__mode-field">
          <span class="mvp-actions__mode-label">{t('actions.mode.label')}</span>
          <select
            class="mvp-actions__mode-select"
            aria-label={t('actions.mode.label')}
            disabled={!enabled('setMode') || modes().length === 0}
            value={selectedMode()}
            onChange={(e) => setSelectedMode(e.currentTarget.value)}
          >
            <option value="">{t('actions.mode.placeholder')}</option>
            <For each={modes()}>{(m) => <option value={m}>{m}</option>}</For>
          </select>
        </label>
        <button
          type="button"
          class="mvp-actions__btn"
          data-action="setMode"
          disabled={!enabled('setMode') || selectedMode() === ''}
          aria-label={t('actions.mode.apply')}
          onClick={onApplyMode}
        >
          {t('actions.mode.apply')}
        </button>
      </div>

      <Show when={enabled('emergencyStop') || props.vehicle() !== undefined}>
        <button
          type="button"
          class="mvp-actions__btn mvp-actions__btn--danger"
          data-action="emergencyStop"
          disabled={!enabled('emergencyStop')}
          aria-label={t('actions.emergencyStop')}
          onClick={() => dispatch('emergencyStop')}
        >
          {t('actions.emergencyStop')}
        </button>
      </Show>
    </section>
  );
};
