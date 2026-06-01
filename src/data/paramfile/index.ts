/**
 * `data/paramfile` public surface (task T3.5; spec plan/04 §4.5, plan/07 §7.6).
 *
 * Parameter file I/O + presets for the Config/Tuning screen:
 *
 *  - `.param`/`.parm` parse/serialize (Mission-Planner / MAVProxy compatible).
 *  - Named **partial** presets persisted via a {@link KvStore}, with a
 *    non-destructive apply/diff preview and a diff→writes reducer.
 *  - {@link FileIo}-based load/save adapters for the workbench `onLoad`/`onSave`.
 *
 * Cross-module consumers import from here, never deep paths. See `./README.md`.
 */
export { parseParamFile, serializeParamFile, PARAM_FILE_HEADER } from './parse';
export {
  applyPreset,
  createPresetStore,
  diffToWrites,
  PRESET_NS,
  PRESET_INDEX_KEY,
} from './presets';
export {
  loadParamFile,
  saveParamFile,
  PARAM_FILE_ACCEPT,
  PARAM_FILE_MIME,
  DEFAULT_PARAM_FILE_NAME,
} from './fileio';
export type {
  CurrentParams,
  LoadedParamFile,
  ParamFileEntry,
  Preset,
  PresetChangeKind,
  PresetDiff,
  PresetDiffChange,
  PresetStore,
} from './types';
