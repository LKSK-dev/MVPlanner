/** Streaming helper APIs for DataFlash byte sources. */
import { DataFlashDecoder } from './decoder';
import type {
  DataFlashByteSource,
  DataFlashDecoderOptions,
  DataFlashRecord,
  DataFlashTypeInfo,
} from './types';

const DEFAULT_BLOB_CHUNK_BYTES = 64 * 1024;

/** Iterate decoded records from any iterable/async-iterable/Blob byte source. */
export async function* decodeDataFlash(
  source: DataFlashByteSource,
  options: DataFlashDecoderOptions = {},
): AsyncGenerator<DataFlashRecord, void, void> {
  const queue: DataFlashRecord[] = [];
  const decoder = new DataFlashDecoder({
    ...options,
    onRecord: (record): void => {
      options.onRecord?.(record);
      queue.push(record);
    },
  });

  for await (const chunk of chunksFrom(source)) {
    decoder.feed(chunk);
    while (queue.length > 0) {
      const record = queue.shift();
      if (record !== undefined) yield record;
    }
  }
  decoder.finish();
}

/** Scan a DataFlash source and return the discovered message type/field index. */
export async function enumerateDataFlashTypes(
  source: DataFlashByteSource,
  options: Omit<DataFlashDecoderOptions, 'onRecord'> = {},
): Promise<readonly DataFlashTypeInfo[]> {
  const decoder = new DataFlashDecoder(options);
  for await (const chunk of chunksFrom(source)) decoder.feed(chunk);
  decoder.finish();
  return decoder.getTypes();
}

/** Lazily iterate only records matching a numeric type or message name. */
export async function* iterateDataFlashRecords(
  source: DataFlashByteSource,
  typeOrName: number | string,
  options: DataFlashDecoderOptions = {},
): AsyncGenerator<DataFlashRecord, void, void> {
  for await (const record of decodeDataFlash(source, options)) {
    if (typeof typeOrName === 'number') {
      if (record.type === typeOrName) yield record;
    } else if (record.name === typeOrName) {
      yield record;
    }
  }
}

/** Convert supported byte sources to chunks without requiring full-file reads. */
export async function* chunksFrom(
  source: DataFlashByteSource,
  chunkBytes = DEFAULT_BLOB_CHUNK_BYTES,
): AsyncGenerator<Uint8Array, void, void> {
  if (isBlob(source)) {
    for (let offset = 0; offset < source.size; offset += chunkBytes) {
      const blob = source.slice(offset, Math.min(source.size, offset + chunkBytes));
      yield new Uint8Array(await blob.arrayBuffer());
    }
    return;
  }

  if (isAsyncIterable(source)) {
    for await (const chunk of source) yield chunk;
    return;
  }

  for (const chunk of source) yield chunk;
}

function isBlob(value: DataFlashByteSource): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function isAsyncIterable(value: DataFlashByteSource): value is AsyncIterable<Uint8Array> {
  const candidate = value as { [Symbol.asyncIterator]?: unknown };
  return typeof candidate[Symbol.asyncIterator] === 'function';
}
