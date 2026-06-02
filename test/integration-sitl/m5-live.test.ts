/**
 * M5-gate LIVE integration smoke (spec plan/03 §3.4 Calibration; WBS M5 gate,
 * T5.1). Closes the calibration-microservice proof that needs a real wire
 * rather than a fake host:
 *
 *   pymavlink "fake vehicle"  (TCP server; also answers PREFLIGHT_CALIBRATION
 *                              + streams MAG_CAL_PROGRESS/REPORT)
 *        -> committed companion bridge  (bridge/bridge.mjs, ws <-> tcp)
 *        -> Node global WebSocket client (this test)
 *        -> REAL MavlinkSession          (our codec + registry + vehicle model)
 *        -> { CommandClient, CalibrationClient }
 *
 * Proves, end to end over the SAME byte path the worker host runs:
 *  1) gyro(): a MAV_CMD_PREFLIGHT_CALIBRATION (p1=1) encoded by MavlinkSession
 *     travels the ws->tcp bridge to the (independent) pymavlink vehicle, which
 *     replies COMMAND_ACK(ACCEPTED); the ACK returns over the bridge and the
 *     real CalibrationClient (via CommandClient) resolves.
 *  2) compass(onProgress): a MAV_CMD_DO_START_MAG_CAL is ACKed AND the vehicle
 *     streams MAG_CAL_PROGRESS (rising completion_pct) followed by a
 *     MAG_CAL_REPORT(MAG_CAL_SUCCESS). The CalibrationClient reports increasing
 *     progress and RESOLVES with { offsets } equal to the vehicle's reported
 *     ofs_x/y/z — proving the DO_START_MAG_CAL -> PROGRESS/REPORT round-trip
 *     over the real bridge.
 *
 * Deferred to a real-board / full-ArduPilot-SITL env (out of scope here): the
 * accel 6-point user-gated pose flow, radio stick capture, and real-board
 * feedback. pymavlink is the independent stand-in vehicle (its independent
 * MAVLink encoder doubly validates our codec on a real wire). The same
 * `session` host entry as m1/m2-live is used (not the package barrel).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MavlinkSession } from '../../src/mavlink/host/session';
import { CommandClient } from '../../src/mavlink/microservices/command';
import { createCalibrationClient } from '../../src/mavlink/microservices/calibration';
import type { CalibrationClient } from '../../src/mavlink/microservices/calibration';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const pythonBin = resolve(repoRoot, '.venv/bin/python');
const fakeVehicle = resolve(here, 'fake_vehicle.py');
const bridgeScript = resolve(repoRoot, 'bridge/bridge.mjs');

// Known compass offsets the fake vehicle reports in MAG_CAL_REPORT.ofs_x/y/z;
// the live compass() result must read these back exactly.
const EXPECTED_OFFSETS = [12, -7, 23];

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

let vehicle: Child | undefined;
let bridge: Child | undefined;
let ws: WebSocket | undefined;
let session: MavlinkSession | undefined;
let command: CommandClient | undefined;
let calibration: CalibrationClient | undefined;
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

describe('M5 live integration: calibration microservice over the real bridge', () => {
  beforeAll(async () => {
    // 1) Boot the pymavlink fake vehicle (telemetry + cal flows) and read its port.
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

    // 4) Build a CommandClient over the LIVE link (as in m2-live), then a real
    //    CalibrationClient on top of it: same session send/tap path, with the
    //    active vehicle's sysid/compid as the calibration target.
    command = new CommandClient({
      sendMessage: (name, fields) => {
        ws!.send(session!.encodeMessage(name, fields));
      },
      onMessage: (names, cb) => session!.onMessage(names, cb),
      getActiveVehicle: () => session!.takeSnapshot().vehicles[0],
    });
    calibration = createCalibrationClient({
      command,
      onMessage: (names, cb) => session!.onMessage(names, cb),
      getTarget: () => {
        const v = session!.takeSnapshot().vehicles[0];
        return v ? { sysid: v.sysid, compid: v.compid } : undefined;
      },
    });

    // 5) Poll snapshots until the live copter vehicle appears (so getTarget /
    //    getActiveVehicle return it and the flows have a target).
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
    calibration?.dispose();
    command?.dispose();
    try {
      ws?.close();
    } catch {
      // ignore
    }
    // On failure, surface child diagnostics to aid debugging.
    if (failed || !vehicleReady) {
      if (vehicle) {
        console.error(
          `[fake_vehicle] stdout:\n${vehicle.stdout()}\n[fake_vehicle] stderr:\n${vehicle.stderr()}`,
        );
      }
      if (bridge) {
        console.error(`[bridge] stdout:\n${bridge.stdout()}\n[bridge] stderr:\n${bridge.stderr()}`);
      }
    }
    vehicle?.proc.kill('SIGKILL');
    bridge?.proc.kill('SIGKILL');
    await sleep(50);
  });

  it('runs gyro calibration (PREFLIGHT_CALIBRATION -> ACK) over the bridge', async () => {
    await step(async () => {
      expect(calibration).toBeDefined();
      // gyro() sends MAV_CMD_PREFLIGHT_CALIBRATION (p1=1); the fake vehicle ACKs
      // ACCEPTED over the bridge and the flow resolves (relies on client retry).
      await expect(calibration!.gyro()).resolves.toBeUndefined();
    });
  });

  it('runs onboard compass calibration: live progress + offsets round-trip', async () => {
    await step(async () => {
      expect(calibration).toBeDefined();
      const pcts: number[] = [];
      // compass() sends DO_START_MAG_CAL; the vehicle ACKs then streams
      // MAG_CAL_PROGRESS (rising pct) -> MAG_CAL_REPORT(SUCCESS, offsets).
      const result = await calibration!.compass((pct) => {
        pcts.push(pct);
      });

      // Progress was reported and is non-decreasing (rising completion_pct).
      expect(pcts.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < pcts.length; i += 1) {
        expect(pcts[i]!).toBeGreaterThanOrEqual(pcts[i - 1]!);
      }
      expect(pcts[pcts.length - 1]!).toBeGreaterThan(pcts[0]!);

      // The reported offsets round-trip the bridge exactly (MAG_CAL_REPORT).
      expect(result.offsets).toEqual(EXPECTED_OFFSETS);
    });
  });
});
