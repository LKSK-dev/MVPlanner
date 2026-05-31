# `src/mavlink/registry` — MAVLink message registry (task T1.4)

Ingests decoded MAVLink and answers the inspector / vehicle-model queries.
Spec: `plan/03` §3.3 (registry) + §3.2 (loss accounting deferred to the
registry); conventions `plan/implementation/00` §0.3.

This module is **internal**: it implements no frozen contract interface. It
depends only on the FROZEN `DecodedMessage` **type** (`src/contracts/mavlink.ts`),
not on the codec implementation, so it builds and tests against synthetic
`DecodedMessage` objects.

## What it does

- Keys a table by `(sysid, compid, msgId)` holding: `latest` message, observed
  `rateHz` (sliding window over arrival times), `lastSeenMs`, total `count`, and
  a bounded ring buffer of recent frames for the inspector.
- Per-`(sysid, compid)` **sequence-gap / packet-loss** accounting (the codec
  defers this here): tracks last seq, computes gaps modulo 256 (wrap-aware),
  exposes `received` / `lost` / `lossPct`, plus `duplicates` and `outOfOrder`.
- Resolves message **name ↔ id** from observed traffic and, optionally, an
  injected `IdNameResolver` (build one from dialect tables with
  `createDialectResolver`).
- Keeps memory **bounded** (ring buffers + windowed/capped rate samples; no
  unbounded history).

It does **not** coalesce/throttle UI updates — that is the worker host (T1.9).

## Public query API (`MessageRegistry`)

```
ingest(msg, nowMs?)                       // update records + loss stats
latest(idOrName, sysid?, compid?)         // DecodedMessage | undefined
rate(idOrName, sysid?, compid?)           // Hz (0 if none/too-few samples)
lastSeen(idOrName, sysid?, compid?)       // ms | undefined
count(idOrName, sysid?, compid?)          // number
getRing(idOrName, sysid?, compid?)        // DecodedMessage[] (oldest→newest)
getRecord(idOrName, sysid?, compid?)      // MessageRecord | undefined
listSystems()                             // {sysid,compid}[] (sorted, unique)
linkStats(sysid, compid)                  // LinkStats | undefined
listLinkStats()                           // LinkStats[]
snapshot()                                // MessageRecord[] (sorted)
forEach(cb)                               // visit MessageRecord copies
idOf(name) / nameOf(id)                   // name↔id resolution
clear()                                   // drop all state
```

- `idOrName` is a numeric msg id **or** a message name (resolved via observed
  traffic, then the injected resolver).
- When `sysid`/`compid` are omitted, queries target the **most recently seen**
  matching stream (deterministic for the common single-source case); pass both
  for an exact lookup.

### Construction

```ts
import { MessageRegistry, createDialectResolver } from '@/mavlink/registry';
import { BUILTIN_DIALECTS } from '@/mavlink/dialects';

const registry = new MessageRegistry({
  resolver: createDialectResolver(BUILTIN_DIALECTS), // optional
  ringCapacity: 20, // default 20
  rateWindowMs: 2000, // default 2000
  rateMaxSamples: 64, // default 64
  clock: () => Date.now(), // injectable; or pass nowMs to ingest()
});
```

## Loss policy (per `(sysid, compid)`)

For `delta = (seq - lastSeq) mod 256`:

- `delta === 0` → duplicate (counted, no loss, `lastSeq` kept).
- `1 ≤ delta ≤ 128` → forward step; `delta - 1` lost; `lastSeq` advances.
- `delta > 128` → frame behind `lastSeq` (reordered/late); counted as
  out-of-order, no loss, `lastSeq` kept.

`lossPct = lost / (received + lost) * 100`.

## Owned files

| File          | Responsibility                                     |
| ------------- | -------------------------------------------------- |
| `types.ts`    | Public types (`MessageRecord`, `LinkStats`, …).    |
| `ring.ts`     | `RingBuffer` — bounded FIFO for recent frames.     |
| `rate.ts`     | `SlidingWindowRate` — windowed Hz estimator.       |
| `loss.ts`     | `LinkLossTracker` — wrap-aware seq-gap accounting. |
| `resolver.ts` | `createDialectResolver` over dialect tables.       |
| `registry.ts` | `MessageRegistry` — ingest + query surface.        |
| `index.ts`    | Public barrel.                                     |

## Tests

`test/unit/registry.test.ts` — rate with an injected clock, last-seen, ring
eviction at capacity, multi-`(sysid,compid)` routing isolation, seq-gap loss
(incl. 255→0 wraparound, duplicate, out-of-order), and name↔id resolution.

```sh
export npm_config_cache="$PWD/.npm-cache"
npx vitest run test/unit/registry.test.ts
npx eslint src/mavlink/registry test/unit/registry.test.ts
```
