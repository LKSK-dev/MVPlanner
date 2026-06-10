/** Measurement-oriented MAVLink telemetry throughput harness for T8.10. */
import { describe, expect, it } from 'vitest';
import { createMavCodec } from '../../src/mavlink/codec';
import { BUILTIN_DIALECTS } from '../../src/mavlink/dialects';
import { MavlinkSession } from '../../src/mavlink/host/session';
import { parseTlog } from '../../src/transport/replay';
import type { MessageInput } from '../../src/contracts';
import {
  concatBytes,
  formatMiB,
  formatRate,
  heapDeltaBytes,
  measureSync,
  reportPerfLine,
  sampleMemory,
  summarizeTimings,
} from './helpers';

const CYCLE_RATE_HZ = 50;
const DURATION_SECONDS = 120;
const MESSAGES_PER_CYCLE = 4;
const EXPECTED_MESSAGES = CYCLE_RATE_HZ * DURATION_SECONDS * MESSAGES_PER_CYCLE;
const REALTIME_MESSAGES_PER_SECOND = CYCLE_RATE_HZ * MESSAGES_PER_CYCLE;
const CHUNK_TARGET_BYTES = 1024;
const SNAPSHOT_SAMPLES = 500;

interface SyntheticTelemetryTlog {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly messageCount: number;
  readonly durationSeconds: number;
}

describe('perf: MAVLink telemetry throughput and bounded session state', () => {
  it('parses a high-rate tlog stream far faster than realtime and keeps snapshots cheap', () => {
    const tlog = buildSyntheticTelemetryTlog(DURATION_SECONDS, CYCLE_RATE_HZ);
    const frames = parseTlog(tlog.bytes);
    const chunks = chunksFromFrames(
      frames.map((frame) => frame.bytes),
      CHUNK_TARGET_BYTES,
    );

    expect(frames).toHaveLength(EXPECTED_MESSAGES);

    let nowMs = 0;
    const session = new MavlinkSession({ nowMs: () => nowMs });
    const before = sampleMemory();
    const pushSamples: number[] = [];
    let decoded = 0;

    const parseStart = performance.now();
    for (const chunk of chunks) {
      nowMs += 20;
      const started = performance.now();
      decoded += session.pushBytes(chunk).length;
      pushSamples.push(performance.now() - started);
    }
    const parseMs = performance.now() - parseStart;

    const snapshotSamples: number[] = [];
    let snapshotRates = 0;
    let snapshotVehicles = 0;
    for (let i = 0; i < SNAPSHOT_SAMPLES; i++) {
      const elapsed = measureSync(() => {
        const snapshot = session.takeSnapshot();
        snapshotRates = snapshot.rates.length;
        snapshotVehicles = snapshot.vehicles.length;
      });
      snapshotSamples.push(elapsed);
    }
    const after = sampleMemory();

    const pushStats = summarizeTimings(pushSamples);
    const snapshotStats = summarizeTimings(snapshotSamples);
    const throughput = decoded / (parseMs / 1000);
    const heapDelta = heapDeltaBytes(before, after);
    const realtimeMultiple = throughput / REALTIME_MESSAGES_PER_SECOND;

    reportPerfLine(
      [
        'T8.10 telemetry perf:',
        `frames=${formatRate(decoded)} (${DURATION_SECONDS}s @ ${CYCLE_RATE_HZ}Hz x ${MESSAGES_PER_CYCLE})`,
        `tlog=${formatMiB(tlog.bytes.byteLength)}`,
        `parse=${parseMs.toFixed(2)}ms`,
        `throughput=${formatRate(throughput, 0)} msgs/sec (${realtimeMultiple.toFixed(1)}x realtime)`,
        `push avg/p95/max=${pushStats.avgMs.toFixed(3)}/${pushStats.p95Ms.toFixed(3)}/${pushStats.maxMs.toFixed(3)}ms`,
        `snapshot avg/p95/max=${snapshotStats.avgMs.toFixed(3)}/${snapshotStats.p95Ms.toFixed(3)}/${snapshotStats.maxMs.toFixed(3)}ms`,
        `snapshot rates=${snapshotRates} vehicles=${snapshotVehicles}`,
        heapDelta === undefined ? 'heap delta=n/a' : `heap delta=${formatMiB(heapDelta)}`,
        'budget mapping: per-push parse and snapshot work are well below the 150ms telemetry→UI hard limit; browser paint/60fps is covered by a browser perf pass.',
      ].join(' | '),
    );

    expect(decoded).toBe(tlog.messageCount);
    expect(throughput).toBeGreaterThan(1_000);
    expect(pushStats.p95Ms).toBeLessThan(50);
    expect(snapshotStats.p95Ms).toBeLessThan(25);
    expect(snapshotRates).toBe(MESSAGES_PER_CYCLE);
    expect(snapshotVehicles).toBe(1);
    if (heapDelta !== undefined) expect(heapDelta).toBeLessThan(128 * 1024 * 1024);
  });
});

function buildSyntheticTelemetryTlog(
  durationSeconds: number,
  cycleRateHz: number,
): SyntheticTelemetryTlog {
  const codec = createMavCodec({ dialects: BUILTIN_DIALECTS });
  const entries: Uint8Array[] = [];
  let seq = 0;

  for (let cycle = 0; cycle < durationSeconds * cycleRateHz; cycle++) {
    const timeBootMs = Math.round((cycle * 1000) / cycleRateHz);
    const timeUs = timeBootMs * 1000;
    const messages = telemetryMessagesForCycle(cycle, timeBootMs);
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const input = messages[messageIndex];
      if (input === undefined) throw new RangeError(`message ${messageIndex} missing`);
      const frame = codec.encode(input, { version: 2, seq });
      seq = (seq + 1) & 0xff;
      entries.push(tlogEntry(BigInt(timeUs + messageIndex * 100), frame));
    }
  }

  return {
    bytes: concatBytes(entries),
    messageCount: durationSeconds * cycleRateHz * MESSAGES_PER_CYCLE,
    durationSeconds,
  };
}

function telemetryMessagesForCycle(cycle: number, timeBootMs: number): readonly MessageInput[] {
  const angle = cycle / 25;
  return [
    {
      name: 'HEARTBEAT',
      sysid: 1,
      compid: 1,
      fields: {
        custom_mode: 0,
        type: 2,
        autopilot: 3,
        base_mode: 81,
        system_status: 4,
        mavlink_version: 3,
      },
    },
    {
      name: 'ATTITUDE',
      sysid: 1,
      compid: 1,
      fields: {
        time_boot_ms: timeBootMs,
        roll: Math.sin(angle) * 0.2,
        pitch: Math.cos(angle) * 0.1,
        yaw: angle % (Math.PI * 2),
        rollspeed: 0.01,
        pitchspeed: 0.02,
        yawspeed: 0.03,
      },
    },
    {
      name: 'GLOBAL_POSITION_INT',
      sysid: 1,
      compid: 1,
      fields: {
        time_boot_ms: timeBootMs,
        lat: Math.round((37.422 + cycle * 0.000001) * 10_000_000),
        lon: Math.round((-122.084 - cycle * 0.000001) * 10_000_000),
        alt: 100_000 + cycle,
        relative_alt: 20_000 + cycle,
        vx: 120,
        vy: -35,
        vz: 5,
        hdg: cycle % 36_000,
      },
    },
    {
      name: 'SYS_STATUS',
      sysid: 1,
      compid: 1,
      fields: {
        onboard_control_sensors_present: 0xffffffff,
        onboard_control_sensors_enabled: 0x0fffffff,
        onboard_control_sensors_health: 0x0fffffff,
        load: 450,
        voltage_battery: 12_000,
        current_battery: 500,
        drop_rate_comm: 0,
        errors_comm: 0,
        errors_count1: 0,
        errors_count2: 0,
        errors_count3: 0,
        errors_count4: 0,
        battery_remaining: 85,
      },
    },
  ];
}

function tlogEntry(timeUs: bigint, frame: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8 + frame.byteLength);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, timeUs, false);
  out.set(frame, 8);
  return out;
}

function chunksFromFrames(
  frames: readonly Uint8Array[],
  targetBytes: number,
): readonly Uint8Array<ArrayBuffer>[] {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;

  for (const frame of frames) {
    pending.push(frame);
    pendingBytes += frame.byteLength;
    if (pendingBytes >= targetBytes) {
      chunks.push(concatBytes(pending));
      pending = [];
      pendingBytes = 0;
    }
  }

  if (pending.length > 0) chunks.push(concatBytes(pending));
  return chunks;
}
