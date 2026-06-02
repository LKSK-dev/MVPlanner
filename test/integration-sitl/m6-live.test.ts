/**
 * M6-gate LIVE integration smoke (spec plan/03 §3.4 Log download, plan/04 §4.8;
 * WBS M6 gate, T6.1). Closes the part of the M6 gate that needs a real wire
 * rather than a fake host: proving the DataFlash LOG-DOWNLOAD microservice
 * (list + chunked, resumable download) end to end over the committed bridge.
 *
 *   pymavlink "fake vehicle" (TCP server; also serves the classic LOG_* protocol
 *        for ONE synthetic in-memory log, dropping a chunk once to force resume)
 *        -> committed companion bridge  (bridge/bridge.mjs, ws <-> tcp)
 *        -> Node global WebSocket client (this test)
 *        -> REAL MavlinkSession          (our codec + registry + vehicle model)
 *        -> LogClient                     (the real log microservice)
 *
 * Proves, end to end over the SAME byte path the worker host runs:
 *  1) list(): a LOG_REQUEST_LIST travels the ws->tcp bridge to the (independent)
 *     pymavlink vehicle, which streams LOG_ENTRY back; the real LogClient
 *     resolves exactly one LogEntry (id 0) with the advertised size.
 *  2) download(0, onProgress): LOG_REQUEST_DATA windows are answered with 90-byte
 *     LOG_DATA chunks; the vehicle DROPS the chunk at ofs=900 once, so the client
 *     must detect the byte gap and re-request it. The reassembled Blob's bytes
 *     must EXACTLY equal the vehicle's deterministic synthetic pattern (proves
 *     chunk reassembly + dropped-chunk RESUME over the bridge) and onProgress
 *     must advance to 100%.
 *
 * Deferred to a SITL/browser CI env: full ArduPilot SITL + a real board, large
 * (500 MB) `.bin` decode/perf, the browser Logs UI (plot + synced map track),
 * CSV export, tlog playback, and message sender. pymavlink is the independent
 * stand-in vehicle (its independent MAVLink codec doubly validates ours on a
 * real wire). The same `session` host entry as m1..m5-live is used (not the
 * package barrel) to avoid the worker-bundling import irrelevant to this smoke.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MavlinkSession } from '../../src/mavlink/host/session';
import { LogClient } from '../../src/mavlink/microservices/log';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const pythonBin = resolve(repoRoot, '.venv/bin/python');
const fakeVehicle = resolve(here, 'fake_vehicle.py');
const bridgeScript = resolve(repoRoot, 'bridge/bridge.mjs');

// Must match the fake vehicle's synthetic log (LOG_LEN / pattern). The length is
// deliberately NOT a multiple of 90 so the last LOG_DATA chunk is partial.
const LOG_LEN = 2600;
/** The deterministic byte pattern the fake vehicle stores for log id 0. */
function expectedLogBytes(): Uint8Array {
  const b = new Uint8Array(LOG_LEN);
  for (let i = 0; i < LOG_LEN; i++) b[i] = (i * 73 + 7) & 0xff;
  return b;
}

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
let log: LogClient | undefined;
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

describe('M6 live integration: DataFlash log list + resumable download over the real bridge', () => {
  beforeAll(async () => {
    // 1) Boot the pymavlink fake vehicle (telemetry + LOG_* protocol) + port.
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

    // 4) Build a LogClient over the LIVE link: encode+send out the ws, tap
    //    decoded LOG_* from the session, resolve the target from snapshots.
    log = new LogClient({
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
    //    returns a target for LOG_* requests).
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
      log?.dispose();
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

  it('lists the one synthetic log (id 0) with the advertised size', async () => {
    await step(async () => {
      expect(log).toBeDefined();
      // LOG_REQUEST_LIST -> LOG_ENTRY round-trip over the bridge.
      const entries = await log!.list();
      expect(entries.length).toBe(1);
      const entry = entries[0]!;
      expect(entry.id).toBe(0);
      expect(entry.sizeBytes).toBe(LOG_LEN);
    });
  }, 30_000);

  it('downloads log 0 byte-exactly, recovering the dropped chunk (resume) + 100% progress', async () => {
    await step(async () => {
      expect(log).toBeDefined();

      // Track progress: capture the last (done,total) and the high-water done.
      let lastDone = -1;
      let lastTotal = -1;
      let maxDone = 0;
      const onProgress = (done: number, total: number): void => {
        lastDone = done;
        lastTotal = total;
        if (done > maxDone) maxDone = done;
      };

      // The vehicle drops the chunk at ofs=900 once, so completing the download
      // proves the client detected the byte gap and re-requested it (resume).
      const blob = await log!.download(0, onProgress);
      const got = new Uint8Array(await blob.arrayBuffer());

      // Byte-exact reassembly against the deterministic synthetic pattern.
      const want = expectedLogBytes();
      expect(got.length).toBe(want.length);
      expect(got.length).toBe(LOG_LEN);
      // Compare via hex digests for a compact, exact assertion (and a precise
      // first-divergence report if it ever fails).
      let firstDiff = -1;
      for (let i = 0; i < want.length; i++) {
        if (got[i] !== want[i]) {
          firstDiff = i;
          break;
        }
      }
      expect(firstDiff, `bytes diverge at offset ${firstDiff}`).toBe(-1);

      // Progress advanced to 100% (done === total === LOG_LEN).
      expect(lastTotal).toBe(LOG_LEN);
      expect(lastDone).toBe(LOG_LEN);
      expect(maxDone).toBe(LOG_LEN);
    });
  }, 30_000);
});
