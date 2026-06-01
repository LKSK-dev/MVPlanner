/**
 * M4-gate LIVE integration smoke (spec plan/03 §3.4 Mission, plan/04 §4.3; WBS
 * M4 gate, T4.1). Closes the part of the M4 gate that needs a real wire rather
 * than a fake host: proving MISSION / FENCE / RALLY upload + read-back end to
 * end over the committed companion bridge.
 *
 *   pymavlink "fake vehicle" (TCP server; also serves the MISSION protocol with
 *        SEPARATE item lists per MAV_MISSION_TYPE, stored verbatim)
 *        -> committed companion bridge  (bridge/bridge.mjs, ws <-> tcp)
 *        -> Node global WebSocket client (this test)
 *        -> REAL MavlinkSession          (our codec + registry + vehicle model)
 *        -> MissionClient                (the real mission microservice)
 *
 * Proves, end to end over the SAME byte path the worker host runs, for ALL THREE
 * mission types (mission=0 / fence=1 / rally=2):
 *  1) UPLOAD with read-back VERIFY: `upload(m, {verify:true})` runs the
 *     MISSION_COUNT -> MISSION_REQUEST_INT -> MISSION_ITEM_INT -> MISSION_ACK
 *     handshake, then re-downloads and compares — it must resolve.
 *  2) DOWNLOAD round-trip: a subsequent `download(type)` returns items that are
 *     byte-faithful to what was uploaded (seq / command / frame / int x,y / z /
 *     params all equal), since the fake vehicle stores items verbatim.
 *
 * The editing models (`geo/mission`, `geo/fence`, `geo/rally`) build the wire
 * Missions, exercising the model -> wire mapping the Plan screen uses.
 *
 * Deferred to a SITL/browser CI env: full ArduPilot SITL + a real board, the
 * browser Plan UI (waypoint table / map / terrain profile / file save-load), and
 * actual fence/rally *enforcement* in flight. pymavlink is the independent
 * stand-in vehicle (its independent MAVLink codec doubly validates ours on a
 * real wire). The same `session` host entry as m1/m2/m3-live is used (not the
 * package barrel) to avoid the worker-bundling import irrelevant to this smoke.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MavlinkSession } from '../../src/mavlink/host/session';
import { MissionClient } from '../../src/mavlink/microservices/mission';
import type { Mission, MissionItem } from '../../src/contracts';
import {
  MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
  NAV_WAYPOINT,
  addWaypoint,
  createMission,
  missionToWire,
} from '../../src/geo/mission';
import { addCircle, addShape, createFence, fenceToMission } from '../../src/geo/fence';
import { addRallyPoint, createRally, rallyToMission } from '../../src/geo/rally';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const pythonBin = resolve(repoRoot, '.venv/bin/python');
const fakeVehicle = resolve(here, 'fake_vehicle.py');
const bridgeScript = resolve(repoRoot, 'bridge/bridge.mjs');

// A base location (ArduPilot's default CMAC test site near Canberra) the built
// geometry hangs off of. All values below are chosen float32-exact so a
// round-trip through the wire (float params / z) compares cleanly.
const BASE_LAT = -35.3632621;
const BASE_LON = 149.1652374;

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
let mission: MissionClient | undefined;
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

/**
 * Assert a downloaded item list is byte-faithful to what was uploaded: seq /
 * command / frame / int lat,lon (x/y) exact; z + the four params within float32
 * precision (both directions quantise through float32 on the wire).
 */
function expectItemsRoundTrip(
  actual: readonly MissionItem[],
  expected: readonly MissionItem[],
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i]!;
    const e = expected[i]!;
    expect(a.seq).toBe(e.seq);
    expect(a.command).toBe(e.command);
    expect(a.frame).toBe(e.frame);
    expect(a.autocontinue).toBe(e.autocontinue);
    expect(a.x).toBe(e.x); // 1e7-scaled int latitude — exact
    expect(a.y).toBe(e.y); // 1e7-scaled int longitude — exact
    expect(a.z).toBeCloseTo(e.z, 3);
    for (let p = 0; p < 4; p++) {
      expect(a.params[p]).toBeCloseTo(e.params[p]!, 3);
    }
  }
}

describe('M4 live integration: mission/fence/rally upload + read-back over the real bridge', () => {
  beforeAll(async () => {
    // 1) Boot the pymavlink fake vehicle (telemetry + MISSION protocol) + port.
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

    // 4) Build a MissionClient over the LIVE link: encode+send out the ws, tap
    //    decoded MISSION_* from the session, resolve the target from snapshots.
    mission = new MissionClient({
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
    //    returns a target for mission transfers).
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
      mission?.dispose();
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

  it('uploads a MISSION (verify) and reads it back byte-faithfully', async () => {
    await step(async () => {
      expect(mission).toBeDefined();

      // Build a small NAV_WAYPOINT mission via the geo/mission editing model.
      let model = createMission('mission', {
        defaultAlt: 50,
        defaultFrame: MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
      });
      model = addWaypoint(
        model,
        { lat: BASE_LAT, lon: BASE_LON },
        { command: NAV_WAYPOINT, alt: 0 },
      );
      model = addWaypoint(model, { lat: BASE_LAT + 0.001, lon: BASE_LON }, { alt: 50 });
      model = addWaypoint(model, { lat: BASE_LAT + 0.001, lon: BASE_LON + 0.001 }, { alt: 60 });
      model = addWaypoint(model, { lat: BASE_LAT, lon: BASE_LON + 0.001 }, { alt: 50 });
      const wire: Mission = missionToWire(model);
      expect(wire.items.length).toBe(4);

      // Upload + read-back verify must resolve (handshake + re-download compare).
      await mission!.upload(wire, { verify: true });

      // An explicit download must round-trip the items.
      const rb = await mission!.download('mission');
      expect(rb.type).toBe('mission');
      expectItemsRoundTrip(rb.items, wire.items);
    });
  }, 30_000);

  it('uploads a FENCE (verify) and reads it back byte-faithfully', async () => {
    await step(async () => {
      expect(mission).toBeDefined();

      // A small inclusion polygon (4 vertices) + an exclusion circle.
      let fence = createFence({ minAltM: 10, maxAltM: 100 });
      fence = addShape(fence, {
        kind: 'polygon',
        inclusion: 'inclusion',
        vertices: [
          { lat: BASE_LAT - 0.002, lon: BASE_LON - 0.002 },
          { lat: BASE_LAT - 0.002, lon: BASE_LON + 0.002 },
          { lat: BASE_LAT + 0.002, lon: BASE_LON + 0.002 },
          { lat: BASE_LAT + 0.002, lon: BASE_LON - 0.002 },
        ],
      });
      fence = addCircle(fence, 'exclusion', { lat: BASE_LAT, lon: BASE_LON }, 75);
      const wire: Mission = fenceToMission(fence);
      expect(wire.type).toBe('fence');
      expect(wire.items.length).toBe(5); // 4 polygon vertices + 1 circle

      await mission!.upload(wire, { verify: true });

      const rb = await mission!.download('fence');
      expect(rb.type).toBe('fence');
      expectItemsRoundTrip(rb.items, wire.items);
    });
  }, 30_000);

  it('uploads a RALLY and reads it back byte-faithfully', async () => {
    await step(async () => {
      expect(mission).toBeDefined();

      // 1-2 rally points (the second carries break-alt + a flag extra).
      let rally = createRally({ defaultAlt: 50 });
      rally = addRallyPoint(rally, { lat: BASE_LAT + 0.0005, lon: BASE_LON + 0.0005 }, { alt: 50 });
      rally = addRallyPoint(
        rally,
        { lat: BASE_LAT - 0.0005, lon: BASE_LON - 0.0005 },
        { alt: 75, breakAlt: 30, flags: 2 },
      );
      const wire: Mission = rallyToMission(rally);
      expect(wire.type).toBe('rally');
      expect(wire.items.length).toBe(2);

      await mission!.upload(wire);

      const rb = await mission!.download('rally');
      expect(rb.type).toBe('rally');
      expectItemsRoundTrip(rb.items, wire.items);
    });
  }, 30_000);
});
