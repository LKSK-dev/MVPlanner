/**
 * `ui/screens/plan/survey` public surface (task T4.5; spec plan/04 §4.3
 * survey/grid, plan/05 §5.3 Plan).
 *
 * The Survey / grid configuration panel plus its registration glue. The survey
 * polygon is provided by the map editor (T4.4) and the generated mission is
 * handed back via `onGenerate`, so the panel is fully injectable/testable. The
 * survey math lives in `geo/survey`. Cross-module consumers import from here,
 * never deep paths (conventions plan/implementation/00 §0.3). Importing this
 * module registers the `survey.*` i18n strings as a side effect.
 *
 * @see ./README.md for the composition and how to test.
 */
import './messages';

export {
  SurveyPanel,
  type SurveyPanelProps,
  type SurveyConfig,
  type TFn,
} from './survey-panel';
export { createSurveyPanel, SURVEY_PANEL_ID, type SurveyPanelDeps } from './register';
export { SURVEY_MESSAGES, registerSurveyMessages } from './messages';
