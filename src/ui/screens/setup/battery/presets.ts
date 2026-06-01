/**
 * Pure battery-monitor setup data and derivation helpers (T5.9; spec plan/04
 * §4.4 battery monitor). These values are intentionally UI-framework agnostic so
 * unit tests can validate ArduPilot param mapping without mounting Solid.
 */

/** ArduPilot battery monitor selector values surfaced by the setup step. */
export type BatteryMonitorValue = 0 | 3 | 4 | 5 | 6 | 7 | 8;

/** A monitor type option for `BATT_MONITOR`. */
export interface BatteryMonitorOption {
  /** Numeric ArduPilot `BATT_MONITOR` value. */
  readonly value: BatteryMonitorValue;
  /** i18n key for the option label. */
  readonly labelKey: string;
  /** True when the monitor reports current draw / consumed mAh. */
  readonly currentSensing: boolean;
  /** True when the monitor uses the analog pin + scaling parameters. */
  readonly analog: boolean;
}

/** UI-supported monitor choices, in ArduPilot value order. */
export const BATTERY_MONITOR_OPTIONS: readonly BatteryMonitorOption[] = [
  { value: 0, labelKey: 'setup.battery.monitor.disabled', currentSensing: false, analog: false },
  { value: 3, labelKey: 'setup.battery.monitor.voltageOnly', currentSensing: false, analog: true },
  {
    value: 4,
    labelKey: 'setup.battery.monitor.voltageCurrent',
    currentSensing: true,
    analog: true,
  },
  { value: 5, labelKey: 'setup.battery.monitor.solo', currentSensing: true, analog: false },
  { value: 6, labelKey: 'setup.battery.monitor.bebop', currentSensing: true, analog: false },
  { value: 7, labelKey: 'setup.battery.monitor.smbusMaxell', currentSensing: true, analog: false },
  { value: 8, labelKey: 'setup.battery.monitor.uavcan', currentSensing: true, analog: false },
] as const;

/** Battery setup parameter names owned by T5.9. */
export type BatteryParamName =
  | 'BATT_MONITOR'
  | 'BATT_VOLT_PIN'
  | 'BATT_CURR_PIN'
  | 'BATT_VOLT_MULT'
  | 'BATT_AMP_PERVLT'
  | 'BATT_AMP_OFFSET'
  | 'BATT_CAPACITY';

/** Parameter writes performed by a power-module preset. */
export type BatteryPresetParams = Partial<Record<BatteryParamName, number>>;

/** A power-module preset that writes known ArduPilot battery scaling params. */
export interface BatteryPowerModulePreset {
  /** Stable UI/test id. */
  readonly id: string;
  /** i18n key for the preset label. */
  readonly labelKey: string;
  /** Parameter values written when the preset is applied. */
  readonly params: BatteryPresetParams;
}

/** Known power-module presets. Values are ArduPilot `BATT_*` parameters. */
export const BATTERY_POWER_MODULE_PRESETS: readonly BatteryPowerModulePreset[] = [
  {
    id: 'pixhawk-standard',
    labelKey: 'setup.battery.preset.pixhawkStandard',
    params: {
      BATT_VOLT_PIN: 2,
      BATT_CURR_PIN: 3,
      BATT_VOLT_MULT: 10.1,
      BATT_AMP_PERVLT: 17,
      BATT_AMP_OFFSET: 0,
    },
  },
  {
    id: 'power-module-90a',
    labelKey: 'setup.battery.preset.powerModule90A',
    params: {
      BATT_VOLT_PIN: 2,
      BATT_CURR_PIN: 3,
      BATT_VOLT_MULT: 15.7,
      BATT_AMP_PERVLT: 27.32,
      BATT_AMP_OFFSET: 0,
    },
  },
  {
    id: 'holybro-pm02',
    labelKey: 'setup.battery.preset.holybroPm02',
    params: {
      BATT_VOLT_PIN: 2,
      BATT_CURR_PIN: 3,
      BATT_VOLT_MULT: 18.182,
      BATT_AMP_PERVLT: 36.364,
      BATT_AMP_OFFSET: 0,
    },
  },
] as const;

/** Which editor fields should be visible for a monitor type. */
export interface BatteryVisibleFields {
  /** Power-module presets write analog pin/scaling params. */
  readonly presets: boolean;
  /** `BATT_VOLT_PIN`. */
  readonly voltagePin: boolean;
  /** `BATT_CURR_PIN`. */
  readonly currentPin: boolean;
  /** `BATT_VOLT_MULT`. */
  readonly voltageMultiplier: boolean;
  /** `BATT_AMP_PERVLT`. */
  readonly ampsPerVolt: boolean;
  /** `BATT_AMP_OFFSET`. */
  readonly ampOffset: boolean;
  /** `BATT_CAPACITY`. */
  readonly capacity: boolean;
}

/** Find a monitor option, defaulting unknown non-zero values to current-sensing. */
export function batteryMonitorOption(value: number): BatteryMonitorOption {
  const known = BATTERY_MONITOR_OPTIONS.find((option) => option.value === value);
  if (known !== undefined) return known;
  return {
    value: 4,
    labelKey: 'setup.battery.monitor.custom',
    currentSensing: value !== 0,
    analog: false,
  };
}

/**
 * Derive the visible editor fields for a `BATT_MONITOR` value.
 *
 * Analog voltage-only monitors expose voltage pin + multiplier. Analog
 * voltage/current monitors additionally expose current pin, amps-per-volt,
 * offset and capacity. Digital/current-aware monitors expose capacity only.
 */
export function visibleFieldsForBatteryMonitor(value: number): BatteryVisibleFields {
  const option = batteryMonitorOption(value);
  const analogCurrent = option.analog && option.currentSensing;
  return {
    presets: option.analog,
    voltagePin: option.analog,
    currentPin: analogCurrent,
    voltageMultiplier: option.analog,
    ampsPerVolt: analogCurrent,
    ampOffset: analogCurrent,
    capacity: option.currentSensing,
  };
}

/** Lookup a power-module preset by id. */
export function batteryPresetById(id: string): BatteryPowerModulePreset | undefined {
  return BATTERY_POWER_MODULE_PRESETS.find((preset) => preset.id === id);
}
