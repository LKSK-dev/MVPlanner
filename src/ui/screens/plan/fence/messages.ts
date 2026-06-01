/**
 * i18n registration for the Geofence editor (task T4.6; spec plan/04 §4.3
 * Geofence, conventions plan/implementation/00 §0.3).
 *
 * Contributes the `fence.*` namespace to the English catalog via the public
 * {@link registerMessages} seam — never editing the i18n internals. Registration
 * runs once at import and is idempotent; the panel barrel imports this for its
 * side effect.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `fence.*` strings owned by the Geofence editor. */
export const FENCE_MESSAGES: Readonly<Record<string, string>> = {
  'fence.title': 'Geofence',
  'fence.region.label': 'Geofence editor',

  // Shapes section.
  'fence.section.shapes': 'Shapes',
  'fence.shapes.empty': 'No fence shapes. Add an inclusion or exclusion shape below.',
  'fence.add.inclusionPolygon': 'Add inclusion polygon',
  'fence.add.exclusionPolygon': 'Add exclusion polygon',
  'fence.add.inclusionCircle': 'Add inclusion circle',
  'fence.add.exclusionCircle': 'Add exclusion circle',

  // Shape row.
  'fence.kind.polygon': 'Polygon',
  'fence.kind.circle': 'Circle',
  'fence.inclusion.inclusion': 'Inclusion',
  'fence.inclusion.exclusion': 'Exclusion',
  'fence.shape.label': '{inclusion} {kind}',
  'fence.shape.vertices': '{n} vertices',
  'fence.shape.radius': 'Radius (m)',
  'fence.shape.remove': 'Remove shape',

  // Limits section.
  'fence.section.limits': 'Limits',
  'fence.limits.minAlt': 'Min altitude (m)',
  'fence.limits.maxAlt': 'Max altitude (m)',
  'fence.limits.breachAction': 'Breach action',

  // Breach actions (FENCE_ACTION).
  'fence.action.0': 'Report only',
  'fence.action.1': 'RTL or Land',
  'fence.action.2': 'Always Land',
  'fence.action.3': 'SmartRTL or RTL or Land',
  'fence.action.4': 'Brake or Land',
  'fence.action.5': 'SmartRTL or Land',
};

let registered = false;

/** Register the `fence.*` English catalog once (idempotent). */
export function registerFenceMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(FENCE_MESSAGES);
}

registerFenceMessages();
