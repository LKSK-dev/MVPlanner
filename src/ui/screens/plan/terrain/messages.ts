/**
 * i18n registration for the terrain profile chart (task T4.8; spec plan/04 §4.3
 * terrain following, conventions plan/implementation/00 §0.3).
 *
 * Contributes the `terrain.*` namespace to the English catalog via the public
 * {@link registerMessages} seam — never editing the i18n internals. Registration
 * runs once at import and is idempotent; the panel barrel imports this for its
 * side effect.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `terrain.*` strings owned by the terrain profile chart. */
export const TERRAIN_MESSAGES: Readonly<Record<string, string>> = {
  'terrain.title': 'Terrain profile',
  'terrain.region.label': 'Terrain profile along the mission path',
  'terrain.chart.label': 'Elevation versus distance along the path',
  'terrain.empty': 'Add path waypoints to sample a terrain profile.',

  // Legend.
  'terrain.legend.terrain': 'Ground',
  'terrain.legend.planned': 'Planned altitude',

  // Collision / clearance.
  'terrain.collision.none': 'Clearance OK',
  'terrain.collision.warning': '{n} collision warning(s)',
  'terrain.clearance.label': 'Clearance {n} m',
};

let registered = false;

/** Register the `terrain.*` English catalog once (idempotent). */
export function registerTerrainMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(TERRAIN_MESSAGES);
}

registerTerrainMessages();
