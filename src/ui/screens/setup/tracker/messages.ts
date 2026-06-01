/**
 * i18n registration for antenna-tracker support (task T8.9; spec plan/04 §4.12).
 * Owns only the `tracker.*` namespace and contributes English strings through
 * the public `registerMessages` seam. Registration runs once at import.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `tracker.*` strings. */
export const TRACKER_MESSAGES: Readonly<Record<string, string>> = {
  'tracker.title': 'Antenna tracker',
  'tracker.description':
    'Connect to an antenna tracker, show where it is pointing, and feed it the active vehicle position so it can follow the aircraft.',
  'tracker.status.title': 'Tracker status',
  'tracker.status.connected': 'Connected',
  'tracker.status.disconnected': 'Not detected',
  'tracker.status.system': 'System {sysid}.{compid}',
  'tracker.status.azimuth': 'Azimuth',
  'tracker.status.elevation': 'Elevation',
  'tracker.status.distance': 'Distance to vehicle',
  'tracker.status.commanded': 'Commanded',
  'tracker.status.actual': 'Actual',
  'tracker.status.solution': 'Pointing solution',
  'tracker.status.noVehicle': 'No active vehicle position available.',
  'tracker.status.noTracker': 'No antenna tracker detected on the link.',
  'tracker.compass.label': 'Pointing compass',
  'tracker.feed.title': 'Position feed',
  'tracker.feed.enable': 'Feed vehicle position to tracker',
  'tracker.feed.on': 'Feeding position at {hz} Hz.',
  'tracker.feed.off': 'Position feed paused.',
  'tracker.config.title': 'Tracker configuration',
  'tracker.config.field.yawType': 'Yaw servo type',
  'tracker.config.field.pitchType': 'Pitch servo type',
  'tracker.config.field.yawRange': 'Yaw range (deg)',
  'tracker.config.field.pitchMin': 'Pitch minimum (deg)',
  'tracker.config.field.pitchMax': 'Pitch maximum (deg)',
  'tracker.config.field.distanceMin': 'Minimum distance (m)',
  'tracker.config.servoType.position': 'Position',
  'tracker.config.servoType.onoff': 'On/Off',
  'tracker.config.servoType.cr': 'Continuous rotation',
  'tracker.config.status.ready': 'Configuration loaded from the parameter cache.',
  'tracker.config.status.wrote': 'Wrote {param}.',
  'tracker.config.status.error': 'Tracker parameter write failed: {message}',
  'tracker.config.status.noParams': 'Connect a tracker to edit its configuration.',
  'tracker.units.degrees': '{value}°',
  'tracker.units.metres': '{value} m',
};

let registered = false;

/** Register the tracker `tracker.*` English catalog once (idempotent). */
export function registerTrackerMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(TRACKER_MESSAGES);
}

registerTrackerMessages();
