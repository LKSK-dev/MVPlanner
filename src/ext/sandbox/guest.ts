/**
 * Sandbox guest bootstrap (task T7.2; spec plan/06 §6.6).
 *
 * Runs *inside* the isolated realm (a Web Worker with no DOM in production; an
 * in-process {@link MessagePort} in tests). It owns the guest side of the RPC
 * bridge: on {@link GUEST_INIT} it evaluates the extension into a
 * {@link GuestModule} and builds the granted-only `ctx` proxy
 * ({@link buildGuestCtx}); on {@link GUEST_ACTIVATE}/{@link GUEST_DEACTIVATE} it
 * drives the module lifecycle. The privileged proxy methods post
 * {@link BROKER_INVOKE} RPCs back to the host {@link
 * import('../permissions').PermissionBroker} — the guest holds no real client.
 *
 * `evaluate` is the swap point between the testable in-process path (return a
 * pre-provided module) and the real Worker path (eval the `code` string into a
 * module — browser-deferred, like the MAVLink host worker). The bootstrap logic
 * is identical for both so the broker + proxy are fully unit-testable here.
 */
import type { ExtManifest } from '../../contracts';
import { type MessageEndpoint, createRpc } from '../../core/bus';
import { type SandboxCtx, buildGuestCtx } from './proxy';
import {
  BROKER_INVOKE,
  GUEST_ACTIVATE,
  GUEST_DEACTIVATE,
  GUEST_INIT,
  HOST_HEARTBEAT,
  narrowInit,
} from './protocol';

/** The lifecycle shape the guest drives (the sandbox view of an extension). */
export interface GuestModule {
  activate?: (ctx: SandboxCtx) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

/** Turn the extension's source/manifest into a runnable {@link GuestModule}. */
export type GuestEvaluate = (input: { code: string; manifest: ExtManifest }) => GuestModule;

/** Timer hooks (injectable for tests); default to global interval timers. */
export interface GuestTimers {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

/** Options for {@link startSandboxGuest}. */
export interface GuestOptions {
  endpoint: MessageEndpoint;
  evaluate: GuestEvaluate;
  /** Liveness heartbeat interval (ms); `0`/omitted disables it. */
  heartbeatMs?: number;
  timers?: GuestTimers;
}

const defaultTimers: GuestTimers = {
  setInterval: (fn, ms): unknown => setInterval(fn, ms),
  clearInterval: (handle): void => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Start the guest on `endpoint`. Returns a handle to {@link stop} it (dispose
 * the RPC + clear the heartbeat). Errors thrown by `evaluate` or the module's
 * `activate`/`deactivate` reject the corresponding host RPC and are isolated by
 * the host (it marks the extension `'error'`).
 */
export function startSandboxGuest(opts: GuestOptions): { stop(): void } {
  const rpc = createRpc(opts.endpoint);
  let mod: GuestModule | undefined;
  let ctx: SandboxCtx | undefined;
  let heartbeatStop: (() => void) | undefined;

  rpc.handle(GUEST_INIT, (req: unknown): Promise<null> => {
    const init = narrowInit(req);
    mod = opts.evaluate({ code: init.code, manifest: init.manifest });
    ctx = buildGuestCtx(init.methods, (method, args) => rpc.call(BROKER_INVOKE, { method, args }));
    return Promise.resolve(null);
  });

  rpc.handle(GUEST_ACTIVATE, async (): Promise<null> => {
    if (!mod || !ctx) throw new Error('sandbox guest not initialised');
    if (mod.activate) await mod.activate(ctx);
    return null;
  });

  rpc.handle(GUEST_DEACTIVATE, async (): Promise<null> => {
    if (mod?.deactivate) await mod.deactivate();
    return null;
  });

  const heartbeatMs = opts.heartbeatMs ?? 0;
  if (heartbeatMs > 0) {
    const timers = opts.timers ?? defaultTimers;
    const id = timers.setInterval((): void => {
      void rpc.call(HOST_HEARTBEAT, null).catch((): void => {
        /* host gone / disposed — nothing to do */
      });
    }, heartbeatMs);
    heartbeatStop = (): void => timers.clearInterval(id);
  }

  return {
    stop(): void {
      if (heartbeatStop) heartbeatStop();
      rpc.dispose();
    },
  };
}
