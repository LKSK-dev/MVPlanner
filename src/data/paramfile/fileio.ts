/**
 * Disk load/save for parameter files over the storage {@link FileIo} seam (task
 * T3.5; spec plan/07 §7.2/§7.6). These are thin adapters the Config assembly can
 * wire straight to the parameter workbench's `onLoad` / `onSave` callbacks; all
 * format logic lives in `./parse`.
 */
import type { FileIo } from '../../contracts';
import { parseParamFile, serializeParamFile } from './parse';
import type { LoadedParamFile, ParamFileEntry } from './types';

/** File-picker accept hints for parameter files. */
export const PARAM_FILE_ACCEPT: readonly string[] = ['.param', '.parm'];

/** MIME type used when saving parameter files. */
export const PARAM_FILE_MIME = 'text/plain';

/** Default suggested file name for {@link saveParamFile}. */
export const DEFAULT_PARAM_FILE_NAME = 'params.param';

/**
 * Prompt the user for a `.param`/`.parm` file and parse it.
 *
 * @param fileIo - The storage {@link FileIo} (or a mock in tests).
 * @returns The file name + parsed entries, or `undefined` if the user cancelled.
 */
export async function loadParamFile(fileIo: FileIo): Promise<LoadedParamFile | undefined> {
  const picked = await fileIo.openForRead([...PARAM_FILE_ACCEPT]);
  if (!picked) {
    return undefined;
  }
  const text = await picked.blob.text();
  return { name: picked.name, params: parseParamFile(text) };
}

/**
 * Serialize entries and save them to disk via the picker.
 *
 * @param fileIo - The storage {@link FileIo} (or a mock in tests).
 * @param params - Entries to write (a live `Param[]` is also accepted).
 * @param suggestedName - Suggested file name (default {@link DEFAULT_PARAM_FILE_NAME}).
 */
export async function saveParamFile(
  fileIo: FileIo,
  params: readonly ParamFileEntry[],
  suggestedName: string = DEFAULT_PARAM_FILE_NAME,
): Promise<void> {
  const text = serializeParamFile(params);
  const blob = new Blob([text], { type: PARAM_FILE_MIME });
  await fileIo.saveAs(blob, suggestedName);
}
