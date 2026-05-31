// Self-test for the MVPlanner companion bridge (task T1.13).
//
// Standalone: run with `node --test` (or `npm test`) from this directory. The
// bridge is excluded from the app's vitest/tsconfig/eslint, so this validates it
// in isolation against real loopback TCP/UDP sockets and a real `ws` client.
//
// Covered:
//   1. ws <-> TCP round-trip: bytes sent from a ws client reach a fake TCP echo
//      server and come back through the bridge unchanged (binary fidelity).
//   2. ws <-> UDP round-trip: same, against a fake UDP echo server (--udp mode).
//   3. token rejection: with --token set, a client connecting without the token
//      is rejected at the HTTP upgrade (no open connection).
//   4. token acceptance: the same client succeeds when it supplies the token.

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startBridge } from './bridge.mjs';

/** Start a TCP echo server on an ephemeral port. */
async function startTcpEcho() {
  const server = net.createServer((sock) => sock.pipe(sock));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

/** Start a UDP echo server on an ephemeral port (echoes back to sender). */
async function startUdpEcho() {
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => sock.send(msg, rinfo.port, rinfo.address));
  sock.bind(0, '127.0.0.1');
  await once(sock, 'listening');
  return { port: sock.address().port, close: () => new Promise((r) => sock.close(r)) };
}

/** Open a ws client and resolve once OPEN; rejects on error/close-before-open. */
function openWs(url, opts) {
  const ws = new WebSocket(url, opts);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

test('ws <-> TCP round-trips bytes through the bridge', async () => {
  const echo = await startTcpEcho();
  const bridge = await startBridge({
    wsPort: 0,
    tcp: { host: '127.0.0.1', port: echo.port },
    quiet: true,
  });
  try {
    const ws = await openWs(`ws://127.0.0.1:${bridge.wsPort}`);
    const payload = Buffer.from([0xfd, 0x09, 0x00, 0x00, 0x42, 0xde, 0xad, 0xbe, 0xef]);
    const got = new Promise((resolve) => ws.once('message', (d) => resolve(Buffer.from(d))));
    ws.send(payload, { binary: true });
    assert.deepEqual(await got, payload, 'echoed bytes must match what was sent');
    ws.close();
  } finally {
    await bridge.close();
    await echo.close();
  }
});

test('ws <-> UDP round-trips bytes through the bridge', async () => {
  const echo = await startUdpEcho();
  const bridge = await startBridge({
    wsPort: 0,
    udp: { host: '127.0.0.1', port: echo.port },
    quiet: true,
  });
  try {
    const ws = await openWs(`ws://127.0.0.1:${bridge.wsPort}`);
    const payload = Buffer.from([0xfe, 0x01, 0x02, 0x03, 0x04, 0x05]);
    const got = new Promise((resolve) => ws.once('message', (d) => resolve(Buffer.from(d))));
    ws.send(payload, { binary: true });
    assert.deepEqual(await got, payload, 'echoed UDP bytes must match what was sent');
    ws.close();
  } finally {
    await bridge.close();
    await echo.close();
  }
});

test('token: rejects clients without the shared secret, accepts with it', async () => {
  const echo = await startTcpEcho();
  const bridge = await startBridge({
    wsPort: 0,
    tcp: { host: '127.0.0.1', port: echo.port },
    token: 's3cret',
    quiet: true,
  });
  try {
    // No token -> rejected at upgrade (401).
    await assert.rejects(
      openWs(`ws://127.0.0.1:${bridge.wsPort}`),
      (err) => /401/.test(String(err.message)),
      'connection without a token must be rejected with 401',
    );
    // Correct token via query param -> accepted.
    const ws = await openWs(`ws://127.0.0.1:${bridge.wsPort}/?token=s3cret`);
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.close();
    // Correct token via x-auth-token header -> accepted.
    const ws2 = await openWs(`ws://127.0.0.1:${bridge.wsPort}`, {
      headers: { 'x-auth-token': 's3cret' },
    });
    assert.equal(ws2.readyState, WebSocket.OPEN);
    ws2.close();
  } finally {
    await bridge.close();
    await echo.close();
  }
});

test('startBridge rejects when no upstream is configured', async () => {
  await assert.rejects(startBridge({ wsPort: 0, quiet: true }), /No upstream/);
});
