/**
 * i18n registration for the gauges widget (task T2.2; conventions
 * plan/implementation/00 §0.3, spec plan/05 §5.9).
 *
 * Contributes the `gauges.*` namespace to the English catalog via the public
 * {@link registerMessages} seam (never edits the i18n internals). Registration
 * runs once at module import and is idempotent; the widget barrel imports this
 * module for its side effect so consumers get the strings for free.
 */
import { registerMessages } from '../../../core/i18n';

/** The English `gauges.*` catalog contributed by this widget. */
export const GAUGE_MESSAGES: Readonly<Record<string, string>> = {
  // Panel + shared.
  'gauges.panel.label': 'Instruments',
  'gauges.value.none': '\u2014',
  'gauges.value.ok': 'OK',
  'gauges.value.bad': 'Bad',
  'gauges.value.yes': 'Yes',
  'gauges.value.no': 'No',

  // Gauge titles.
  'gauges.attitude.title': 'Attitude',
  'gauges.compass.title': 'Heading',
  'gauges.vsi.title': 'Climb',
  'gauges.airspeed.title': 'Speed',
  'gauges.battery.title': 'Battery',
  'gauges.gps.title': 'GPS',
  'gauges.ekf.title': 'EKF',
  'gauges.vibe.title': 'Vibration',
  'gauges.rc.title': 'RC in/out',
  'gauges.system.title': 'System',
  'gauges.link.title': 'Link',
  'gauges.nav.title': 'Waypoint',

  // Attitude / compass / VSI canvas labels.
  'gauges.roll': 'Roll',
  'gauges.pitch': 'Pitch',
  'gauges.compass.n': 'N',
  'gauges.compass.ne': 'NE',
  'gauges.compass.e': 'E',
  'gauges.compass.se': 'SE',
  'gauges.compass.s': 'S',
  'gauges.compass.sw': 'SW',
  'gauges.compass.w': 'W',
  'gauges.compass.nw': 'NW',

  // Speed.
  'gauges.groundspeed': 'Ground',
  'gauges.airspeed': 'Air',

  // Battery.
  'gauges.voltage': 'Voltage',
  'gauges.current': 'Current',
  'gauges.remaining': 'Remaining',

  // GPS.
  'gauges.fix': 'Fix',
  'gauges.sats': 'Satellites',
  'gauges.hdop': 'HDOP',
  'gauges.gps.fix.none': 'No fix',
  'gauges.gps.fix.2d': '2D',
  'gauges.gps.fix.3d': '3D',
  'gauges.gps.fix.dgps': 'DGPS',
  'gauges.gps.fix.rtkFloat': 'RTK float',
  'gauges.gps.fix.rtkFixed': 'RTK fixed',

  // EKF.
  'gauges.ekf.status': 'Status',

  // Vibration.
  'gauges.vibe.x': 'X',
  'gauges.vibe.y': 'Y',
  'gauges.vibe.z': 'Z',

  // RC.
  'gauges.rc.in.ch': 'In {n}',
  'gauges.rc.out.ch': 'Out {n}',
  'gauges.rc.none': 'No RC data',

  // System.
  'gauges.system.armed': 'Armed',
  'gauges.system.armedYes': 'Armed',
  'gauges.system.armedNo': 'Disarmed',
  'gauges.system.mode': 'Mode',

  // Link.
  'gauges.link.rate': 'Rate',
  'gauges.link.loss': 'Loss',
  'gauges.link.rssi': 'RSSI',
  'gauges.link.signed': 'Signed',

  // Nav / waypoint.
  'gauges.nav.wp': 'Current WP',
  'gauges.nav.distance': 'Distance',
  'gauges.nav.eta': 'ETA',

  // Unit symbols (kept here so they remain translatable; the metric UnitHook
  // and format helpers reference these keys rather than literals).
  'gauges.unit.ms': 'm/s',
  'gauges.unit.m': 'm',
  'gauges.unit.km': 'km',
  'gauges.unit.deg': '\u00b0',
  'gauges.unit.v': 'V',
  'gauges.unit.a': 'A',
  'gauges.unit.pct': '%',
  'gauges.unit.hz': 'Hz',
  'gauges.unit.us': '\u00b5s',
};

let registered = false;

/** Register the `gauges.*` English catalog once (idempotent). */
export function registerGaugeMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(GAUGE_MESSAGES);
}

registerGaugeMessages();
