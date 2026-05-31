/**
 * Dialect-driven enum decoding for the inspector field tree (task T1.12; spec
 * plan/04 §4.9 "enum-decoded where the dialect has it", plan/03 §3.1). Pure and
 * DOM-free.
 *
 * The host keeps inspector payloads light by shipping raw field values; mapping
 * an enum-typed field's numeric value to its symbolic name is a UI concern, so
 * it happens here against the (import-only) bundled {@link DialectTable}s.
 */
import type { DialectTable, FieldValue } from '../../../contracts';

/** Resolves an enum-typed field's value to its symbolic name. */
export interface EnumDecoder {
  /**
   * Symbolic enum-entry name for `(messageName, fieldName, value)`, or
   * `undefined` when the field is not enum-typed or the value is unknown.
   */
  decode(messageName: string, fieldName: string, value: FieldValue): string | undefined;
}

/**
 * Build an {@link EnumDecoder} from `dialects`. Indices are built once: a
 * `messageName → (fieldName → enumName)` map and an `enumName → (value →
 * entryName)` map. Earlier dialects win on conflicting entries (the bundled
 * order is `common` then `ardupilotmega`, the superset).
 */
export function createEnumDecoder(dialects: readonly DialectTable[]): EnumDecoder {
  const fieldEnum = new Map<string, Map<string, string>>();
  const enumValues = new Map<string, Map<number, string>>();

  for (const d of dialects) {
    for (const meta of Object.values(d.messages)) {
      let fields: Map<string, string> | undefined;
      for (const f of meta.fields) {
        if (f.enum === undefined) continue;
        if (fields === undefined) {
          fields = fieldEnum.get(meta.name) ?? new Map<string, string>();
          fieldEnum.set(meta.name, fields);
        }
        if (!fields.has(f.name)) fields.set(f.name, f.enum);
      }
    }
    for (const [enumName, entries] of Object.entries(d.enums)) {
      let values = enumValues.get(enumName);
      if (values === undefined) {
        values = new Map<number, string>();
        enumValues.set(enumName, values);
      }
      for (const e of entries) {
        if (!values.has(e.value)) values.set(e.value, e.name);
      }
    }
  }

  return {
    decode(messageName, fieldName, value) {
      if (typeof value !== 'number') return undefined;
      const enumName = fieldEnum.get(messageName)?.get(fieldName);
      if (enumName === undefined) return undefined;
      return enumValues.get(enumName)?.get(value);
    },
  };
}
