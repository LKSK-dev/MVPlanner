# `src/core/bus` — Event bus + worker RPC (T0.4)

Implements the frozen seam in [`src/contracts/bus.ts`](../../contracts/bus.ts)
(impl `02` §2.1/§2.3): a typed in-process pub/sub `EventBus` and a
`postMessage`-based `Rpc` (request/response + streaming) that runs unchanged on
either side of a Web Worker boundary.

## Contract

- **`EventBus`** — `on<T>(topic, cb): () => void`, `emit<T>(topic, payload)`.
  Synchronous fan-out; `on` returns an idempotent disposer; `emit` iterates a
  snapshot so listeners may (un)subscribe during delivery.
- **`Rpc`** — `call<Req,Res>(method, req, {signal?})`,
  `handle<Req,Res>(method, fn)`, `stream<Req,Msg>(method, req, onMsg, {signal?})`.
  - `call` resolves with the single response or rejects with the marshaled
    handler error / abort reason.
  - `stream` invokes `onMsg` per message, resolves on stream end, rejects on
    handler error, and rejects with the abort reason on cancel.
  - `AbortSignal` propagates across the boundary: cancelling the caller aborts
    the `AbortSignal` passed to the handler.

### Additive members (not a contract change)

The frozen `Rpc` seam only declares the **caller-side** `stream`. To make it
functional, `PostMessageRpc` adds the **server counterpart**
`handleStream<Req,Msg>(method, fn)` where `fn(req, send, signal)` calls
`send(msg)` per message and resolves to end the stream. It also adds
`dispose()` for leak-free teardown. These are extra members on the concrete
class; the `Rpc` interface itself is implemented exactly.

> The frozen `call`/`stream` signatures expose no per-call transfer list, so
> transferables are not surfaced on the public RPC surface (that would require a
> contract change, impl `00` §0.6). The underlying `MessageEndpoint.postMessage`
> keeps an optional `transfer?: Transferable[]` parameter for host-level use.

## Owned files

| File           | Role                                                  |
| -------------- | ----------------------------------------------------- |
| `event-bus.ts` | `TypedEventBus` + `createEventBus`                    |
| `rpc.ts`       | `PostMessageRpc` + `createRpc` + `MessageEndpoint`    |
| `protocol.ts`  | Internal wire envelopes, type guard, error marshaling |
| `index.ts`     | Public barrel                                         |
| `README.md`    | This document                                         |

`src/workers/rpc.ts` provides `connectWorker` / `serveWorker` naming wrappers
around `createRpc`.

## How to test

```sh
npx vitest run test/unit/bus.test.ts
```

The suite uses a `MessageChannel` (happy-dom) to drive both ends and covers
pub/sub emit + unsubscribe, call round-trip, error propagation, streaming, and
cancellation via `AbortSignal`.
