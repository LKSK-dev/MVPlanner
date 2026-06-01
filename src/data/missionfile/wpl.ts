/**
 * `QGC WPL 110` mission text (`.waypoints`/`.txt`) parse + serialize (task
 * T4.9; spec plan/04 §4.3, plan/07 §7.6).
 *
 * The format is a header line followed by one tab-separated row per item:
 *
 * ```
 * QGC WPL 110
 * INDEX  CURRENT  FRAME  COMMAND  PARAM1  PARAM2  PARAM3  PARAM4  X  Y  Z  AUTOCONTINUE
 * ```
 *
 * `X`/`Y` are latitude/longitude in **decimal degrees** in the file and are
 * converted to/from the integer `×1e7` form stored in a
 * {@link import('../../contracts').MissionItem} (`x`/`y`). `Z` is altitude in
 * metres. The parse → serialize round-trip is exact for files this module
 * produces.
 */
import type { Mission, MissionItem } from '../../contracts';
import { degToE7, e7ToDegString, formatNum } from './coords';

/** The fixed header line of a `QGC WPL 110` file. */
export const WPL_HEADER = 'QGC WPL 110';

/** Number of tab-separated columns in a WPL row. */
const WPL_COLUMNS = 12;

/** Pull and validate the finite number at `tokens[i]`, or throw with context. */
function numAt(tokens: readonly string[], i: number, label: string, row: number): number {
  const tok = tokens[i];
  if (tok === undefined) {
    throw new Error(`WPL row ${row}: missing column ${label}`);
  }
  const n = Number(tok);
  if (!Number.isFinite(n)) {
    throw new Error(`WPL row ${row}: column ${label} is not a number (${tok})`);
  }
  return n;
}

/** Convert one parsed token row into a {@link MissionItem}. */
function rowToItem(tokens: readonly string[], row: number): MissionItem {
  return {
    seq: numAt(tokens, 0, 'INDEX', row),
    current: numAt(tokens, 1, 'CURRENT', row),
    frame: numAt(tokens, 2, 'FRAME', row),
    command: numAt(tokens, 3, 'COMMAND', row),
    params: [
      numAt(tokens, 4, 'PARAM1', row),
      numAt(tokens, 5, 'PARAM2', row),
      numAt(tokens, 6, 'PARAM3', row),
      numAt(tokens, 7, 'PARAM4', row),
    ],
    x: degToE7(numAt(tokens, 8, 'X', row)),
    y: degToE7(numAt(tokens, 9, 'Y', row)),
    z: numAt(tokens, 10, 'Z', row),
    autocontinue: numAt(tokens, 11, 'AUTOCONTINUE', row),
  };
}

/**
 * Parse `QGC WPL 110` text into a mission.
 *
 * @param text - Raw file contents (`\n`, `\r\n` or `\r` line endings).
 * @returns A `mission`-type {@link Mission} with items in file order.
 * @throws If the `QGC WPL 110` header is missing or a row is malformed.
 */
export function parseWpl(text: string): Mission {
  const lines = text.split(/\r\n|\r|\n/);
  const items: MissionItem[] = [];
  let started = false;
  let row = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    if (!started) {
      if (!/^QGC\s+WPL\s+110$/i.test(line)) {
        throw new Error('not a WPL file: missing "QGC WPL 110" header');
      }
      started = true;
      continue;
    }
    const tokens = line.split(/\s+/);
    if (tokens.length < WPL_COLUMNS) {
      throw new Error(`WPL row ${row}: expected ${WPL_COLUMNS} columns, got ${tokens.length}`);
    }
    items.push(rowToItem(tokens, row));
    row += 1;
  }
  if (!started) {
    throw new Error('not a WPL file: missing "QGC WPL 110" header');
  }
  return { type: 'mission', items };
}

/** Format one {@link MissionItem} as a tab-separated WPL row. */
function itemToRow(item: MissionItem): string {
  return [
    String(item.seq),
    String(item.current),
    String(item.frame),
    String(item.command),
    formatNum(item.params[0]),
    formatNum(item.params[1]),
    formatNum(item.params[2]),
    formatNum(item.params[3]),
    e7ToDegString(item.x),
    e7ToDegString(item.y),
    formatNum(item.z),
    String(item.autocontinue),
  ].join('\t');
}

/**
 * Serialize a mission to `QGC WPL 110` text.
 *
 * Integer columns (index/current/frame/command/autocontinue) are written as
 * integers, params/altitude as shortest round-trippable decimals, and
 * latitude/longitude are derived losslessly from the stored `×1e7` integers.
 *
 * @param mission - The mission to serialize (item order is preserved).
 * @returns Newline-terminated WPL text.
 */
export function serializeWpl(mission: Mission): string {
  const lines = [WPL_HEADER, ...mission.items.map(itemToRow)];
  return `${lines.join('\n')}\n`;
}
