/**
 * `ui/screens/setup` public surface (task T5.12; spec plan/04 §4.4, plan/05
 * §5.4 Setup). The composed Setup wizard screen plus its shell registration
 * glue. Cross-module consumers (notably {@link App}) import from here, never deep
 * paths (conventions plan/implementation/00 §0.3). Importing this module
 * registers the `setup.params.*` i18n strings as a side effect.
 *
 * The per-step modules (frame/accel/compass/radio/modes/failsafe/battery/motors)
 * and the reusable wizard framework remain importable from their own barrels;
 * this assembly composes them and is the only screen-level entry point.
 *
 * @see ./README.md (framework) for the wizard contract and how to test it.
 */
import './messages';

export { SetupScreen, type SetupScreenProps } from './setup-screen';
export {
  createSetupScreenPanel,
  SETUP_SCREEN_PANEL_ID,
  type SetupScreenPanelDeps,
} from './register';
export { SETUP_SCREEN_MESSAGES, registerSetupScreenMessages } from './messages';
export {
  wireTracker,
  TRACKER_PANEL_ID,
  TRACKER_COMMAND_ID,
  type TrackerWiringDeps,
  type TrackerWiringHost,
} from './tracker-register';
