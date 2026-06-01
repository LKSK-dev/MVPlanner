/**
 * The capability map (task T7.3; spec plan/06 §6.4/§6.5).
 *
 * The single, authoritative table mapping every privileged `ctx.*` method to the
 * {@link Permission} that gates it. It is the source of truth for both
 * {@link import('./register').registerExtApi} (which registers a broker handler
 * per row) and {@link import('./context').assembleExtContext} (which exposes a
 * `ctx.*` group only when its permission is granted), and is exported so the
 * T7.7 conformance suite can assert the surface never drifts.
 *
 * Permission rationale (spec plan/06 §6.5):
 *  - reads (`vehicles`, `mavlink` taps, `params` get/fetch/onChange, `mission`
 *    download/onCurrent/onReached, `logs`) → `telemetry:read`;
 *  - `connection` is ungated (link state is benign and always observable);
 *  - vehicle-affecting writes carry their own scope (`mavlink:send`, `command`,
 *    `params:write`, `mission:write`) and are confirm-gated + audited by the
 *    broker;
 *  - UI/`theme` → `ui:panel`; `ui.toast` + `notify.*` → `notify`; `map.*` →
 *    `map`; `storage` → `storage`; `files` → `files`; `transports` → `transport`;
 *  - `net.fetch` is egress-gated per call against `net:<host>` grants (`net:true`).
 */
import type { Permission } from '../../contracts';

/** Advanced service groups that may be absent; their methods skip registration then. */
export type OptionalGroup = 'map' | 'theme' | 'logs' | 'files' | 'net' | 'transports';

/** One row of the capability map: a dotted method name + the scope that gates it. */
export interface ApiMethodSpec {
  /** Dotted `ctx` method name, e.g. `'params.set'`, `'command.arm'`, `'net.fetch'`. */
  readonly method: string;
  /** Required scope, or `null` for an always-available method. */
  readonly permission: Permission | null;
  /** Network egress: the per-call host is gated against `net:<host>` grants. */
  readonly net?: boolean;
  /** Backing service group that may be absent (method skipped when so). */
  readonly optionalGroup?: OptionalGroup;
}

/** The frozen capability map, in `ctx` order (spec plan/06 §6.4). */
export const CAPABILITY_MAP: readonly ApiMethodSpec[] = [
  // Connection (ungated — link state is benign and always observable).
  { method: 'connection.state', permission: null },
  { method: 'connection.on', permission: null },

  // Vehicles (read).
  { method: 'vehicles.list', permission: 'telemetry:read' },
  { method: 'vehicles.active', permission: 'telemetry:read' },
  { method: 'vehicles.on', permission: 'telemetry:read' },

  // MAVLink reads.
  { method: 'mavlink.on', permission: 'telemetry:read' },
  { method: 'mavlink.latest', permission: 'telemetry:read' },
  { method: 'mavlink.rate', permission: 'telemetry:read' },
  { method: 'mavlink.requestInterval', permission: 'telemetry:read' },
  // MAVLink writes / advanced.
  { method: 'mavlink.send', permission: 'mavlink:send' },
  { method: 'mavlink.loadDialect', permission: 'dialect' },

  // Command (all vehicle-affecting).
  { method: 'command.send', permission: 'command' },
  { method: 'command.arm', permission: 'command' },
  { method: 'command.setMode', permission: 'command' },
  { method: 'command.takeoff', permission: 'command' },
  { method: 'command.land', permission: 'command' },
  { method: 'command.rtl', permission: 'command' },
  { method: 'command.guidedGoto', permission: 'command' },
  { method: 'command.setRoi', permission: 'command' },
  { method: 'command.clearRoi', permission: 'command' },
  { method: 'command.setCurrentWp', permission: 'command' },

  // Parameters (reads gated by telemetry:read; set is vehicle-affecting).
  { method: 'params.get', permission: 'telemetry:read' },
  { method: 'params.fetchAll', permission: 'telemetry:read' },
  { method: 'params.onChange', permission: 'telemetry:read' },
  { method: 'params.set', permission: 'params:write' },

  // Mission / fence / rally (reads gated by telemetry:read; writes by mission:write).
  { method: 'mission.download', permission: 'telemetry:read' },
  { method: 'mission.onCurrent', permission: 'telemetry:read' },
  { method: 'mission.onReached', permission: 'telemetry:read' },
  { method: 'mission.upload', permission: 'mission:write' },
  { method: 'mission.clear', permission: 'mission:write' },
  { method: 'mission.setCurrent', permission: 'mission:write' },

  // UI contributions.
  { method: 'ui.registerPanel', permission: 'ui:panel' },
  { method: 'ui.registerWidget', permission: 'ui:panel' },
  { method: 'ui.registerCommand', permission: 'ui:panel' },
  { method: 'ui.addMenuItem', permission: 'ui:panel' },
  { method: 'ui.confirm', permission: 'ui:panel' },
  { method: 'ui.toast', permission: 'notify' },

  // Notifications.
  { method: 'notify.info', permission: 'notify' },
  { method: 'notify.warn', permission: 'notify' },
  { method: 'notify.error', permission: 'notify' },

  // Map overlays.
  { method: 'map.addLayer', permission: 'map', optionalGroup: 'map' },
  { method: 'map.on', permission: 'map', optionalGroup: 'map' },
  { method: 'map.setBasemap', permission: 'map', optionalGroup: 'map' },
  { method: 'map.prefetch', permission: 'map', optionalGroup: 'map' },

  // Theme.
  { method: 'theme.register', permission: 'ui:panel', optionalGroup: 'theme' },

  // Logs & data analysis (read).
  { method: 'logs.openCurrentTlog', permission: 'telemetry:read', optionalGroup: 'logs' },
  { method: 'logs.queryDataFlash', permission: 'telemetry:read', optionalGroup: 'logs' },

  // Namespaced per-extension KV.
  { method: 'storage.get', permission: 'storage' },
  { method: 'storage.set', permission: 'storage' },

  // Files (File System Access API).
  { method: 'files.openForRead', permission: 'files', optionalGroup: 'files' },
  { method: 'files.saveAs', permission: 'files', optionalGroup: 'files' },

  // Networking (per-call host egress gating).
  { method: 'net.fetch', permission: null, net: true, optionalGroup: 'net' },

  // Custom transports.
  { method: 'transports.register', permission: 'transport', optionalGroup: 'transports' },
];

/** Look up the gating spec for a dotted `ctx` method (or `undefined`). */
export function specForMethod(method: string): ApiMethodSpec | undefined {
  return CAPABILITY_MAP.find((s) => s.method === method);
}
