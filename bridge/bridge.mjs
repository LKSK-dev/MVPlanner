// MVPlanner companion bridge (spec plan/03 §3.6, task T1.13).
//
// A tiny, OPTIONAL Node program that bridges a WebSocket server <-> a TCP or UDP
// MAVLink endpoint, so the browser's WebSocket transport (plan/03 §3.5 item 4)
// can reach SITL (tcp:5760), mavlink-router, or mavproxy from any browser.
//
// This file is NOT part of the single-file web app, is never bundled into the
// HTML, and is intentionally excluded from the app's eslint/tsconfig/vitest.
// It carries its own package.json + node_modules (the `ws` dependency).
//
// Security posture: binds 127.0.0.1 (localhost) by default. An optional shared
// secret (--token) is required on the WebSocket upgrade when set. See README.md
// before exposing this to a non-loopback interface.

import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import { parseArgs } from 'node:util';
import { WebSocketServer } from 'ws';

/** Default WebSocket listen port. Distinct from SITL's TCP 5760 to avoid a
 *  same-port collision when bridging to local SITL. 14550 is the conventional
 *  MAVLink/GCS port and is easy to remember. */
export const DEFAULT_WS_PORT = 14550;

/** Default bind address: loopback only, for safety (plan/03 §3.6). */
export const DEFAULT_HOST = '127.0.0.1';

/**
 * Parse `host:port` into a typed pair. Accepts bare `:port` (host defaults to
 * 127.0.0.1) and bracketed IPv6 like `[::1]:5760`.
 * @param {string} value
 * @param {string} flag - originating flag name, for error messages
 * @returns {{ host: string, port: number }}
 */
export function parseHostPort(value, flag) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${flag} requires a value like host:port (e.g. 127.0.0.1:5760)`);
  }
  let host;
  let portStr;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end === -1) throw new Error(`${flag}: malformed IPv6 address in "${value}"`);
    host = value.slice(1, end);
    const rest = value.slice(end + 1);
    if (!rest.startsWith(':')) throw new Error(`${flag}: missing :port in "${value}"`);
    portStr = rest.slice(1);
  } else {
    const idx = value.lastIndexOf(':');
    if (idx === -1) throw new Error(`${flag}: expected host:port, got "${value}"`);
    host = value.slice(0, idx) || DEFAULT_HOST;
    portStr = value.slice(idx + 1);
  }
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${flag}: invalid port "${portStr}" in "${value}"`);
  }
  return { host, port };
}

/**
 * Extract the auth token a client supplied on the HTTP upgrade request, from
 * either the `?token=` query param, an `x-auth-token` header, or a
 * `Authorization: Bearer <token>` header.
 * @param {http.IncomingMessage} req
 * @returns {string | undefined}
 */
function extractToken(req) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const q = url.searchParams.get('token');
    if (q) return q;
  } catch {
    // ignore malformed request URL; fall through to headers
  }
  const header = req.headers['x-auth-token'];
  if (typeof header === 'string' && header.length > 0) return header;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return undefined;
}

/**
 * Wire a ws connection to a freshly-opened TCP upstream. Each ws client gets its
 * own TCP socket (matches GCS-per-link semantics for SITL/mavlink-router).
 * @param {import('ws').WebSocket} ws
 * @param {{ host: string, port: number }} target
 * @param {(msg: string) => void} log
 */
function bridgeTcp(ws, target, log) {
  const sock = net.connect(target.port, target.host);
  sock.on('connect', () => log(`tcp connected -> ${target.host}:${target.port}`));
  sock.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
  });
  ws.on('message', (data, isBinary) => {
    // Browsers send MAVLink frames as binary; ignore stray text frames.
    if (!isBinary && typeof data === 'string') return;
    sock.write(/** @type {Buffer} */ (data));
  });
  const closeBoth = () => {
    sock.destroy();
    if (ws.readyState === ws.OPEN) ws.close();
  };
  sock.on('error', (err) => {
    log(`tcp error: ${err.message}`);
    closeBoth();
  });
  sock.on('close', closeBoth);
  ws.on('close', () => sock.destroy());
  ws.on('error', () => sock.destroy());
}

/**
 * Wire a ws connection to a per-client UDP "remote" upstream. We bind an
 * ephemeral local port, send datagrams to the configured remote, and forward
 * datagrams received from it back to this ws client. Each ws client is isolated.
 * @param {import('ws').WebSocket} ws
 * @param {{ host: string, port: number }} target
 * @param {(msg: string) => void} log
 */
function bridgeUdpRemote(ws, target, log) {
  const sock = dgram.createSocket('udp4');
  let sockClosed = false;
  sock.on('message', (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
  });
  ws.on('message', (data, isBinary) => {
    if (!isBinary && typeof data === 'string') return;
    if (sockClosed) return; // socket already closed; drop
    sock.send(/** @type {Buffer} */ (data), target.port, target.host);
  });
  const closeSock = () => {
    if (sockClosed) return;
    sockClosed = true;
    sock.close();
  };
  sock.on('error', (err) => {
    log(`udp error: ${err.message}`);
    closeSock();
    if (ws.readyState === ws.OPEN) ws.close();
  });
  ws.on('close', closeSock);
  ws.on('error', closeSock);
  log(`udp remote ready -> ${target.host}:${target.port}`);
}

/**
 * Shared UDP-listen upstream: a single bound dgram socket fanned out to every
 * connected ws client. Suits the common single-vehicle case where an autopilot
 * router does `--out udpout:<bridge-host>:<port>`. The remote address is learned
 * from the most recent inbound datagram; ws->udp is sent to that learned peer.
 */
class UdpListenHub {
  /**
   * @param {{ host: string, port: number }} bind
   * @param {(msg: string) => void} log
   */
  constructor(bind, log) {
    this.log = log;
    /** @type {Set<import('ws').WebSocket>} */
    this.clients = new Set();
    /** @type {{ address: string, port: number } | undefined} */
    this.remote = undefined;
    this.closed = false;
    this.sock = dgram.createSocket('udp4');
    this.sock.on('message', (chunk, rinfo) => {
      this.remote = { address: rinfo.address, port: rinfo.port };
      for (const ws of this.clients) {
        if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
      }
    });
    this.sock.on('error', (err) => log(`udp-listen error: ${err.message}`));
    this.sock.bind(bind.port, bind.host, () =>
      log(`udp-listen bound ${bind.host}:${bind.port} (shared)`),
    );
  }

  /** @param {import('ws').WebSocket} ws */
  attach(ws) {
    this.clients.add(ws);
    ws.on('message', (data, isBinary) => {
      if (!isBinary && typeof data === 'string') return;
      if (this.closed) return; // socket already closed; drop
      if (!this.remote) return; // no peer learned yet; drop
      this.sock.send(/** @type {Buffer} */ (data), this.remote.port, this.remote.address);
    });
    const detach = () => this.clients.delete(ws);
    ws.on('close', detach);
    ws.on('error', detach);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const ws of this.clients) ws.close();
    this.clients.clear();
    this.sock.close();
  }
}

/**
 * @typedef {Object} BridgeOptions
 * @property {number} [wsPort]   WebSocket listen port (0 = ephemeral).
 * @property {string} [host]     Bind address (default 127.0.0.1).
 * @property {{ host: string, port: number }} [tcp]        TCP upstream target.
 * @property {{ host: string, port: number }} [udp]        UDP remote target.
 * @property {{ host: string, port: number }} [udpListen]  UDP listen bind.
 * @property {string} [token]    Optional shared secret required on ws upgrade.
 * @property {boolean} [quiet]   Suppress per-event logging.
 */

/**
 * @typedef {Object} BridgeHandle
 * @property {number} wsPort                The actual WebSocket port in use.
 * @property {string} host                  The actual bind host.
 * @property {() => Promise<void>} close    Shut everything down.
 */

/**
 * Start the bridge. Exactly one of `tcp`, `udp`, or `udpListen` must be set.
 * Resolves once the WebSocket server is listening (so callers can read the
 * assigned ephemeral port).
 * @param {BridgeOptions} options
 * @returns {Promise<BridgeHandle>}
 */
export function startBridge(options) {
  const host = options.host ?? DEFAULT_HOST;
  const upstreams = [options.tcp, options.udp, options.udpListen].filter(Boolean);
  if (upstreams.length === 0) {
    return Promise.reject(
      new Error('No upstream configured: provide --tcp, --udp, or --udp-listen.'),
    );
  }
  if (upstreams.length > 1) {
    return Promise.reject(
      new Error(
        'Multiple upstreams configured: provide exactly one of --tcp / --udp / --udp-listen.',
      ),
    );
  }
  const log = options.quiet ? () => {} : (msg) => console.log(`[bridge] ${msg}`);

  const server = http.createServer((_req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain' });
    res.end('MVPlanner bridge: WebSocket upgrade required.\n');
  });
  const wss = new WebSocketServer({ noServer: true });
  const hub = options.udpListen ? new UdpListenHub(options.udpListen, log) : undefined;

  server.on('upgrade', (req, socket, head) => {
    if (options.token) {
      const supplied = extractToken(req);
      if (supplied !== options.token) {
        log('rejected ws upgrade: bad or missing token');
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    log(`ws client connected from ${req.socket.remoteAddress ?? 'unknown'}`);
    if (options.tcp) bridgeTcp(ws, options.tcp, log);
    else if (options.udp) bridgeUdpRemote(ws, options.udp, log);
    else if (hub) hub.attach(ws);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.wsPort ?? DEFAULT_WS_PORT, host, () => {
      server.removeListener('error', reject);
      const addr = server.address();
      const wsPort =
        typeof addr === 'object' && addr ? addr.port : (options.wsPort ?? DEFAULT_WS_PORT);
      log(`listening ws://${host}:${wsPort}${options.token ? ' (token required)' : ''}`);
      resolve({
        wsPort,
        host,
        close: () =>
          new Promise((done) => {
            hub?.close();
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => server.close(() => done()));
          }),
      });
    });
  });
}

const USAGE = `MVPlanner-bridge — WebSocket <-> TCP/UDP MAVLink bridge (plan/03 §3.6)

Usage:
  mvplanner-bridge --tcp <host:port>        [--ws-port N] [--host ADDR] [--token S]
  mvplanner-bridge --udp <host:port>        [--ws-port N] [--host ADDR] [--token S]
  mvplanner-bridge --udp-listen <port>      [--ws-port N] [--host ADDR] [--token S]

Options:
  --tcp <host:port>    Connect each ws client to this TCP endpoint (e.g. SITL 127.0.0.1:5760).
  --udp <host:port>    Send/recv UDP to this remote; each ws client gets its own socket.
  --udp-listen <port>  Bind a shared UDP socket; learns the peer from inbound datagrams.
  --ws-port <N>        WebSocket listen port (default ${DEFAULT_WS_PORT}).
  --host <ADDR>        Bind address (default ${DEFAULT_HOST} / loopback only).
  --token <SECRET>     Require this shared secret on the ws upgrade (?token= or x-auth-token).
  --help               Show this help.

Exactly one of --tcp / --udp / --udp-listen is required.

Examples:
  # Bridge to local ArduPilot/PX4 SITL (TCP 5760):
  mvplanner-bridge --ws-port 14550 --tcp 127.0.0.1:5760
  # then point MVPlanner's WebSocket transport at ws://127.0.0.1:14550
`;

/**
 * CLI entry point. Parses argv, validates, and starts the bridge.
 * @param {string[]} argv
 * @returns {Promise<BridgeHandle>}
 */
export async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'ws-port': { type: 'string' },
      tcp: { type: 'string' },
      udp: { type: 'string' },
      'udp-listen': { type: 'string' },
      token: { type: 'string' },
      host: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return process.exit(0);
  }

  /** @type {BridgeOptions} */
  const opts = {};
  if (values['ws-port'] !== undefined) {
    const p = Number(values['ws-port']);
    if (!Number.isInteger(p) || p < 0 || p > 65535)
      throw new Error(`--ws-port: invalid port "${values['ws-port']}"`);
    opts.wsPort = p;
  }
  if (values.host !== undefined) opts.host = values.host;
  if (values.token !== undefined) opts.token = values.token;
  if (values.tcp !== undefined) opts.tcp = parseHostPort(values.tcp, '--tcp');
  if (values.udp !== undefined) opts.udp = parseHostPort(values.udp, '--udp');
  if (values['udp-listen'] !== undefined) {
    const lp = Number(values['udp-listen']);
    if (!Number.isInteger(lp) || lp < 1 || lp > 65535)
      throw new Error(`--udp-listen: invalid port "${values['udp-listen']}"`);
    // Bind the UDP listener to the same safety-default host as the ws server
    // (loopback) unless the operator explicitly widens it via --host.
    opts.udpListen = { host: values.host ?? DEFAULT_HOST, port: lp };
  }

  return startBridge(opts);
}

// Run as a CLI only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[bridge] ${err.message}`);
    console.error('\nRun with --help for usage.');
    process.exit(1);
  });
}
