/**
 * Joystick / gamepad control panel (task T8.6; spec plan/04 §4.2 joystick).
 *
 * SAFETY-relevant: this panel ENABLES live manual vehicle control. It shows a
 * loud "MANUAL CONTROL ACTIVE" banner whenever the injected
 * {@link ManualControlService} is active, a live axis/button readout, the
 * per-axis mapping/expo/trim/deadzone editors, an output-mode + rate + armed-gate
 * control, and an enable/disable toggle. It wires the focus-loss failsafe
 * (`window` blur → `service.stop()`) and pumps the service (`tick()`) while
 * active so the rate-limited frames flow.
 *
 * The widget is a pure view over the injected service + gamepad source — it
 * never touches the worker host directly (the Flight screen wires those in).
 */
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import './messages';
import type {
  AxisShape,
  ManualControlConfig,
  ManualMode,
  RcChannelMapping,
} from '../../../mavlink/microservices/manual';
import type { JoystickProps } from './types';

/** The four MANUAL_CONTROL axis slots, in display order. */
const MANUAL_AXIS_KEYS = ['x', 'y', 'z', 'r'] as const;
type ManualAxisKey = (typeof MANUAL_AXIS_KEYS)[number];

/** Default rAF pump loop used when no `schedule` is injected. */
function defaultSchedule(cb: () => void): () => void {
  let raf = 0;
  let stopped = false;
  const loop = (): void => {
    if (stopped) return;
    cb();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

/** Clamp + parse a numeric input, falling back to `fallback` on NaN. */
function parseNum(value: string, fallback: number): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/** The joystick / gamepad control panel. */
export const Joystick: Component<JoystickProps> = (props) => {
  const t = props.t;
  const [active, setActive] = createSignal(props.service.isActive());
  const [frame, setFrame] = createSignal(props.gamepad());
  const [config, setConfig] = createSignal<ManualControlConfig>(props.service.getConfig());

  /** Push a config patch into the service and refresh the local snapshot. */
  const apply = (patch: Partial<ManualControlConfig>): void => {
    props.service.setConfig(patch);
    setConfig(props.service.getConfig());
  };

  const updateRcShape = (index: number, patch: Partial<AxisShape>): void => {
    const next = config().rcChannels.map((m, i) =>
      i === index ? { ...m, shape: { ...m.shape, ...patch } } : m,
    );
    apply({ rcChannels: next });
  };
  const updateRc = (index: number, patch: Partial<Omit<RcChannelMapping, 'shape'>>): void => {
    const next = config().rcChannels.map((m, i) => (i === index ? { ...m, ...patch } : m));
    apply({ rcChannels: next });
  };

  const manualMapping = (key: ManualAxisKey): { axis: number; shape: AxisShape } | undefined =>
    config().manualAxes[key];
  const updateManualShape = (key: ManualAxisKey, patch: Partial<AxisShape>): void => {
    const cur = manualMapping(key);
    if (cur === undefined) return;
    apply({
      manualAxes: { ...config().manualAxes, [key]: { ...cur, shape: { ...cur.shape, ...patch } } },
    });
  };
  const updateManualAxis = (key: ManualAxisKey, axis: number): void => {
    const cur = manualMapping(key);
    if (cur === undefined) return;
    apply({ manualAxes: { ...config().manualAxes, [key]: { ...cur, axis } } });
  };

  const toggle = (): void => {
    if (active()) props.service.stop();
    else props.service.start();
  };

  onMount(() => {
    const off = props.service.onActiveChange((a) => setActive(a));
    onCleanup(off);

    // Focus-loss FAILSAFE: a blurred window stops manual control immediately.
    const target = props.failsafeTarget ?? (typeof window !== 'undefined' ? window : undefined);
    if (target !== undefined) {
      const onBlur = (): void => props.service.stop();
      target.addEventListener('blur', onBlur);
      onCleanup(() => target.removeEventListener('blur', onBlur));
    }
  });

  // Pump loop: refresh the live readout + advance the rate-limited service while
  // active. Re-runs when `active()` flips; the previous loop is cancelled first.
  createEffect(() => {
    if (!active()) return;
    const scheduler = props.schedule ?? defaultSchedule;
    const cancel = scheduler(() => {
      setFrame(props.gamepad());
      props.service.tick();
    });
    onCleanup(cancel);
  });

  return (
    <section class="mvp-joystick" role="region" aria-label={t('joystick.title')}>
      <Show
        when={active()}
        fallback={
          <p class="mvp-joystick__status mvp-joystick__status--off" role="status">
            {t('joystick.inactive')}
          </p>
        }
      >
        <p
          class="mvp-joystick__status mvp-joystick__status--active"
          role="status"
          aria-live="assertive"
        >
          {t('joystick.active')}
        </p>
      </Show>

      <p class="mvp-joystick__warning">{t('joystick.warning')}</p>

      <div class="mvp-joystick__controls">
        <button
          type="button"
          class="mvp-joystick__toggle"
          classList={{ 'mvp-joystick__toggle--active': active() }}
          aria-pressed={active()}
          onClick={toggle}
        >
          {active() ? t('joystick.disable') : t('joystick.enable')}
        </button>

        <label class="mvp-joystick__field">
          <span>{t('joystick.mode')}</span>
          <select
            class="mvp-joystick__mode"
            value={config().mode}
            onChange={(e) => apply({ mode: e.currentTarget.value as ManualMode })}
          >
            <option value="rc">{t('joystick.mode.rc')}</option>
            <option value="manual">{t('joystick.mode.manual')}</option>
          </select>
        </label>

        <label class="mvp-joystick__field">
          <span>{t('joystick.rate')}</span>
          <input
            class="mvp-joystick__rate"
            type="number"
            min="1"
            max="50"
            value={config().rateHz}
            onInput={(e) => apply({ rateHz: parseNum(e.currentTarget.value, config().rateHz) })}
          />
        </label>

        <label class="mvp-joystick__field mvp-joystick__field--check">
          <input
            class="mvp-joystick__require-armed"
            type="checkbox"
            checked={config().requireArmed}
            onChange={(e) => apply({ requireArmed: e.currentTarget.checked })}
          />
          <span>{t('joystick.requireArmed')}</span>
        </label>
      </div>

      <p class="mvp-joystick__failsafe-note">{t('joystick.failsafeNote')}</p>

      <div class="mvp-joystick__live">
        <h3 class="mvp-joystick__heading">{t('joystick.live')}</h3>
        <Show
          when={frame() !== undefined}
          fallback={
            <p class="mvp-joystick__no-gamepad" role="status">
              {t('joystick.noGamepad')}
            </p>
          }
        >
          <ul class="mvp-joystick__axes" aria-label={t('joystick.axes')}>
            <For each={frame()?.axes ?? []}>
              {(v, i) => (
                <li class="mvp-joystick__axis">
                  <span class="mvp-joystick__axis-name">{t('joystick.axisLabel', { n: i() })}</span>
                  <span class="mvp-joystick__axis-value">{v.toFixed(2)}</span>
                  <span
                    class="mvp-joystick__axis-bar"
                    style={{ '--mvp-joystick-axis': String(v) }}
                    aria-hidden="true"
                  />
                </li>
              )}
            </For>
          </ul>
          <ul class="mvp-joystick__buttons" aria-label={t('joystick.buttons')}>
            <For each={frame()?.buttons ?? []}>
              {(b, i) => (
                <li
                  class="mvp-joystick__button"
                  classList={{ 'mvp-joystick__button--pressed': b.pressed }}
                >
                  {t('joystick.buttonLabel', { n: i() })}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      <div class="mvp-joystick__mappings">
        <h3 class="mvp-joystick__heading">{t('joystick.mappings')}</h3>

        <Show when={config().mode === 'rc'}>
          <Show
            when={config().rcChannels.length > 0}
            fallback={<p class="mvp-joystick__no-mappings">{t('joystick.noMappings')}</p>}
          >
            <ul class="mvp-joystick__map-list">
              <For each={config().rcChannels}>
                {(m, i) => (
                  <li class="mvp-joystick__map-row">
                    <label class="mvp-joystick__field">
                      <span>{t('joystick.channel')}</span>
                      <input
                        type="number"
                        min="1"
                        max="18"
                        class="mvp-joystick__map-channel"
                        value={m.channel}
                        onInput={(e) =>
                          updateRc(i(), {
                            channel: Math.round(parseNum(e.currentTarget.value, m.channel)),
                          })
                        }
                      />
                    </label>
                    <label class="mvp-joystick__field">
                      <span>{t('joystick.axis')}</span>
                      <input
                        type="number"
                        min="0"
                        class="mvp-joystick__map-axis"
                        value={m.axis}
                        onInput={(e) =>
                          updateRc(i(), {
                            axis: Math.round(parseNum(e.currentTarget.value, m.axis)),
                          })
                        }
                      />
                    </label>
                    <label class="mvp-joystick__field">
                      <span>{t('joystick.deadzone')}</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        class="mvp-joystick__map-deadzone"
                        value={m.shape.deadzone}
                        onInput={(e) =>
                          updateRcShape(i(), {
                            deadzone: parseNum(e.currentTarget.value, m.shape.deadzone),
                          })
                        }
                      />
                    </label>
                    <label class="mvp-joystick__field">
                      <span>{t('joystick.expo')}</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        class="mvp-joystick__map-expo"
                        value={m.shape.expo}
                        onInput={(e) =>
                          updateRcShape(i(), {
                            expo: parseNum(e.currentTarget.value, m.shape.expo),
                          })
                        }
                      />
                    </label>
                    <label class="mvp-joystick__field">
                      <span>{t('joystick.trim')}</span>
                      <input
                        type="number"
                        min="-1"
                        max="1"
                        step="0.05"
                        class="mvp-joystick__map-trim"
                        value={m.shape.trim}
                        onInput={(e) =>
                          updateRcShape(i(), {
                            trim: parseNum(e.currentTarget.value, m.shape.trim),
                          })
                        }
                      />
                    </label>
                    <label class="mvp-joystick__field mvp-joystick__field--check">
                      <input
                        type="checkbox"
                        class="mvp-joystick__map-reverse"
                        checked={m.shape.reverse}
                        onChange={(e) => updateRcShape(i(), { reverse: e.currentTarget.checked })}
                      />
                      <span>{t('joystick.reverse')}</span>
                    </label>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>

        <Show when={config().mode === 'manual'}>
          <ul class="mvp-joystick__map-list">
            <For each={MANUAL_AXIS_KEYS}>
              {(key) => (
                <Show when={manualMapping(key) !== undefined}>
                  <li class="mvp-joystick__map-row" data-axis={key}>
                    <span class="mvp-joystick__map-name">{t(`joystick.axisName.${key}`)}</span>
                    <label class="mvp-joystick__field">
                      <span>{t('joystick.axis')}</span>
                      <input
                        type="number"
                        min="0"
                        class="mvp-joystick__map-axis"
                        value={manualMapping(key)?.axis ?? 0}
                        onInput={(e) =>
                          updateManualAxis(
                            key,
                            Math.round(
                              parseNum(e.currentTarget.value, manualMapping(key)?.axis ?? 0),
                            ),
                          )
                        }
                      />
                    </label>
                    <label class="mvp-joystick__field">
                      <span>{t('joystick.deadzone')}</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        class="mvp-joystick__map-deadzone"
                        value={manualMapping(key)?.shape.deadzone ?? 0}
                        onInput={(e) =>
                          updateManualShape(key, { deadzone: parseNum(e.currentTarget.value, 0) })
                        }
                      />
                    </label>
                    <label class="mvp-joystick__field">
                      <span>{t('joystick.expo')}</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        class="mvp-joystick__map-expo"
                        value={manualMapping(key)?.shape.expo ?? 0}
                        onInput={(e) =>
                          updateManualShape(key, { expo: parseNum(e.currentTarget.value, 0) })
                        }
                      />
                    </label>
                    <label class="mvp-joystick__field">
                      <span>{t('joystick.trim')}</span>
                      <input
                        type="number"
                        min="-1"
                        max="1"
                        step="0.05"
                        class="mvp-joystick__map-trim"
                        value={manualMapping(key)?.shape.trim ?? 0}
                        onInput={(e) =>
                          updateManualShape(key, { trim: parseNum(e.currentTarget.value, 0) })
                        }
                      />
                    </label>
                    <label class="mvp-joystick__field mvp-joystick__field--check">
                      <input
                        type="checkbox"
                        class="mvp-joystick__map-reverse"
                        checked={manualMapping(key)?.shape.reverse ?? false}
                        onChange={(e) =>
                          updateManualShape(key, { reverse: e.currentTarget.checked })
                        }
                      />
                      <span>{t('joystick.reverse')}</span>
                    </label>
                  </li>
                </Show>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </section>
  );
};
