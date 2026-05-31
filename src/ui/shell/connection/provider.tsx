/**
 * Connection provider (T1.10; spec plan/03 §3.5, plan/05 §5.2). The Solid glue
 * between the {@link ConnectionManager} and the rest of the app:
 *
 *  - constructs a {@link ConnectionManager} over the supplied MAVLink host,
 *  - mirrors the manager's state / vehicles / diagnostics into Solid signals so
 *    the drawer + top-bar chip react,
 *  - reactively PUSHES that state into the shared app {@link Store}: connection
 *    state → `s.connection`; detected vehicles → `s.vehicles` (keyed by sysid)
 *    + `s.activeSysid`, so the existing top-bar status chips light up live,
 *  - registers the `Connect / Disconnect` command on the shell {@link UiRegistry}
 *    (command palette, spec plan/05 §5.7),
 *  - renders the {@link ConnectionDrawer} and provides the {@link ConnectionContext},
 *  - disposes everything (subscriptions, command, manager → host worker) on
 *    cleanup.
 *
 * It does NOT construct the host (which pulls the inlined worker); {@link App}
 * creates the singleton host and hands it in, keeping this module test-friendly.
 */
import { createSignal, onCleanup, type Component, type JSX } from 'solid-js';
import type {
  AppState,
  ConnState,
  LinkStats,
  Store,
  UiRegistry,
  VehicleState,
} from '../../../contracts';
import { createConnectionManager, type MavlinkHostLike } from '../../../transport/manager';
import { t } from '../../../core/i18n';
import { ConnectionContext, type ConnectionContextValue } from './context';
import { ConnectionDrawer } from './drawer';

/** A fresh zeroed {@link LinkStats} for the pre-connection diagnostics state. */
function zeroLink(): LinkStats {
  return { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
}

/** {@link ConnectionProvider} props. */
export interface ConnectionProviderProps {
  /** The shared app store (created once by {@link App}). */
  readonly store: Store<AppState>;
  /** The shell command registry, for the `Connect / Disconnect` command. */
  readonly registry: UiRegistry;
  /** The MAVLink host the manager drives (real worker host, or a mock in tests). */
  readonly host: MavlinkHostLike;
  /** The shell subtree this provider wraps. */
  readonly children: JSX.Element;
}

/** Provider wiring the connection manager into the store, palette, and drawer. */
export const ConnectionProvider: Component<ConnectionProviderProps> = (props) => {
  const manager = createConnectionManager({ host: props.host });

  const [state, setState] = createSignal<ConnState>(manager.state());
  const [vehicles, setVehicles] = createSignal<readonly VehicleState[]>(manager.vehicles());
  const [activeSysid, setActiveSysid] = createSignal<number | undefined>(manager.activeSysid());
  const [stats, setStats] = createSignal<LinkStats>(zeroLink());
  const [drawerOpen, setDrawerOpen] = createSignal(false);

  // --- host/manager → signals + shared store --------------------------------
  const offState = manager.onState((s) => {
    setState(s);
    props.store.patch((draft) => {
      draft.connection = s;
    });
  });

  const offTelemetry = manager.onTelemetry((tele) => {
    setVehicles(tele.vehicles);
    setActiveSysid(tele.activeSysid);
    setStats(tele.stats);
    props.store.patch((draft) => {
      const next: Record<number, VehicleState> = {};
      for (const v of tele.vehicles) next[v.sysid] = v;
      draft.vehicles = next;
      if (tele.activeSysid !== undefined) draft.activeSysid = tele.activeSysid;
      else delete draft.activeSysid;
    });
  });

  // --- `Connect / Disconnect` command ---------------------------------------
  const offCommand = props.registry.registerCommand({
    id: 'connection.toggle',
    title: t('cmd.connection'),
    run: () => {
      setDrawerOpen(true);
    },
  });

  onCleanup(() => {
    offState();
    offTelemetry();
    offCommand();
    void manager.dispose();
  });

  const ctx: ConnectionContextValue = {
    manager,
    state,
    vehicles,
    activeSysid,
    stats,
    drawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
  };

  return (
    <ConnectionContext.Provider value={ctx}>
      {props.children}
      <ConnectionDrawer />
    </ConnectionContext.Provider>
  );
};
