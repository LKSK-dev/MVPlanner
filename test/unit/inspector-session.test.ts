/**
 * Inspector data-path tests (task T1.12; spec plan/04 §4.9).
 *
 * Drives the PURE {@link MavlinkSession} with REAL encoded frames and asserts
 * the on-demand inspector table `takeInspectorSnapshot()` exposes the full
 * per-`(sysid, compid, msgId)` projection the widget needs: name, observed rate,
 * last-seen, count, latest decoded fields, the latest raw frame bytes (hex
 * source) and the frame's signing / CRC status. No Worker / DOM.
 */
import { describe, expect, it } from 'vitest';
import type { MessageInput } from '../../src/contracts';
import { createMavCodec } from '../../src/mavlink/codec';
import { BUILTIN_DIALECTS } from '../../src/mavlink/dialects';
import { MavlinkSession } from '../../src/mavlink/host/session';
import { toHex } from '../../src/ui/widgets/inspector';

const MAV_TYPE_QUADROTOR = 2;
const MAV_AUTOPILOT_ARDUPILOTMEGA = 3;
const MAV_STATE_ACTIVE = 4;

const codec = createMavCodec({ dialects: BUILTIN_DIALECTS });

function encode(input: MessageInput, seq?: number): Uint8Array {
  return seq === undefined
    ? codec.encode(input, { version: 2 })
    : codec.encode(input, { version: 2, seq });
}

function heartbeat(sysid: number, compid: number, customMode: number, seq?: number): Uint8Array {
  return encode(
    {
      name: 'HEARTBEAT',
      sysid,
      compid,
      fields: {
        type: MAV_TYPE_QUADROTOR,
        autopilot: MAV_AUTOPILOT_ARDUPILOTMEGA,
        base_mode: 0,
        custom_mode: customMode,
        system_status: MAV_STATE_ACTIVE,
        mavlink_version: 3,
      },
    },
    seq,
  );
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

describe('MavlinkSession — inspector snapshot', () => {
  it('projects name / count / last-seen / fields for each stream', () => {
    const session = new MavlinkSession({ nowMs: () => 1234 });
    session.pushBytes(concat(heartbeat(1, 1, 5, 0), heartbeat(1, 1, 5, 1)));

    const snap = session.takeInspectorSnapshot();
    const hb = snap.rows.find((r) => r.name === 'HEARTBEAT');
    expect(hb).toBeDefined();
    if (hb === undefined) throw new Error('no HEARTBEAT row');

    expect(hb.sysid).toBe(1);
    expect(hb.compid).toBe(1);
    expect(hb.msgId).toBe(0); // HEARTBEAT id
    expect(hb.count).toBe(2);
    expect(hb.lastSeenMs).toBe(1234);
    expect(hb.rateHz).toBeGreaterThanOrEqual(0);
    // Latest decoded fields are carried verbatim.
    expect(hb.fields['custom_mode']).toBe(5);
    expect(hb.fields['type']).toBe(MAV_TYPE_QUADROTOR);
  });

  it('carries the latest raw frame bytes (hex source) + CRC/signing status', () => {
    const session = new MavlinkSession({ nowMs: () => 0 });
    const frame = heartbeat(7, 1, 3, 0);
    session.pushBytes(frame);

    const hb = session.takeInspectorSnapshot().rows.find((r) => r.name === 'HEARTBEAT');
    if (hb === undefined) throw new Error('no HEARTBEAT row');

    // raw is the full frame the hex view renders.
    expect(Array.from(hb.raw)).toEqual(Array.from(frame));
    expect(toHex(hb.raw)).toBe(toHex(frame));
    expect(toHex(hb.raw).startsWith('FD')).toBe(true); // MAVLink v2 magic
    expect(hb.crcOk).toBe(true);
    expect(hb.signed).toBe(false);
    expect(hb.seq).toBe(0);
    expect(hb.linkId).toBeUndefined();
  });

  it('reflects the latest frame when a stream is updated', () => {
    const session = new MavlinkSession({ nowMs: () => 0 });
    session.pushBytes(heartbeat(1, 1, 5, 0));
    session.pushBytes(heartbeat(1, 1, 9, 1));

    const hb = session.takeInspectorSnapshot().rows.find((r) => r.name === 'HEARTBEAT');
    expect(hb?.fields['custom_mode']).toBe(9);
    expect(hb?.count).toBe(2);
  });

  it('separates rows per (sysid, compid, msgId) and bumps rev with the session', () => {
    const session = new MavlinkSession({ nowMs: () => 0 });
    session.pushBytes(concat(heartbeat(1, 1, 0, 0), heartbeat(2, 1, 0, 0)));

    const snap = session.takeInspectorSnapshot();
    const systems = new Set(snap.rows.map((r) => `${r.sysid}:${r.compid}`));
    expect(systems.has('1:1')).toBe(true);
    expect(systems.has('2:1')).toBe(true);
    expect(snap.rev).toBe(session.takeSnapshot().rev);
  });

  it('returns an empty table before any traffic', () => {
    const session = new MavlinkSession();
    const snap = session.takeInspectorSnapshot();
    expect(snap.rows).toEqual([]);
  });
});
