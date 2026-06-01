/** DataFlash log query engine (windowed, downsampled, derived expressions). */
export { buildLogQueryIndex, LogQueryIndex } from './engine';
export type { LogQueryIndexOptions } from './engine';
export type { LogQueryPoint, LogQueryRange, LogSeriesData, LogSeriesDescriptor } from './types';
