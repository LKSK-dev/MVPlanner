/**
 * Battery monitor setup step (T5.9; spec plan/04 §4.4). This module adapts the
 * SetupStep contract to ArduPilot `BATT_*` parameters through an injected
 * ParamClient: current values are read from `get`, edits and power-module
 * presets write through `set`, and `onChange` keeps the mounted form current.
 */
import { For, Show, createMemo, createSignal, onCleanup, type Component, type JSX } from 'solid-js';
import { t as defaultT } from '../../../../core/i18n';
import type { Param, ParamClient } from '../../../../contracts';
import type { SetupStep, SetupStepApi, SettledStatus, TFn } from '../framework';
import {
  BATTERY_MONITOR_OPTIONS,
  BATTERY_POWER_MODULE_PRESETS,
  batteryPresetById,
  visibleFieldsForBatteryMonitor,
  type BatteryParamName,
  type BatteryPowerModulePreset,
} from './presets';
import './messages';
import './battery.css';

/** Dependencies for {@link createBatteryStep}. */
export interface BatteryStepDeps {
  /** Parameter microservice client used for ArduPilot `BATT_*` reads/writes. */
  readonly params: ParamClient;
  /** Optional translator; defaults to the app i18n `t`. */
  readonly t?: TFn;
}

type BatteryValueField =
  | 'monitor'
  | 'voltagePin'
  | 'currentPin'
  | 'voltageMultiplier'
  | 'ampsPerVolt'
  | 'ampOffset'
  | 'capacity';

interface BatteryValues {
  readonly monitor: number;
  readonly voltagePin: number;
  readonly currentPin: number;
  readonly voltageMultiplier: number;
  readonly ampsPerVolt: number;
  readonly ampOffset: number;
  readonly capacity: number;
}

interface BatteryPanelProps {
  readonly params: ParamClient;
  readonly api: SetupStepApi;
  readonly onMonitorValue: (value: number) => void;
}

const FIELD_PARAM: Readonly<Record<BatteryValueField, BatteryParamName>> = {
  monitor: 'BATT_MONITOR',
  voltagePin: 'BATT_VOLT_PIN',
  currentPin: 'BATT_CURR_PIN',
  voltageMultiplier: 'BATT_VOLT_MULT',
  ampsPerVolt: 'BATT_AMP_PERVLT',
  ampOffset: 'BATT_AMP_OFFSET',
  capacity: 'BATT_CAPACITY',
};

const PARAM_FIELD: Readonly<Record<BatteryParamName, BatteryValueField>> = {
  BATT_MONITOR: 'monitor',
  BATT_VOLT_PIN: 'voltagePin',
  BATT_CURR_PIN: 'currentPin',
  BATT_VOLT_MULT: 'voltageMultiplier',
  BATT_AMP_PERVLT: 'ampsPerVolt',
  BATT_AMP_OFFSET: 'ampOffset',
  BATT_CAPACITY: 'capacity',
};

const DEFAULT_VALUES: BatteryValues = {
  monitor: 0,
  voltagePin: 2,
  currentPin: 3,
  voltageMultiplier: 10.1,
  ampsPerVolt: 17,
  ampOffset: 0,
  capacity: 0,
};

/** Read a numeric param from the ParamClient cache, falling back to a default. */
function readNumber(params: ParamClient, name: BatteryParamName, fallback: number): number {
  return params.get(name)?.value ?? fallback;
}

/** Snapshot all battery setup params from the ParamClient cache. */
function readBatteryValues(params: ParamClient): BatteryValues {
  return {
    monitor: readNumber(params, 'BATT_MONITOR', DEFAULT_VALUES.monitor),
    voltagePin: readNumber(params, 'BATT_VOLT_PIN', DEFAULT_VALUES.voltagePin),
    currentPin: readNumber(params, 'BATT_CURR_PIN', DEFAULT_VALUES.currentPin),
    voltageMultiplier: readNumber(params, 'BATT_VOLT_MULT', DEFAULT_VALUES.voltageMultiplier),
    ampsPerVolt: readNumber(params, 'BATT_AMP_PERVLT', DEFAULT_VALUES.ampsPerVolt),
    ampOffset: readNumber(params, 'BATT_AMP_OFFSET', DEFAULT_VALUES.ampOffset),
    capacity: readNumber(params, 'BATT_CAPACITY', DEFAULT_VALUES.capacity),
  };
}

/** Convert a param update into the local form field it owns. */
function fieldForParam(name: string): BatteryValueField | undefined {
  switch (name) {
    case 'BATT_MONITOR':
    case 'BATT_VOLT_PIN':
    case 'BATT_CURR_PIN':
    case 'BATT_VOLT_MULT':
    case 'BATT_AMP_PERVLT':
    case 'BATT_AMP_OFFSET':
    case 'BATT_CAPACITY':
      return PARAM_FIELD[name];
    default:
      return undefined;
  }
}

/** A finite numeric parser for form input/select values. */
function parseNumber(raw: string): number | undefined {
  const value = Number.parseFloat(raw.trim());
  return Number.isFinite(value) ? value : undefined;
}

/** Format numbers for controlled inputs without adding trailing zeroes. */
function formatNumber(value: number): string {
  return Number(value.toPrecision(8)).toString();
}

/** Overlay a single field value into the immutable form snapshot. */
function withField(values: BatteryValues, field: BatteryValueField, value: number): BatteryValues {
  return { ...values, [field]: value };
}

/** Battery setup form rendered inside the Setup wizard pane. */
const BatteryPanel: Component<BatteryPanelProps> = (props) => {
  const t = props.api.t;
  const [values, setValues] = createSignal<BatteryValues>(readBatteryValues(props.params));
  const [selectedPresetId, setSelectedPresetId] = createSignal('');
  const [status, setStatus] = createSignal(t('setup.battery.status.ready'));

  const setFieldLocal = (field: BatteryValueField, value: number): void => {
    setValues((prev) => withField(prev, field, value));
    if (field === 'monitor') props.onMonitorValue(value);
  };

  const reportError = (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(t('setup.battery.status.error', { message }));
  };

  const writeField = (field: BatteryValueField, value: number): void => {
    const param = FIELD_PARAM[field];
    const previous = values()[field];
    setFieldLocal(field, value);
    void props.params
      .set(param, value)
      .then(() => setStatus(t('setup.battery.status.wrote', { param })))
      .catch((err: unknown) => {
        // The write failed — revert the optimistic local value (E14).
        setFieldLocal(field, previous);
        reportError(err);
      });
  };

  const writeFieldFromRaw = (field: BatteryValueField, raw: string): void => {
    const value = parseNumber(raw);
    if (value === undefined) return;
    writeField(field, value);
  };

  const applyPreset = (preset: BatteryPowerModulePreset): void => {
    const entries = Object.entries(preset.params) as readonly (readonly [
      BatteryParamName,
      number,
    ])[];
    for (const [param, value] of entries) {
      const field = fieldForParam(param);
      if (field !== undefined) setFieldLocal(field, value);
    }
    void Promise.all(entries.map(([param, value]) => props.params.set(param, value)))
      .then(() => setStatus(t('setup.battery.status.preset', { preset: t(preset.labelKey) })))
      .catch(reportError);
  };

  const visible = createMemo(() => visibleFieldsForBatteryMonitor(values().monitor));

  const selectedPreset = createMemo(() => batteryPresetById(selectedPresetId()));

  const numberField = (
    field: BatteryValueField,
    labelKey: string,
    testId: string,
    step: string,
  ) => (
    <label class="mvp-setup-battery__field">
      <span class="mvp-setup-battery__label">{t(labelKey)}</span>
      <input
        class="mvp-setup-battery__input"
        data-testid={testId}
        type="number"
        step={step}
        value={formatNumber(values()[field])}
        onChange={(event): void => {
          writeFieldFromRaw(field, event.currentTarget.value);
        }}
      />
    </label>
  );

  const refreshFromParam = (param: Param): void => {
    const field = fieldForParam(param.name);
    if (field === undefined) return;
    setFieldLocal(field, param.value);
  };

  const initial = readBatteryValues(props.params);
  setValues(initial);
  props.onMonitorValue(initial.monitor);

  const off = props.params.onChange(refreshFromParam);
  onCleanup(off);

  return (
    <section class="mvp-setup-battery" aria-label={t('setup.battery.title')}>
      <p class="mvp-setup-battery__intro">{t('setup.battery.description')}</p>

      <label class="mvp-setup-battery__field">
        <span class="mvp-setup-battery__label">{t('setup.battery.monitor.label')}</span>
        <select
          class="mvp-setup-battery__select"
          data-testid="battery-monitor"
          value={String(values().monitor)}
          onChange={(event): void => {
            writeFieldFromRaw('monitor', event.currentTarget.value);
          }}
        >
          <For each={BATTERY_MONITOR_OPTIONS}>
            {(option) => <option value={String(option.value)}>{t(option.labelKey)}</option>}
          </For>
        </select>
      </label>

      <Show when={visible().presets}>
        <div class="mvp-setup-battery__preset" data-testid="battery-preset-panel">
          <label class="mvp-setup-battery__field">
            <span class="mvp-setup-battery__label">{t('setup.battery.preset.label')}</span>
            <select
              class="mvp-setup-battery__select"
              data-testid="battery-preset"
              value={selectedPresetId()}
              onChange={(event): void => {
                setSelectedPresetId(event.currentTarget.value);
              }}
            >
              <option value="">{t('setup.battery.preset.custom')}</option>
              <For each={BATTERY_POWER_MODULE_PRESETS}>
                {(preset) => <option value={preset.id}>{t(preset.labelKey)}</option>}
              </For>
            </select>
          </label>
          <button
            class="mvp-setup-battery__button"
            type="button"
            data-testid="battery-apply-preset"
            disabled={selectedPreset() === undefined}
            onClick={(): void => {
              const preset = selectedPreset();
              if (preset !== undefined) applyPreset(preset);
            }}
          >
            {t('setup.battery.preset.apply')}
          </button>
        </div>
      </Show>

      <div class="mvp-setup-battery__grid">
        <Show when={visible().voltagePin}>
          {numberField('voltagePin', 'setup.battery.field.voltagePin', 'battery-voltage-pin', '1')}
        </Show>
        <Show when={visible().currentPin}>
          {numberField('currentPin', 'setup.battery.field.currentPin', 'battery-current-pin', '1')}
        </Show>
        <Show when={visible().voltageMultiplier}>
          {numberField(
            'voltageMultiplier',
            'setup.battery.field.voltageMultiplier',
            'battery-voltage-multiplier',
            '0.001',
          )}
        </Show>
        <Show when={visible().ampsPerVolt}>
          {numberField(
            'ampsPerVolt',
            'setup.battery.field.ampsPerVolt',
            'battery-amps-per-volt',
            '0.001',
          )}
        </Show>
        <Show when={visible().ampOffset}>
          {numberField('ampOffset', 'setup.battery.field.ampOffset', 'battery-amp-offset', '0.001')}
        </Show>
        <Show when={visible().capacity}>
          {numberField('capacity', 'setup.battery.field.capacity', 'battery-capacity', '1')}
        </Show>
      </div>

      <p class="mvp-setup-battery__status" role="status" aria-live="polite">
        {status()}
      </p>
    </section>
  );
};

/**
 * Create the battery-monitor setup step for the Setup wizard registry.
 *
 * Status is derived from `BATT_MONITOR`: disabled (`0`) is `todo`; any non-zero
 * monitor type is `done`. The mounted form keeps the status accessor current
 * when the user edits `BATT_MONITOR` or the ParamClient emits a change.
 */
export function createBatteryStep(deps: BatteryStepDeps): SetupStep {
  const translate = deps.t ?? defaultT;
  const [monitor, setMonitor] = createSignal(readNumber(deps.params, 'BATT_MONITOR', 0));
  const status = (): SettledStatus => (monitor() !== 0 ? 'done' : 'todo');

  return {
    id: 'battery',
    title: translate('setup.battery.title'),
    icon: '🔋',
    safetyNote: translate('setup.battery.safety'),
    status,
    allowManualComplete: false,
    render: (api): JSX.Element => (
      <BatteryPanel params={deps.params} api={api} onMonitorValue={setMonitor} />
    ),
  };
}
