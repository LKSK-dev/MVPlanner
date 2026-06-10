/**
 * Setup screen assembly (task T5.12; spec plan/04 §4.4, plan/05 §5.4 Setup —
 * "left list of setup steps with completion state; right pane is a guided wizard
 * with live feedback"). This is the M5 keystone: it composes the eight per-step
 * factories (T5.3–T5.10) into the ordered {@link SetupStep} registry and renders
 * the reusable {@link WizardShell} (T5.2). It owns no calibration/param logic —
 * every step brings its own; the assembly only wires the shared services + store
 * into each factory's declared dependencies.
 *
 * Step order mirrors a sensible first-time-setup flow (spec plan/04 §4.4):
 * frame → accel → compass → radio → modes → failsafe → battery → motors.
 *
 * The steps read parameters via the shared {@link ParamClient}'s cached `get` /
 * `onChange`. Because that cache is populated by `fetchAll` (or any incoming
 * `PARAM_VALUE`), the assembly adds a "Fetch parameters" affordance above the
 * wizard so the whole set can be (re)loaded with a global progress readout — the
 * param-driven steps (frame/modes/failsafe/battery) would otherwise render empty
 * until the user visits Config. The default-active frame step also loads the set
 * on its own mount, so opening Setup populates the cache without extra clicks.
 *
 * Mounted imperatively by {@link import('./register').createSetupScreenPanel} via
 * `render()`, capturing the services by closure — the screen never relies on a
 * provider an imperative mount cannot see (same pattern as Flight/Config/Plan).
 */
import { Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import type {
  AppState,
  CalibrationClient,
  CommandClient,
  ParamClient,
  Store,
  UiRegistry,
  VehicleClass,
  VehicleState,
} from '../../../contracts';
import { WizardShell, type SettledStatus, type SetupStep, type TFn } from './framework';
import { createFrameStep, FRAME_PARAM_NAMES } from './frame';
import { createAccelStep } from './accel';
import { createCompassStep } from './compass';
import { createRadioStep } from './radio';
import { createModesStep, FLIGHT_MODE_PARAM_NAMES } from './modes';
import { createFailsafeStep, FAILSAFE_PARAM_NAMES } from './failsafe';
import { createBatteryStep } from './battery';
import { createMotorsStep } from './motors';
import { registerSetupScreenMessages } from './messages';
import './framework/wizard-shell.css';
import './accel/accel-setup.css';
import './compass/compass-setup.css';
import './radio/radio.css';
import './battery/battery.css';
import './motors/motors.css';
import './setup-screen.css';

registerSetupScreenMessages();

/**
 * Module-level Setup session: the manual "Mark complete" overrides live here
 * (mirroring the plan screen's session pattern) so they survive screen
 * remounts — a wizard-local signal would reset on every Setup mount (E15).
 */
const [sessionOverrides, setSessionOverrides] = createSignal<ReadonlyMap<string, SettledStatus>>(
  new Map<string, SettledStatus>(),
);

/**
 * Representative parameter names spanning the param-driven steps. If ANY is
 * already in the shared cache the wizard has data to show, so the assembly skips
 * the auto-fetch on mount (a populated-cache probe — there is no cache-size seam).
 */
const PROBE_PARAMS: readonly string[] = [
  ...FRAME_PARAM_NAMES,
  ...FLIGHT_MODE_PARAM_NAMES,
  ...FAILSAFE_PARAM_NAMES,
];

/** Construction dependencies for {@link SetupScreen}. */
export interface SetupScreenProps {
  /** Calibration microservice (accel/compass/radio steps). */
  readonly calibration: CalibrationClient;
  /** Shared parameter microservice (frame/modes/failsafe/battery/radio steps). */
  readonly param: ParamClient;
  /** Command microservice (motors/ESC step, narrowed to `send` by the step). */
  readonly command: CommandClient;
  /** Shared app store (active-vehicle class + armed state). */
  readonly store: Store<AppState>;
  /** Destructive-action confirmation gate (armed-aware; motor test step). */
  readonly confirm: UiRegistry['confirm'];
  /** i18n translate function. */
  readonly t: TFn;
}

/** Current parameter-fetch progress. */
interface FetchProgress {
  readonly done: number;
  readonly total: number;
}

/**
 * The composed Setup screen: a small parameter-fetch bar above the
 * {@link WizardShell} with the eight ordered steps.
 */
export const SetupScreen: Component<SetupScreenProps> = (props) => {
  const t = props.t;

  // Reactive active vehicle: () => store.vehicles[store.activeSysid].
  const activeVehicle = props.store.select<VehicleState | undefined>((s) => {
    if (s.activeSysid === undefined) return undefined;
    return s.vehicles[s.activeSysid];
  });
  const getVehicleClass = (): VehicleClass => activeVehicle()?.vehicleClass ?? 'copter';
  const getArmed = (): boolean => activeVehicle()?.armed ?? false;

  // Build the ordered step registry ONCE (each factory owns its own flow state).
  const steps: readonly SetupStep[] = [
    createFrameStep({ params: props.param, getVehicleClass }),
    createAccelStep({ calibration: props.calibration }),
    createCompassStep({ calibration: props.calibration, params: props.param }),
    createRadioStep({ calibration: props.calibration, params: props.param }),
    createModesStep({ params: props.param, getVehicleClass }),
    createFailsafeStep({ params: props.param, getVehicleClass }),
    createBatteryStep({ params: props.param }),
    createMotorsStep({
      command: props.command,
      confirm: props.confirm,
      params: props.param,
      getVehicleClass,
      getArmed,
    }),
  ];

  // --- parameter fetch affordance -----------------------------------------
  const [busy, setBusy] = createSignal(false);
  const [progress, setProgress] = createSignal<FetchProgress | undefined>(undefined);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [paramRev, setParamRev] = createSignal(0);

  /** Reactive populated-cache probe (re-evaluates on `onChange` bumps). */
  const hasParams = createMemo<boolean>(() => {
    paramRev();
    return PROBE_PARAMS.some((name) => props.param.get(name) !== undefined);
  });

  const doFetch = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    setError(undefined);
    setProgress(undefined);
    try {
      await props.param.fetchAll((done, total): void => {
        setProgress({ done, total });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  };

  onMount(() => {
    const off = props.param.onChange((): void => {
      setParamRev((n) => n + 1);
    });
    onCleanup(off);
  });

  return (
    <div class="mvp-setup-screen" data-screen="setup">
      <header class="mvp-setup-screen__bar">
        <button
          type="button"
          class="mvp-setup-screen__fetch"
          data-testid="setup-fetch"
          disabled={busy()}
          onClick={(): void => {
            void doFetch();
          }}
        >
          {hasParams() ? t('setup.params.refresh') : t('setup.params.fetch')}
        </button>
        <Show when={busy()}>
          <span class="mvp-setup-screen__status" role="status" aria-live="polite">
            <Show when={progress()} fallback={t('setup.params.fetching')}>
              {(p) => t('setup.params.progress', { done: p().done, total: p().total })}
            </Show>
          </span>
        </Show>
        <Show when={error()}>
          {(msg) => (
            <span class="mvp-setup-screen__error" role="alert">
              {t('setup.params.error', { error: msg() })}
            </span>
          )}
        </Show>
      </header>
      <WizardShell
        steps={steps}
        t={t}
        overrides={sessionOverrides}
        setOverrides={setSessionOverrides}
      />
    </div>
  );
};
