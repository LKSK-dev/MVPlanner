/**
 * Replay transport public surface (T1.8).
 *
 * Feeds a recorded tlog back through the byte pipeline honoring inter-frame
 * timing. See `./README.md` for the contract and how to test it.
 */

export { ReplayTransport } from './replay-transport';
export type { ReplayConfig, ReplayTransportOptions } from './replay-transport';
export { replayTransportFactory } from './factory';
export { parseTlog, TlogParseError } from './tlog-parser';
export type { TlogFrame } from './tlog-parser';
export type { Scheduler, TimeoutHandle } from './scheduler';
export { defaultScheduler } from './scheduler';
