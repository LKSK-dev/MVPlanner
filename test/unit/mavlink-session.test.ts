/**
 * MavlinkSession tests (task T1.9; spec plan/02 §2.1/§2.6).
 *
 * Exercises the PURE host core end-to-end with REAL encoded frames (produced by
 * an independent `createMavCodec` instance): inbound parse → registry + vehicle
 * model → coalesced snapshot, plus outgoing HEARTBEAT / message encoding. No
 * Worker, no DOM, no transport — that plumbing is covered by SITL/e2e (T1.10).
 */
import { describe, expect, it } from 'vitest';
import type { DecodedMessage, MessageInput } from '../../src/contracts';
import { createMavCodec } from '../../src/mavlink/codec';
import { BUILTIN_DIALECTS } from '../../src/mavlink/dialects';
import { MavlinkSession } from '../../src/mavlink/host/session';

const MAV_TYPE_QUADROTOR = 2;
const MAV_TYPE_GCS = 6;
const MAV_AUTOPILOT_ARDUPILOTMEGA = 3;
const MAV_AUTOPILOT_INVALID = 8;
const MAV_STATE_ACTIVE = 4;
const MAV_MODE_FLAG_SAFETY_ARMED = 0x80;
const COPTER_MODE_LOITER = 5;
const COPTER_MODE_RTL = 6;

/** Independent encoder (separate from the session's internal codec). */
const codec = createMavCodec({ dialects: BUILTIN_DIALECTS });

function encode(input: MessageInput): Uint8Array {
  return codec.encode(input, { version: 2 });
}

function decodeOne(frame: Uint8Array): DecodedMessage {
  const msgs = codec.parser({ dialects: [...BUILTIN_DIALECTS] }).push(frame);
  expect(msgs).toHaveLength(1);
  const m = msgs[0];
  if (m === undefined) throw new Error('no message decoded');
  return m;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function heartbeat(customMode: number, armed: boolean, seq?: number): Uint8Array {
  const input: MessageInput = {
    name: 'HEARTBEAT',
    sysid: 1,
    compid: 1,
    fields: {
      type: MAV_TYPE_QUADROTOR,
      autopilot: MAV_AUTOPILOT_ARDUPILOTMEGA,
      base_mode: armed ? MAV_MODE_FLAG_SAFETY_ARMED : 0,
      custom_mode: customMode,
      system_status: MAV_STATE_ACTIVE,
      mavlink_version: 3,
    },
  };
  return seq === undefined ? encode(input) : codec.encode(input, { version: 2, seq });
}

describe('MavlinkSession — inbound parse + snapshot', () => {
  it('derives vehicle class / mode / armed / position / gps from real frames', () => {
    const session = new MavlinkSession({ nowMs: () => 1000 });

    const hb = heartbeat(COPTER_MODE_LOITER, true);
    const pos = encode({
      name: 'GLOBAL_POSITION_INT',
      sysid: 1,
      compid: 1,
      fields: {
        time_boot_ms: 1000,
        lat: 473977418, // 47.3977418°
        lon: 85455941, // 8.5455941°
        alt: 500000, // 500 m AMSL (mm)
        relative_alt: 100000, // 100 m rel (mm)
        vx: 300, // 3 m/s N (cm/s)
        vy: -400, // -4 m/s E
        vz: -150, // 1.5 m/s climb
        hdg: 9000,
      },
    });
    const gps = encode({
      name: 'GPS_RAW_INT',
      sysid: 1,
      compid: 1,
      fields: {
        time_usec: 0n,
        fix_type: 3,
        lat: 473977418,
        lon: 85455941,
        alt: 500000,
        eph: 121, // 1.21 (eph/100)
        epv: 200,
        vel: 500,
        cog: 9000,
        satellites_visible: 11,
      },
    });

    const decoded = session.pushBytes(concat(hb, pos, gps));
    expect(decoded.map((m) => m.name)).toEqual(['HEARTBEAT', 'GLOBAL_POSITION_INT', 'GPS_RAW_INT']);

    const snap = session.takeSnapshot();
    expect(snap.vehicles).toHaveLength(1);
    const v = snap.vehicles[0];
    if (v === undefined) throw new Error('no vehicle');

    expect(v.sysid).toBe(1);
    expect(v.vehicleClass).toBe('copter');
    expect(v.armed).toBe(true);
    expect(v.mode).toBe('LOITER');
    expect(v.position?.lat).toBeCloseTo(47.3977418, 6);
    expect(v.position?.lon).toBeCloseTo(8.5455941, 6);
    expect(v.position?.altRelM).toBeCloseTo(100, 3);
    expect(v.position?.altAmslM).toBeCloseTo(500, 3);
    expect(v.velocity?.climbMs).toBeCloseTo(1.5, 3);
    expect(v.gps?.fix).toBe(3);
    expect(v.gps?.sats).toBe(11);
    expect(v.gps?.hdop).toBeCloseTo(1.21, 3);

    expect(snap.activeSysid).toBe(1);
  });

  it('overlays registry-derived link stats (host fills bytes later)', () => {
    const session = new MavlinkSession({ nowMs: () => 0 });
    // Contiguous seqs 0,1,2 → no loss.
    session.pushBytes(
      concat(heartbeat(0, false, 0), heartbeat(0, false, 1), heartbeat(0, false, 2)),
    );
    const v = session.takeSnapshot().vehicles[0];
    if (v === undefined) throw new Error('no vehicle');
    expect(v.link.packetsIn).toBe(3);
    expect(v.link.lossPct).toBe(0);
    expect(v.link.rateHz).toBeGreaterThanOrEqual(0);
    // byte/signed counters are the host's job — left at defaults here.
    expect(v.link.bytesIn).toBe(0);
    expect(v.link.bytesOut).toBe(0);
    expect(v.link.signed).toBe(false);
  });

  it('coalesces multiple pushes into one snapshot reflecting the latest state', () => {
    const session = new MavlinkSession({ nowMs: () => 0 });
    session.pushBytes(heartbeat(COPTER_MODE_LOITER, false, 0));
    const rev1 = session.takeSnapshot().rev;
    session.pushBytes(heartbeat(COPTER_MODE_RTL, true, 1));
    session.pushBytes(heartbeat(COPTER_MODE_RTL, true, 2));

    const snap = session.takeSnapshot();
    expect(snap.rev).toBeGreaterThan(rev1);
    expect(snap.vehicles).toHaveLength(1);
    const v = snap.vehicles[0];
    if (v === undefined) throw new Error('no vehicle');
    // Only the latest values survive coalescing.
    expect(v.mode).toBe('RTL');
    expect(v.armed).toBe(true);
  });

  it('does not bump the revision when bytes decode to nothing', () => {
    const session = new MavlinkSession();
    const before = session.takeSnapshot().rev;
    session.pushBytes(new Uint8Array([0x00, 0x01, 0x02, 0x03])); // garbage, no frame
    expect(session.takeSnapshot().rev).toBe(before);
  });

  it('rates table tracks per-stream message metadata', () => {
    const session = new MavlinkSession({ nowMs: () => 0 });
    session.pushBytes(concat(heartbeat(0, false, 0), heartbeat(0, false, 1)));
    const rates = session.takeSnapshot().rates;
    const hb = rates.find((r) => r.name === 'HEARTBEAT');
    expect(hb).toBeDefined();
    expect(hb?.count).toBe(2);
    expect(hb?.sysid).toBe(1);
  });
});

describe('MavlinkSession — outgoing encoding', () => {
  it('encodeHeartbeat produces a decodable GCS HEARTBEAT', () => {
    const session = new MavlinkSession();
    const m = decodeOne(session.encodeHeartbeat());
    expect(m.name).toBe('HEARTBEAT');
    expect(m.fields.type).toBe(MAV_TYPE_GCS);
    expect(m.fields.autopilot).toBe(MAV_AUTOPILOT_INVALID);
    expect(m.fields.system_status).toBe(MAV_STATE_ACTIVE);
  });

  it('encodeHeartbeat auto-increments the transmit sequence', () => {
    const session = new MavlinkSession();
    const a = decodeOne(session.encodeHeartbeat());
    const b = decodeOne(session.encodeHeartbeat());
    const c = decodeOne(session.encodeHeartbeat());
    expect(b.seq).toBe((a.seq + 1) & 0xff);
    expect(c.seq).toBe((a.seq + 2) & 0xff);
  });

  it('encodeMessage round-trips arbitrary messages through the codec', () => {
    const session = new MavlinkSession();
    const frame = session.encodeMessage('COMMAND_LONG', {
      target_system: 1,
      target_component: 1,
      command: 400, // MAV_CMD_COMPONENT_ARM_DISARM
      confirmation: 0,
      param1: 1,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
    const m = decodeOne(frame);
    expect(m.name).toBe('COMMAND_LONG');
    expect(m.fields.command).toBe(400);
    expect(m.fields.param1).toBeCloseTo(1, 6);
    // Outgoing frames carry the GCS identity.
    expect(m.sysid).toBe(255);
    expect(m.compid).toBe(190);
  });

  it('shares a single transmit sequence across heartbeat + message sends', () => {
    const session = new MavlinkSession();
    const a = decodeOne(session.encodeHeartbeat());
    const b = decodeOne(
      session.encodeMessage('HEARTBEAT', {
        type: MAV_TYPE_GCS,
        autopilot: MAV_AUTOPILOT_INVALID,
        base_mode: 0,
        custom_mode: 0,
        system_status: MAV_STATE_ACTIVE,
        mavlink_version: 3,
      }),
    );
    expect(b.seq).toBe((a.seq + 1) & 0xff);
  });
});
