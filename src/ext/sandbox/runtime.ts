/**
 * Sandboxed extension runtime (task T7.2; spec plan/06 §6.6).
 *
 * Implements the T7.1 {@link ExtensionRuntime} seam (`load(record) ->
 * LoadedExtension`) so the {@link import('../host').ExtensionHost} drives a
 * sandboxed extension exactly like the in-process one — no host changes. For
 * each load it:
 *
 *  - spawns a guest realm via the injected {@link GuestSpawner} (in-process for
 *    tests, a real Worker in-browser),
 *  - bridges {@link BROKER_INVOKE} RPCs from the guest proxy to
 *    {@link PermissionBroker.invoke} (the host-side mediation point),
 *  - sends the *granted-only* method names ({@link PermissionBroker.capabilitiesFor})
 *    at init so the guest proxy exposes only permitted methods,
 *  - optionally arms a {@link SandboxWatchdog} fed by guest heartbeats that
 *    `terminate()`s a runaway guest.
 *
 * The {@link ExtContext} the host passes to `activate` is intentionally ignored:
 * across the worker boundary the privileged surface is the broker, reached via
 * the in-guest proxy. (The full typed `ExtContext` for the trusted/in-process
 * path is assembled in T7.3.)
 */
import type { ExtContext } from '../../contracts';
import { createRpc } from '../../core/bus';
import type { ExtLoadRecord, ExtensionRuntime, LoadedExtension } from '../host';
import type { PermissionBroker } from '../permissions';
import {
  BROKER_INVOKE,
  GUEST_ACTIVATE,
  GUEST_DEACTIVATE,
  GUEST_INIT,
  HOST_HEARTBEAT,
  narrowInvoke,
} from './protocol';
import type { GuestSpawner } from './transport';
import { SandboxWatchdog } from './watchdog';

/** Watchdog config for the runtime (timer hooks injectable for tests). */
export interface SandboxWatchdogConfig {
  /** Max time between guest heartbeats before it is terminated (ms). */
  timeoutMs: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Injected dependencies for {@link createSandboxRuntime}. */
export interface SandboxRuntimeDeps {
  broker: PermissionBroker;
  spawn: GuestSpawner;
  /** Enable the CPU/loop watchdog (off by default). */
  watchdog?: SandboxWatchdogConfig;
  /** Notified when a guest is force-terminated (e.g. watchdog timeout). */
  onTerminated?: (id: string, reason: string) => void;
}

/** Build a sandboxed {@link ExtensionRuntime} mediated by `deps.broker`. */
export function createSandboxRuntime(deps: SandboxRuntimeDeps): ExtensionRuntime {
  return {
    async load(record: ExtLoadRecord): Promise<LoadedExtension> {
      const spawned = await deps.spawn(record);
      const rpc = createRpc(spawned.host);
      const methods = [...(await deps.broker.capabilitiesFor(record.id))];

      let terminated = false;
      const terminate = (reason: string): void => {
        if (terminated) return;
        terminated = true;
        watchdog?.stop();
        // Reject all in-flight host->guest RPCs (e.g. a hanging GUEST_ACTIVATE)
        // BEFORE killing the guest, so callers like `host.activate` settle.
        rpc.dispose();
        try {
          spawned.terminate();
        } catch {
          /* isolate terminate faults */
        }
        deps.onTerminated?.(record.id, reason);
      };

      let watchdog: SandboxWatchdog | undefined;
      if (deps.watchdog) {
        watchdog = new SandboxWatchdog({
          timeoutMs: deps.watchdog.timeoutMs,
          onTimeout: (): void => terminate('watchdog-timeout'),
          ...(deps.watchdog.setTimer ? { setTimer: deps.watchdog.setTimer } : {}),
          ...(deps.watchdog.clearTimer ? { clearTimer: deps.watchdog.clearTimer } : {}),
        });
        rpc.handle(HOST_HEARTBEAT, (): Promise<null> => {
          watchdog?.beat();
          return Promise.resolve(null);
        });
      }

      // Guest proxy → host broker. Errors from the broker/handler marshal back
      // as a rejected RPC; they never crash the host.
      rpc.handle(BROKER_INVOKE, (req: unknown): Promise<unknown> => {
        const { method, args } = narrowInvoke(req);
        return deps.broker.invoke(record.id, method, args);
      });

      return {
        async activate(_ctx: ExtContext): Promise<void> {
          await rpc.call(GUEST_INIT, { code: record.code, manifest: record.manifest, methods });
          watchdog?.start();
          await rpc.call(GUEST_ACTIVATE, {});
        },
        async deactivate(): Promise<void> {
          watchdog?.stop();
          await rpc.call(GUEST_DEACTIVATE, {});
        },
        async dispose(): Promise<void> {
          watchdog?.stop();
          rpc.dispose();
          if (!terminated) {
            terminated = true;
            try {
              spawned.terminate();
            } catch {
              /* isolate terminate faults */
            }
          }
        },
      };
    },
  };
}
