/**
 * STATUSTEXT field parsing (task T2.8; spec plan/04 §4.2). Pure helpers that
 * turn a decoded STATUSTEXT frame into the widget-local {@link StatusMessage}
 * view model. Reused by T2.11's accumulator so the parsing is tested once and
 * shared with the wiring.
 *
 * The codec already decodes `char[]` fields to a NUL-trimmed `string`
 * (`src/mavlink/codec/field-codec.ts`), but mock data and other producers may
 * hand the raw `char[]` as a `number[]` of code points — {@link parseStatusText}
 * accepts either and always returns clean text.
 */
import type { DecodedMessage, FieldValue } from '../../../contracts';
import type { StatusMessage } from './types';

/**
 * Coerce a STATUSTEXT `text` field to a clean string. Accepts an already-decoded
 * `string`, a `number[]` of char codes (stopping at the first NUL), or
 * `undefined`; trailing NULs/whitespace are trimmed.
 */
export function parseStatusText(value: FieldValue | undefined): string {
  if (typeof value === 'string') return trimText(value);
  if (Array.isArray(value)) {
    let text = '';
    for (const code of value) {
      if (code === 0) break; // C-string: stop at first NUL
      text += String.fromCharCode(code);
    }
    return trimText(text);
  }
  return '';
}

/** Trim a trailing NUL run and surrounding whitespace. */
function trimText(text: string): string {
  const nul = text.indexOf('\u0000');
  return (nul >= 0 ? text.slice(0, nul) : text).trim();
}

/** Read a numeric field, falling back to `fallback` for missing/non-numeric. */
function numField(fields: Record<string, FieldValue>, name: string, fallback: number): number {
  const v = fields[name];
  return typeof v === 'number' ? v : fallback;
}

/**
 * Build a {@link StatusMessage} from a decoded STATUSTEXT frame. `tMs` is the
 * wall-clock receive time (default `Date.now()`); `seq` defaults to the frame's
 * MAVLink sequence number for a stable render key. Severity defaults to INFO (6)
 * and text to `''` when the respective field is absent.
 */
export function statusMessageFromDecoded(
  msg: DecodedMessage,
  tMs: number = Date.now(),
  seq: number = msg.seq,
): StatusMessage {
  return {
    severity: numField(msg.fields, 'severity', 6),
    text: parseStatusText(msg.fields.text),
    sysid: msg.sysid,
    compid: msg.compid,
    tMs,
    seq,
  };
}
