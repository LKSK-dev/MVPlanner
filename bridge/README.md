# MVPlanner companion bridge (`mvplanner-bridge`)

A tiny, **optional** Node program that bridges a **WebSocket server ⇄ a TCP or
UDP MAVLink endpoint**. It lets MVPlanner's in-browser WebSocket transport
(spec `plan/03` §3.5 item 4) reach raw sockets the browser cannot open itself —
ArduPilot/PX4 **SITL** (`tcp:5760`), `mavlink-router`, or `mavproxy` — and is how
Firefox/Safari and network/remote links connect (spec `plan/03` §3.6).

> **This is not part of the MVPlanner web app.** It is never bundled into
> `MVPlanner.html`, is not imported by `src/`, is separately distributed, and is
> **never required** for the Web Serial / Web Bluetooth / WebUSB workflows.

## Install

```sh
cd bridge
npm install        # installs `ws` into bridge/node_modules (separate from the app)
```

## Usage

```
mvplanner-bridge --tcp <host:port>     [--ws-port N] [--host ADDR] [--token S]
mvplanner-bridge --udp <host:port>     [--ws-port N] [--host ADDR] [--token S]
mvplanner-bridge --udp-listen <port>   [--ws-port N] [--host ADDR] [--token S]
```

Exactly one of `--tcp` / `--udp` / `--udp-listen` is required (a clear error is
printed otherwise).

| Flag                  | Default     | Meaning                                                                                                                                              |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--tcp <host:port>`   | —           | Connect **each** ws client to this TCP endpoint (e.g. SITL `127.0.0.1:5760`).                                                                        |
| `--udp <host:port>`   | —           | UDP remote target; **each** ws client gets its own dgram socket bound to an ephemeral local port.                                                    |
| `--udp-listen <port>` | —           | Bind **one shared** UDP socket; the peer address is learned from inbound datagrams and fanned out to all ws clients.                                 |
| `--ws-port <N>`       | `14550`     | WebSocket listen port. (14550 is the conventional MAVLink/GCS port and avoids colliding with SITL's TCP 5760.)                                       |
| `--host <ADDR>`       | `127.0.0.1` | Bind address. **Loopback-only by default** for safety.                                                                                               |
| `--token <SECRET>`    | —           | If set, require this secret on the ws upgrade (`?token=…` query param, or `x-auth-token` / `Authorization: Bearer` header). Mismatches get HTTP 401. |
| `--help`              | —           | Print usage.                                                                                                                                         |

### Connect MVPlanner to local SITL (the common case)

Start SITL so it exposes TCP `5760` (ArduPilot does this by default):

```sh
# ArduPilot example (Copter):
sim_vehicle.py -v ArduCopter --map --console
#   ... SITL now listens on tcp:127.0.0.1:5760
```

Then run the bridge and point the app at it:

```sh
node bridge.mjs --ws-port 14550 --tcp 127.0.0.1:5760
# In MVPlanner: WebSocket transport -> ws://127.0.0.1:14550
```

### UDP examples

```sh
# Talk to a router that expects datagrams at a fixed remote:
node bridge.mjs --udp 127.0.0.1:14550 --ws-port 14551

# Or let a router push to us (mavproxy --out udpout:127.0.0.1:14560):
node bridge.mjs --udp-listen 14560 --ws-port 14551
```

## Behavior notes

- **Binary frames only.** MAVLink frames are forwarded as WebSocket binary
  messages; stray text frames are ignored. Bytes are piped verbatim in both
  directions (the bridge does no MAVLink parsing).
- **One upstream per ws client (TCP / `--udp`).** Each browser link gets its own
  upstream socket, matching GCS-per-link semantics. Closing either side tears
  down the other.
- **`--udp-listen` is shared.** A single bound socket is fanned out to all ws
  clients and ws→udp is sent to the most-recently-seen peer. This suits the
  common single-vehicle case; for multiple isolated vehicles prefer `--udp` or
  multiple bridge instances.

## Security

- **Loopback by default.** The ws server (and the `--udp-listen` socket) bind
  `127.0.0.1` unless you pass `--host`. Keep it that way unless you understand
  the exposure.
- **Before exposing remotely:** set a strong `--token`, terminate TLS in front of
  the bridge (e.g. a reverse proxy giving you `wss://`), and restrict the source
  network. The token is checked on the HTTP upgrade only; it is not a substitute
  for transport encryption. The bridge performs **no MAVLink signing** — use
  MAVLink message signing in the app and/or `wss://` for confidentiality.
- The bridge forwards raw bytes without inspection; treat any exposed bridge as a
  direct path to your vehicle/SITL.

## Validation (self-test)

```sh
cd bridge
export npm_config_cache="$PWD/.npm-cache"   # repo-local cache
npm install
npm test            # node --test (runs test.mjs)
```

The self-test starts fake TCP/UDP echo servers on ephemeral ports, starts the
bridge against them, connects a real `ws` client, and asserts bytes round-trip
unchanged; it also asserts token rejection (401) and acceptance, and that a
missing upstream is rejected.

## Scope (v1) & TODO

- **In scope:** `ws ⇄ TCP` (client to SITL) and `ws ⇄ UDP` (remote + listen).
- **Out of scope / documented TODO:** **serial bridging.** The app handles
  serial directly via Web Serial (spec `plan/03` §3.5 item 1), so a `ws ⇄ serial`
  mode is intentionally deferred. If a future need arises (e.g. Firefox/Safari
  serial), add a `--serial <path>@<baud>` mode here using `node:serialport` as a
  separate optional dependency.
