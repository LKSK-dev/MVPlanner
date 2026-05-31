/**
 * Parser for ArduPilot's canonical **apm.pdef.json** parameter-definition
 * metadata format (T3.3; spec plan/04 §4.5 metadata-driven editors).
 *
 * `apm.pdef.json` is the standard per-firmware metadata document produced by
 * ArduPilot's `param_metadata` tooling. Its top level is either:
 *
 *  1. **Vehicle-grouped** — `{ "json": {...}, "ArduCopter": { PARAM: {...} },
 *     "ArduPlane": { PARAM: {...} }, ... }` (the canonical shipped form), or
 *  2. **Flat** — `{ PARAM: {...}, PARAM2: {...} }` (a single firmware's params).
 *
 * Each per-parameter object uses string-valued fields:
 * `Description`, `DisplayName`, `User`, `Units`, `Range` (`{ high, low }`),
 * `Increment`, `Values` (enum map `{ "0": "Disabled" }`), `Bitmask`
 * (`{ "0": "Roll" }`), `RebootRequired` (`"True"`), `ReadOnly` (`"True"`).
 *
 * The parser is deliberately tolerant: missing/extra fields are ignored, and
 * the legacy comma form (`"0:Off,1:On"`) is accepted for `Values`/`Bitmask` in
 * addition to the object form. `ReadOnly` is recognised but has no slot in the
 * frozen {@link ParamMeta} contract, so it is dropped.
 *
 * This module is **pure** (no I/O): the full per-firmware document is imported
 * at runtime by the caller (it is intentionally not bundled — see README), then
 * fed here. The result is merged into a {@link ParamMetaStore}.
 */
import type { ParamMeta } from '../../contracts';

/** Metadata field names that mark an object as a per-parameter definition. */
const PARAM_META_KEYS = [
  'Description',
  'DisplayName',
  'Units',
  'Range',
  'Values',
  'Bitmask',
  'Increment',
  'RebootRequired',
  'ReadOnly',
  'User',
] as const;

/** Top-level keys that are document metadata, not vehicle groups. */
const NON_GROUP_KEYS = new Set(['json', 'format', 'version']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse a string or number into a finite number, else `undefined`. */
function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Parse ArduPilot's `"True"`/`"False"` (or boolean) flags. */
function toBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  return undefined;
}

/**
 * Parse a `Values`/`Bitmask` map. Accepts the canonical object form
 * (`{ "0": "Label" }`) and the legacy comma form (`"0:Label,1:Other"`). Keys
 * are coerced to integers; non-numeric keys are skipped. Returns `undefined`
 * when no usable entry is found.
 */
function parseIntKeyedMap(v: unknown): Record<number, string> | undefined {
  const out: Record<number, string> = {};
  let count = 0;
  const add = (rawKey: string, label: unknown): void => {
    const key = Number.parseInt(rawKey.trim(), 10);
    if (!Number.isFinite(key)) return;
    const text = typeof label === 'string' ? label.trim() : String(label);
    if (text.length === 0) return;
    out[key] = text;
    count++;
  };
  if (isRecord(v)) {
    for (const [k, label] of Object.entries(v)) add(k, label);
  } else if (typeof v === 'string') {
    for (const pair of v.split(',')) {
      const idx = pair.indexOf(':');
      if (idx < 0) continue;
      add(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }
  return count > 0 ? out : undefined;
}

/** Parse a `Range` value (`{ high, low }` object, or `"low high"` string). */
function parseRange(v: unknown): { min?: number; max?: number } {
  if (isRecord(v)) {
    const min = toFiniteNumber(v['low']);
    const max = toFiniteNumber(v['high']);
    return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }
  if (typeof v === 'string') {
    const parts = v.split(/[\s,]+/).map((p) => toFiniteNumber(p));
    const min = parts[0];
    const max = parts[1];
    return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }
  return {};
}

/**
 * Convert one raw apm.pdef parameter object into a {@link ParamMeta}. Returns
 * `undefined` when the object carries no field representable in `ParamMeta`
 * (e.g. only `ReadOnly`/`User`).
 */
export function parseApmPdefParam(raw: unknown): ParamMeta | undefined {
  if (!isRecord(raw)) return undefined;
  const meta: ParamMeta = {};

  const units = raw['Units'];
  if (typeof units === 'string' && units.trim().length > 0) meta.units = units.trim();

  const { min, max } = parseRange(raw['Range']);
  if (min !== undefined) meta.min = min;
  if (max !== undefined) meta.max = max;

  const inc = toFiniteNumber(raw['Increment']);
  if (inc !== undefined) meta.increment = inc;

  const values = parseIntKeyedMap(raw['Values']);
  if (values) meta.values = values;

  const bitmask = parseIntKeyedMap(raw['Bitmask']);
  if (bitmask) meta.bitmask = bitmask;

  const reboot = toBool(raw['RebootRequired']);
  if (reboot !== undefined) meta.rebootRequired = reboot;

  const description = raw['Description'] ?? raw['DisplayName'];
  if (typeof description === 'string' && description.trim().length > 0) {
    meta.description = description.trim();
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** True when an object has at least one recognised per-parameter field. */
function isParamMetaShape(v: unknown): v is Record<string, unknown> {
  return isRecord(v) && PARAM_META_KEYS.some((k) => k in v);
}

/**
 * Parse a full apm.pdef.json document into a `paramName -> ParamMeta` record.
 * Both the vehicle-grouped and flat top-level shapes are supported; when a
 * parameter appears under multiple vehicle groups the **last** one wins (pass a
 * single-vehicle document, or pre-filter, if that matters). Unknown/document
 * metadata keys (`json`, `format`, `version`) are skipped.
 *
 * @param json - the parsed JSON document (any shape; validated defensively).
 * @returns a record of upper-case-insensitive parameter names to metadata.
 */
export function parseApmPdef(json: unknown): Record<string, ParamMeta> {
  const out: Record<string, ParamMeta> = {};
  if (!isRecord(json)) return out;

  const ingest = (name: string, raw: unknown): void => {
    const meta = parseApmPdefParam(raw);
    if (meta) out[name] = meta;
  };

  for (const [key, val] of Object.entries(json)) {
    if (NON_GROUP_KEYS.has(key.toLowerCase())) continue;
    if (!isRecord(val)) continue;
    if (isParamMetaShape(val)) {
      // Flat document: `key` is a parameter name.
      ingest(key, val);
    } else {
      // Vehicle group: iterate its parameters.
      for (const [pname, pval] of Object.entries(val)) ingest(pname, pval);
    }
  }
  return out;
}
