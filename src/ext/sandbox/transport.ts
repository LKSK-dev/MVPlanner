/**
 * Sandbox transport / guest spawning (task T7.2; spec plan/06 §6.6).
 *
 * The {@link GuestSpawner} seam decouples the {@link createSandboxRuntime host
 * runtime} from *how* the guest realm is created:
 *
 *  - {@link createInProcessSpawner} — an in-thread {@link MessageChannel} with
 *    the guest bootstrap running on the far port. No real Worker, so the broker
 *    + proxy logic is fully unit-testable. By default it runs the module carried
 *    on the load record (mirroring the T7.1 in-process runtime); pass a custom
 *    `evaluate` to test code-string evaluation.
 *  - the real-Worker spawner (eval of the persisted `code` string in a blob
 *    Worker) is browser/e2e-deferred — like the MAVLink host worker — because it
 *    needs a CSP-compatible inline worker + `import()` of untrusted code, which
 *    is exercised in the browser, not in the node unit harness.
 */
import type { ExtContext } from '../../contracts';
import type { MessageEndpoint } from '../../core/bus';
import type { ExtLoadRecord, ExtModule } from '../host';
import { type GuestEvaluate, type GuestModule, startSandboxGuest } from './guest';
import type { SandboxCtx } from './proxy';

/** A spawned guest realm: its host-side endpoint + a terminate handle. */
export interface SpawnedGuest {
  /** The host-side {@link MessageEndpoint} the runtime speaks RPC over. */
  host: MessageEndpoint;
  /** Tear the guest down (terminate the Worker / close the channel). */
  terminate(): void;
}

/** Creates a guest realm for one extension load. */
export type GuestSpawner = (record: ExtLoadRecord) => Promise<SpawnedGuest>;

/** Options for {@link createInProcessSpawner}. */
export interface InProcessSpawnerOptions {
  /** How to turn the record into a runnable module (default: use `record.module`). */
  evaluate?: GuestEvaluate;
  /** Liveness heartbeat interval (ms) for the guest; `0`/omitted disables it. */
  heartbeatMs?: number;
}

/**
 * Adapt a T7.1 {@link ExtModule} (whose `activate` takes the full
 * {@link ExtContext}) into the sandbox {@link GuestModule} (whose `activate`
 * takes the proxy `ctx`). The proxy is the T7.2 surface; the full typed
 * `ExtContext` is assembled over the broker in T7.3 — so the cast is the single
 * documented narrow at this seam.
 */
function adaptModule(mod: ExtModule): GuestModule {
  const { activate, deactivate } = mod;
  return {
    ...(activate
      ? {
          activate: (ctx: SandboxCtx): void | Promise<void> =>
            activate(ctx as unknown as ExtContext),
        }
      : {}),
    ...(deactivate ? { deactivate: (): void | Promise<void> => deactivate() } : {}),
  };
}

/** Default in-process `evaluate`: run the module carried on the load record. */
function moduleEvaluate(record: ExtLoadRecord): GuestEvaluate {
  return (): GuestModule => {
    const mod = record.module;
    if (!mod) {
      throw new Error(
        `in-process sandbox requires a module for extension "${record.id}" (code-string eval is the real-Worker path)`,
      );
    }
    return adaptModule(mod);
  };
}

/** Build an in-process {@link GuestSpawner} backed by a {@link MessageChannel}. */
export function createInProcessSpawner(opts: InProcessSpawnerOptions = {}): GuestSpawner {
  const heartbeatMs = opts.heartbeatMs ?? 0;
  return (record: ExtLoadRecord): Promise<SpawnedGuest> => {
    const channel = new MessageChannel();
    const evaluate = opts.evaluate ?? moduleEvaluate(record);
    const guest = startSandboxGuest({
      endpoint: channel.port2,
      evaluate,
      ...(heartbeatMs > 0 ? { heartbeatMs } : {}),
    });
    const spawned: SpawnedGuest = {
      host: channel.port1,
      terminate(): void {
        guest.stop();
        channel.port1.close();
        channel.port2.close();
      },
    };
    return Promise.resolve(spawned);
  };
}
