/**
 * `ui/widgets/cmd-editor` public surface (task T4.2; spec plan/04 §4.3).
 *
 * A metadata-driven **MAV_CMD command palette + per-command parameter editor**:
 * a grouped command picker ({@link CmdPicker}) and a controlled per-command slot
 * editor ({@link CmdEditor}) that labels `param1..param4` + `x`/`y`/`z` from the
 * dialect `MAV_CMD` metadata. Both are controlled (`value` + `onChange`) over the
 * `geo/mission` `MissionItemModel`, for the waypoint table (T4.3) and map editing
 * (T4.4) to reuse.
 *
 * Importing this module registers the widget's `cmd.*` / `mission.*` English
 * strings via `core/i18n` `registerMessages`. Cross-module consumers import from
 * here, never deep paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the widget API and conventions.
 */
import './messages';

export { CmdEditor } from './cmd-editor';
export { CmdPicker, CUSTOM_OPTION_VALUE } from './cmd-picker';
export { registerCmdEditorMessages, CMD_EDITOR_MESSAGES } from './messages';
export {
  CURATED_COMMANDS,
  CATEGORY_ORDER,
  allCommandMetas,
  applySlot,
  categoryKey,
  curatedCommandMetas,
  groupCommands,
  resolveSlots,
  type CommandGroup,
} from './catalog';
export type {
  CmdEditorProps,
  CmdPickerProps,
  EditorSlot,
  MavCmdCategory,
  MavCmdMeta,
  MissionItemModel,
  TFn,
} from './types';
