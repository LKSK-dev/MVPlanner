/**
 * Host MESSAGE TAP tests (tasks T2.5 / T2.10 / T1.9; spec plan/03 §3.4
 * microservices, plan/07 §7.4 tlog, plan/02 §2.6 separate recording path).
 *
 * Exercises the PURE session-level tap wiring with REAL encoded synthetic frames
 * (produced by an independent `createMavCodec` instance), feeding them through
 * {@link MavlinkSession.pushBytes} and asserting the two worker→main taps:
 *
 *  1. {@link MavlinkSession.onMessage} — the SELECTIVE decoded-message tap:
 *     delivers only messages whose name is in the requested set (the reply path
 *     for ACK/reply microservices), and is multiplexed per subscription.
 *  2. {@link MavlinkSession.onRawFrame} — the RAW-FRAME tap: fires for EVERY
 *     parsed frame (tlog recording) with the raw bytes + rxTimeUs + sysid /
 *     compid / msgId, on a path SEPARATE from coalesced telemetry.
 *
 * The real-Worker / RPC-stream plumbing is SITL/e2e-deferred, like the existing
 * host tests: vitest's Worker + Web Streams support is too limited to exercise
 * the inlined-worker relay meaningfully. The worker stream handlers are thin
 * bridges that register exactly these session taps and forward each callback.
 */
import { describe, expect, it } from 'vitest';
import type { DecodedMessage, MessageInput } from '../../src/contracts';
import { createMavCodec } from '../../src/mavlink/codec';
import { BUILTIN_DIALECTS } from '../../src/mavlink/dialects';
import { MavlinkSession, type RawFrame } from '../../src/mavlink/host/session';

const MAV_TYPE_QUADROTOR = 2;
const MAV_AUTOPILOT_ARDUPILOTMEGA = 3;
const MAV_STATE_ACTIVE = 4;
const MAV_CMD_COMPONENT_ARM_DISARM = 400;
const MAV_RESULT_ACCEPTED = 0;
const MAV_PARAM_TYPE_REAL32 = 9;

/** Independent encoder (separate from the session's internal codec). */
const codec = createMavCodec({ dialects: BUILTIN_DIALECTS });

function encode(input: MessageInput, seq?: number): Uint8Array {
  return seq === undefined
    ? codec.encode(input, { version: 2 })
    : codec.encode(input, { version: 2, seq });
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

function heartbeat(seq?: number): Uint8Array {
  return encode(
    {
      name: 'HEARTBEAT',
      sysid: 1,
      compid: 1,
      fields: {
        type: MAV_TYPE_QUADROTOR,
        autopilot: MAV_AUTOPILOT_ARDUPILOTMEGA,
        base_mode: 0,
        custom_mode: 0,
        system_status: MAV_STATE_ACTIVE,
        mavlink_version: 3,
      },
    },
    seq,
  );
}

function commandAck(command: number, result: number, seq?: number): Uint8Array {
  return encode(
    {
      name: 'COMMAND_ACK',
      sysid: 1,
      compid: 1,
      fields: { command, result },
    },
    seq,
  );
}

function paramValue(id: string, value: number, index: number, count: number): Uint8Array {
  return encode({
    name: 'PARAM_VALUE',
    sysid: 1,
    compid: 1,
    fields: {
      param_id: id,
      param_value: value,
      param_type: MAV_PARAM_TYPE_REAL32,
      param_count: count,
      param_index: index,
    },
  });
}

describe('MavlinkSession — selective onMessage tap', () => {
  it('delivers only messages whose name is in the requested set', () => {
    const session = new MavlinkSession();
    const got: DecodedMessage[] = [];
    session.onMessage(['COMMAND_ACK', 'PARAM_VALUE'], (m) => got.push(m));

    session.pushBytes(
      concat(
        heartbeat(),
        commandAck(MAV_CMD_COMPONENT_ARM_DISARM, MAV_RESULT_ACCEPTED),
        paramValue('SYSID_THISMAV', 1, 0, 2),
        heartbeat(),
      ),
    );

    expect(got.map((m) => m.name)).toEqual(['COMMAND_ACK', 'PARAM_VALUE']);
    const ack = got[0];
    const param = got[1];
    if (ack === undefined || param === undefined) throw new Error('missing tap message');
    expect(ack.fields.command).toBe(MAV_CMD_COMPONENT_ARM_DISARM);
    expect(ack.fields.result).toBe(MAV_RESULT_ACCEPTED);
    expect(param.fields.param_id).toBe('SYSID_THISMAV');
    expect(param.fields.param_value).toBeCloseTo(1, 6);
  });

  it('multiplexes concurrent subscriptions, each by its own filter', () => {
    const session = new MavlinkSession();
    const acks: string[] = [];
    const params: string[] = [];
    session.onMessage(['COMMAND_ACK'], (m) => acks.push(m.name));
    session.onMessage(['PARAM_VALUE'], (m) => params.push(m.name));

    session.pushBytes(
      concat(commandAck(1, 0), paramValue('A', 0, 0, 1), commandAck(2, 0), heartbeat()),
    );

    expect(acks).toEqual(['COMMAND_ACK', 'COMMAND_ACK']);
    expect(params).toEqual(['PARAM_VALUE']);
  });

  it('an empty name set never fires', () => {
    const session = new MavlinkSession();
    let fired = 0;
    session.onMessage([], () => (fired += 1));
    session.pushBytes(concat(heartbeat(), commandAck(1, 0)));
    expect(fired).toBe(0);
  });

  it('unsubscribe stops delivery and shrinks the active filter', () => {
    const session = new MavlinkSession();
    const got: string[] = [];
    const off = session.onMessage(['COMMAND_ACK'], (m) => got.push(m.name));

    session.pushBytes(commandAck(1, 0));
    off();
    session.pushBytes(commandAck(2, 0));

    expect(got).toEqual(['COMMAND_ACK']);
  });
});

describe('MavlinkSession — raw onRawFrame tap', () => {
  it('fires for EVERY parsed frame with correct ids and rxTimeUs', () => {
    const session = new MavlinkSession();
    const frames: RawFrame[] = [];
    session.onRawFrame((f) => frames.push(f));

    const decoded = session.pushBytes(
      concat(heartbeat(), commandAck(MAV_CMD_COMPONENT_ARM_DISARM, 0), paramValue('P', 0, 0, 1)),
    );

    // One raw frame per parsed frame — the recorder must never drop.
    expect(frames).toHaveLength(decoded.length);
    expect(frames.map((f) => f.msgId)).toEqual(decoded.map((m) => m.msgId));

    frames.forEach((f, i) => {
      const m = decoded[i];
      if (m === undefined) throw new Error('missing decoded message');
      expect(f.sysid).toBe(m.sysid);
      expect(f.compid).toBe(m.compid);
      expect(f.msgId).toBe(m.msgId);
      // rxTimeUs mirrors the decoded frame's parser rx clock (a positive int).
      expect(f.rxTimeUs).toBe(m.rxTimeUs);
      expect(Number.isInteger(f.rxTimeUs)).toBe(true);
      expect(f.rxTimeUs).toBeGreaterThanOrEqual(0);
      // Raw bytes are the exact wire frame (v2 magic 0xFD).
      expect(f.raw).toEqual(m.raw);
      expect(f.raw[0]).toBe(0xfd);
    });
  });

  it('runs independently of (and alongside) the selective message tap', () => {
    const session = new MavlinkSession();
    const raw: number[] = [];
    const msgs: string[] = [];
    session.onRawFrame((f) => raw.push(f.msgId));
    session.onMessage(['COMMAND_ACK'], (m) => msgs.push(m.name));

    session.pushBytes(concat(heartbeat(), commandAck(1, 0)));

    // Raw tap saw both frames; the selective tap only the COMMAND_ACK.
    expect(raw).toHaveLength(2);
    expect(msgs).toEqual(['COMMAND_ACK']);
  });

  it('unsubscribe stops raw delivery', () => {
    const session = new MavlinkSession();
    let count = 0;
    const off = session.onRawFrame(() => (count += 1));

    session.pushBytes(heartbeat());
    off();
    session.pushBytes(heartbeat());

    expect(count).toBe(1);
  });

  it('garbage bytes that decode to no frame emit nothing on either tap', () => {
    const session = new MavlinkSession();
    let raw = 0;
    let msg = 0;
    session.onRawFrame(() => (raw += 1));
    session.onMessage(['HEARTBEAT'], () => (msg += 1));
    session.pushBytes(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    expect(raw).toBe(0);
    expect(msg).toBe(0);
  });
});
