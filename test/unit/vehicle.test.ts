/**
 * Vehicle-model tests (task T1.5; spec plan/03 §3.3, plan/04 §4.11).
 *
 * Built against synthetic `DecodedMessage` objects — the model depends only on
 * the FROZEN `DecodedMessage`/`VehicleState` types, not the codec. Covers class
 * mapping per `MAV_TYPE`, armed flag on/off, ArduPilot/PX4 mode decode (incl.
 * pinned copter/plane/rover values and unknown→numeric fallback), and field
 * derivation from GLOBAL_POSITION_INT / SYS_STATUS / GPS_RAW_INT / ATTITUDE /
 * VFR_HUD / BATTERY_STATUS / EKF_STATUS_REPORT / HOME_POSITION.
 */
import { describe, expect, it } from 'vitest';
import type { DecodedMessage, FieldValue } from '../../src/contracts';
import {
  VehicleModel,
  classifyMavType,
  decodeMode,
  decodePx4Mode,
  MAV_AUTOPILOT_ARDUPILOTMEGA,
  MAV_AUTOPILOT_PX4,
} from '../../src/vehicle';

const ARDU = MAV_AUTOPILOT_ARDUPILOTMEGA;

// MAV_TYPE constants used in tests.
const T_QUAD = 2;
const T_HEXA = 13;
const T_OCTO = 14;
const T_TRI = 15;
const T_HELI = 4;
const T_COAX = 3;
const T_DODECA = 29;
const T_FIXED = 1;
const T_VTOL_QUAD = 20;
const T_ROVER = 10;
const T_BOAT = 11;
const T_SUB = 12;
const T_TRACKER = 5;
const T_GCS = 6;

const MAV_MODE_FLAG_SAFETY_ARMED = 0x80;

interface MsgInit {
  name: string;
  msgId?: number;
  sysid?: number;
  compid?: number;
  seq?: number;
  fields?: Record<string, FieldValue>;
}

function decoded(init: MsgInit): DecodedMessage {
  return {
    sysid: init.sysid ?? 1,
    compid: init.compid ?? 1,
    seq: init.seq ?? 0,
    msgId: init.msgId ?? 0,
    name: init.name,
    fields: init.fields ?? {},
    crcOk: true,
    signed: false,
    rxTimeUs: 0,
    raw: new Uint8Array(0),
  };
}

function heartbeat(opts: {
  type: number;
  autopilot?: number;
  baseMode?: number;
  customMode?: number;
  sysid?: number;
  compid?: number;
}): DecodedMessage {
  return decoded({
    name: 'HEARTBEAT',
    msgId: 0,
    ...(opts.sysid !== undefined ? { sysid: opts.sysid } : {}),
    ...(opts.compid !== undefined ? { compid: opts.compid } : {}),
    fields: {
      type: opts.type,
      autopilot: opts.autopilot ?? ARDU,
      base_mode: opts.baseMode ?? 0,
      custom_mode: opts.customMode ?? 0,
      system_status: 0,
      mavlink_version: 3,
    },
  });
}

describe('classifyMavType', () => {
  it('maps each MAV_TYPE to its VehicleClass', () => {
    expect(classifyMavType(T_QUAD)).toBe('copter');
    expect(classifyMavType(T_HEXA)).toBe('copter');
    expect(classifyMavType(T_OCTO)).toBe('copter');
    expect(classifyMavType(T_TRI)).toBe('copter');
    expect(classifyMavType(T_HELI)).toBe('copter');
    expect(classifyMavType(T_COAX)).toBe('copter');
    expect(classifyMavType(T_DODECA)).toBe('copter');
    expect(classifyMavType(T_FIXED)).toBe('plane');
    expect(classifyMavType(T_VTOL_QUAD)).toBe('plane');
    expect(classifyMavType(T_ROVER)).toBe('rover');
    expect(classifyMavType(T_BOAT)).toBe('boat');
    expect(classifyMavType(T_SUB)).toBe('sub');
    expect(classifyMavType(T_TRACKER)).toBe('tracker');
    expect(classifyMavType(T_GCS)).toBe('unknown');
    expect(classifyMavType(0)).toBe('unknown');
  });

  it('classifies every VTOL variant as plane', () => {
    for (const t of [19, 20, 21, 22, 23, 24, 25]) {
      expect(classifyMavType(t)).toBe('plane');
    }
  });
});

describe('decodeMode — ArduPilot per-class maps', () => {
  it('pins known copter custom_mode values', () => {
    expect(decodeMode('copter', ARDU, 0)).toBe('STABILIZE');
    expect(decodeMode('copter', ARDU, 3)).toBe('AUTO');
    expect(decodeMode('copter', ARDU, 4)).toBe('GUIDED');
    expect(decodeMode('copter', ARDU, 5)).toBe('LOITER');
    expect(decodeMode('copter', ARDU, 6)).toBe('RTL');
    expect(decodeMode('copter', ARDU, 16)).toBe('POSHOLD');
  });

  it('pins known plane custom_mode values', () => {
    expect(decodeMode('plane', ARDU, 0)).toBe('MANUAL');
    expect(decodeMode('plane', ARDU, 10)).toBe('AUTO');
    expect(decodeMode('plane', ARDU, 11)).toBe('RTL');
    expect(decodeMode('plane', ARDU, 17)).toBe('QSTABILIZE');
  });

  it('pins known rover/boat custom_mode values (shared table)', () => {
    expect(decodeMode('rover', ARDU, 0)).toBe('MANUAL');
    expect(decodeMode('rover', ARDU, 10)).toBe('AUTO');
    expect(decodeMode('rover', ARDU, 11)).toBe('RTL');
    expect(decodeMode('boat', ARDU, 11)).toBe('RTL');
  });

  it('pins known sub and tracker custom_mode values', () => {
    expect(decodeMode('sub', ARDU, 9)).toBe('SURFACE');
    expect(decodeMode('sub', ARDU, 19)).toBe('MANUAL');
    expect(decodeMode('tracker', ARDU, 2)).toBe('SCAN');
    expect(decodeMode('tracker', ARDU, 10)).toBe('AUTO');
  });

  it('falls back to the numeric value for unmapped ArduPilot modes', () => {
    expect(decodeMode('copter', ARDU, 99)).toBe('99');
    expect(decodeMode('sub', ARDU, 5)).toBe('5'); // gap in the sub table
  });

  it('falls back to numeric for unknown class / autopilot', () => {
    expect(decodeMode('unknown', ARDU, 3)).toBe('3');
    expect(decodeMode('copter', 99, 3)).toBe('3');
  });
});

describe('decodePx4Mode — best-effort PX4 decode', () => {
  it('decodes the main-mode high byte', () => {
    expect(decodePx4Mode(1 << 16)).toBe('MANUAL');
    expect(decodePx4Mode(3 << 16)).toBe('POSCTL');
    expect(decodePx4Mode(6 << 16)).toBe('OFFBOARD');
  });

  it('decodes AUTO sub-modes', () => {
    expect(decodePx4Mode((4 << 16) | (4 << 24))).toBe('AUTO.MISSION');
    expect(decodePx4Mode((4 << 16) | (5 << 24))).toBe('AUTO.RTL');
    expect(decodePx4Mode(4 << 16)).toBe('AUTO'); // no sub-mode
  });

  it('falls back to numeric when the main-mode byte is zero/unknown', () => {
    expect(decodePx4Mode(0)).toBe('0');
    expect(decodePx4Mode(42)).toBe('42');
  });

  it('routes PX4 autopilot through decodeMode', () => {
    expect(decodeMode('copter', MAV_AUTOPILOT_PX4, 4 << 16)).toBe('AUTO');
  });
});

describe('VehicleModel — HEARTBEAT: class, armed, mode', () => {
  it('derives class and pinned mode from a copter HEARTBEAT', () => {
    const m = new VehicleModel();
    m.ingest(heartbeat({ type: T_QUAD, customMode: 3 }), 1000);
    const s = m.getState(1, 1);
    expect(s?.vehicleClass).toBe('copter');
    expect(s?.mavType).toBe(T_QUAD);
    expect(s?.autopilot).toBe(ARDU);
    expect(s?.mode).toBe('AUTO');
    expect(s?.lastHeartbeatMs).toBe(1000);
  });

  it('reflects the armed flag on and off', () => {
    const m = new VehicleModel();
    m.ingest(heartbeat({ type: T_QUAD, baseMode: MAV_MODE_FLAG_SAFETY_ARMED, customMode: 6 }));
    expect(m.getState(1, 1)?.armed).toBe(true);
    expect(m.getState(1, 1)?.mode).toBe('RTL');

    m.ingest(heartbeat({ type: T_QUAD, baseMode: 0, customMode: 4 }));
    expect(m.getState(1, 1)?.armed).toBe(false);
    expect(m.getState(1, 1)?.mode).toBe('GUIDED');
  });

  it('decodes plane and rover modes by class', () => {
    const m = new VehicleModel();
    m.ingest(heartbeat({ type: T_FIXED, customMode: 10 }));
    expect(m.getState(1, 1)?.mode).toBe('AUTO');
    m.ingest(heartbeat({ type: T_FIXED, customMode: 11 }));
    expect(m.getState(1, 1)?.mode).toBe('RTL');

    m.ingest(heartbeat({ type: T_ROVER, customMode: 11, sysid: 2 }));
    expect(m.getState(2, 1)?.vehicleClass).toBe('rover');
    expect(m.getState(2, 1)?.mode).toBe('RTL');
  });

  it('renders an unknown class mode as the numeric custom_mode string', () => {
    const m = new VehicleModel();
    m.ingest(heartbeat({ type: T_GCS, customMode: 7 }));
    const s = m.getState(1, 1);
    expect(s?.vehicleClass).toBe('unknown');
    expect(s?.mode).toBe('7');
  });
});

describe('VehicleModel — field derivation from telemetry', () => {
  it('derives position/velocity from GLOBAL_POSITION_INT', () => {
    const m = new VehicleModel();
    m.ingest(
      decoded({
        name: 'GLOBAL_POSITION_INT',
        msgId: 33,
        fields: {
          time_boot_ms: 0,
          lat: -353632621,
          lon: 1491652374,
          alt: 584090,
          relative_alt: 100000,
          vx: 300,
          vy: 400,
          vz: -150,
          hdg: 9000,
        },
      }),
    );
    const s = m.getState(1, 1);
    expect(s?.position?.lat).toBeCloseTo(-35.3632621, 6);
    expect(s?.position?.lon).toBeCloseTo(149.1652374, 6);
    expect(s?.position?.altAmslM).toBeCloseTo(584.09, 3);
    expect(s?.position?.altRelM).toBeCloseTo(100, 3);
    expect(s?.velocity?.groundMs).toBeCloseTo(5, 3); // hypot(3,4) m/s
    expect(s?.velocity?.climbMs).toBeCloseTo(1.5, 3); // -vz/100
  });

  it('refines velocity (airspeed) from VFR_HUD', () => {
    const m = new VehicleModel();
    m.ingest(
      decoded({
        name: 'VFR_HUD',
        msgId: 74,
        fields: {
          airspeed: 18.5,
          groundspeed: 17.2,
          alt: 120,
          climb: 2.5,
          heading: 90,
          throttle: 60,
        },
      }),
    );
    const s = m.getState(1, 1);
    expect(s?.velocity?.groundMs).toBeCloseTo(17.2, 3);
    expect(s?.velocity?.airMs).toBeCloseTo(18.5, 3);
    expect(s?.velocity?.climbMs).toBeCloseTo(2.5, 3);
  });

  it('derives attitude (radians) from ATTITUDE', () => {
    const m = new VehicleModel();
    m.ingest(
      decoded({
        name: 'ATTITUDE',
        msgId: 30,
        fields: {
          time_boot_ms: 0,
          roll: 0.1,
          pitch: -0.2,
          yaw: 1.57,
          rollspeed: 0,
          pitchspeed: 0,
          yawspeed: 0,
        },
      }),
    );
    const s = m.getState(1, 1);
    expect(s?.attitude.rollRad).toBeCloseTo(0.1, 6);
    expect(s?.attitude.pitchRad).toBeCloseTo(-0.2, 6);
    expect(s?.attitude.yawRad).toBeCloseTo(1.57, 6);
  });

  it('derives battery + EKF health from SYS_STATUS', () => {
    const m = new VehicleModel();
    const AHRS = 0x200000;
    m.ingest(
      decoded({
        name: 'SYS_STATUS',
        msgId: 1,
        fields: {
          onboard_control_sensors_present: AHRS,
          onboard_control_sensors_enabled: AHRS,
          onboard_control_sensors_health: AHRS,
          load: 250,
          voltage_battery: 12600, // mV → 12.6 V
          current_battery: 1550, // cA → 15.5 A
          drop_rate_comm: 0,
          errors_comm: 0,
          errors_count1: 0,
          errors_count2: 0,
          errors_count3: 0,
          errors_count4: 0,
          battery_remaining: 87,
        },
      }),
    );
    const s = m.getState(1, 1);
    expect(s?.battery?.voltageV).toBeCloseTo(12.6, 3);
    expect(s?.battery?.currentA).toBeCloseTo(15.5, 3);
    expect(s?.battery?.remainingPct).toBe(87);
    expect(s?.ekfOk).toBe(true);
  });

  it('reports ekfOk=false when the AHRS health bit is clear', () => {
    const m = new VehicleModel();
    const AHRS = 0x200000;
    m.ingest(
      decoded({
        name: 'SYS_STATUS',
        msgId: 1,
        fields: {
          onboard_control_sensors_present: AHRS,
          onboard_control_sensors_enabled: AHRS,
          onboard_control_sensors_health: 0,
          load: 0,
          voltage_battery: 0xffff, // unknown → no battery
          current_battery: -1,
          drop_rate_comm: 0,
          errors_comm: 0,
          errors_count1: 0,
          errors_count2: 0,
          errors_count3: 0,
          errors_count4: 0,
          battery_remaining: -1,
        },
      }),
    );
    const s = m.getState(1, 1);
    expect(s?.ekfOk).toBe(false);
    expect(s?.battery).toBeUndefined();
  });

  it('derives gps fix/sats/hdop from GPS_RAW_INT', () => {
    const m = new VehicleModel();
    m.ingest(
      decoded({
        name: 'GPS_RAW_INT',
        msgId: 24,
        fields: {
          time_usec: 0n,
          lat: 0,
          lon: 0,
          alt: 0,
          eph: 121, // → hdop 1.21
          epv: 0,
          vel: 0,
          cog: 0,
          fix_type: 3,
          satellites_visible: 14,
        },
      }),
    );
    const s = m.getState(1, 1);
    expect(s?.gps?.fix).toBe(3);
    expect(s?.gps?.sats).toBe(14);
    expect(s?.gps?.hdop).toBeCloseTo(1.21, 3);
  });

  it('refines battery from BATTERY_STATUS (cell voltage + consumed mAh)', () => {
    const m = new VehicleModel();
    m.ingest(
      decoded({
        name: 'BATTERY_STATUS',
        msgId: 147,
        fields: {
          current_consumed: 1234, // mAh
          energy_consumed: 0,
          temperature: 0,
          voltages: [12550, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
          current_battery: 900, // cA → 9.0 A
          id: 0,
          battery_function: 0,
          type: 0,
          battery_remaining: 78,
        },
      }),
    );
    const s = m.getState(1, 1);
    expect(s?.battery?.voltageV).toBeCloseTo(12.55, 3);
    expect(s?.battery?.currentA).toBeCloseTo(9.0, 3);
    expect(s?.battery?.consumedmAh).toBe(1234);
    expect(s?.battery?.remainingPct).toBe(78);
  });

  it('derives ekfOk from EKF_STATUS_REPORT flags', () => {
    const m = new VehicleModel();
    const flags = 0x01 | 0x02 | 0x10; // ATTITUDE | VELOCITY_HORIZ | POS_HORIZ_ABS
    m.ingest(decoded({ name: 'EKF_STATUS_REPORT', msgId: 193, fields: { flags } }));
    expect(m.getState(1, 1)?.ekfOk).toBe(true);

    m.ingest(decoded({ name: 'EKF_STATUS_REPORT', msgId: 193, fields: { flags: 0x01 | 0x400 } }));
    expect(m.getState(1, 1)?.ekfOk).toBe(false);
  });

  it('derives home from HOME_POSITION', () => {
    const m = new VehicleModel();
    m.ingest(
      decoded({
        name: 'HOME_POSITION',
        msgId: 242,
        fields: {
          latitude: -353632621,
          longitude: 1491652374,
          altitude: 584000,
          x: 0,
          y: 0,
          z: 0,
          q: [1, 0, 0, 0],
          approach_x: 0,
          approach_y: 0,
          approach_z: 0,
        },
      }),
    );
    const s = m.getState(1, 1);
    expect(s?.home?.lat).toBeCloseTo(-35.3632621, 6);
    expect(s?.home?.lon).toBeCloseTo(149.1652374, 6);
    expect(s?.home?.altM).toBeCloseTo(584, 3);
  });

  it('formats firmware from AUTOPILOT_VERSION.flight_sw_version', () => {
    const m = new VehicleModel();
    const ver = (4 << 24) | (5 << 16) | (7 << 8) | 255; // 4.5.7
    m.ingest(
      decoded({ name: 'AUTOPILOT_VERSION', msgId: 148, fields: { flight_sw_version: ver } }),
    );
    expect(m.getState(1, 1)?.firmware).toBe('4.5.7');
  });

  it('derives vibration from VIBRATION', () => {
    const m = new VehicleModel();
    m.ingest(
      decoded({
        name: 'VIBRATION',
        msgId: 241,
        fields: {
          time_usec: 0n,
          vibration_x: 5,
          vibration_y: 6,
          vibration_z: 7,
          clipping_0: 0,
          clipping_1: 0,
          clipping_2: 0,
        },
      }),
    );
    const s = m.getState(1, 1);
    expect(s?.vibe).toEqual({ x: 5, y: 6, z: 7 });
  });
});

describe('VehicleModel — bookkeeping', () => {
  it('defaults link stats to zeros (filled by the worker host, T1.9)', () => {
    const m = new VehicleModel();
    m.ingest(heartbeat({ type: T_QUAD }));
    expect(m.getState(1, 1)?.link).toEqual({
      bytesIn: 0,
      bytesOut: 0,
      packetsIn: 0,
      lossPct: 0,
      rateHz: 0,
      signed: false,
    });
  });

  it('isolates state per (sysid, compid) and lists vehicles sorted', () => {
    const m = new VehicleModel();
    m.ingest(heartbeat({ type: T_FIXED, customMode: 10, sysid: 2, compid: 1 }));
    m.ingest(heartbeat({ type: T_QUAD, customMode: 5, sysid: 1, compid: 1 }));
    const list = m.listVehicles();
    expect(list.map((v) => [v.sysid, v.compid])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(m.getState(1, 1)?.vehicleClass).toBe('copter');
    expect(m.getState(2, 1)?.vehicleClass).toBe('plane');
  });

  it('uses the injected clock when nowMs is omitted', () => {
    let t = 5000;
    const m = new VehicleModel({ clock: () => t });
    m.ingest(heartbeat({ type: T_QUAD }));
    expect(m.getState(1, 1)?.lastHeartbeatMs).toBe(5000);
    t = 6000;
    m.ingest(heartbeat({ type: T_QUAD }));
    expect(m.getState(1, 1)?.lastHeartbeatMs).toBe(6000);
  });

  it('notifies onChange listeners with snapshot copies and unsubscribes', () => {
    const m = new VehicleModel();
    const seen: string[] = [];
    const off = m.onChange((s) => seen.push(s.mode));
    m.ingest(heartbeat({ type: T_QUAD, customMode: 3 }));
    m.ingest(heartbeat({ type: T_QUAD, customMode: 6 }));
    off();
    m.ingest(heartbeat({ type: T_QUAD, customMode: 4 }));
    expect(seen).toEqual(['AUTO', 'RTL']);
  });

  it('returns copies that cannot mutate internal state', () => {
    const m = new VehicleModel();
    m.ingest(heartbeat({ type: T_QUAD, customMode: 3 }));
    const a = m.getState(1, 1);
    if (a) a.mode = 'TAMPERED';
    expect(m.getState(1, 1)?.mode).toBe('AUTO');
  });
});
