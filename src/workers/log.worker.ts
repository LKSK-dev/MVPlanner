/**
 * Log worker entry (task T6.2). Thin RPC shim around the pure DataFlash decoder.
 *
 * The worker accepts a Blob/File or chunk array at the RPC boundary, reads it in
 * bounded chunks, and streams decoded records plus format/index events. UI/query
 * clients are added in T6.3/T6.8; this file deliberately contains no log UI or
 * export logic.
 */
import type { MessageEndpoint } from '../core/bus';
import {
  chunksFrom,
  DataFlashDecoder,
  type DataFlashByteSource,
  type DataFlashFormatDefinition,
  type DataFlashRecord,
  type DataFlashTypeInfo,
} from '../data/dataflash';
import { serveWorker } from './rpc';

/** RPC stream method: decode a DataFlash source and emit records/events. */
export const RPC_DATAFLASH_DECODE = 'dataflash.decode';
/** RPC call method: scan a DataFlash source and return the type/field index. */
export const RPC_DATAFLASH_TYPES = 'dataflash.types';

/** Request accepted by the log worker DataFlash methods. */
export interface DataFlashWorkerRequest {
  readonly source: Uint8Array | Blob | readonly Uint8Array[];
  readonly chunkBytes?: number;
  readonly filterType?: number;
  readonly filterName?: string;
}

/** Stream event emitted by {@link RPC_DATAFLASH_DECODE}. */
export type DataFlashWorkerEvent =
  | { readonly kind: 'format'; readonly format: DataFlashFormatDefinition }
  | { readonly kind: 'record'; readonly record: DataFlashRecord }
  | { readonly kind: 'index'; readonly types: readonly DataFlashTypeInfo[] };

const DEFAULT_CHUNK_BYTES = 64 * 1024;

const scope = self as unknown as MessageEndpoint;
const rpc = serveWorker(scope);

rpc.handleStream<DataFlashWorkerRequest, DataFlashWorkerEvent>(
  RPC_DATAFLASH_DECODE,
  async (req, send, signal) => {
    const source = requestSource(req);
    const decoder = new DataFlashDecoder({
      onFormat: (format): void => send({ kind: 'format', format }),
    });
    const chunkBytes = validChunkBytes(req.chunkBytes);

    for await (const chunk of chunksFrom(source, chunkBytes)) {
      if (signal.aborted) break;
      const records = decoder.feed(chunk);
      for (const record of records) {
        if (signal.aborted) break;
        if (matchesFilter(record, req)) send({ kind: 'record', record });
      }
    }
    decoder.finish();
    if (!signal.aborted) send({ kind: 'index', types: decoder.getTypes() });
  },
);

rpc.handle<DataFlashWorkerRequest, readonly DataFlashTypeInfo[]>(
  RPC_DATAFLASH_TYPES,
  async (req) => {
    const source = requestSource(req);
    const decoder = new DataFlashDecoder();
    const chunkBytes = validChunkBytes(req.chunkBytes);
    for await (const chunk of chunksFrom(source, chunkBytes)) decoder.feed(chunk);
    decoder.finish();
    return decoder.getTypes();
  },
);

function requestSource(req: DataFlashWorkerRequest): DataFlashByteSource {
  if (req.source instanceof Uint8Array) return [req.source];
  if (typeof Blob !== 'undefined' && req.source instanceof Blob) return req.source;
  return req.source;
}

function validChunkBytes(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_CHUNK_BYTES;
}

function matchesFilter(record: DataFlashRecord, req: DataFlashWorkerRequest): boolean {
  if (req.filterType !== undefined && record.type !== req.filterType) return false;
  if (req.filterName !== undefined && record.name !== req.filterName) return false;
  return true;
}
