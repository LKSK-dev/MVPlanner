/**
 * Public surface for the Setup battery monitor step (T5.9). Consumers compose
 * this `SetupStep` into the setup wizard registry and inject a ParamClient.
 */
export { createBatteryStep, type BatteryStepDeps } from './battery-step';
export {
  BATTERY_MONITOR_OPTIONS,
  BATTERY_POWER_MODULE_PRESETS,
  batteryMonitorOption,
  batteryPresetById,
  visibleFieldsForBatteryMonitor,
  type BatteryMonitorOption,
  type BatteryMonitorValue,
  type BatteryParamName,
  type BatteryPowerModulePreset,
  type BatteryPresetParams,
  type BatteryVisibleFields,
} from './presets';
export { registerBatteryMessages, SETUP_BATTERY_MESSAGES } from './messages';
