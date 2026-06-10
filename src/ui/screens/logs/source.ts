/**
 * Log source loading for the Logs screen (task T6.8 assembly; spec plan/04 §4.8).
 *
 * Turns an opened DataFlash `.bin`/`.log` byte source into a queryable
 * {@link LogQueryIndex}. Two decode paths are provided:
 *
 *  - {@link decodeDataFlashInWorker} — the PREFERRED path: it lazily (dynamic
 *    `import`) spins the inlined `?worker&inline` log worker and streams decoded
 *    records over the existing worker RPC, so a large file decodes OFF the main
 *    thread. The dynamic import keeps the worker bundle out of the module graph
 *    until a `.bin` is actually opened (so screen unit tests never spawn a
 *    Worker).
 *  - {@link decodeDataFlashOnMainThread} — a synchronous-pipeline fallback over
 *    the pure decoder (used by tests and as a degrade path). It also captures
 *    UNIT/MULT metadata so series carry unit labels.
 *
 * Both build the index with {@link buildLogQueryIndex}. The screen injects one
 * of these as its `decodeBin` seam (default: the worker path).
 */
import { createRpc } from '../../../core/bus';
import {
  DataFlashDecoder,
  chunksFrom,
  type DataFlashByteSource,
  type DataFlashMetadata,
  type DataFlashRecord,
} from '../../../data/dataflash';
import { buildLogQueryIndex, type LogQueryIndex } from '../../../data/log-query';
import type { DataFlashWorkerEvent, DataFlashWorkerRequest } from '../../../workers/log.worker';

/**
 * RPC stream method exposed by `src/workers/log.worker.ts`. Re-declared locally
 * (as a literal, not a value import) so this main-thread module never imports
 * the worker entry — importing it would run the worker's `serveWorker(self)`
 * side effect on the main thread. The string MUST match `RPC_DATAFLASH_DECODE`.
 */
const RPC_DATAFLASH_DECODE = 'dataflash.decode';

/**
 * Build a query index by decoding a DataFlash source on the main thread. A bare
 * `Uint8Array` is wrapped as a single chunk (a `Uint8Array` is itself an iterable
 * of bytes, so it must not be passed straight to {@link chunksFrom}).
 */
export async function decodeDataFlashOnMainThread(
  source: Uint8Array | DataFlashByteSource,
): Promise<LogQueryIndex> {
  const normalized: DataFlashByteSource = source instanceof Uint8Array ? [source] : source;
  const records: DataFlashRecord[] = [];
  const decoder = new DataFlashDecoder({
    onRecord: (record): void => {
      records.push(record);
    },
  });
  for await (const chunk of chunksFrom(normalized)) decoder.feed(chunk);
  decoder.finish();
  return buildLogQueryIndex(records, { metadata: decoder.getMetadata() });
}

/** How many decoded records between two progress callbacks. */
const PROGRESS_EVERY_RECORDS = 5000;

/**
 * Build a query index by decoding a DataFlash source in the inlined log worker.
 * The worker bundle is loaded lazily so it stays out of the module graph until a
 * file is opened. Records are streamed back over RPC and collected; the worker
 * is terminated when the stream ends or errors. The worker's final `metadata`
 * event (UNIT/MULT) is threaded into the index (mirroring the main-thread
 * fallback) and `onProgress` is invoked every {@link PROGRESS_EVERY_RECORDS}
 * decoded records with the running record count.
 */
export async function decodeDataFlashInWorker(
  source: Blob | Uint8Array,
  onProgress?: (records: number) => void,
): Promise<LogQueryIndex> {
  const { default: LogWorker } = await import('../../../workers/log.worker.ts?worker&inline');
  const worker = new LogWorker();
  const rpc = createRpc(worker);
  const records: DataFlashRecord[] = [];
  let metadata: DataFlashMetadata | undefined;
  try {
    await rpc.stream<DataFlashWorkerRequest, DataFlashWorkerEvent>(
      RPC_DATAFLASH_DECODE,
      { source },
      (event): void => {
        if (event.kind === 'record') {
          records.push(event.record);
          if (records.length % PROGRESS_EVERY_RECORDS === 0) onProgress?.(records.length);
        } else if (event.kind === 'metadata') {
          metadata = event.metadata;
        }
      },
    );
  } finally {
    rpc.dispose();
    worker.terminate();
  }
  return buildLogQueryIndex(records, metadata === undefined ? {} : { metadata });
}

/** True when the file name looks like a DataFlash log (`.bin`/`.log`). */
export function isDataFlashName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.bin') || lower.endsWith('.log');
}

/** True when the file name looks like a MAVLink tlog (`.tlog`). */
export function isTlogName(name: string): boolean {
  return name.toLowerCase().endsWith('.tlog');
}
