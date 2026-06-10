/**
 * ESC calibration + motor test setup step (T5.10; spec plan/04 §4.4 ESC/motor,
 * plan/08 §8.2/§8.3 destructive-action gating). SAFETY-CRITICAL: these controls
 * spin propellers, so gating is the whole point of this module.
 *
 * Every motor command is gated behind THREE independent checks before anything
 * is sent to the vehicle:
 *  1. a persistent "props removed" acknowledgement checkbox (disables controls),
 *  2. an armed/in-air guard (disables controls while armed), and
 *  3. a prominent, armed-aware {@link UiRegistry.confirm} dialog — declining
 *     sends NOTHING.
 * An always-available Emergency-stop commands every motor to halt immediately.
 *
 * The wire mapping lives in the pure {@link import('./motor-test')} module; this
 * file owns only the Solid UI + the gating policy.
 */
import { For, Show, createMemo, createSignal, type Component, type JSX } from 'solid-js';
import { t as defaultT } from '../../../../core/i18n';
import type { CommandClient, ParamClient, UiRegistry, VehicleClass } from '../../../../contracts';
import type { SetupStep, SetupStepApi, SettledStatus, TFn } from '../framework';
import {
  DEFAULT_MOTOR_TEST_THROTTLE_PCT,
  DEFAULT_MOTOR_TEST_TIMEOUT_S,
  ESC_CALIBRATION_ENABLE,
  ESC_CALIBRATION_NORMAL,
  ESC_CALIBRATION_PARAM,
  MAV_CMD_DO_MOTOR_TEST,
  MAX_MOTOR_COUNT,
  MAX_MOTOR_TEST_THROTTLE_PCT,
  MAX_MOTOR_TEST_TIMEOUT_S,
  MOTOR_TEST_ORDER_SEQUENCE,
  clampMotorCount,
  clampThrottlePct,
  clampTimeoutS,
  defaultMotorCount,
  motorInstances,
  motorTestCommandParams,
  motorTestStopParams,
} from './motor-test';
import './messages';
import './motors.css';

/**
 * Dependencies for {@link createMotorsStep}. `command` is narrowed to just
 * `send` so the step cannot accidentally arm/take off; `confirm` is the injected
 * destructive-action gate; `params` is optional (ESC-cal param writes degrade to
 * instructions when absent).
 */
export interface MotorsStepDeps {
  /** Command microservice, narrowed to `send` (the only verb this step needs). */
  readonly command: Pick<CommandClient, 'send'>;
  /** Destructive-action confirmation gate (armed-aware). */
  readonly confirm: UiRegistry['confirm'];
  /** Optional parameter client for ESC-calibration param writes. */
  readonly params?: ParamClient;
  /** Current vehicle class — seeds the default motor count. */
  readonly getVehicleClass: () => VehicleClass;
  /** Whether the vehicle is armed/in-air; gates the motor controls. */
  readonly getArmed?: () => boolean;
  /** Optional translator; defaults to the app i18n `t`. */
  readonly t?: TFn;
}

/** Parse a finite number from an input value, or `undefined`. */
function parseNumber(raw: string): number | undefined {
  const value = Number.parseFloat(raw.trim());
  return Number.isFinite(value) ? value : undefined;
}

interface MotorsPanelProps {
  readonly deps: MotorsStepDeps;
  readonly api: SetupStepApi;
}

/** The guided ESC/motor pane rendered inside the wizard. */
const MotorsPanel: Component<MotorsPanelProps> = (props) => {
  const t = props.api.t;
  const { command, confirm, params, getVehicleClass, getArmed } = props.deps;

  const [acked, setAcked] = createSignal(false);
  const [throttle, setThrottle] = createSignal(DEFAULT_MOTOR_TEST_THROTTLE_PCT);
  const [timeout, setTimeoutS] = createSignal(DEFAULT_MOTOR_TEST_TIMEOUT_S);
  const [count, setCount] = createSignal(clampMotorCount(defaultMotorCount(getVehicleClass())));
  const [status, setStatus] = createSignal(t('setup.motors.status.idle'));

  const isArmed = (): boolean => getArmed?.() === true;
  /** Motor controls are enabled only when acknowledged AND not armed. */
  const canTest = createMemo(() => acked() && !isArmed());
  const instances = createMemo(() => motorInstances(count()));

  const reportError = (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(t('setup.motors.status.error', { message }));
  };

  /** Send one `MAV_CMD_DO_MOTOR_TEST` for a single motor instance. */
  const sendOne = async (instance: number): Promise<void> => {
    await command.send(
      MAV_CMD_DO_MOTOR_TEST,
      motorTestCommandParams({
        instance,
        throttlePct: throttle(),
        timeoutS: timeout(),
      }),
    );
  };

  /** Gated single-motor test: confirm (armed-aware) → send, or send nothing. */
  const testMotor = async (instance: number): Promise<void> => {
    if (!canTest()) return;
    const ok = await confirm({
      title: t('setup.motors.confirm.title'),
      body: t('setup.motors.confirm.body', {
        n: instance,
        throttle: clampThrottlePct(throttle()),
        timeout: clampTimeoutS(timeout()),
      }),
      destructive: true,
      armedAware: true,
    });
    if (!ok) {
      setStatus(t('setup.motors.status.declined'));
      return;
    }
    try {
      await sendOne(instance);
      setStatus(
        t('setup.motors.status.sent', {
          n: instance,
          throttle: clampThrottlePct(throttle()),
          timeout: clampTimeoutS(timeout()),
        }),
      );
    } catch (err) {
      reportError(err);
    }
  };

  /** Gated "test all in sequence": confirm once → ONE sequential-test command. */
  const testAll = async (): Promise<void> => {
    if (!canTest()) return;
    const motors = instances();
    const ok = await confirm({
      title: t('setup.motors.confirm.title'),
      body: t('setup.motors.confirm.bodyAll', {
        count: motors.length,
        throttle: clampThrottlePct(throttle()),
        timeout: clampTimeoutS(timeout()),
      }),
      destructive: true,
      armedAware: true,
    });
    if (!ok) {
      setStatus(t('setup.motors.status.declined'));
      return;
    }
    try {
      // ONE command encoding the whole sequence: per-command tests would all
      // start at once and spin every motor simultaneously (audit E2).
      await command.send(
        MAV_CMD_DO_MOTOR_TEST,
        motorTestCommandParams({
          instance: 1,
          throttlePct: throttle(),
          timeoutS: timeout(),
          motorCount: motors.length,
          testOrder: MOTOR_TEST_ORDER_SEQUENCE,
        }),
      );
      setStatus(
        t('setup.motors.status.sentAll', {
          count: motors.length,
          throttle: clampThrottlePct(throttle()),
        }),
      );
    } catch (err) {
      reportError(err);
    }
  };

  /** Emergency stop: halt every motor immediately (no confirmation). */
  const emergencyStop = async (): Promise<void> => {
    try {
      for (const instance of motorInstances(Math.max(count(), 1))) {
        await command.send(MAV_CMD_DO_MOTOR_TEST, motorTestStopParams(instance));
      }
      setStatus(t('setup.motors.status.stopped'));
    } catch (err) {
      reportError(err);
    }
  };

  /** Gated ESC-calibration param write: confirm → write, or do nothing. */
  const armEscCalibration = async (): Promise<void> => {
    if (params === undefined) return;
    const ok = await confirm({
      title: t('setup.motors.esc.confirm.title'),
      body: t('setup.motors.esc.confirm.body', {
        param: ESC_CALIBRATION_PARAM,
        value: ESC_CALIBRATION_ENABLE,
      }),
      destructive: true,
      armedAware: true,
    });
    if (!ok) {
      setStatus(t('setup.motors.status.declined'));
      return;
    }
    try {
      await params.set(ESC_CALIBRATION_PARAM, ESC_CALIBRATION_ENABLE);
      setStatus(t('setup.motors.esc.armed'));
    } catch (err) {
      reportError(err);
    }
  };

  /** Reset the ESC-calibration parameter back to normal flight. */
  const resetEscCalibration = async (): Promise<void> => {
    if (params === undefined) return;
    try {
      await params.set(ESC_CALIBRATION_PARAM, ESC_CALIBRATION_NORMAL);
      setStatus(t('setup.motors.esc.reset.done'));
    } catch (err) {
      reportError(err);
    }
  };

  const onThrottleInput = (raw: string): void => {
    const value = parseNumber(raw);
    if (value !== undefined) setThrottle(clampThrottlePct(value));
  };
  const onTimeoutInput = (raw: string): void => {
    const value = parseNumber(raw);
    if (value !== undefined) setTimeoutS(clampTimeoutS(value));
  };
  const onCountInput = (raw: string): void => {
    const value = parseNumber(raw);
    if (value !== undefined) setCount(clampMotorCount(value));
  };

  return (
    <section class="mvp-setup-motors" aria-label={t('setup.motors.title')}>
      <p class="mvp-setup-motors__intro">{t('setup.motors.description')}</p>

      {/* Persistent props-removed acknowledgement gate. */}
      <label class="mvp-setup-motors__ack">
        <input
          type="checkbox"
          data-testid="motors-ack"
          checked={acked()}
          onChange={(event): void => {
            setAcked(event.currentTarget.checked);
          }}
        />
        <span class="mvp-setup-motors__ack-text">
          <span>{t('setup.motors.ack.label')}</span>
          <span class="mvp-setup-motors__ack-help">{t('setup.motors.ack.help')}</span>
        </span>
      </label>

      <Show when={isArmed()}>
        <p class="mvp-setup-motors__armed" role="alert" data-testid="motors-armed-warning">
          {t('setup.motors.armed.warning')}
        </p>
      </Show>

      {/* Emergency stop is always available. */}
      <button
        type="button"
        class="mvp-setup-motors__stop"
        data-testid="motors-stop"
        onClick={(): void => {
          void emergencyStop();
        }}
      >
        {t('setup.motors.stop')}
      </button>
      <span class="mvp-setup-motors__help">{t('setup.motors.stop.help')}</span>

      {/* Motor test. */}
      <section class="mvp-setup-motors__section" aria-label={t('setup.motors.test.title')}>
        <h3 class="mvp-setup-motors__heading">{t('setup.motors.test.title')}</h3>
        <div class="mvp-setup-motors__grid">
          <label class="mvp-setup-motors__field">
            <span class="mvp-setup-motors__label">{t('setup.motors.test.throttle')}</span>
            <input
              class="mvp-setup-motors__input"
              data-testid="motors-throttle"
              type="number"
              min="0"
              max={String(MAX_MOTOR_TEST_THROTTLE_PCT)}
              step="1"
              value={String(throttle())}
              onChange={(event): void => {
                onThrottleInput(event.currentTarget.value);
              }}
            />
          </label>
          <label class="mvp-setup-motors__field">
            <span class="mvp-setup-motors__label">{t('setup.motors.test.timeout')}</span>
            <input
              class="mvp-setup-motors__input"
              data-testid="motors-timeout"
              type="number"
              min="0"
              max={String(MAX_MOTOR_TEST_TIMEOUT_S)}
              step="1"
              value={String(timeout())}
              onChange={(event): void => {
                onTimeoutInput(event.currentTarget.value);
              }}
            />
          </label>
          <label class="mvp-setup-motors__field">
            <span class="mvp-setup-motors__label">{t('setup.motors.test.count')}</span>
            <input
              class="mvp-setup-motors__input"
              data-testid="motors-count"
              type="number"
              min="1"
              max={String(MAX_MOTOR_COUNT)}
              step="1"
              value={String(count())}
              onChange={(event): void => {
                onCountInput(event.currentTarget.value);
              }}
            />
          </label>
        </div>

        <div class="mvp-setup-motors__motors">
          <For each={instances()}>
            {(instance) => (
              <button
                type="button"
                class="mvp-setup-motors__button mvp-setup-motors__button--danger"
                data-testid={`motors-test-${instance}`}
                disabled={!canTest()}
                onClick={(): void => {
                  void testMotor(instance);
                }}
              >
                {t('setup.motors.test.motor', { n: instance })}
              </button>
            )}
          </For>
          <button
            type="button"
            class="mvp-setup-motors__button mvp-setup-motors__button--danger"
            data-testid="motors-test-all"
            disabled={!canTest()}
            onClick={(): void => {
              void testAll();
            }}
          >
            {t('setup.motors.test.all')}
          </button>
        </div>
      </section>

      {/* ESC calibration. */}
      <section class="mvp-setup-motors__section" aria-label={t('setup.motors.esc.title')}>
        <h3 class="mvp-setup-motors__heading">{t('setup.motors.esc.title')}</h3>
        <p class="mvp-setup-motors__armed" role="note">
          {t('setup.motors.esc.warning')}
        </p>
        <p class="mvp-setup-motors__help">{t('setup.motors.esc.steps.intro')}</p>
        <ol class="mvp-setup-motors__steps">
          <li>{t('setup.motors.esc.steps.s1')}</li>
          <li>{t('setup.motors.esc.steps.s2')}</li>
          <li>{t('setup.motors.esc.steps.s3')}</li>
          <li>{t('setup.motors.esc.steps.s4')}</li>
          <li>{t('setup.motors.esc.steps.s5')}</li>
        </ol>
        <Show
          when={params !== undefined}
          fallback={
            <p class="mvp-setup-motors__help" data-testid="motors-esc-unavailable">
              {t('setup.motors.esc.unavailable')}
            </p>
          }
        >
          <div class="mvp-setup-motors__esc-actions">
            <button
              type="button"
              class="mvp-setup-motors__button mvp-setup-motors__button--danger"
              data-testid="motors-esc-arm"
              onClick={(): void => {
                void armEscCalibration();
              }}
            >
              {t('setup.motors.esc.arm')}
            </button>
            <button
              type="button"
              class="mvp-setup-motors__button"
              data-testid="motors-esc-reset"
              onClick={(): void => {
                void resetEscCalibration();
              }}
            >
              {t('setup.motors.esc.reset')}
            </button>
          </div>
        </Show>
      </section>

      <p
        class="mvp-setup-motors__status"
        role="status"
        aria-live="polite"
        data-testid="motors-status"
      >
        {status()}
      </p>
    </section>
  );
};

/**
 * Create the optional ESC-calibration + motor-test setup step. The step never
 * forces completion: its status is always `'na'` (an optional diagnostics step),
 * so it counts as satisfied without a manual "mark complete".
 */
export function createMotorsStep(deps: MotorsStepDeps): SetupStep {
  const translate = deps.t ?? defaultT;
  const status = (): SettledStatus => 'na';

  return {
    id: 'motors',
    title: translate('setup.motors.title'),
    icon: '🛟',
    safetyNote: translate('setup.motors.safety'),
    status,
    allowManualComplete: false,
    render: (api): JSX.Element => <MotorsPanel deps={deps} api={api} />,
  };
}
