/**
 * Pure flight-mode option and mapping derivation helpers for the setup modes
 * step (T5.7; spec plan/04 §4.4). This module has no Solid or MAVLink side
 * effects: callers provide a vehicle class and a parameter-value reader.
 */
import type { VehicleClass } from '../../../../contracts';
import { arduMapForClass } from '../../../../vehicle/mode-maps';

/** ArduPilot flight-mode switch position parameter names. */
export const FLIGHT_MODE_PARAM_NAMES = [
  'FLTMODE1',
  'FLTMODE2',
  'FLTMODE3',
  'FLTMODE4',
  'FLTMODE5',
  'FLTMODE6',
] as const;

/** ArduPilot RC channel parameter that selects the flight-mode switch input. */
export const FLIGHT_MODE_CHANNEL_PARAM = 'FLTMODE_CH' as const;

/** Optional ArduPilot simple-mode bitmask parameter. */
export const SIMPLE_MODE_PARAM = 'SIMPLE' as const;

/** Optional ArduPilot super-simple-mode bitmask parameter. */
export const SUPER_SIMPLE_MODE_PARAM = 'SUPER_SIMPLE' as const;

/** A flight-mode switch position parameter name. */
export type FlightModeParamName = (typeof FLIGHT_MODE_PARAM_NAMES)[number];

/** Any parameter observed by the flight-modes setup step. */
export type ModesParamName =
  | FlightModeParamName
  | typeof FLIGHT_MODE_CHANNEL_PARAM
  | typeof SIMPLE_MODE_PARAM
  | typeof SUPER_SIMPLE_MODE_PARAM;

/** RC channel selector values offered for `FLTMODE_CH`. */
export const FLIGHT_MODE_CHANNEL_OPTIONS: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
];

/** One vehicle-aware ArduPilot flight-mode option. */
export interface ModeOption {
  /** Numeric ArduPilot mode id written into `FLTMODEn`. */
  readonly value: number;
  /** Human-readable mode name from the per-class ArduPilot mode table. */
  readonly name: string;
}

/** Current value for one switch-position mode parameter. */
export interface FlightModePositionSelection {
  /** 1-based switch position, matching `FLTMODE1` through `FLTMODE6`. */
  readonly position: number;
  /** Parameter name backing this switch position. */
  readonly name: FlightModeParamName;
  /** Current numeric parameter value, if present and finite. */
  readonly value: number | undefined;
  /** Matched vehicle-aware option for `value`, when known. */
  readonly option: ModeOption | undefined;
}

/** Current `FLTMODE_CH` selector state. */
export interface FlightModeChannelSelection {
  /** Parameter name backing the RC channel selector. */
  readonly name: typeof FLIGHT_MODE_CHANNEL_PARAM;
  /** Current numeric parameter value, if present and finite. */
  readonly value: number | undefined;
  /** UI value; ArduPilot defaults to RC channel 5 when absent. */
  readonly displayValue: number;
  /** True when a non-disabled channel is configured in the parameter cache. */
  readonly configured: boolean;
}

/** Current optional simple/super-simple bitmask parameter state. */
export interface SimpleModeBitmaskSelection {
  /** Parameter name backing this bitmask. */
  readonly name: typeof SIMPLE_MODE_PARAM | typeof SUPER_SIMPLE_MODE_PARAM;
  /** Current finite numeric bitmask value. */
  readonly value: number;
}

/** Derived setup model for the flight-modes step. */
export interface FlightModeMapping {
  /** Vehicle class used to select the ArduPilot mode table. */
  readonly vehicleClass: VehicleClass;
  /** Vehicle-aware dropdown options sorted by numeric mode id. */
  readonly options: readonly ModeOption[];
  /** Current `FLTMODE_CH` selector state. */
  readonly channel: FlightModeChannelSelection;
  /** Current values for all six switch positions. */
  readonly positions: readonly FlightModePositionSelection[];
  /** Optional `SIMPLE` bitmask when present in the parameter cache. */
  readonly simple: SimpleModeBitmaskSelection | undefined;
  /** Optional `SUPER_SIMPLE` bitmask when present in the parameter cache. */
  readonly superSimple: SimpleModeBitmaskSelection | undefined;
  /** Count of switch positions with finite `FLTMODEn` values. */
  readonly configuredModeCount: number;
  /** Step status per T5.7 acceptance criteria. */
  readonly status: 'todo' | 'done';
}

/** Read a numeric setup-modes parameter value by name. */
export type ModesParamValueReader = (name: ModesParamName) => number | undefined;

/** Returns true when `name` is a parameter observed by the modes step. */
export function isModesParamName(name: string): name is ModesParamName {
  return (
    (FLIGHT_MODE_PARAM_NAMES as readonly string[]).includes(name) ||
    name === FLIGHT_MODE_CHANNEL_PARAM ||
    name === SIMPLE_MODE_PARAM ||
    name === SUPER_SIMPLE_MODE_PARAM
  );
}

/** Build the vehicle-aware ArduPilot mode option list for a vehicle class. */
export function modeOptionsForClass(vehicleClass: VehicleClass): readonly ModeOption[] {
  const map = arduMapForClass(vehicleClass);
  if (map === undefined) return [];
  return Object.entries(map)
    .map(([rawValue, name]): ModeOption => ({ value: Number(rawValue), name }))
    .filter((option) => Number.isFinite(option.value))
    .sort((a, b) => a.value - b.value);
}

/** Find a mode option by its numeric mode id. */
export function modeOptionForValue(
  options: readonly ModeOption[],
  value: number | undefined,
): ModeOption | undefined {
  if (value === undefined) return undefined;
  return options.find((option) => option.value === value);
}

/** Coerce a raw param value to a finite number, otherwise `undefined`. */
export function finiteParamValue(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/** Return the bit value used for a 1-based flight-mode switch position. */
export function simpleModeBitForPosition(position: number): number {
  return 1 << (position - 1);
}

/** True when `mask` has the simple/super-simple bit set for `position`. */
export function simpleModeEnabled(mask: number, position: number): boolean {
  return (Math.trunc(mask) & simpleModeBitForPosition(position)) !== 0;
}

/** Return `mask` with the simple/super-simple bit for `position` toggled. */
export function setSimpleModeEnabled(mask: number, position: number, enabled: boolean): number {
  const bit = simpleModeBitForPosition(position);
  const base = Math.trunc(mask);
  return enabled ? base | bit : base & ~bit;
}

/** Derive all mode-switch selections from the current parameter cache. */
export function deriveFlightModeMapping(
  vehicleClass: VehicleClass,
  readValue: ModesParamValueReader,
): FlightModeMapping {
  const options = modeOptionsForClass(vehicleClass);
  const positions = FLIGHT_MODE_PARAM_NAMES.map((name, index): FlightModePositionSelection => {
    const value = finiteParamValue(readValue(name));
    return {
      position: index + 1,
      name,
      value,
      option: modeOptionForValue(options, value),
    };
  });
  const channelValue = finiteParamValue(readValue(FLIGHT_MODE_CHANNEL_PARAM));
  const configuredModeCount = positions.filter((position) => position.value !== undefined).length;
  const simpleValue = finiteParamValue(readValue(SIMPLE_MODE_PARAM));
  const superSimpleValue = finiteParamValue(readValue(SUPER_SIMPLE_MODE_PARAM));

  return {
    vehicleClass,
    options,
    channel: {
      name: FLIGHT_MODE_CHANNEL_PARAM,
      value: channelValue,
      displayValue: channelValue ?? 5,
      configured: channelValue !== undefined && channelValue > 0,
    },
    positions,
    simple: simpleValue === undefined ? undefined : { name: SIMPLE_MODE_PARAM, value: simpleValue },
    superSimple:
      superSimpleValue === undefined
        ? undefined
        : { name: SUPER_SIMPLE_MODE_PARAM, value: superSimpleValue },
    configuredModeCount,
    status:
      channelValue !== undefined && channelValue > 0 && configuredModeCount > 0 ? 'done' : 'todo',
  };
}
