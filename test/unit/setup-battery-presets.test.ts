/**
 * Battery setup pure derivation tests (T5.9): power-module preset data and
 * visible field selection by ArduPilot `BATT_MONITOR` value.
 */
import { describe, expect, it } from 'vitest';
import {
  BATTERY_POWER_MODULE_PRESETS,
  batteryPresetById,
  visibleFieldsForBatteryMonitor,
} from '../../src/ui/screens/setup/battery';

describe('battery power-module presets', () => {
  it('includes Pixhawk standard pin and scaling values', () => {
    const preset = batteryPresetById('pixhawk-standard');
    expect(preset?.params).toMatchObject({
      BATT_VOLT_PIN: 2,
      BATT_CURR_PIN: 3,
      BATT_VOLT_MULT: 10.1,
      BATT_AMP_PERVLT: 17,
      BATT_AMP_OFFSET: 0,
    });
  });

  it('includes a Power Module 90A preset', () => {
    const preset = BATTERY_POWER_MODULE_PRESETS.find(
      (candidate) => candidate.id === 'power-module-90a',
    );
    expect(preset?.params.BATT_VOLT_MULT).toBe(15.7);
    expect(preset?.params.BATT_AMP_PERVLT).toBe(27.32);
  });
});

describe('visibleFieldsForBatteryMonitor', () => {
  it('hides analog and capacity fields when disabled', () => {
    expect(visibleFieldsForBatteryMonitor(0)).toEqual({
      presets: false,
      voltagePin: false,
      currentPin: false,
      voltageMultiplier: false,
      ampsPerVolt: false,
      ampOffset: false,
      capacity: false,
    });
  });

  it('shows only voltage analog fields for voltage-only monitors', () => {
    expect(visibleFieldsForBatteryMonitor(3)).toEqual({
      presets: true,
      voltagePin: true,
      currentPin: false,
      voltageMultiplier: true,
      ampsPerVolt: false,
      ampOffset: false,
      capacity: false,
    });
  });

  it('shows pin, divider, current scaling and capacity fields for analog current sensing', () => {
    expect(visibleFieldsForBatteryMonitor(4)).toEqual({
      presets: true,
      voltagePin: true,
      currentPin: true,
      voltageMultiplier: true,
      ampsPerVolt: true,
      ampOffset: true,
      capacity: true,
    });
  });

  it('shows capacity but not analog scaling for digital current monitors', () => {
    expect(visibleFieldsForBatteryMonitor(8)).toEqual({
      presets: false,
      voltagePin: false,
      currentPin: false,
      voltageMultiplier: false,
      ampsPerVolt: false,
      ampOffset: false,
      capacity: true,
    });
  });
});
