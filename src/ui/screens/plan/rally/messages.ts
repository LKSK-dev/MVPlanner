/**
 * i18n registration for the Rally points editor (task T4.7; spec plan/04 §4.3
 * rally, conventions plan/implementation/00 §0.3).
 *
 * Contributes the `rally.*` namespace to the English catalog via the public
 * {@link registerMessages} seam — never editing the i18n internals. Registration
 * runs once at import and is idempotent; the panel barrel imports this for its
 * side effect.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `rally.*` strings owned by the Rally points editor. */
export const RALLY_MESSAGES: Readonly<Record<string, string>> = {
  'rally.title': 'Rally points',
  'rally.region.label': 'Rally points editor',

  // Table headers / point fields.
  'rally.point': 'Point {n}',
  'rally.field.lat': 'Latitude (°)',
  'rally.field.lon': 'Longitude (°)',
  'rally.field.alt': 'Altitude (m)',
  'rally.field.breakAlt': 'Break alt (m)',
  'rally.field.landDir': 'Land dir (°)',

  // Defaults.
  'rally.defaultAlt': 'Default altitude (m)',

  // Actions.
  'rally.add': 'Add rally point',
  'rally.remove': 'Remove rally point {n}',

  // Empty state.
  'rally.empty': 'No rally points yet. Add one, then place it on the map.',
  'rally.count': '{n} rally point(s)',
};

let registered = false;

/** Register the `rally.*` English catalog once (idempotent). */
export function registerRallyMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(RALLY_MESSAGES);
}

registerRallyMessages();
