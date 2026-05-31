/**
 * M2-gate LIVE integration smoke (spec plan/03 §3.4 Command, plan/07 §7.4 tlog;
 * WBS M2 gate, T2.5, T2.10). Closes the two M2-gate proofs that need a real
 * wire rather than a fake host:
 *
 *   pymavlink "fake vehicle" (TCP server, also answers COMMAND_LONG/INT)
 *        -> committed companion bridge  (bridge/bridge.mjs, ws <-> tcp)
 *        -> Node global WebSocket client (this test)
 *        -> REAL MavlinkSession          (our codec + registry + vehicle model)
 *        -> { CommandClient, TlogRecorder }
 *
 * Proves, end to end over the SAME byte path the worker host runs:
 *  1) COMMAND round-trip: a COMMAND_LONG encoded by MavlinkSession travels the
 *     ws->tcp bridge to the (independent) pymavlink vehicle, which replies with a
 *     COMMAND_ACK(ACCEPTED); the ACK returns over the bridge and the real
 *     CommandClient correlates + resolves it (arm + setMode).
 *  2) tlog recording: a TlogRecorder tapping the session's never-dropped
 *     onRawFrame records the LIVE telemetry, and the exported blob round-trips
 *     through `transport/replay`'s parseTlog (frames, monotonic timestamps,
 *     HEARTBEAT present).
 *
 * Full ArduPilot SITL + the browser Worker/Flight UI + live-fps assertions stay
 * deferred to a SITL/browser CI env; pymavlink is the independent stand-in
 * vehicle (its independent MAVLink encoder doubly validates our codec on a real
 * wire). The same `session` host entry as m1-live is used (not the package
 * barrel) to avoid the worker-bundling import irrelevant to this node smoke.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MavlinkSession } from '../../src/mavlink/host/session';
import { CommandClient } from '../../src/mavlink/microservices/command';
import { CMD_COMPONENT_ARM_DISARM, MAV_RESULT } from '../../src/mavlink/microservices/command/constants';
import { TlogRecorder } from '../../src/data/tlog';
import { parseTlog } from '../../src/transport/replay';
import type { BlobStore, BlobMeta } from '../../src/contracts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const pythonBin = resolve(repoRoot, '.venv/bin/python');
const fakeVehicle = resolve(here, 'fake_vehicle.py');
const bridgeScript = resolve(repoRoot, 'bridge/bridge.mjs');

interface Child {
  proc: ChildProcess;
  stdout: () => string;
  stderr: () => string;
}

/** Spawn a child, buffering its stdout/stderr for readiness parsing + diagnostics. */
function spawnChild(cmd: string, args: string[], cwd: string): Child {
  const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  proc.stdout?.setEncoding('utf8');
  proc.stderr?.setEncoding('utf8');
  proc.stdout?.on('data', (d: string) => (out += d));
  proc.stderr?.on('data', (d: string) => (err += d));
  return { proc, stdout: () => out, stderr: () => err };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll a child's buffered output for `re` until it matches or the deadline passes. */
async function waitForMatch(
  child: Child,
  stream: 'stdout' | 'stderr',
  re: RegExp,
  timeoutMs: number,
  label: string,
): Promise<RegExpMatchArray> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.proc.exitCode !== null) {
      throw new Error(
        `${label}: process exited (code ${child.proc.exitCode}) before match.\n` +
          `stdout:\n${child.stdout()}\nstderr:\n${child.stderr()}`,
      );
    }
    const text = stream === 'stdout' ? child.stdout() : child.stderr();
    const m = text.match(re);
    if (m) return m;
    await sleep(50);
  }
  throw new Error(
    `${label}: timed out after ${timeoutMs}ms waiting for ${re}.\n` +
      `stdout:\n${child.stdout()}\nstderr:\n${child.stderr()}`,
  );
}

/** Open a ws client, retrying the connect to absorb bridge-startup races. */
async function connectWs(url: string, timeoutMs: number): Promise<WebSocket> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const ws = await new Promise<WebSocket>((resolveWs, rejectWs) => {
        const sock = new WebSocket(url);
        sock.binaryType = 'arraybuffer';
        const onOpen = (): void => {
          sock.removeEventListener('error', onErr);
          resolveWs(sock);
        };
        const onErr = (ev: Event): void => {
          sock.removeEventListener('open', onOpen);
          rejectWs(new Error(`ws error: ${String((ev as ErrorEvent)?.message ?? ev?.type)}`));
        };
        sock.addEventListener('open', onOpen, { once: true });
        sock.addEventListener('error', onErr, { once: true });
      });
      return ws;
    } catch (e) {
      lastErr = e;
      await sleep(100);
    }
  }
  throw new Error(`ws connect to ${url} failed within ${timeoutMs}ms: ${String(lastErr)}`);
}

/**
 * A minimal in-memory {@link BlobStore} for the recorder. The recorder only
 * needs put/getRange/size; list/del round out the contract. Keys are namespaced
 * `"<ns>/<key>"`; values are flat byte copies.
 */
class MemBlobStore implements BlobStore {
  private readonly map = new Map<string, Uint8Array>();
  private k(ns: string, key: string): string {
    return `${ns}\u0000${key}`;
  }
  async put(ns: string, key: string, data: Blob): Promise<void> {
    this.map.set(this.k(ns, key), new Uint8Array(await data.arrayBuffer()));
  }
  async getRange(ns: string, key: string, start: number, end: number): Promise<Uint8Array> {
    const b = this.map.get(this.k(ns, key)) ?? new Uint8Array();
    return b.subarray(start, end);
  }
  async size(ns: string, key: string): Promise<number> {
    return (this.map.get(this.k(ns, key)) ?? new Uint8Array()).byteLength;
  }
  async list(ns: string): Promise<BlobMeta[]> {
    const out: BlobMeta[] = [];
    const prefix = `${ns}\u0000`;
    for (const [k, v] of this.map) {
      if (k.startsWith(prefix)) out.push({ key: k.slice(prefix.length), bytes: v.byteLength });
    }
    return out;
  }
  async del(ns: string, key: string): Promise<void> {
    this.map.delete(this.k(ns, key));
  }
}

let vehicle: Child | undefined;
let bridge: Child | undefined;
let ws: WebSocket | undefined;
let session: MavlinkSession | undefined;
let command: CommandClient | undefined;
let recorder: TlogRecorder | undefined;
let vehicleReady = false;
let failed = false;

/** Wrap a test body so a failure flags the afterAll child diagnostics dump. */
async function step(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    failed = true;
    throw e;
  }
}

describe('M2 live integration: command round-trip + tlog over the real bridge', () => {
  beforeAll(async () => {
    // 1) Boot the pymavlink fake vehicle (telemetry + COMMAND_ACK) and read its port.
    vehicle = spawnChild(pythonBin, [fakeVehicle, '--port', '0'], repoRoot);
    const portMatch = await waitForMatch(vehicle, 'stdout', /PORT (\d+)/, 10_000, 'fake_vehicle');
    const vehPort = Number(portMatch[1]);
    expect(vehPort).toBeGreaterThan(0);

    // 2) Boot the committed bridge: ws server (ephemeral) <-> the vehicle's TCP.
    bridge = spawnChild(
      process.execPath,
      [bridgeScript, '--ws-port', '0', '--tcp', `127.0.0.1:${vehPort}`],
      repoRoot,
    );
    const wsMatch = await waitForMatch(
      bridge,
      'stdout',
      /listening ws:\/\/127\.0\.0\.1:(\d+)/,
      10_000,
      'bridge',
    );
    const wsPort = Number(wsMatch[1]);
    expect(wsPort).toBeGreaterThan(0);

    // 3) Real session + a real Node WebSocket client into the bridge.
    session = new MavlinkSession();
    ws = await connectWs(`ws://127.0.0.1:${wsPort}`, 10_000);
    ws.addEventListener('message', (ev: MessageEvent) => {
      const data = ev.data;
      if (data instanceof ArrayBuffer) {
        session!.pushBytes(new Uint8Array(data));
      }
    });

    // 4) Build a CommandClient over the LIVE link: encode+send out the ws, tap
    //    decoded ACKs from the session, resolve the active vehicle from snapshots.
    command = new CommandClient({
      sendMessage: (name, fields) => {
        ws!.send(session!.encodeMessage(name, fields));
      },
      onMessage: (names, cb) => session!.onMessage(names, cb),
      getActiveVehicle: () => session!.takeSnapshot().vehicles[0],
    });

    // 5) Poll snapshots until the live copter vehicle appears (so getActiveVehicle
    //    returns it and commands have a target).
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const v = session.takeSnapshot().vehicles[0];
      if (v && v.vehicleClass === 'copter') {
        vehicleReady = true;
        break;
      }
      await sleep(100);
    }
    expect(vehicleReady, 'no live copter vehicle decoded before timeout').toBe(true);
  });

  afterAll(async () => {
    try {
      await recorder?.dispose();
    } catch {
      // ignore
    }
    command?.dispose();
    try {
      ws?.close();
    } catch {
      // ignore
    }
    // On failure, surface child diagnostics to aid debugging.
    if (failed || !vehicleReady) {
      if (vehicle) {
        // eslint-disable-next-line no-console
        console.error(
          `[fake_vehicle] stdout:\n${vehicle.stdout()}\n[fake_vehicle] stderr:\n${vehicle.stderr()}`,
        );
      }
      if (bridge) {
        // eslint-disable-next-line no-console
        console.error(`[bridge] stdout:\n${bridge.stdout()}\n[bridge] stderr:\n${bridge.stderr()}`);
      }
    }
    vehicle?.proc.kill('SIGKILL');
    bridge?.proc.kill('SIGKILL');
    await sleep(50);
  });

  it('round-trips a COMMAND_LONG -> COMMAND_ACK over the bridge (arm)', async () => {
    await step(async () => {
      expect(command).toBeDefined();
      // The COMMAND_LONG goes out over the ws->tcp bridge; the fake vehicle ACKs
      // with MAV_RESULT_ACCEPTED; the ACK returns and the CommandClient resolves.
      const res = await command!.send(CMD_COMPONENT_ARM_DISARM, [1, 0]);
      expect(res.result).toBe(MAV_RESULT.ACCEPTED);
      // The arm() helper exercises the same path and resolves (resolution only
      // happens on a terminal ACCEPTED ACK; any other result rejects).
      await expect(command!.arm(true)).resolves.toBeUndefined();
    });
  });

  it('round-trips a DO_SET_MODE -> COMMAND_ACK over the bridge (setMode GUIDED)', async () => {
    await step(async () => {
      expect(command).toBeDefined();
      await expect(command!.setMode('GUIDED')).resolves.toBeUndefined();
    });
  });

  it('records live telemetry to a tlog that round-trips through parseTlog', async () => {
    await step(async () => {
      expect(session).toBeDefined();
      const blobs = new MemBlobStore();
      // MavlinkSession satisfies RawFrameSource structurally (its never-dropped
      // onRawFrame tap). Record a short window while live telemetry flows.
      recorder = new TlogRecorder({ source: session!, blobs });
      await recorder.start({ vehicleType: 'ArduCopter' });
      await sleep(2_500);
      await recorder.stop();

      const stats = recorder.stats();
      expect(stats.frameCount).toBeGreaterThanOrEqual(4);

      // Export the recorded blob and parse it back with the replay-side parser.
      const blob = await recorder.export();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const frames = parseTlog(bytes);
      expect(frames.length).toBeGreaterThanOrEqual(4);

      // Timestamps are monotonic non-decreasing (recorded in receive order).
      for (let i = 1; i < frames.length; i += 1) {
        expect(frames[i]!.timeUs).toBeGreaterThanOrEqual(frames[i - 1]!.timeUs);
      }

      // Round-trip: feed the recorded frames through a fresh codec and confirm
      // HEARTBEAT (and the live position stream) survive the record->parse cycle.
      const verify = new MavlinkSession();
      for (const f of frames) verify.pushBytes(f.bytes);
      const names = new Set(verify.takeSnapshot().rates.map((r) => r.name));
      expect(names.has('HEARTBEAT')).toBe(true);
    });
  });
});
