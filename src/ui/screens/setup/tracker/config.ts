/**
 * Antenna-tracker configuration table (task T8.9; spec plan/04 §4.12).
 *
 * A pure description of the key ArduPilot AntennaTracker parameters the config
 * form edits, plus helpers to snapshot the current values from a
 * {@link ParamClient} cache. The actual reads/writes go through the injected
 * `ParamClient` (`get` / `set`) exactly like the other setup steps — this module
 * carries no MAVLink or I/O, so it is trivially unit-testable.
 */
import type { ParamClient } from '../../../../contracts';

/** The tracker parameters surfaced by the config form. */
export type TrackerParamName =
  | 'YAW_RANGE'
  | 'PITCH_MIN'
  | 'PITCH_MAX'
  | 'DISTANCE_MIN'
  | 'SERVO_PITCH_TYPE'
  | 'SERVO_YAW_TYPE';

/** A selectable option for an enum-valued tracker parameter. */
export interface TrackerEnumOption {
  readonly value: number;
  readonly labelKey: string;
}

/** Description of one editable tracker parameter field. */
export interface TrackerConfigField {
  readonly param: TrackerParamName;
  readonly labelKey: string;
  /** `number` → numeric input; `enum` → a `select` of {@link options}. */
  readonly kind: 'number' | 'enum';
  /** Default shown when the parameter is absent from the cache. */
  readonly default: number;
  /** Numeric `<input step>` (for `kind === 'number'`). */
  readonly step?: string;
  /** Options for `kind === 'enum'`. */
  readonly options?: readonly TrackerEnumOption[];
}

/** Servo-driver type options shared by the pitch/yaw servo-type parameters. */
export const TRACKER_SERVO_TYPE_OPTIONS: readonly TrackerEnumOption[] = [
  { value: 0, labelKey: 'tracker.config.servoType.position' },
  { value: 1, labelKey: 'tracker.config.servoType.onoff' },
  { value: 2, labelKey: 'tracker.config.servoType.cr' },
];

/** The editable tracker configuration fields, in display order. */
export const TRACKER_CONFIG_FIELDS: readonly TrackerConfigField[] = [
  {
    param: 'SERVO_YAW_TYPE',
    labelKey: 'tracker.config.field.yawType',
    kind: 'enum',
    default: 0,
    options: TRACKER_SERVO_TYPE_OPTIONS,
  },
  {
    param: 'SERVO_PITCH_TYPE',
    labelKey: 'tracker.config.field.pitchType',
    kind: 'enum',
    default: 0,
    options: TRACKER_SERVO_TYPE_OPTIONS,
  },
  {
    param: 'YAW_RANGE',
    labelKey: 'tracker.config.field.yawRange',
    kind: 'number',
    default: 360,
    step: '1',
  },
  {
    param: 'PITCH_MIN',
    labelKey: 'tracker.config.field.pitchMin',
    kind: 'number',
    default: -90,
    step: '1',
  },
  {
    param: 'PITCH_MAX',
    labelKey: 'tracker.config.field.pitchMax',
    kind: 'number',
    default: 90,
    step: '1',
  },
  {
    param: 'DISTANCE_MIN',
    labelKey: 'tracker.config.field.distanceMin',
    kind: 'number',
    default: 5,
    step: '1',
  },
];

/** A snapshot of every tracker config value keyed by parameter name. */
export type TrackerConfig = Record<TrackerParamName, number>;

/** The default config used when a parameter is absent from the cache. */
export function defaultTrackerConfig(): TrackerConfig {
  const out = {} as Record<TrackerParamName, number>;
  for (const field of TRACKER_CONFIG_FIELDS) out[field.param] = field.default;
  return out;
}

/**
 * Snapshot the tracker config from a {@link ParamClient} cache (`get`), falling
 * back to the per-field default for any parameter not yet fetched.
 */
export function readTrackerConfig(params: Pick<ParamClient, 'get'>): TrackerConfig {
  const out = {} as Record<TrackerParamName, number>;
  for (const field of TRACKER_CONFIG_FIELDS) {
    out[field.param] = params.get(field.param)?.value ?? field.default;
  }
  return out;
}
