/**
 * Connection context (T1.10; spec plan/05 §5.2). Provides the live
 * {@link ConnectionManager} plus reactive accessors (state / vehicles / active
 * selection / diagnostics) and the drawer open/close controls to the shell tree.
 *
 * The context is OPTIONAL: {@link useConnection} returns `undefined` when no
 * {@link import('./provider').ConnectionProvider} is present, so the shell (and
 * its tests) render without a live MAVLink host. The top bar uses this to make
 * the connection chip a drawer trigger only when wiring is available.
 */
import { createContext, useContext, type Accessor } from 'solid-js';
import type { ConnState, LinkStats, VehicleState } from '../../../contracts';
import type { ConnectionManager } from '../../../transport/manager';
import type { ForwardController } from './forward-control';

/** Everything the connection drawer + top-bar chip read from the provider. */
export interface ConnectionContextValue {
  /** The live connection manager (single active link for M1). */
  readonly manager: ConnectionManager;
  /** Current connection state. */
  readonly state: Accessor<ConnState>;
  /** All currently-detected vehicles. */
  readonly vehicles: Accessor<readonly VehicleState[]>;
  /** Resolved ACTIVE vehicle `sysid`, or `undefined`. */
  readonly activeSysid: Accessor<number | undefined>;
  /** Merged link diagnostics (rate / loss / rssi / signed / bytes). */
  readonly stats: Accessor<LinkStats>;
  /** Whether the connection drawer is open. */
  readonly drawerOpen: Accessor<boolean>;
  /**
   * Optional MAVLink forwarding controller (T8.5). Present when the app wires a
   * raw-frame-capable host; the drawer shows the forwarding control when set.
   */
  readonly forwarder?: ForwardController;
  /** Open the connection drawer. */
  openDrawer(): void;
  /** Close the connection drawer. */
  closeDrawer(): void;
}

const ConnectionContext = createContext<ConnectionContextValue>();

export { ConnectionContext };

/**
 * Read the connection context, or `undefined` outside a provider. Consumers
 * that always live inside the provider (the drawer) may assert; the top bar
 * treats `undefined` as "no live link wiring" and degrades gracefully.
 */
export function useConnection(): ConnectionContextValue | undefined {
  return useContext(ConnectionContext);
}
