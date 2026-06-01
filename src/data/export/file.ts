/** File export helpers for CSV output (T6.7; spec plan/07 §7.4). */
import type { FileIo } from '../../contracts';

/** MIME type used for CSV downloads. */
const CSV_MIME = 'text/csv;charset=utf-8';

/**
 * Save CSV text through MVPlanner's {@link FileIo} abstraction.
 *
 * @param fileIo - Browser/File-System save abstraction.
 * @param name - Suggested file name shown to the user.
 * @param csv - CSV text to write.
 */
export async function saveCsv(fileIo: FileIo, name: string, csv: string): Promise<void> {
  await fileIo.saveAs(new Blob([csv], { type: CSV_MIME }), name);
}
