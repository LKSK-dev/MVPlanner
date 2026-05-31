/**
 * Disk open/save ({@link FileIo}) for logs, missions, params and extensions
 * (T0.9; spec plan/07 §7.2; contract `src/contracts/storage.ts`). Uses the File
 * System Access API (`showOpenFilePicker` / `showSaveFilePicker`) where the
 * browser provides it, and falls back to a hidden `<input type=file>` /
 * `<a download>` blob URL otherwise. Availability is detected at runtime so the
 * same build degrades gracefully across the supported-browser matrix.
 *
 * The File System Access types are not present in every TS DOM lib version, so
 * this module declares the minimal structural shapes it relies on.
 */
import type { FileIo } from '../../contracts';

/** A picker accept descriptor (`{ description?, accept: { mime: ext[] } }`). */
interface FilePickerAcceptType {
  readonly description?: string;
  readonly accept: Readonly<Record<string, readonly string[]>>;
}

/** Options accepted by `showOpenFilePicker`. */
interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: readonly FilePickerAcceptType[];
}

/** Options accepted by `showSaveFilePicker`. */
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: readonly FilePickerAcceptType[];
}

/** Minimal writable-stream view returned by `createWritable`. */
interface WritableFileStreamLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

/** Minimal file-handle view returned by the pickers. */
interface FileSystemFileHandleLike {
  getFile(): Promise<File>;
  createWritable(): Promise<WritableFileStreamLike>;
}

/** `window.showOpenFilePicker` signature. */
type ShowOpenFilePicker = (
  options?: OpenFilePickerOptions,
) => Promise<readonly FileSystemFileHandleLike[]>;

/** `window.showSaveFilePicker` signature. */
type ShowSaveFilePicker = (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;

/**
 * Injectable environment for {@link createFileIo}. Omit in production (the real
 * globals are probed); pass mocks in tests. Each field overrides the matching
 * ambient global when provided.
 */
export interface FileIoEnv {
  readonly showOpenFilePicker?: ShowOpenFilePicker;
  readonly showSaveFilePicker?: ShowSaveFilePicker;
  readonly document?: Document;
  readonly createObjectURL?: (obj: Blob) => string;
  readonly revokeObjectURL?: (url: string) => void;
}

/** Ambient globals consulted when an {@link FileIoEnv} field is absent. */
interface FileIoGlobals {
  showOpenFilePicker?: ShowOpenFilePicker;
  showSaveFilePicker?: ShowSaveFilePicker;
  document?: Document;
  URL?: {
    createObjectURL?: (obj: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  };
}

/** Fully-resolved environment (every field present-or-undefined). */
interface ResolvedFileIoEnv {
  readonly showOpenFilePicker: ShowOpenFilePicker | undefined;
  readonly showSaveFilePicker: ShowSaveFilePicker | undefined;
  readonly document: Document | undefined;
  readonly createObjectURL: ((obj: Blob) => string) | undefined;
  readonly revokeObjectURL: ((url: string) => void) | undefined;
}

/** Merge an injected env over the ambient globals. */
function resolveEnv(env: FileIoEnv | undefined): ResolvedFileIoEnv {
  const g = globalThis as unknown as FileIoGlobals;
  const url = g.URL;
  return {
    showOpenFilePicker: env?.showOpenFilePicker ?? g.showOpenFilePicker,
    showSaveFilePicker: env?.showSaveFilePicker ?? g.showSaveFilePicker,
    document: env?.document ?? g.document,
    createObjectURL:
      env?.createObjectURL ??
      (typeof url?.createObjectURL === 'function' ? url.createObjectURL.bind(url) : undefined),
    revokeObjectURL:
      env?.revokeObjectURL ??
      (typeof url?.revokeObjectURL === 'function' ? url.revokeObjectURL.bind(url) : undefined),
  };
}

/** True for a user-cancelled picker (`AbortError`), which is not a failure. */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

/** Build File System Access `types` from the accept hints, or `undefined`. */
function toPickerTypes(accept: readonly string[] | undefined): FilePickerAcceptType[] | undefined {
  if (!accept || accept.length === 0) {
    return undefined;
  }
  const extensions = accept.filter((a) => a.startsWith('.'));
  if (extensions.length === 0) {
    return undefined;
  }
  return [{ description: 'Supported files', accept: { 'application/octet-stream': extensions } }];
}

/** Fallback open via a hidden `<input type=file>` (no File System Access API). */
function openViaInput(
  doc: Document,
  accept: string[] | undefined,
): Promise<{ name: string; blob: Blob } | undefined> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.multiple = false;
    if (accept && accept.length > 0) {
      input.accept = accept.join(',');
    }
    input.addEventListener(
      'change',
      () => {
        const file = input.files && input.files.length > 0 ? input.files[0] : undefined;
        resolve(file ? { name: file.name, blob: file } : undefined);
      },
      { once: true },
    );
    // Newer browsers fire 'cancel' when the dialog is dismissed.
    input.addEventListener('cancel', () => resolve(undefined), { once: true });
    input.click();
  });
}

/** Fallback save via an `<a download>` blob URL (no File System Access API). */
function saveViaAnchor(env: ResolvedFileIoEnv, data: Blob, suggestedName: string): void {
  const doc = env.document;
  const createObjectURL = env.createObjectURL;
  const revokeObjectURL = env.revokeObjectURL;
  if (!doc || !createObjectURL) {
    throw new Error('FileIo.saveAs: no File System Access API and no DOM download fallback');
  }
  const url = createObjectURL(data);
  try {
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.rel = 'noopener';
    anchor.click();
  } finally {
    // The download fetch starts synchronously during click(), so the URL can be
    // revoked immediately to avoid leaking it.
    revokeObjectURL?.(url);
  }
}

/**
 * Create a {@link FileIo} that prefers the File System Access API and falls back
 * to DOM input/anchor when unavailable.
 *
 * @param env - Optional injected environment (testing); defaults to the ambient
 *   globals.
 * @returns A {@link FileIo} with `openForRead` / `saveAs`.
 */
export function createFileIo(env?: FileIoEnv): FileIo {
  return {
    async openForRead(accept?: string[]): Promise<{ name: string; blob: Blob } | undefined> {
      const resolved = resolveEnv(env);
      const picker = resolved.showOpenFilePicker;
      if (typeof picker === 'function') {
        const options: OpenFilePickerOptions = { multiple: false };
        const types = toPickerTypes(accept);
        if (types) {
          options.types = types;
        }
        try {
          const handles = await picker(options);
          const handle = handles.length > 0 ? handles[0] : undefined;
          if (!handle) {
            return undefined;
          }
          const file = await handle.getFile();
          return { name: file.name, blob: file };
        } catch (err) {
          if (isAbortError(err)) {
            return undefined;
          }
          throw err;
        }
      }
      if (!resolved.document) {
        throw new Error('FileIo.openForRead: no File System Access API and no DOM available');
      }
      return openViaInput(resolved.document, accept);
    },

    async saveAs(data: Blob, suggestedName: string): Promise<void> {
      const resolved = resolveEnv(env);
      const picker = resolved.showSaveFilePicker;
      if (typeof picker === 'function') {
        try {
          const handle = await picker({ suggestedName });
          const writable = await handle.createWritable();
          try {
            await writable.write(data);
          } finally {
            await writable.close();
          }
          return;
        } catch (err) {
          if (isAbortError(err)) {
            return;
          }
          throw err;
        }
      }
      saveViaAnchor(resolved, data, suggestedName);
    },
  };
}
