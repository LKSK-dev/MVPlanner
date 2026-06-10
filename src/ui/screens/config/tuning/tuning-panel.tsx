/**
 * PID / tuning panel (task T3.6; spec plan/04 §4.5 tuning).
 *
 * Vehicle-aware PID/tuning tables that edit the relevant ArduPilot parameter
 * groups for the ACTIVE vehicle (Copter `ATC_*`/`PSC_*`, Plane `*_RATE_*`,
 * Rover `ATC_STR_RAT_*`/`ATC_SPEED_*`) via the injected {@link ParamClient}:
 *
 *  - **Editable tables** (MUST): one row per parameter with a type-aware number
 *    editor plus units / range / description resolved from the
 *    {@link ParamMetaResolver}; staged edits write through `client.set`.
 *  - **Extended-tune sliders** (SHOULD): a few key proportional gains as range
 *    sliders bound to the same staged-edit state.
 *  - **Autotune** (SHOULD): start/stop via the injected {@link CommandClient}
 *    (`MAV_CMD_DO_AUTOTUNE_ENABLE`).
 *  - **Setpoint-vs-actual mini-plot** (SHOULD): a noted placeholder — the live
 *    plot is driven by flight/SITL telemetry (deferred to the M3 SITL gate).
 *
 * The base parameter values come from the shared {@link ParamClient} cache
 * (populated by the Parameters tab's full fetch, or this panel's own Fetch
 * button) and stay live via `client.onChange`. The client / meta / command and
 * the active-vehicle accessor are all injected, so the panel unit-tests with
 * mocks (no Worker, no host).
 */
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type Component,
  type JSX,
} from 'solid-js';
import type {
  CommandClient,
  ConfirmOptions,
  ParamClient,
  ParamMeta,
  VehicleClass,
} from '../../../../contracts';
import type { ParamMetaResolver, TFn } from '../../../widgets/paramgrid';
import {
  MAV_CMD_DO_AUTOTUNE_ENABLE,
  groupParamNames,
  sliderParamsForClass,
  tuningGroupsForClass,
  type TuningGroup,
} from './groups';
import './messages';

/** The minimal active-vehicle view the tuning panel needs (a `VehicleState` fits). */
export interface TuningVehicle {
  /** Vehicle class — selects the parameter groups shown. */
  readonly vehicleClass: VehicleClass;
}

/** {@link TuningPanel} props. */
export interface TuningPanelProps {
  /** Parameter microservice client (the real one, or a mock in tests). */
  client: ParamClient;
  /** Metadata resolver (the `ParamMetaStore`, or a mock). */
  meta: ParamMetaResolver;
  /** Command microservice for autotune start/stop (omit to hide autotune). */
  command?: CommandClient;
  /** Reactive active vehicle (drives the per-class group selection). */
  vehicle: Accessor<TuningVehicle | undefined>;
  /** Destructive-action confirmation gate (threaded from the Config assembly). */
  confirm?: (opts: ConfirmOptions) => Promise<boolean>;
  /** Whether the "confirm destructive actions" setting is on (store accessor). */
  confirmDestructive?: () => boolean;
  /** Reactive active vehicle sysid — a switch clears cached/staged state. */
  activeSysid?: () => number | undefined;
  /** i18n translate function. */
  t: TFn;
}

/** Format a numeric value for display/edit (trims float noise). */
function fmtValue(v: number | undefined): string {
  if (v === undefined) return '';
  return Number(v.toPrecision(8)).toString();
}

/** Build the human range text for a parameter from its metadata. */
function rangeText(t: TFn, meta: ParamMeta | undefined): string {
  if (meta === undefined) return t('tuning.range.none');
  const { min, max } = meta;
  if (min !== undefined && max !== undefined) return t('tuning.range', { min, max });
  if (min !== undefined) return t('tuning.range.min', { min });
  if (max !== undefined) return t('tuning.range.max', { max });
  return t('tuning.range.none');
}

/** The composed PID / tuning panel. */
export const TuningPanel: Component<TuningPanelProps> = (props) => {
  const t = props.t;

  const [base, setBase] = createSignal<ReadonlyMap<string, number>>(new Map());
  const [pending, setPending] = createSignal<ReadonlyMap<string, number>>(new Map());
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal('');
  const [autotuneActive, setAutotuneActive] = createSignal(false);

  const vehicleClass = createMemo<VehicleClass>(() => props.vehicle()?.vehicleClass ?? 'copter');
  const groups = createMemo<readonly TuningGroup[]>(() => tuningGroupsForClass(vehicleClass()));
  const sliderParams = createMemo<readonly string[]>(() => sliderParamsForClass(vehicleClass()));
  const changedCount = createMemo(() => pending().size);

  /** The display/edit value for `name`: staged edit over the cached base. */
  const effective = (name: string): number | undefined => pending().get(name) ?? base().get(name);
  /** True when a staged edit for `name` differs from its base value. */
  const isModified = (name: string): boolean => {
    const staged = pending().get(name);
    return staged !== undefined && staged !== base().get(name);
  };

  // Seed the base map from the shared client cache whenever the visible groups
  // change (a different vehicle class shows a different parameter set). The
  // cache read is non-reactive, so this effect re-runs only on a class switch.
  createEffect(() => {
    const names = groupParamNames(groups());
    setBase((prev) => {
      const next = new Map(prev);
      for (const name of names) {
        const cached = props.client.get(name);
        if (cached !== undefined) next.set(name, cached.value);
      }
      return next;
    });
  });

  // Keep base values live: reflect confirmed PARAM_VALUE changes and drop a
  // now-matching staged edit (a written/echoed value is no longer "modified").
  onMount(() => {
    const off = props.client.onChange((p) => {
      setBase((prev) => {
        const next = new Map(prev);
        next.set(p.name, p.value);
        return next;
      });
      setPending((prev) => {
        if (prev.get(p.name) !== p.value) return prev;
        const next = new Map(prev);
        next.delete(p.name);
        return next;
      });
    });
    onCleanup(off);
  });

  // A vehicle switch invalidates the cached base + staged edits — without this
  // a "Write" after switching would push vehicle A's gains to vehicle B.
  const sysidAccessor = props.activeSysid;
  if (sysidAccessor !== undefined) {
    createEffect<number | undefined>((prev) => {
      const cur = sysidAccessor();
      if (prev !== undefined && prev !== cur) {
        setBase(new Map());
        setPending(new Map());
        setStatus('');
      }
      return cur;
    }, sysidAccessor());
  }

  /**
   * Gate a destructive action behind the injected confirm seam when the user's
   * `confirmDestructive` setting is on. Absent seam ⇒ allowed (the
   * standalone-docked panel keeps its existing behaviour).
   */
  const confirmDestructiveAction = async (title: string, body: string): Promise<boolean> => {
    const confirm = props.confirm;
    if (confirm === undefined || props.confirmDestructive?.() !== true) return true;
    return confirm({ title, body, destructive: true, armedAware: true });
  };

  const reportError = (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(t('tuning.status.error', { message }));
  };

  const onEdit = (name: string, value: number): void => {
    setPending((prev) => {
      const next = new Map(prev);
      if (base().get(name) === value) next.delete(name);
      else next.set(name, value);
      return next;
    });
  };

  const onEditRaw = (name: string, raw: string): void => {
    const v = Number(raw);
    if (Number.isFinite(v)) onEdit(name, v);
  };

  const fetchAll = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await props.client.fetchAll();
      setBase((prev) => {
        const next = new Map(prev);
        for (const p of result) next.set(p.name, p.value);
        return next;
      });
      setStatus(t('tuning.status.fetched'));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const writeChanged = async (): Promise<void> => {
    if (busy()) return;
    const entries = [...pending()];
    if (entries.length === 0) return;
    if (
      !(await confirmDestructiveAction(
        t('config.confirm.write.title'),
        t('config.confirm.write.body', { n: entries.length }),
      ))
    ) {
      setStatus(t('config.confirm.declined'));
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      for (const [name, value] of entries) await props.client.set(name, value);
      setBase((prev) => {
        const next = new Map(prev);
        for (const [name, value] of entries) next.set(name, value);
        return next;
      });
      setPending(new Map());
      setStatus(t('tuning.status.wrote', { n: entries.length }));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const autotune = async (enable: boolean): Promise<void> => {
    const command = props.command;
    if (command === undefined || busy()) return;
    if (
      enable &&
      !(await confirmDestructiveAction(
        t('config.confirm.autotune.title'),
        t('config.confirm.autotune.body'),
      ))
    ) {
      setStatus(t('config.confirm.declined'));
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      await command.send(MAV_CMD_DO_AUTOTUNE_ENABLE, [enable ? 1 : 0]);
      setAutotuneActive(enable);
      setStatus(enable ? t('tuning.status.autotuneStarted') : t('tuning.status.autotuneStopped'));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Render the editable number cell for one parameter. */
  const valueCell = (name: string): JSX.Element => (
    <input
      type="number"
      class="mvp-tuning__input"
      classList={{ 'is-modified': isModified(name) }}
      data-param={name}
      aria-label={t('tuning.cell.label', { name })}
      value={fmtValue(effective(name))}
      step={props.meta.get(name)?.increment ?? 'any'}
      title={props.meta.get(name)?.description ?? name}
      disabled={busy()}
      onChange={(e) => onEditRaw(name, e.currentTarget.value)}
    />
  );

  return (
    <section class="mvp-tuning" role="region" aria-label={t('tuning.title')}>
      <div class="mvp-tuning__toolbar" role="toolbar" aria-label={t('tuning.toolbar.label')}>
        <button
          type="button"
          class="mvp-tuning__btn"
          data-testid="tuning-fetch"
          disabled={busy()}
          onClick={() => void fetchAll()}
        >
          {base().size === 0 ? t('tuning.fetch') : t('tuning.refresh')}
        </button>
        <button
          type="button"
          class="mvp-tuning__btn"
          data-testid="tuning-write"
          disabled={busy() || changedCount() === 0}
          onClick={() => void writeChanged()}
        >
          {t('tuning.writeChanged')}
        </button>
        <Show when={changedCount() > 0}>
          <span class="mvp-tuning__changed" role="status">
            {t('tuning.changedCount', { n: changedCount() })}
          </span>
        </Show>
        <span class="mvp-tuning__vehicle">
          {t('tuning.vehicle', { cls: t(`tuning.class.${vehicleClass()}`) })}
        </span>
      </div>

      <Show when={props.vehicle() === undefined}>
        <p class="mvp-tuning__hint" role="note">
          {t('tuning.noVehicle')}
        </p>
      </Show>

      <Show when={status() !== ''}>
        <p class="mvp-tuning__status" role="status">
          {status()}
        </p>
      </Show>

      <Show
        when={groups().length > 0}
        fallback={
          <p class="mvp-tuning__empty" role="status">
            {t('tuning.empty')}
          </p>
        }
      >
        <For each={groups()}>
          {(group) => (
            <section class="mvp-tuning__group" data-group={group.id}>
              <h3 class="mvp-tuning__group-title">{t(`tuning.group.${group.id}`)}</h3>
              <table class="mvp-tuning__table">
                <thead>
                  <tr>
                    <th scope="col">{t('tuning.col.param')}</th>
                    <th scope="col">{t('tuning.col.value')}</th>
                    <th scope="col">{t('tuning.col.units')}</th>
                    <th scope="col">{t('tuning.col.range')}</th>
                    <th scope="col">{t('tuning.col.desc')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={group.params}>
                    {(name) => (
                      <tr data-param={name} classList={{ 'is-modified': isModified(name) }}>
                        <th scope="row" class="mvp-tuning__pname">
                          {name}
                        </th>
                        <td class="mvp-tuning__pvalue">{valueCell(name)}</td>
                        <td class="mvp-tuning__punits">{props.meta.get(name)?.units ?? ''}</td>
                        <td class="mvp-tuning__prange">{rangeText(t, props.meta.get(name))}</td>
                        <td class="mvp-tuning__pdesc">{props.meta.get(name)?.description ?? ''}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </section>
          )}
        </For>

        <Show when={sliderParams().length > 0}>
          <section class="mvp-tuning__sliders" aria-label={t('tuning.sliders.title')}>
            <h3 class="mvp-tuning__group-title">{t('tuning.sliders.title')}</h3>
            <For each={sliderParams()}>
              {(name) => {
                const meta = (): ParamMeta | undefined => props.meta.get(name);
                const min = (): number => meta()?.min ?? 0;
                const max = (): number => meta()?.max ?? 1;
                return (
                  <label class="mvp-tuning__slider-row">
                    <span class="mvp-tuning__slider-label">
                      {t('tuning.slider.label', { name })}
                    </span>
                    <input
                      type="range"
                      class="mvp-tuning__slider"
                      data-slider={name}
                      aria-label={t('tuning.slider.label', { name })}
                      min={min()}
                      max={max()}
                      step={meta()?.increment ?? 0.001}
                      value={effective(name) ?? min()}
                      disabled={busy()}
                      onInput={(e) => onEditRaw(name, e.currentTarget.value)}
                    />
                    <span class="mvp-tuning__slider-value">{fmtValue(effective(name))}</span>
                  </label>
                );
              }}
            </For>
          </section>
        </Show>
      </Show>

      <Show when={props.command !== undefined}>
        <section class="mvp-tuning__autotune" aria-label={t('tuning.autotune.title')}>
          <h3 class="mvp-tuning__group-title">{t('tuning.autotune.title')}</h3>
          <div class="mvp-tuning__autotune-row">
            <button
              type="button"
              class="mvp-tuning__btn"
              data-testid="tuning-autotune-start"
              disabled={busy() || autotuneActive()}
              onClick={() => void autotune(true)}
            >
              {t('tuning.autotune.start')}
            </button>
            <button
              type="button"
              class="mvp-tuning__btn mvp-tuning__btn--danger"
              data-testid="tuning-autotune-stop"
              disabled={busy()}
              onClick={() => void autotune(false)}
            >
              {t('tuning.autotune.stop')}
            </button>
            <span class="mvp-tuning__autotune-state" data-active={autotuneActive()}>
              {autotuneActive() ? t('tuning.autotune.active') : t('tuning.autotune.idle')}
            </span>
          </div>
        </section>
      </Show>

      <section class="mvp-tuning__plot" aria-label={t('tuning.plot.title')}>
        <h3 class="mvp-tuning__group-title">{t('tuning.plot.title')}</h3>
        <div class="mvp-tuning__plot-placeholder" role="img" aria-label={t('tuning.plot.title')}>
          {t('tuning.plot.placeholder')}
        </div>
      </section>
    </section>
  );
};
