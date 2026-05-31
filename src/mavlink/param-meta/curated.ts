/**
 * Compact, curated **embedded fallback** parameter metadata (T3.3; spec
 * plan/04 §4.5). About four dozen of the most commonly edited ArduPilot
 * parameters, with units / ranges / enum-values / bitmasks / reboot flags where
 * well known, so type-aware editors (T3.4) have metadata out-of-the-box while
 * **offline** — before, or instead of, importing a full per-firmware
 * `apm.pdef.json` (see {@link ParamMetaStore.loadApmPdef}).
 *
 * This table is intentionally small to keep the single-file bundle light. It is
 * not authoritative or version-specific; the runtime apm.pdef import overrides
 * it field-by-field. Values mirror current ArduCopter conventions; minor
 * per-firmware/version drift is expected and acceptable for editor hints.
 *
 * Keys are stored as written; lookups in {@link ParamMetaStore} are
 * case-insensitive and instance-tolerant (e.g. `BATT2_MONITOR` → `BATT_MONITOR`,
 * `RC9_MIN` → `RC1_MIN`).
 */
import type { ParamMeta } from '../../contracts';

export const CURATED_PARAM_META: Readonly<Record<string, ParamMeta>> = {
  // --- Attitude rate PIDs (Copter) ---
  ATC_RAT_RLL_P: {
    description: 'Roll axis rate controller P gain',
    min: 0.0,
    max: 0.35,
    increment: 0.005,
  },
  ATC_RAT_RLL_I: {
    description: 'Roll axis rate controller I gain',
    min: 0.0,
    max: 0.6,
    increment: 0.01,
  },
  ATC_RAT_RLL_D: {
    description: 'Roll axis rate controller D gain',
    min: 0.0,
    max: 0.03,
    increment: 0.001,
  },
  ATC_RAT_PIT_P: {
    description: 'Pitch axis rate controller P gain',
    min: 0.0,
    max: 0.35,
    increment: 0.005,
  },
  ATC_RAT_PIT_I: {
    description: 'Pitch axis rate controller I gain',
    min: 0.0,
    max: 0.6,
    increment: 0.01,
  },
  ATC_RAT_PIT_D: {
    description: 'Pitch axis rate controller D gain',
    min: 0.0,
    max: 0.03,
    increment: 0.001,
  },
  ATC_RAT_YAW_P: {
    description: 'Yaw axis rate controller P gain',
    min: 0.0,
    max: 0.6,
    increment: 0.005,
  },
  ATC_RAT_YAW_I: {
    description: 'Yaw axis rate controller I gain',
    min: 0.0,
    max: 0.06,
    increment: 0.01,
  },
  ATC_RAT_YAW_D: {
    description: 'Yaw axis rate controller D gain',
    min: 0.0,
    max: 0.02,
    increment: 0.001,
  },
  ATC_ANG_RLL_P: {
    description: 'Roll axis angle controller P gain',
    min: 3.0,
    max: 12.0,
    increment: 0.1,
  },
  ATC_ANG_PIT_P: {
    description: 'Pitch axis angle controller P gain',
    min: 3.0,
    max: 12.0,
    increment: 0.1,
  },
  ATC_ANG_YAW_P: {
    description: 'Yaw axis angle controller P gain',
    min: 3.0,
    max: 12.0,
    increment: 0.1,
  },

  // --- Battery monitoring ---
  BATT_MONITOR: {
    description: 'Controls enabling monitoring of the battery’s voltage and current',
    rebootRequired: true,
    values: {
      0: 'Disabled',
      3: 'Analog Voltage Only',
      4: 'Analog Voltage and Current',
      7: 'SMBus-Generic',
      8: 'DroneCAN-BatteryInfo',
      9: 'ESC',
      10: 'Sum Of Selected Monitors',
    },
  },
  BATT_CAPACITY: {
    description: 'Capacity of the battery in mAh when full',
    units: 'mAh',
    min: 0,
    increment: 50,
  },
  BATT_LOW_VOLT: {
    description: 'Voltage that triggers a low battery failsafe (0 = disabled)',
    units: 'V',
    min: 0,
    max: 100,
    increment: 0.1,
  },
  BATT_CRT_VOLT: {
    description: 'Voltage that triggers a critical battery failsafe (0 = disabled)',
    units: 'V',
    min: 0,
    max: 100,
    increment: 0.1,
  },
  BATT_LOW_MAH: {
    description: 'Capacity remaining that triggers a low battery failsafe (0 = disabled)',
    units: 'mAh',
    min: 0,
    increment: 50,
  },

  // --- Arming ---
  ARMING_CHECK: {
    description: 'Bitmask of checks performed before arming the vehicle',
    bitmask: {
      0: 'All',
      1: 'Barometer',
      2: 'Compass',
      3: 'GPS lock',
      4: 'INS',
      5: 'Parameters',
      6: 'RC Channels',
      7: 'Board voltage',
      8: 'Battery Level',
      10: 'Logging Available',
      11: 'Hardware safety switch',
      12: 'GPS configuration',
    },
  },

  // --- Failsafes ---
  FS_THR_ENABLE: {
    description: 'Throttle (RC) failsafe enable and behaviour',
    values: {
      0: 'Disabled',
      1: 'Enabled always RTL',
      2: 'Enabled Continue with Mission in Auto Mode',
      3: 'Enabled always Land',
      4: 'Enabled always SmartRTL or RTL',
      5: 'Enabled always SmartRTL or Land',
    },
  },
  FS_THR_VALUE: {
    description: 'Throttle PWM below which the throttle failsafe triggers',
    units: 'PWM',
    min: 910,
    max: 1100,
    increment: 1,
  },
  FS_GCS_ENABLE: {
    description: 'GCS (ground station) failsafe enable and behaviour',
    values: {
      0: 'Disabled',
      1: 'Enabled always RTL',
      2: 'Enabled Continue with Mission in Auto Mode',
      5: 'Enabled always SmartRTL or RTL',
      6: 'Enabled always SmartRTL or Land',
      7: 'Enabled always Land',
    },
  },

  // --- Navigation & speed limits ---
  WPNAV_SPEED: {
    description: 'Horizontal speed target during a WP mission',
    units: 'cm/s',
    min: 20,
    max: 2000,
    increment: 50,
  },
  WPNAV_SPEED_UP: {
    description: 'Climb speed target during a WP mission',
    units: 'cm/s',
    min: 10,
    max: 1000,
    increment: 50,
  },
  WPNAV_SPEED_DN: {
    description: 'Descent speed target during a WP mission',
    units: 'cm/s',
    min: 10,
    max: 500,
    increment: 10,
  },
  WPNAV_RADIUS: {
    description: 'Distance from a waypoint at which it is considered reached',
    units: 'cm',
    min: 5,
    max: 1000,
    increment: 1,
  },
  RTL_ALT: {
    description: 'Minimum relative altitude climbed to before returning to launch',
    units: 'cm',
    min: 0,
    max: 27000,
    increment: 1,
  },
  RTL_SPEED: {
    description: 'Horizontal speed while returning home (0 = use WPNAV_SPEED)',
    units: 'cm/s',
    min: 0,
    max: 2000,
    increment: 50,
  },
  LAND_SPEED: {
    description: 'Descent speed for the final stage of landing',
    units: 'cm/s',
    min: 30,
    max: 200,
    increment: 10,
  },
  PILOT_SPEED_UP: {
    description: 'Maximum vertical ascending velocity the pilot may request',
    units: 'cm/s',
    min: 50,
    max: 500,
    increment: 10,
  },
  ANGLE_MAX: {
    description: 'Maximum lean angle in all flight modes',
    units: 'cdeg',
    min: 1000,
    max: 8000,
    increment: 10,
  },

  // --- Sensors / estimators ---
  GPS_TYPE: {
    description: 'GPS receiver type',
    rebootRequired: true,
    values: {
      0: 'None',
      1: 'AUTO',
      2: 'uBlox',
      5: 'NMEA',
      6: 'SiRF',
      9: 'DroneCAN',
      14: 'MAV',
      16: 'External AHRS',
    },
  },
  COMPASS_USE: {
    description: 'Enable or disable use of the first compass for yaw',
    values: { 0: 'Disabled', 1: 'Enabled' },
  },
  INS_GYRO_FILTER: {
    description: 'Low-pass filter cutoff frequency for the gyroscopes',
    units: 'Hz',
    min: 0,
    max: 256,
    increment: 1,
  },
  AHRS_EKF_TYPE: {
    description: 'Selects which EKF version is used for attitude and position estimation',
    values: { 0: 'Disabled', 2: 'Enable EKF2', 3: 'Enable EKF3', 11: 'ExternalAHRS' },
  },
  EK3_ENABLE: {
    description: 'Enable EKF3',
    rebootRequired: true,
    values: { 0: 'Disabled', 1: 'Enabled' },
  },

  // --- Frame configuration ---
  FRAME_CLASS: {
    description: 'Major frame class for the multicopter',
    rebootRequired: true,
    values: {
      0: 'Undefined',
      1: 'Quad',
      2: 'Hexa',
      3: 'Octa',
      4: 'OctaQuad',
      5: 'Y6',
      7: 'Tri',
      12: 'DodecaHexa',
    },
  },
  FRAME_TYPE: {
    description: 'Motor mixing geometry for the multicopter',
    values: {
      0: 'Plus',
      1: 'X',
      2: 'V',
      3: 'H',
      4: 'V-Tail',
      5: 'A-Tail',
      10: 'Y6B',
      12: 'BetaFlightX',
    },
  },

  // --- Serial ports ---
  SERIAL1_PROTOCOL: {
    description: 'Protocol used on the Telem1 serial port',
    rebootRequired: true,
    values: { '-1': 'None', 1: 'MAVLink1', 2: 'MAVLink2', 5: 'GPS', 23: 'RCIN' },
  },
  SERIAL1_BAUD: {
    description: 'Baud rate of the Telem1 serial port',
    rebootRequired: true,
    values: { 9: '9600', 19: '19200', 38: '38400', 57: '57600', 115: '115200', 921: '921600' },
  },

  // --- Geofence ---
  FENCE_ENABLE: {
    description: 'Enable (1) or disable (0) fence functionality',
    values: { 0: 'Disabled', 1: 'Enabled' },
  },
  FENCE_TYPE: {
    description: 'Enabled fence types (bitmask)',
    bitmask: { 0: 'Max altitude', 1: 'Circle', 2: 'Polygon', 3: 'Min altitude' },
  },
  FENCE_ACTION: {
    description: 'Action taken when the fence is breached',
    values: {
      0: 'Report Only',
      1: 'RTL or Land',
      2: 'Always Land',
      3: 'SmartRTL or RTL or Land',
      4: 'Brake or Land',
      5: 'SmartRTL or Land',
    },
  },
  FENCE_ALT_MAX: {
    description: 'Maximum altitude allowed before the fence triggers',
    units: 'm',
    min: 10,
    max: 1000,
    increment: 1,
  },
  FENCE_RADIUS: {
    description: 'Circular fence radius which when breached causes an RTL',
    units: 'm',
    min: 30,
    max: 10000,
    increment: 1,
  },

  // --- RC calibration (instance 1 — resolved for RCn_* via instance fallback) ---
  RC1_MIN: {
    description: 'RC minimum PWM pulse width',
    units: 'PWM',
    min: 800,
    max: 2200,
    increment: 1,
  },
  RC1_MAX: {
    description: 'RC maximum PWM pulse width',
    units: 'PWM',
    min: 800,
    max: 2200,
    increment: 1,
  },
  RC1_TRIM: {
    description: 'RC trim (neutral) PWM pulse width',
    units: 'PWM',
    min: 800,
    max: 2200,
    increment: 1,
  },

  // --- Flight modes & system ---
  FLTMODE1: {
    description: 'Flight mode for RC mode-switch position 1',
    values: {
      0: 'Stabilize',
      2: 'AltHold',
      3: 'Auto',
      4: 'Guided',
      5: 'Loiter',
      6: 'RTL',
      9: 'Land',
      16: 'PosHold',
    },
  },
  SYSID_THISMAV: {
    description: 'MAVLink system id of this vehicle',
    rebootRequired: true,
    min: 1,
    max: 255,
    increment: 1,
  },
};
