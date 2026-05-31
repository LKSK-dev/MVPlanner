/**
 * `mavlink/param-meta` public surface (task T3.3; spec plan/04 §4.5
 * metadata-driven parameter editors). Provides a typed {@link ParamMeta} lookup
 * for the parameter workbench (T3.4): a curated offline fallback table, a parser
 * for ArduPilot's canonical `apm.pdef.json` for runtime per-firmware import, and
 * optional enrichment from bundled dialect enums. Cross-module consumers import
 * from here, never deep paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the API, the apm.pdef format, and the curated scope.
 */
export { ParamMetaStore, createParamMetaStore } from './store';
export type { ParamEnumRef } from './store';
export { parseApmPdef, parseApmPdefParam } from './apm-pdef';
export { CURATED_PARAM_META } from './curated';
