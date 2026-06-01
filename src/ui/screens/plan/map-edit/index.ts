/**
 * `ui/screens/plan/map-edit` public surface (task T4.4; spec plan/04 §4.3 map
 * editing). The map-mission editor: a PURE reducer (`./dispatch`) turning map
 * clicks / drags into edits of the shared plan models, plus a thin controller
 * (`./controller`) that binds it to the map engine and renders the editable
 * geometry through the existing overlay layers. Cross-module consumers import
 * from here, never deep paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the tool modes, the reducer and how to test it.
 */
export type { EditState, FeatureRef, MapEditEvent, PlanToolMode } from './types';
export {
  DEFAULT_MAP_CIRCLE_RADIUS_M,
  dispatchMapEdit,
  hitTest,
  toFenceOverlay,
  toMissionOverlay,
  toRallyOverlay,
  type Project,
} from './dispatch';
export {
  createMapEditController,
  type MapEditController,
  type MapEditControllerDeps,
  type MapEditHost,
} from './controller';
