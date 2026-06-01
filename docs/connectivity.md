# Connectivity

How MVPlanner talks to vehicles and simulators: the available transports, the
optional companion bridge, security considerations, and which browsers support
what.

Open the **connection drawer** from the top bar to pick a transport, configure
it, and connect. Once connected, the drawer shows live link stats — data rate,
packet loss, RSSI, and signing status — and you can switch between multiple
vehicles.

## Transports

MVPlanner connects over modern browser APIs. Each transport has its own config
form and reconnect behavior.

| Transport     | Browser API          | Typical use                                              | Browsers          |
| ------------- | -------------------- | -------------------------------------------------------- | ----------------- |
| **Serial**    | Web Serial           | USB cable or telemetry radio direct to the autopilot.    | Chrome/Edge/Opera |
| **Bluetooth** | Web Bluetooth (GATT) | BLE telemetry bridges (MTU-aware chunking).              | Chrome/Edge/Opera |
| **WebSocket** | WebSocket            | SITL / TCP / UDP endpoints **via the companion bridge**. | All modern        |
| **WebRTC**    | RTCDataChannel       | Bridged endpoints over a WebRTC link (advanced).         | All modern        |
| **Replay**    | (local file)         | Replay a recorded tlog through the full UI.              | All modern        |

> WebUSB is reserved for device-specific uses (e.g. DFU). Firmware flashing —
> the main WebUSB/DFU use case — is **not in v1**, so there is no flashing
> transport in this release.

### Serial (USB / telemetry radio)

The most direct path for a real vehicle in Chrome/Edge/Opera:

1. Plug in the USB cable or telemetry radio.
2. Choose **Serial** and connect; pick the port in the browser prompt.
3. Set the **baud rate** — telemetry radios are commonly `57600`; a USB-direct
   link is commonly `115200`.

The transport streams bytes both ways and reconnects automatically on re-plug.

### Bluetooth

A BLE GATT streaming transport for Bluetooth telemetry bridges, with MTU-aware
chunking. Chromium browsers only.

### WebSocket (SITL and network endpoints)

Browsers cannot open raw TCP/UDP sockets, so SITL (`tcp:5760`),
`mavlink-router`, and `mavproxy` are reached through the
[companion bridge](#companion-bridge) over WebSocket (`ws://` / `wss://`). This
is also how Firefox/Safari and remote/network links connect. Reconnect/backoff
is built in.

### WebRTC

A `RTCDataChannel` transport with a signaling client, for connecting over a
WebRTC link to a bridged endpoint (advanced/optional).

### Replay

Feed a recorded **tlog** through the same stack the live path uses, honoring
timestamps, with seek/speed/pause/step. The Logs screen's
[playback UI](user-guide.md#playback) drives this transport.

### Forwarding (where available)

MVPlanner can **forward/rebroadcast** received traffic to a secondary link
(`SHOULD`) — e.g. serial in, WebSocket out — so another tool can share the same
vehicle connection.

## Companion bridge

The bridge is a tiny, **optional** Node program that bridges a **WebSocket
server ⇄ a TCP or UDP MAVLink endpoint**. It lets MVPlanner's in-browser
WebSocket transport reach sockets the browser cannot open itself.

> **The bridge is not part of the MVPlanner web app.** It is never bundled into
> `MVPlanner.html`, is not imported by the app, is distributed separately, and is
> **never required** for the Web Serial / Bluetooth / WebUSB workflows.

### Connect to local SITL (the common case)

Start SITL so it exposes TCP `5760` (ArduPilot does this by default):

```sh
# ArduPilot Copter example:
sim_vehicle.py -v ArduCopter --map --console
#   ... SITL now listens on tcp:127.0.0.1:5760
```

Run the bridge and point the app at it:

```sh
cd bridge
npm install
node bridge.mjs --ws-port 14550 --tcp 127.0.0.1:5760
# In MVPlanner: WebSocket transport -> ws://127.0.0.1:14550
```

### UDP endpoints

```sh
# Talk to a router that expects datagrams at a fixed remote:
node bridge.mjs --udp 127.0.0.1:14550 --ws-port 14551

# Or let a router push to us (e.g. mavproxy --out udpout:127.0.0.1:14560):
node bridge.mjs --udp-listen 14560 --ws-port 14551
```

Full flag reference and behavior notes are in
[`bridge/README.md`](../bridge/README.md).

## Security notes

- **Loopback by default.** The bridge binds `127.0.0.1` unless you pass `--host`.
  Keep it that way unless you understand the exposure — the bridge forwards raw
  bytes without inspection, so an exposed bridge is a direct path to your
  vehicle/SITL.
- **Before exposing remotely:** set a strong `--token`, terminate TLS in front of
  the bridge (a reverse proxy giving you `wss://`), and restrict the source
  network. The token is checked only on the WebSocket upgrade; it is not a
  substitute for transport encryption.
- **MAVLink signing** is done in the app, not the bridge — use it (and/or
  `wss://`) for authenticity/confidentiality over untrusted links.
- **Egress is visible.** MVPlanner keeps all data local by default and never
  phones home; any opt-in network destinations (custom tile sources, extension
  `net:<host>` access) are listed in **Config → Settings → Network**.

## Browser support

Web Serial / Bluetooth / USB are Chromium-only today. MVPlanner **detects
capabilities at runtime** and degrades gracefully with clear messaging, so
Firefox/Safari users are guided to the WebSocket bridge or to offline and
log-analysis features.

| Capability                    | Chrome/Edge ≥ 110 | Opera | Firefox | Safari |
| ----------------------------- | :---------------: | :---: | :-----: | :----: |
| Core UI / maps / log analysis |        ✅         |  ✅   |   ✅    |   ✅   |
| Web Serial (USB/radio)        |        ✅         |  ✅   |  ❌\*   |  ❌\*  |
| Web Bluetooth                 |        ✅         |  ✅   |  ❌\*   |  ❌\*  |
| WebUSB                        |        ✅         |  ✅   |  ❌\*   |  ❌\*  |
| WebSocket bridge transport    |        ✅         |  ✅   |   ✅    |   ✅   |

\* Firefox/Safari lack Web Serial/USB/Bluetooth; those users connect via the
WebSocket bridge or use offline/log-analysis features.

For a step-by-step first connection, see [Getting started](getting-started.md).
