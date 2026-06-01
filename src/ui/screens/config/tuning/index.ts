/**
 * `ui/screens/config/tuning` public surface (task T3.6; spec plan/04 §4.5
 * tuning, plan/05 §5.4 Config).
 *
 * The vehicle-aware PID / tuning panel: editable per-class controller tables
 * (units / range / description from metadata) wired to a {@link ParamClient},
 * extended-tune sliders, autotune start/stop via a {@link CommandClient}, and a
 * setpoint-vs-actual mini-plot placeholder. The Config screen assembly mounts
 * the panel via {@link createTuningPanel}.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Importing this module registers the `tuning.*`
 * i18n strings as a side effect.
 *
 * @see ./README.md for the group model, injection seams and how to test.
 */
import './messages';

export { TuningPanel, type TuningPanelProps, type TuningVehicle } from './tuning-panel';
export { createTuningPanel, TUNING_PANEL_ID, type TuningPanelDeps } from './register';
export {
  tuningGroupsForClass,
  groupParamNames,
  sliderParamsForClass,
  MAV_CMD_DO_AUTOTUNE_ENABLE,
  type TuningGroup,
} from './groups';
export { TUNING_MESSAGES, registerTuningMessages } from './messages';
