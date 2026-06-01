/**
 * `ui/screens/plan/fence` public surface (task T4.6; spec plan/04 §4.3 Geofence,
 * plan/05 §5.3 Plan).
 *
 * The Geofence editor panel plus its registration glue. The panel manages the
 * fence **shape list** (add/remove inclusion/exclusion polygons + circles, edit
 * circle radius) and the non-spatial **limits** (min/max altitude + breach
 * action), reporting the current {@link import('../../../../geo/fence').Fence}
 * via `onChange`. Polygon vertex drawing is owned by the map editor (T4.4); the
 * fence model + conversion live in `geo/fence`. Cross-module consumers import
 * from here, never deep paths (conventions plan/implementation/00 §0.3).
 * Importing this module registers the `fence.*` i18n strings as a side effect.
 *
 * @see ./README.md for the composition and how to test.
 */
import './messages';

export { FencePanel, type FencePanelProps, type TFn } from './fence-panel';
export { createFencePanel, FENCE_PANEL_ID, type FencePanelDeps } from './register';
export { FENCE_MESSAGES, registerFenceMessages } from './messages';
