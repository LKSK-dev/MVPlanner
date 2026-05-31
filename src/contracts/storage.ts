/**
 * Storage seams (impl 02 §2.8; spec plan/07). FROZEN.
 */

export interface KvStore {
  get<T>(ns: string, key: string): Promise<T | undefined>;
  set<T>(ns: string, key: string, v: T): Promise<void>;
  del(ns: string, key: string): Promise<void>;
}

export interface BlobMeta {
  key: string;
  bytes: number;
  meta?: unknown;
}

export interface BlobStore {
  put(ns: string, key: string, data: Blob, meta?: unknown): Promise<void>;
  getRange(ns: string, key: string, start: number, end: number): Promise<Uint8Array>;
  size(ns: string, key: string): Promise<number>;
  list(ns: string): Promise<BlobMeta[]>;
  del(ns: string, key: string): Promise<void>;
}

export interface FileIo {
  openForRead(accept?: string[]): Promise<{ name: string; blob: Blob } | undefined>;
  saveAs(data: Blob, suggestedName: string): Promise<void>;
}
