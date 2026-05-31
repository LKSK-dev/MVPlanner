/**
 * Raw-frame hex formatting for the inspector hex view (task T1.12; spec plan/04
 * §4.9 "raw/hex view of recent frames"). Pure, DOM-free, unit-testable.
 */

/** Two-digit uppercase hex for one byte. */
function hexByte(b: number): string {
  return (b & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

/** Printable-ASCII for the dump's right column; non-printable → `.`. */
function asciiByte(b: number): string {
  return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
}

/**
 * Continuous space-separated hex of every byte, e.g. `FD 09 00 …`. Empty input
 * yields an empty string.
 */
export function toHex(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (const b of bytes) parts.push(hexByte(b));
  return parts.join(' ');
}

/** Bytes per row in {@link formatHexDump}. */
const BYTES_PER_ROW = 16;

/**
 * A classic offset / hex / ASCII hex dump (16 bytes per row), e.g.:
 *
 * ```
 * 0000  FD 09 00 00 00 01 01 00  00 00 02 03 00 00 00 00  .........…
 * ```
 *
 * Returns an empty string for empty input. Used in a `<pre>` so the columns
 * align; the ASCII column gives screen-reader/visual context for the frame.
 */
export function formatHexDump(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += BYTES_PER_ROW) {
    const slice = bytes.subarray(off, off + BYTES_PER_ROW);
    const hexCols: string[] = [];
    let ascii = '';
    for (let i = 0; i < BYTES_PER_ROW; i++) {
      const b = slice[i];
      if (b === undefined) {
        hexCols.push('  ');
      } else {
        hexCols.push(hexByte(b));
        ascii += asciiByte(b);
      }
      if (i === 7) hexCols.push(''); // gutter between the two 8-byte halves
    }
    const offsetCol = off.toString(16).toUpperCase().padStart(4, '0');
    lines.push(`${offsetCol}  ${hexCols.join(' ')}  ${ascii}`);
  }
  return lines.join('\n');
}
