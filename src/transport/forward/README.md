# MAVLink forwarding / proxy

`createForwarder({ source, targets })` rebroadcasts raw bytes from a primary
`Transport` to one or more secondary `Transport`s. It is intentionally below the
MAVLink codec: no frames are parsed or rewritten.

```ts
import { createForwarder } from './forward';

const forwarder = createForwarder({
  source: serialTransport,
  targets: [websocketTransport],
  bidirectional: false,
});

forwarder.start();
forwarder.addTarget(otherTransport, { bidirectional: true });
forwarder.removeTarget(websocketTransport);
forwarder.stop();
```

## API

- `start()` begins reading `source.readable` and writing each chunk to every
  target's `writable`.
- `stop()` halts future forwarding. It does **not** close any transport.
- `addTarget(target, options?)` adds a secondary link. When the forwarder is
  already running, the target starts receiving immediately.
- `removeTarget(target)` removes a secondary link by object identity.
- `stats()` reports forwarded and dropped chunks/bytes per target.

Set `bidirectional: true` globally or per target to also forward
`target.readable` to `source.writable`.

## Back-pressure policy

The source link is never blocked by a slow secondary link. Each destination has a
bounded write queue (`maxPendingChunks`, default `16`). When that queue is full,
the newest chunk for that destination is dropped and counted in `stats()`; other
destinations continue normally.

`stop()` is cooperative and non-cancelling: it avoids cancelling/closing the
underlying Web Streams owned by the transports. A pending read lock is released
when that read resolves or the stream ends.
