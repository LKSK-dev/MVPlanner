/** MAVLink LOG_* message names and protocol constants (common dialect ids 117–122). */

/** Request streamed log entries for an inclusive id range. */
export const LOG_REQUEST_LIST = 'LOG_REQUEST_LIST';
/** One log entry returned by {@link LOG_REQUEST_LIST}. */
export const LOG_ENTRY = 'LOG_ENTRY';
/** Request a byte range from one DataFlash log. */
export const LOG_REQUEST_DATA = 'LOG_REQUEST_DATA';
/** One data chunk returned by {@link LOG_REQUEST_DATA}. */
export const LOG_DATA = 'LOG_DATA';
/** Erase logs on the vehicle. */
export const LOG_ERASE = 'LOG_ERASE';
/** End a log-data stream/download. */
export const LOG_REQUEST_END = 'LOG_REQUEST_END';

/** Maximum bytes carried in one `LOG_DATA.data` payload. */
export const LOG_DATA_MAX_BYTES = 90;
/** MAVLink sentinel used by `LOG_REQUEST_LIST.end` to request all logs. */
export const LOG_LIST_END_ALL = 0xffff;
/** MAVLink sentinel used by `LOG_REQUEST_DATA.count` to stream all remaining bytes. */
export const LOG_DATA_COUNT_ALL = 0xffffffff;
