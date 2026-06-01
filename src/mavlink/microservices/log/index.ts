/**
 * `mavlink/microservices/log` public surface (task T6.1; spec plan/03 §3.4
 * Log download). The {@link LogClient} implements the frozen `LogClient`
 * contract over MAVLink `LOG_REQUEST_LIST` / `LOG_REQUEST_DATA` /
 * `LOG_REQUEST_END` / `LOG_ERASE`, with gap retries for listings and resumable
 * byte-range download assembly.
 *
 * @see ./README.md for the contract, owned files, and how to test it.
 */
export { LogClient, LogError, createLogClient } from './log-client';
export type {
  LogClientDeps,
  LogSendFn,
  LogMessageTap,
  LogTarget,
  LogTargetAccessor,
  LogClock,
  LogErrorReason,
} from './log-client';
export {
  LOG_REQUEST_LIST,
  LOG_ENTRY,
  LOG_REQUEST_DATA,
  LOG_DATA,
  LOG_ERASE,
  LOG_REQUEST_END,
  LOG_DATA_MAX_BYTES,
  LOG_LIST_END_ALL,
  LOG_DATA_COUNT_ALL,
} from './constants';
