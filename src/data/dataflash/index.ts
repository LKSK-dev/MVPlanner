/**
 * DataFlash (.bin/.log) streaming decoder (task T6.2).
 *
 * Import the pure decoder from here for worker, tests, and any main-thread
 * fallback. The decoder is FMT-driven, resynchronises on bad headers, and keeps
 * only bounded carry-over bytes between chunks.
 */
export { DataFlashDecoder } from './decoder';
export {
  chunksFrom,
  decodeDataFlash,
  enumerateDataFlashTypes,
  iterateDataFlashRecords,
} from './stream';
export type {
  DataFlashByteSource,
  DataFlashDecoderOptions,
  DataFlashFormatDefinition,
  DataFlashFormatUnits,
  DataFlashMetadata,
  DataFlashMultiplierDefinition,
  DataFlashRecord,
  DataFlashTypeInfo,
  DataFlashUnitDefinition,
  DataFlashValue,
} from './types';
