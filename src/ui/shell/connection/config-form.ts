/**
 * Pragmatic `TransportFactory.configSchema` → form-field normalizer (T1.10;
 * spec plan/03 §3.5 / §3.7, plan/05 §5.2).
 *
 * `configSchema` is typed `unknown` at the frozen transport seam, and the three
 * built-in transports describe their forms in DIFFERENT shapes:
 *
 *  - **serial** — `{ id:'serial', fields:[{ key, type:'select', default, options }] }`
 *  - **websocket** — JSON-schema-ish `{ type:'object', properties:{ url:{type:'string'} } }`
 *  - **replay** — `{ type:'object', properties:{ data:{type:'arraybuffer'}, speed:{type:'number'} } }`
 *
 * Rather than over-engineer a full JSON-schema engine, this reads the two
 * concrete shapes defensively and emits a small, typed {@link FormField} list
 * the drawer renders. Field labels are i18n keys (`transport.<id>.<key>`) so
 * the UI localizes them via `t()` (conventions plan/implementation/00 §0.3).
 */

/** A `<select>` of numeric options (e.g. serial baud rate). */
export interface SelectField {
  readonly kind: 'select';
  readonly key: string;
  readonly labelKey: string;
  readonly value: number;
  readonly options: ReadonlyArray<{ readonly value: number; readonly label: string }>;
}

/** A free-text field (e.g. the WebSocket bridge URL). */
export interface TextField {
  readonly kind: 'text';
  readonly key: string;
  readonly labelKey: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly required: boolean;
}

/** A numeric field with optional bounds (e.g. replay playback speed). */
export interface NumberField {
  readonly kind: 'number';
  readonly key: string;
  readonly labelKey: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
}

/** A binary file field (e.g. the replay tlog data). */
export interface FileField {
  readonly kind: 'file';
  readonly key: string;
  readonly labelKey: string;
  readonly required: boolean;
}

/** A single rendered form control. */
export type FormField = SelectField | TextField | NumberField | FileField;

/** Narrowing helper for plain objects. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Build the i18n label key for a field on a given transport. */
function labelKey(transportId: string, fieldKey: string): string {
  return `transport.${transportId}.${fieldKey}`;
}

/** Read the serial-style `{ fields: [...] }` shape, if present. */
function fromSerialShape(
  transportId: string,
  schema: Record<string, unknown>,
): FormField[] | undefined {
  const fields = schema['fields'];
  if (!Array.isArray(fields)) return undefined;
  const out: FormField[] = [];
  for (const raw of fields) {
    const field = asRecord(raw);
    if (!field) continue;
    const key = typeof field['key'] === 'string' ? field['key'] : undefined;
    if (key === undefined) continue;
    if (field['type'] === 'select' && Array.isArray(field['options'])) {
      const options = field['options']
        .map(asRecord)
        .filter((o): o is Record<string, unknown> => o !== undefined)
        .map((o) => ({
          value: typeof o['value'] === 'number' ? o['value'] : 0,
          label: typeof o['label'] === 'string' ? o['label'] : String(o['value'] ?? ''),
        }));
      const def =
        typeof field['default'] === 'number' ? field['default'] : (options[0]?.value ?? 0);
      out.push({ kind: 'select', key, labelKey: labelKey(transportId, key), value: def, options });
    }
  }
  return out.length > 0 ? out : undefined;
}

/** Read the JSON-schema-ish `{ properties: {...} }` shape, if present. */
function fromPropertiesShape(
  transportId: string,
  schema: Record<string, unknown>,
): FormField[] | undefined {
  const properties = asRecord(schema['properties']);
  if (!properties) return undefined;
  const required = new Set(Array.isArray(schema['required']) ? schema['required'] : []);
  const out: FormField[] = [];
  for (const [key, rawProp] of Object.entries(properties)) {
    const prop = asRecord(rawProp);
    if (!prop) continue;
    const type = prop['type'];
    const isRequired = required.has(key) || prop['required'] === true;
    const lk = labelKey(transportId, key);
    if (type === 'string') {
      out.push({
        kind: 'text',
        key,
        labelKey: lk,
        value: typeof prop['default'] === 'string' ? prop['default'] : '',
        ...(typeof prop['description'] === 'string' ? { placeholder: prop['description'] } : {}),
        required: isRequired,
      });
    } else if (type === 'number' || type === 'integer') {
      out.push({
        kind: 'number',
        key,
        labelKey: lk,
        value: typeof prop['default'] === 'number' ? prop['default'] : 0,
        ...(typeof prop['minimum'] === 'number' ? { min: prop['minimum'] } : {}),
        ...(typeof prop['maximum'] === 'number' ? { max: prop['maximum'] } : {}),
      });
    } else if (type === 'arraybuffer') {
      out.push({ kind: 'file', key, labelKey: lk, required: isRequired });
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Normalize a transport's `configSchema` into renderable {@link FormField}s.
 * Returns an empty list for an unrecognized/empty schema (the drawer then offers
 * a bare Connect with no options).
 */
export function normalizeConfigSchema(transportId: string, schema: unknown): FormField[] {
  const record = asRecord(schema);
  if (!record) return [];
  return fromSerialShape(transportId, record) ?? fromPropertiesShape(transportId, record) ?? [];
}
