/**
 * `ui/screens/plan` public surface (task T4.10; spec plan/04 §4.3, plan/05 §5.4
 * Plan). The composed Flight Plan screen plus its shell registration glue and
 * the map editor (T4.4). Cross-module consumers (notably {@link App}) import
 * from here, never deep paths (conventions plan/implementation/00 §0.3).
 * Importing this module registers the `plan.screen.*` i18n strings as a side
 * effect.
 *
 * @see ./README.md for the composition, shared-signal wiring and how to test it.
 */
import './messages';

export { PlanScreen, type PlanScreenProps, type TFn } from './plan-screen';
export { ToolRail, type ToolRailProps } from './tool-rail';
export { createPlanScreenPanel, PLAN_SCREEN_PANEL_ID, type PlanScreenPanelDeps } from './register';
export { PLAN_SCREEN_MESSAGES, registerPlanScreenMessages } from './messages';

// The map editor (pure reducer + controller) — re-exported for one import site.
export {
  createMapEditController,
  dispatchMapEdit,
  hitTest,
  toFenceOverlay,
  toMissionOverlay,
  toRallyOverlay,
  type EditState,
  type FeatureRef,
  type MapEditController,
  type MapEditEvent,
  type PlanToolMode,
} from './map-edit';

// Re-export the composed editor panels for one import site.
export { WaypointTable } from './table';
export { FencePanel } from './fence';
export { RallyPanel } from './rally';
export { SurveyPanel } from './survey';
export { TerrainProfile } from './terrain';
