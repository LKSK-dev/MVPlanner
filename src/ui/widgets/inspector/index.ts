/**
 * `ui/widgets/inspector` public surface (task T1.12; spec plan/04 §4.9,
 * plan/05 §5.4/§5.5). The MAVLink inspector: a per-`(sysid, compid)` message /
 * field tree with observed rates, last-seen, search, a raw/HEX view and the
 * latest frame's signing / CRC status.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Wire it into the app with
 * {@link registerInspector}(registry, host, t).
 *
 * @see ./README.md for the data contract, owned files, and how to test.
 */
import './messages';

export { Inspector, type InspectorProps } from './inspector';
export { INSPECTOR_MESSAGES } from './messages';
export {
  registerInspector,
  createInspectorPanel,
  toggleInspectorWindow,
  INSPECTOR_PANEL_ID,
  INSPECTOR_COMMAND_ID,
} from './register';
export { createEnumDecoder, type EnumDecoder } from './enums';
export { toHex, formatHexDump } from './hex';
export { formatFieldValue, formatRate, formatAge, type AgeParts } from './format';
export type { InspectorSource, InspectorSnapshot, InspectorRow, TFn } from './types';
