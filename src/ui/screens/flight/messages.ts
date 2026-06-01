/**
 * i18n registration for the Flight screen assembly (task T2.11; conventions
 * plan/implementation/00 §0.3, spec plan/05 §5.4/§5.9).
 *
 * Contributes the `flight.*` namespace (the composition chrome: record control,
 * map tool/click-intent toggles, panel labels) to the English catalog via the
 * public {@link registerMessages} seam — never editing the i18n internals. The
 * widget namespaces (`hud.*`, `gauges.*`, `map.*`, `statustext.*`,
 * `quickwatch.*`, `actions.*`, `audit.*`) are registered by their own modules.
 *
 * Registration runs once at import and is idempotent; the screen barrel imports
 * this for its side effect.
 */
import { registerMessages } from '../../../core/i18n';

/** English `flight.*` strings contributed by the Flight screen. */
export const FLIGHT_MESSAGES: Readonly<Record<string, string>> = {
  'flight.region.label': 'Flight data',
  'flight.map.label': 'Map',
  'flight.hud.label': 'Head-up display',
  'flight.instruments.label': 'Instruments',
  'flight.console.label': 'Messages',
  'flight.quickwatch.label': 'Quick watch',
  'flight.swap': 'Swap map / HUD dominance',

  // tlog record control.
  'flight.record.title': 'Telemetry recording',
  'flight.record.start': 'Record',
  'flight.record.stop': 'Stop',
  'flight.record.export': 'Export tlog',
  'flight.record.idle': 'Idle',
  'flight.record.recording': 'Recording',
  'flight.record.stats': '{frames} frames \u00b7 {size} \u00b7 {duration}',

  // Map click-intent + tools toolbar.
  'flight.tool.label': 'Map tool',
  'flight.tool.none': 'Guided',
  'flight.tool.measureDistance': 'Measure distance',
  'flight.tool.measureArea': 'Measure area',
  'flight.tool.marker': 'Drop marker',
  'flight.guided.label': 'Map click',
  'flight.guided.goto': 'Fly here',
  'flight.guided.roi': 'Set ROI',

  // Audit log section.
  'flight.audit.toggle': 'Action audit log',

  // ADS-B traffic (display-only).
  'flight.adsb.label': 'ADS-B traffic',
  'flight.adsb.close': 'Close traffic details',
};

let registered = false;

/** Register the `flight.*` English catalog once (idempotent). */
export function registerFlightMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(FLIGHT_MESSAGES);
}

registerFlightMessages();
