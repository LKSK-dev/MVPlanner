/**
 * M3-gate LIVE integration smoke (spec plan/03 §3.4 Parameters, plan/04 §4.5,
 * plan/07 §7.6; WBS M3 gate, T3.2, T3.5). Closes the M3-gate proofs that need a
 * real wire rather than a fake host:
 *
 *   pymavlink "fake vehicle" (TCP server; also serves the PARAMETER protocol)
 *        -> committed companion bridge  (bridge/bridge.mjs, ws <-> tcp)
 *        -> Node global WebSocket client (this test)
 *        -> REAL MavlinkSession          (our codec + registry + vehicle model)
 *        -> ParamClient                  (the real parameter microservice)
 *
 * Proves, end to end over the SAME byte path the worker host runs:
 *  1) FULL FETCH with MISSING-INDEX RECOVERY: `fetchAll` broadcasts
 *     PARAM_REQUEST_LIST; the (independent) pymavlink vehicle streams the whole
 *     set but DROPS exactly one index on the first burst, forcing the client to
 *     re-request that index with a targeted PARAM_REQUEST_READ. The fetch still
 *     resolves with the complete set (length === param_count, every index
 *     present) and `onProgress` advances.
 *  2) SET -> CONFIRM round-trip: `set(name, value)` emits PARAM_SET; the vehicle
 *     updates its in-memory value and echoes PARAM_VALUE; the client correlates
 *     the echo, resolves, and a subsequent `get` reflects the new value.
 *  3) PARAMFILE round-trip + DIFF (pure, in-process): the fetched set is
 *     serialized to `.param` text and parsed back to identical entries, and an
 *     `applyPreset` diff for a one-parameter change reduces to a single write
 *     (covers the M3 gate's ".param save/load" + "two-set diff" without a file
 *     dialog).
 *
 * Full ArduPilot SITL + a real board + the browser Flight/Config UI + autotune
 * stay deferred to a SITL/browser CI env; pymavlink is the independent stand-in
 * vehicle (its independent MAVLink encoder doubly validates our codec on a real
 * wire). The same `session` host entry as m1/m2-live is used (not the package
 * barrel) to avoid the worker-bundling import irrelevant to this node smoke.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MavlinkSession } from '../../src/mavlink/host/session';
import { ParamClient } from '../../src/mavlink/microservices/param';
import type { Param } from '../../src/contracts';
import {
  applyPreset,
  diffToWrites,
  parseParamFile,
  serializeParamFile,
} from '../../src/data/paramfile';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const pythonBin = resolve(repoRoot, '.venv/bin/python');
const fakeVehicle = resolve(here, 'fake_vehicle.py');
const bridgeScript = resolve(repoRoot, 'bridge/bridge.mjs');

// The fake vehicle's in-memory parameter set size (kept in sync with it).
const EXPECTED_PARAM_COUNT = 16;
// A known parameter + value the fake vehicle serves, and a fresh value to write.
const KNOWN_PARAM = 'WPNAV_SPEED';
const KNOWN_VALUE = 500;
const NEW_VALUE = 750;

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
let param: ParamClient | undefined;
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

describe('M3 live integration: parameter microservice over the real bridge', () => {
  beforeAll(async () => {
    // 1) Boot the pymavlink fake vehicle (telemetry + PARAM protocol) + read port.
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

    // 4) Build a ParamClient over the LIVE link: encode+send out the ws, tap
    //    decoded PARAM_VALUEs from the session, resolve the target from snapshots.
    param = new ParamClient({
      sendMessage: (name, fields) => {
        ws!.send(session!.encodeMessage(name, fields));
      },
      onMessage: (names, cb) => session!.onMessage(names, cb),
      getTarget: () => {
        const v = session!.takeSnapshot().vehicles[0];
        return v ? { sysid: v.sysid, compid: v.compid } : undefined;
      },
    });

    // 5) Poll snapshots until the live copter vehicle appears (so getTarget
    //    returns a target for parameter requests).
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
      param?.dispose();
    } catch {
      // ignore
    }
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

  // The fetched set is shared by the set/confirm + paramfile assertions below.
  let fetched: Param[] | undefined;

  it('fetchAll recovers a dropped index and returns the FULL set', async () => {
    await step(async () => {
      expect(param).toBeDefined();
      const progress: Array<[number, number]> = [];
      // The vehicle drops exactly one index on the first PARAM_REQUEST_LIST burst;
      // the client must recover it via a targeted PARAM_REQUEST_READ. Generous
      // timeout leaves room for the client's quiet-window + retry over the wire.
      fetched = await param!.fetchAll((done, total) => progress.push([done, total]));

      // The complete set came back DESPITE the dropped index.
      expect(fetched.length).toBe(EXPECTED_PARAM_COUNT);
      const names = new Set(fetched.map((p) => p.name));
      expect(names.size).toBe(EXPECTED_PARAM_COUNT);
      expect(names.has(KNOWN_PARAM)).toBe(true);

      // Progress was reported and advanced toward the full count.
      expect(progress.length).toBeGreaterThan(0);
      const last = progress[progress.length - 1]!;
      expect(last[0]).toBe(EXPECTED_PARAM_COUNT);
      expect(last[1]).toBe(EXPECTED_PARAM_COUNT);
    });
  }, 30_000);

  it('get returns a known value and set -> confirm reflects the new value', async () => {
    await step(async () => {
      expect(param).toBeDefined();
      // `get` is a cached lookup after fetchAll.
      const before = param!.get(KNOWN_PARAM);
      expect(before).toBeDefined();
      expect(before!.value).toBeCloseTo(KNOWN_VALUE, 3);

      // PARAM_SET goes out over the bridge; the vehicle updates + echoes
      // PARAM_VALUE; the client correlates the echo and resolves.
      await param!.set(KNOWN_PARAM, NEW_VALUE);

      const after = param!.get(KNOWN_PARAM);
      expect(after).toBeDefined();
      expect(after!.value).toBeCloseTo(NEW_VALUE, 3);
    });
  }, 30_000);

  it('round-trips the fetched set through serialize/parse and diffs a one-param change', () => {
    expect(fetched, 'fetchAll must have populated the set').toBeDefined();
    const params = fetched!;

    // .param save -> load: serialize the live set to MP-compatible text and parse
    // it back; the resulting name->value entries must be identical (file order is
    // sorted by serialize, so compare as a name->value map).
    const text = serializeParamFile(params);
    const reparsed = parseParamFile(text);
    expect(reparsed.length).toBe(params.length);

    const original = new Map(params.map((p) => [p.name, p.value]));
    const roundTripped = new Map(reparsed.map((p) => [p.name, p.value]));
    expect(roundTripped.size).toBe(original.size);
    for (const [name, value] of original) {
      expect(roundTripped.get(name)).toBeCloseTo(value, 6);
    }

    // Two-set diff: a preset that changes exactly one parameter must yield a
    // single 'changed' entry that reduces to one write.
    const target = params.find((p) => p.name === KNOWN_PARAM)!;
    const preset = {
      name: 'tune-a',
      params: { [KNOWN_PARAM]: target.value + 100 },
    };
    const diff = applyPreset(preset, params);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]!.name).toBe(KNOWN_PARAM);
    expect(diff.changes[0]!.kind).toBe('changed');
    expect(diff.changes[0]!.from).toBeCloseTo(target.value, 6);
    expect(diff.changes[0]!.to).toBeCloseTo(target.value + 100, 6);

    const writes = diffToWrites(diff);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.name).toBe(KNOWN_PARAM);

    // An unchanged preset (identical values) reduces to zero writes.
    const noop = applyPreset({ name: 'noop', params: { [KNOWN_PARAM]: target.value } }, params);
    expect(noop.changes[0]!.kind).toBe('unchanged');
    expect(diffToWrites(noop)).toHaveLength(0);
  });
});
