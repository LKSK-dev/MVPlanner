/**
 * `ui/screens/plan/rally` public surface (task T4.7; spec plan/04 §4.3 rally,
 * plan/05 §5.3 Plan).
 *
 * The Rally points editor panel plus its registration glue. The editor manages a
 * {@link import('../../../../geo/rally').Rally} model (add/remove/edit of the
 * numeric fields) and hands every edit back via `onChange`; the Plan assembly
 * serialises it to a `MISSION_TYPE_RALLY` mission (`geo/rally` `rallyToMission`)
 * and uploads it via the `MissionClient`. Map placement of points is owned by
 * the map editor (T4.4). All rally math lives in `geo/rally`; this module is
 * presentation + wiring only. Cross-module consumers import from here, never deep
 * paths (conventions plan/implementation/00 §0.3). Importing this module
 * registers the `rally.*` i18n strings as a side effect.
 *
 * @see ./README.md for the composition and how to test.
 */
import './messages';

export { RallyPanel, type RallyPanelProps, type TFn } from './rally-panel';
export { createRallyPanel, RALLY_PANEL_ID, type RallyPanelDeps } from './register';
export { RALLY_MESSAGES, registerRallyMessages } from './messages';
