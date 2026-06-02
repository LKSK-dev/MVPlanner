/**
 * M1-gate LIVE integration smoke (spec plan/05 §5.3; WBS M1 gate, T1.9, T1.13).
 *
 * Proves the real byte path end to end:
 *
 *   pymavlink "fake vehicle" (TCP server)
 *        -> committed companion bridge  (bridge/bridge.mjs, ws <-> tcp)
 *        -> Node global WebSocket client (this test)
 *        -> REAL MavlinkSession          (our codec + registry + vehicle model)
 *        -> a live vehicle is decoded.
 *
 * Full ArduPilot SITL is not installed here; pymavlink is the stand-in vehicle.
 * Because pymavlink is an INDEPENDENT MAVLink encoder, decoding its live stream
 * with our codec doubly validates the codec on a real wire.
 *
 * We import {@link MavlinkSession} from the host module's `session` entry (the
 * SAME real class the worker host wraps) rather than the package barrel, because
 * the barrel also pulls `MavlinkHost`, whose `?worker&inline` import is a
 * browser/Worker-bundling concern irrelevant to — and undesirable in — this
 * process-spawning node smoke. The codec/registry/vehicle graph exercised here
 * is byte-for-byte the one the worker host runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MavlinkSession } from '../../src/mavlink/host/session';
import type { TelemetrySnapshot } from '../../src/mavlink/host/session';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const pythonBin = resolve(repoRoot, '.venv/bin/python');
const fakeVehicle = resolve(here, 'fake_vehicle.py');
const bridgeScript = resolve(repoRoot, 'bridge/bridge.mjs');

// Expected fixed location emitted by fake_vehicle.py (kept in sync with it).
const EXPECTED_LAT = -35.3632621;
const EXPECTED_LON = 149.1652374;

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
let finalSnapshot: TelemetrySnapshot | undefined;

describe('M1 live integration: pymavlink -> bridge -> ws -> MavlinkSession', () => {
  beforeAll(async () => {
    // 1) Boot the pymavlink fake vehicle and read its bound TCP port.
    vehicle = spawnChild(pythonBin, [fakeVehicle, '--port', '0'], repoRoot);
    const portMatch = await waitForMatch(vehicle, 'stdout', /PORT (\d+)/, 10_000, 'fake_vehicle');
    const vehPort = Number(portMatch[1]);
    expect(vehPort).toBeGreaterThan(0);

    // 2) Boot the committed bridge: ws server (ephemeral) <-> the vehicle's TCP.
    //    --ws-port 0 lets the OS assign a free port; we read it back from the log.
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

    // 4) Poll snapshots until a live copter in AUTO, armed, with a 3D GPS fix
    //    and a decoded position appears (or the deadline passes).
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const snap = session.takeSnapshot();
      const v = snap.vehicles[0];
      if (
        v &&
        v.vehicleClass === 'copter' &&
        v.mode === 'AUTO' &&
        v.armed === true &&
        v.gps !== undefined &&
        v.gps.fix >= 3 &&
        v.position !== undefined
      ) {
        finalSnapshot = snap;
        break;
      }
      await sleep(100);
    }
  });

  afterAll(async () => {
    try {
      ws?.close();
    } catch {
      // ignore
    }
    // On failure, surface child diagnostics to aid debugging.
    if (finalSnapshot === undefined) {
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

  it('decodes a live vehicle through the full bridge+codec path', () => {
    expect(finalSnapshot, 'no vehicle decoded before timeout').toBeDefined();
    const snap = finalSnapshot!;
    const v = snap.vehicles[0]!;

    // Vehicle identity + state derived by the REAL vehicle model from the live
    // HEARTBEAT custom_mode/base_mode.
    expect(v.vehicleClass).toBe('copter');
    expect(v.mode).toBe('AUTO');
    expect(v.armed).toBe(true);

    // GPS health from the live GPS_RAW_INT.
    expect(v.gps).toBeDefined();
    expect(v.gps!.fix).toBeGreaterThanOrEqual(3);
    expect(v.gps!.sats).toBeGreaterThanOrEqual(10);

    // Position from the live GLOBAL_POSITION_INT, matching what the fake vehicle
    // sent (within a tight tolerance covering int1e7 quantisation).
    expect(v.position).toBeDefined();
    expect(v.position!.lat).toBeCloseTo(EXPECTED_LAT, 5);
    expect(v.position!.lon).toBeCloseTo(EXPECTED_LON, 5);

    // The active vehicle is the one we decoded.
    expect(snap.activeSysid).toBe(v.sysid);
  });

  it('observed live HEARTBEAT and GLOBAL_POSITION_INT in the snapshot rates', () => {
    expect(finalSnapshot).toBeDefined();
    const names = new Set(finalSnapshot!.rates.map((r) => r.name));
    expect(names.has('HEARTBEAT')).toBe(true);
    expect(names.has('GLOBAL_POSITION_INT')).toBe(true);
    // Each observed stream should have ingested at least one frame.
    for (const r of finalSnapshot!.rates) {
      expect(r.count).toBeGreaterThanOrEqual(1);
    }
  });
});
