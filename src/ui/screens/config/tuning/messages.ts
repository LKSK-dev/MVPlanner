/**
 * i18n registration for the PID / tuning panel (task T3.6; conventions
 * plan/implementation/00 §0.3, spec plan/05 §5.4 Config / §5.9).
 *
 * Contributes the panel's `tuning.*` strings to the English catalog via the
 * public {@link registerMessages} seam (never editing i18n internals).
 * Registration runs once at import and is idempotent.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `tuning.*` strings owned by the tuning panel. */
export const TUNING_MESSAGES: Readonly<Record<string, string>> = {
  'tuning.title': 'Tuning',
  'tuning.toolbar.label': 'Tuning actions',
  'tuning.fetch': 'Fetch',
  'tuning.refresh': 'Refresh',
  'tuning.writeChanged': 'Write changed',
  'tuning.changedCount': '{n} changed',
  'tuning.busy': 'Working…',
  'tuning.vehicle': 'Tuning for: {cls}',
  'tuning.noVehicle': 'No active vehicle — connect one to fetch and write tuning parameters.',
  'tuning.empty': 'No PID tuning parameters for this vehicle type.',

  // Group titles.
  'tuning.group.rate': 'Rate controllers',
  'tuning.group.angle': 'Angle controllers',
  'tuning.group.position': 'Position / velocity controllers',
  'tuning.group.controllers': 'Steering & speed controllers',
  'tuning.group.vtolRate': 'VTOL rate controllers',
  'tuning.group.vtolAngle': 'VTOL angle controllers',

  // Table column headers.
  'tuning.col.param': 'Parameter',
  'tuning.col.value': 'Value',
  'tuning.col.units': 'Units',
  'tuning.col.range': 'Range',
  'tuning.col.desc': 'Description',

  // Per-cell labels.
  'tuning.cell.label': 'Value for {name}',
  'tuning.range': '{min} … {max}',
  'tuning.range.min': '≥ {min}',
  'tuning.range.max': '≤ {max}',
  'tuning.range.none': '—',

  // Extended tune (sliders).
  'tuning.sliders.title': 'Extended tune',
  'tuning.slider.label': '{name} gain',

  // Autotune.
  'tuning.autotune.title': 'Autotune',
  'tuning.autotune.start': 'Start autotune',
  'tuning.autotune.stop': 'Stop autotune',
  'tuning.autotune.active': 'Autotune running',
  'tuning.autotune.idle': 'Autotune idle',

  // Setpoint-vs-actual mini-plot (placeholder; live plot is SITL/flight-only).
  'tuning.plot.title': 'Setpoint vs actual',
  'tuning.plot.placeholder': 'Live setpoint-vs-actual plotting appears here during flight.',

  // Status line.
  'tuning.status.fetched': 'Fetched tuning parameters.',
  'tuning.status.wrote': 'Wrote {n} tuning parameters.',
  'tuning.status.autotuneStarted': 'Autotune started.',
  'tuning.status.autotuneStopped': 'Autotune stopped.',
  'tuning.status.error': 'Operation failed: {message}',

  // Vehicle-class display names.
  'tuning.class.copter': 'Copter',
  'tuning.class.plane': 'Plane',
  'tuning.class.rover': 'Rover',
  'tuning.class.boat': 'Boat',
  'tuning.class.sub': 'Sub',
  'tuning.class.tracker': 'Tracker',
  'tuning.class.unknown': 'Unknown',
};

let registered = false;

/** Register the tuning panel's `tuning.*` English catalog once (idempotent). */
export function registerTuningMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(TUNING_MESSAGES);
}

registerTuningMessages();
