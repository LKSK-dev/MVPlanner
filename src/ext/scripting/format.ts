/**
 * Pretty-printing for the scripting output pane (task T7.4; spec plan/06 §6.7
 * "returned values pretty-printed").
 *
 * Pure and DOM-free. {@link formatValue} renders an arbitrary value to a
 * readable string (quoted strings, `[Function]`, errors, circular-safe object /
 * array dumps); {@link renderLogArgs} mirrors `console.log` semantics (top-level
 * strings printed bare, everything else via {@link formatValue}).
 */

/** Indentation unit for nested objects/arrays. */
const INDENT = '  ';

/** True for values JSON-ish enough to recurse into. */
function isPlainContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  if (Array.isArray(v)) return true;
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Render a single primitive (or primitive-like) value, with strings quoted. */
function formatPrimitive(value: unknown): string | undefined {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return Object.is(value, -0) ? '-0' : String(value);
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${value.toString()}n`;
    case 'symbol':
      return value.toString();
    case 'undefined':
      return 'undefined';
    case 'function': {
      const name = (value as { name?: unknown }).name;
      return typeof name === 'string' && name ? `[Function: ${name}]` : '[Function (anonymous)]';
    }
    default:
      return undefined;
  }
}

/**
 * Render `value` to a readable, multi-line-capable string. Cyclic references are
 * rendered as `[Circular]`; non-plain objects fall back to a tag like
 * `[object Map]` (with `Error` specially formatted).
 */
export function formatValue(value: unknown, depth = 0, seen: Set<object> = new Set()): string {
  if (value === null) return 'null';

  const primitive = formatPrimitive(value);
  if (primitive !== undefined) return primitive;

  // Objects from here down.
  const obj = value as object;
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (seen.has(obj)) return '[Circular]';
  if (depth > 6) return Array.isArray(value) ? '[Array]' : '[Object]';

  if (!isPlainContainer(value)) {
    const tag = Object.prototype.toString.call(value).slice(8, -1);
    return `[object ${tag}]`;
  }

  seen.add(obj);
  try {
    const pad = INDENT.repeat(depth + 1);
    const closePad = INDENT.repeat(depth);
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      const items = value.map((item) => `${pad}${formatValue(item, depth + 1, seen)}`);
      return `[\n${items.join(',\n')}\n${closePad}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) return '{}';
    const entries = keys.map((key) => {
      const k = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
      return `${pad}${k}: ${formatValue(record[key], depth + 1, seen)}`;
    });
    return `{\n${entries.join(',\n')}\n${closePad}}`;
  } finally {
    seen.delete(obj);
  }
}

/**
 * Render a `console.*` argument list the way a browser console does: a top-level
 * string argument is printed verbatim (no quotes), anything else via
 * {@link formatValue}. Arguments are space-joined.
 */
export function renderLogArgs(args: readonly unknown[]): string {
  return args.map((a) => (typeof a === 'string' ? a : formatValue(a))).join(' ');
}
