/**
 * Vehicle-aware PID / tuning parameter groups (task T3.6; spec plan/04 §4.5
 * tuning). Pure, DOM-free data: each {@link TuningGroup} names the ArduPilot
 * parameters of one controller group (rate / angle / position / steering…) for
 * a {@link VehicleClass}, so the tuning panel renders the relevant editable
 * tables for the ACTIVE vehicle only. Metadata (units / range / description) is
 * resolved separately from the {@link import('../../../widgets/paramgrid').ParamMetaResolver};
 * this module only decides WHICH parameters belong to WHICH group.
 *
 * The parameter names follow ArduPilot conventions (Copter `ATC_*` / `PSC_*`,
 * Plane `*_RATE_*`, Rover `ATC_STR_RAT_*` / `ATC_SPEED_*`). Unknown firmwares
 * still render — the grid simply shows whatever values the vehicle reports.
 */
import type { VehicleClass } from '../../../../contracts';

/**
 * `MAV_CMD_DO_AUTOTUNE_ENABLE` (212) — start/stop autotune via a COMMAND_LONG
 * (`param1` = 1 to enable, 0 to disable). A frozen MAVLink wire id (protocol
 * constants never change); resolved here so the tuning panel needs no extra
 * dialect import. Copter additionally exposes an `AUTOTUNE` flight mode — see
 * the tuning panel README for the SHOULD-level scope of this control.
 */
export const MAV_CMD_DO_AUTOTUNE_ENABLE = 212;

/** One controller group: a stable id (i18n `tuning.group.<id>`) + its params. */
export interface TuningGroup {
  /** Stable group id; the i18n title key is `tuning.group.<id>`. */
  readonly id: string;
  /** ArduPilot parameter names in this group, in display order. */
  readonly params: readonly string[];
}

/** ArduCopter (and Sub) rate / angle / position controller groups. */
const COPTER_GROUPS: readonly TuningGroup[] = [
  {
    id: 'rate',
    params: [
      'ATC_RAT_RLL_P',
      'ATC_RAT_RLL_I',
      'ATC_RAT_RLL_D',
      'ATC_RAT_PIT_P',
      'ATC_RAT_PIT_I',
      'ATC_RAT_PIT_D',
      'ATC_RAT_YAW_P',
      'ATC_RAT_YAW_I',
      'ATC_RAT_YAW_D',
    ],
  },
  {
    id: 'angle',
    params: ['ATC_ANG_RLL_P', 'ATC_ANG_PIT_P', 'ATC_ANG_YAW_P'],
  },
  {
    id: 'position',
    params: ['PSC_POSXY_P', 'PSC_VELXY_P', 'PSC_POSZ_P', 'PSC_VELZ_P'],
  },
];

/**
 * ArduPlane groups: the fixed-wing `*_RATE_*` controllers (4.1+) plus the
 * QuadPlane VTOL attitude/rate controllers. ArduPlane runs the multirotor
 * `AC_AttitudeControl` for VTOL flight under the `Q_A_*` prefix — the same
 * controller Copter exposes as `ATC_*` (source: ArduPlane `quadplane.cpp` /
 * `Parameters.cpp`, `Q_A_RAT_*` / `Q_A_ANG_*`). These are only present when
 * `Q_ENABLE = 1`; on a pure fixed-wing the grid simply shows nothing for them.
 */
const PLANE_GROUPS: readonly TuningGroup[] = [
  {
    id: 'rate',
    params: [
      'RLL_RATE_P',
      'RLL_RATE_I',
      'RLL_RATE_D',
      'RLL_RATE_FF',
      'PTCH_RATE_P',
      'PTCH_RATE_I',
      'PTCH_RATE_D',
      'PTCH_RATE_FF',
      'YAW_RATE_P',
      'YAW_RATE_I',
      'YAW_RATE_D',
      'YAW_RATE_FF',
    ],
  },
  {
    id: 'vtolRate',
    params: [
      'Q_A_RAT_RLL_P',
      'Q_A_RAT_RLL_I',
      'Q_A_RAT_RLL_D',
      'Q_A_RAT_PIT_P',
      'Q_A_RAT_PIT_I',
      'Q_A_RAT_PIT_D',
      'Q_A_RAT_YAW_P',
      'Q_A_RAT_YAW_I',
      'Q_A_RAT_YAW_D',
    ],
  },
  {
    id: 'vtolAngle',
    params: ['Q_A_ANG_RLL_P', 'Q_A_ANG_PIT_P', 'Q_A_ANG_YAW_P'],
  },
];

/** ArduRover (and Boat) steering + speed controller group. */
const ROVER_GROUPS: readonly TuningGroup[] = [
  {
    id: 'controllers',
    params: [
      'ATC_STR_RAT_P',
      'ATC_STR_RAT_I',
      'ATC_STR_RAT_D',
      'ATC_STR_RAT_FF',
      'ATC_SPEED_P',
      'ATC_SPEED_I',
      'ATC_SPEED_D',
      'ATC_SPEED_FF',
    ],
  },
];

/**
 * The tuning groups for a vehicle class. Sub reuses the Copter groups and Boat
 * reuses the Rover groups (same controllers); an unknown class falls back to
 * Copter (the most common). Tracker has no PID tuning surface here.
 */
export function tuningGroupsForClass(cls: VehicleClass): readonly TuningGroup[] {
  switch (cls) {
    case 'plane':
      return PLANE_GROUPS;
    case 'rover':
    case 'boat':
      return ROVER_GROUPS;
    case 'tracker':
      return [];
    case 'copter':
    case 'sub':
    case 'unknown':
    default:
      return COPTER_GROUPS;
  }
}

/** Flatten every parameter name across `groups` (de-duplicated, in order). */
export function groupParamNames(groups: readonly TuningGroup[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    for (const name of g.params) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Pick the key proportional gains for the extended-tune sliders (SHOULD): up to
 * `limit` `*_P` parameters from the first group (e.g. Copter rate roll/pitch/yaw
 * P). Returns `[]` when the class has no groups.
 */
export function sliderParamsForClass(cls: VehicleClass, limit = 3): readonly string[] {
  const groups = tuningGroupsForClass(cls);
  const first = groups[0];
  if (first === undefined) return [];
  return first.params.filter((name) => name.endsWith('_P')).slice(0, limit);
}
