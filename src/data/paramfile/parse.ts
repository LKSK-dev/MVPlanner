/**
 * `.param`/`.parm` text parsing + MP-compatible serialization (task T3.5; spec
 * plan/04 §4.5, plan/07 §7.6).
 *
 * Mission Planner / MAVProxy parameter files are plain text, one parameter per
 * line, in any of the following equivalent shapes:
 *
 * ```
 * NAME,VALUE
 * NAME VALUE
 * NAME<TAB>VALUE
 * ```
 *
 * The parser is intentionally tolerant: it skips blank lines and `#` / `//`
 * comments (whole-line and trailing/inline), ignores any extra trailing columns,
 * and treats a non-numeric value as a header row to be dropped (so a `Name,Value`
 * CSV header or an MP banner line parses cleanly without configuration).
 */
import type { ParamFileEntry } from './types';

/**
 * Strip a trailing/inline comment (`#…` or `//…`) from a single line. Parameter
 * names never contain `#` or `//`, so cutting at the first occurrence is safe
 * and also removes whole-line comments (the result trims to empty).
 */
function stripInlineComment(line: string): string {
  const hash = line.indexOf('#');
  const slash = line.indexOf('//');
  let cut = -1;
  if (hash >= 0) {
    cut = hash;
  }
  if (slash >= 0 && (cut < 0 || slash < cut)) {
    cut = slash;
  }
  return cut >= 0 ? line.slice(0, cut) : line;
}

/**
 * Robustly parse a value token to a finite number, or `undefined` when it is not
 * numeric (empty, a header label, NaN/Infinity, etc.).
 */
function parseValue(token: string): number | undefined {
  const t = token.trim();
  if (t === '') {
    return undefined;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Split a cleaned line into `[name, value]` tokens, comma- or whitespace-delimited. */
function splitFields(line: string): { name: string; value: string } | undefined {
  const tokens = line.includes(',') ? line.split(',') : line.split(/\s+/);
  const first = tokens[0];
  const second = tokens[1];
  if (first === undefined || second === undefined) {
    return undefined;
  }
  const name = first.trim();
  if (name === '') {
    return undefined;
  }
  return { name, value: second };
}

/**
 * Parse Mission-Planner / MAVProxy `.param`/`.parm` text into entries.
 *
 * @param text - Raw file contents (any of `\n`, `\r\n`, `\r` line endings).
 * @returns Entries in file order. Blank lines, comments, and non-numeric
 *   (header) rows are dropped; extra trailing columns are ignored.
 */
export function parseParamFile(text: string): ParamFileEntry[] {
  const out: ParamFileEntry[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = stripInlineComment(rawLine).trim();
    if (line === '') {
      continue;
    }
    const fields = splitFields(line);
    if (!fields) {
      continue;
    }
    const value = parseValue(fields.value);
    if (value === undefined) {
      // Non-numeric value ⇒ header / banner row: skip rather than fail.
      continue;
    }
    out.push({ name: fields.name, value });
  }
  return out;
}

/**
 * Format a parameter value for output. Integers are written plainly; other
 * values use the shortest round-trippable decimal (`Number(format(v)) === v`).
 */
function formatValue(value: number): string {
  return value.toString();
}

/** Default header comment emitted by {@link serializeParamFile}. */
export const PARAM_FILE_HEADER = '# Onboard parameters saved by MVPlanner';

/**
 * Serialize entries to MP-compatible `.param` text: a leading header comment
 * then one `NAME,VALUE` line per parameter, sorted by name (ASCII order).
 *
 * @param params - Entries to write (a live `Param[]` is also accepted).
 * @returns The file text, newline-terminated.
 */
export function serializeParamFile(params: readonly ParamFileEntry[]): string {
  const sorted = [...params].sort((a, b) => {
    if (a.name < b.name) {
      return -1;
    }
    if (a.name > b.name) {
      return 1;
    }
    return 0;
  });
  const lines = [PARAM_FILE_HEADER];
  for (const p of sorted) {
    lines.push(`${p.name},${formatValue(p.value)}`);
  }
  return `${lines.join('\n')}\n`;
}
