/**
 * Guest-side `ctx` proxy builder (task T7.2; spec plan/06 §6.4/§6.6).
 *
 * Inside the sandbox the extension never holds a real service client — only this
 * proxy, reconstructed from the flat list of *granted* method names the host
 * sends at init. Each privileged method becomes an async stub that posts a
 * single RPC to the main-thread {@link import('../permissions').PermissionBroker}
 * via {@link BrokerCall}. Dotted names (`command.send`, `params.set`,
 * `net.fetch`) are rebuilt into the nested `ctx` shape. Only granted methods are
 * materialised, so capability checks are explicit: an ungranted method is
 * **absent**, not a no-op (spec plan/06 §6.5).
 */

/** The reconstructed sandbox `ctx` (a nested tree of RPC stubs). */
export type SandboxCtx = Record<string, unknown>;

/** Posts one privileged call to the host broker and resolves with its result. */
export type BrokerCall = (method: string, args: readonly unknown[]) => Promise<unknown>;

/**
 * Build the nested `ctx` proxy from a flat list of granted, dotted method names.
 * Each leaf is an async function forwarding `(...args)` to `call(fullName, args)`.
 */
export function buildGuestCtx(methods: readonly string[], call: BrokerCall): SandboxCtx {
  const root: Record<string, unknown> = {};
  for (const full of methods) {
    const parts = full.split('.');
    const leaf = parts.pop();
    if (leaf === undefined || leaf === '') continue;
    let node = root;
    for (const key of parts) {
      const existing = node[key];
      if (typeof existing === 'object' && existing !== null) {
        node = existing as Record<string, unknown>;
      } else {
        const child: Record<string, unknown> = {};
        node[key] = child;
        node = child;
      }
    }
    node[leaf] = (...args: unknown[]): Promise<unknown> => call(full, args);
  }
  return root;
}
