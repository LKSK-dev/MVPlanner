/**
 * `ui/screens/config` public surface (M3 keystone; spec plan/04 §4.5, plan/05
 * §5.4 Config).
 *
 * The tabbed Config screen (Parameters | Tuning | Settings) plus its shell
 * registration glue. {@link App} installs the real `screen.config` panel via
 * {@link createConfigScreenPanel}. Cross-module consumers import from here, never
 * deep paths (conventions plan/implementation/00 §0.3). Importing this module
 * registers the `config.*` i18n strings as a side effect.
 *
 * @see ./README.md for the composition, the shared singletons and how to test.
 */
import './messages';

export { ConfigScreen, type ConfigScreenProps } from './config-screen';
export {
  createConfigScreenPanel,
  CONFIG_SCREEN_PANEL_ID,
  type ConfigScreenPanelDeps,
} from './register';
export { CONFIG_MESSAGES, registerConfigMessages } from './messages';

// Re-export the sub-surfaces for one import site (each is a side-effecting barrel).
export { ParamWorkbench, createParamWorkbenchPanel, PARAM_WORKBENCH_PANEL_ID } from './params';
export { TuningPanel, createTuningPanel, TUNING_PANEL_ID } from './tuning';
export { SettingsScreen, createSettingsPanel, SETTINGS_PANEL_ID } from './settings';
export {
  NetworkSection,
  createEgressLog,
  type NetworkSectionDeps,
  type LinkDestination,
  type NetGrantRow,
  type EgressLog,
  type EgressEntry,
} from './settings';
