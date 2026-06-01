/**
 * `ui/screens/plan/terrain` public surface (task T4.8; spec plan/04 §4.3 terrain
 * following, plan/05 §5.3 Plan).
 *
 * The terrain profile chart (elevation vs distance with the planned altitude
 * overlaid + collision-warning markers) plus its registration glue. The profile
 * **data** is injected — the async elevation sampling lives in `geo/terrain` —
 * so the component is fully testable without a provider or map. Cross-module
 * consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Importing this module registers the `terrain.*`
 * i18n strings as a side effect.
 *
 * @see ./README.md for the composition and how to test.
 */
import './messages';

export { TerrainProfile, type TerrainProfileProps, type TFn } from './terrain-profile';
export { createTerrainPanel, TERRAIN_PANEL_ID, type TerrainPanelDeps } from './register';
export { TERRAIN_MESSAGES, registerTerrainMessages } from './messages';
