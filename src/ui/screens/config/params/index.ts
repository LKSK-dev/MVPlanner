/**
 * `ui/screens/config/params` public surface (task T3.4; spec plan/04 §4.5,
 * plan/05 §5.4 Config).
 *
 * The parameter workbench: the {@link ParamGrid} wired to a {@link ParamClient}
 * + a toolbar (Fetch/Refresh with progress, Write changed, Write all) and a
 * compare/diff drawer. Save/Load are **injected callbacks** (`onSave`/`onLoad`)
 * that the Config assembly wires to the param-file module (T3.5) — this module
 * never imports `data/paramfile`.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). The Config assembly mounts the panel via
 * {@link createParamWorkbenchPanel}.
 *
 * @see ./README.md for the injection seams and how to test.
 */
export { ParamWorkbench, type ParamWorkbenchProps, type ParamFileCallbacks } from './workbench';
export {
  createParamWorkbenchPanel,
  PARAM_WORKBENCH_PANEL_ID,
  type ParamWorkbenchPanelDeps,
} from './register';
export { registerParamWorkbenchMessages, PARAM_WORKBENCH_MESSAGES } from './messages';
