/**
 * CSV serialization helpers for selected time-series exports (T6.7; spec
 * plan/04 §4.8). The implementation is deliberately pure: callers provide rows
 * and receive RFC4180-ish CSV text with a header row, comma separators, and
 * double-quote escaping for fields that need it.
 */

/** A row object accepted by {@link seriesToCsv}. */
export type CsvRow = Readonly<Record<string, unknown>>;

/** A column in a selected-series CSV export. */
export interface CsvColumn<Row extends CsvRow = CsvRow> {
  /** Header text written in the first CSV row. */
  readonly header: string;
  /** Row key or projector used to obtain the cell value. */
  readonly value: keyof Row | ((row: Row) => unknown);
}

/** Options for {@link seriesToCsv}. */
export interface SeriesToCsvOptions<Row extends CsvRow = CsvRow> {
  /** Explicit column order. When omitted, keys are inferred from the first row. */
  readonly columns?: readonly CsvColumn<Row>[];
}

/** Convert a JS value to a plain, unescaped CSV cell string. */
function cellToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const json = JSON.stringify(value, (_key: string, nested: unknown): unknown =>
      typeof nested === 'bigint' ? nested.toString() : nested,
    );
    return json ?? String(value);
  }

  return String(value);
}

/** Quote/escape a CSV cell when it contains RFC4180 special characters. */
export function escapeCsvCell(value: unknown): string {
  const raw = cellToString(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function normalizeColumns<Row extends CsvRow>(
  firstRow: Row | undefined,
  options: SeriesToCsvOptions<Row> | readonly CsvColumn<Row>[] | undefined,
): readonly CsvColumn<Row>[] {
  const explicit =
    options === undefined
      ? undefined
      : Array.isArray(options)
        ? (options as readonly CsvColumn<Row>[])
        : (options as SeriesToCsvOptions<Row>).columns;
  if (explicit !== undefined) return explicit;
  if (firstRow === undefined) return [];
  return Object.keys(firstRow).map((key) => ({ header: key, value: key }));
}

function columnValue<Row extends CsvRow>(row: Row, column: CsvColumn<Row>): unknown {
  return typeof column.value === 'function' ? column.value(row) : row[column.value];
}

/**
 * Serialize selected time-series rows to CSV.
 *
 * @param rows - Iterable of objects such as `{ time, altitude, speed }`.
 * @param options - Optional explicit column order/projectors. Passing the column
 *   array directly is also supported for compact call sites.
 * @returns CSV text with a header row and a trailing newline when non-empty.
 */
export function seriesToCsv<Row extends CsvRow>(
  rows: Iterable<Row>,
  options?: SeriesToCsvOptions<Row> | readonly CsvColumn<Row>[],
): string {
  const iterator = rows[Symbol.iterator]();
  const first = iterator.next();
  const firstRow = first.done ? undefined : first.value;
  const columns = normalizeColumns(firstRow, options);
  if (columns.length === 0) return '';

  const lines: string[] = [columns.map((column) => escapeCsvCell(column.header)).join(',')];
  const appendRow = (row: Row): void => {
    lines.push(columns.map((column) => escapeCsvCell(columnValue(row, column))).join(','));
  };

  if (firstRow !== undefined) appendRow(firstRow);
  for (let next = iterator.next(); !next.done; next = iterator.next()) {
    appendRow(next.value);
  }

  return `${lines.join('\n')}\n`;
}
