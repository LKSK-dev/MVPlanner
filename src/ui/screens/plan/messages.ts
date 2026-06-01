/**
 * i18n registration for the Plan screen assembly (task T4.10; conventions
 * plan/implementation/00 §0.3, spec plan/05 §5.4 Plan).
 *
 * Contributes the `plan.screen.*`, `plan.tool.*` and `plan.toolbar.*` namespaces
 * (the composition chrome: tool rail, upload/download/file toolbar, drawer
 * labels) to the English catalog via the public {@link registerMessages} seam —
 * never editing the i18n internals. The composed widgets (`plan.table.*`,
 * `fence.*`, `rally.*`, `survey.*`, `terrain.*`, `map.*`, `mapoverlay.*`) are
 * registered by their own modules.
 *
 * Registration runs once at import and is idempotent; the screen barrel imports
 * this for its side effect.
 */
import { registerMessages } from '../../../core/i18n';

/** English `plan.screen.*` / `plan.tool.*` / `plan.toolbar.*` strings. */
export const PLAN_SCREEN_MESSAGES: Readonly<Record<string, string>> = {
  'plan.screen.region.label': 'Flight plan',
  'plan.screen.map.label': 'Map',
  'plan.screen.table.label': 'Waypoints',
  'plan.screen.profile.label': 'Terrain profile',
  'plan.screen.drawer.label': 'Editor',

  // Tool rail.
  'plan.tool.rail.label': 'Plan tools',
  'plan.tool.select': 'Select / move',
  'plan.tool.addWaypoint': 'Add waypoint',
  'plan.tool.survey': 'Survey polygon',
  'plan.tool.fencePolygon': 'Fence polygon',
  'plan.tool.fenceCircle': 'Fence circle',
  'plan.tool.rally': 'Rally point',
  'plan.tool.measure': 'Measure',
  'plan.tool.import': 'Import / open file',
  'plan.tool.hint.select': 'Drag a point to move it; Alt/Ctrl-click to delete.',
  'plan.tool.hint.addWaypoint': 'Click the map to append a waypoint.',
  'plan.tool.hint.survey': 'Click to outline the survey area, then Generate.',
  'plan.tool.hint.fencePolygon': 'Add a polygon, then click to draw its vertices.',
  'plan.tool.hint.fenceCircle': 'Click to place the circle centre; set its radius below.',
  'plan.tool.hint.rally': 'Click the map to drop a rally point.',
  'plan.tool.hint.measure': 'Click to measure distance along a path.',

  // Drawer tabs.
  'plan.drawer.fence': 'Geofence',
  'plan.drawer.rally': 'Rally',
  'plan.drawer.survey': 'Survey',

  // Upload / download / file toolbar.
  'plan.toolbar.label': 'Mission transfer',
  'plan.toolbar.verify': 'Verify read-back',
  'plan.toolbar.uploadMission': 'Upload mission',
  'plan.toolbar.downloadMission': 'Download mission',
  'plan.toolbar.uploadFence': 'Upload fence',
  'plan.toolbar.uploadRally': 'Upload rally',
  'plan.toolbar.open': 'Open file',
  'plan.toolbar.saveWpl': 'Save .waypoints',
  'plan.toolbar.savePlan': 'Save .plan',
  'plan.toolbar.measure': 'Measure: {value}',

  // Transfer status / progress.
  'plan.status.idle': 'Ready',
  'plan.status.uploading': 'Uploading {what}\u2026 {i}/{n}',
  'plan.status.downloading': 'Downloading {what}\u2026 {i}/{n}',
  'plan.status.uploaded': 'Uploaded {what} ({n} items)',
  'plan.status.downloaded': 'Downloaded {what} ({n} items)',
  'plan.status.error': '{what} failed: {message}',
  'plan.status.loaded': 'Loaded {name} ({n} items)',
  'plan.status.saved': 'Saved {name}',
  'plan.status.noTarget': 'No vehicle connected',
  'plan.what.mission': 'mission',
  'plan.what.fence': 'fence',
  'plan.what.rally': 'rally',
};

let registered = false;

/** Register the Plan-screen English catalog once (idempotent). */
export function registerPlanScreenMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(PLAN_SCREEN_MESSAGES);
}

registerPlanScreenMessages();
