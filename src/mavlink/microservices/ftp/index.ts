/**
 * `mavlink/microservices/ftp` public surface (tasks T3.1 + T5.11; spec plan/03
 * §3.4 FTP). The {@link FtpClient} implements the frozen `FtpClient` contract
 * for `list`, robust burst/sequential `read`, `write`, and `remove` over
 * `FILE_TRANSFER_PROTOCOL`. Cross-module consumers import from here, never deep
 * paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the contract, owned files, and how to test it.
 */
export { FtpClient, FtpError, createFtpClient } from './ftp-client';
export type {
  FtpClientDeps,
  FtpSendFn,
  FtpMessageTap,
  FtpTarget,
  FtpClock,
  FtpErrorReason,
} from './ftp-client';
export {
  FTP_MSG_NAME,
  FTP_MSG_ID,
  FTP_PAYLOAD_LEN,
  FTP_HEADER_LEN,
  FTP_MAX_DATA,
  FtpOpcode,
  FtpNak,
  nakName,
  encodePayload,
  decodePayload,
  readU32LE,
} from './ftp-protocol';
export type { FtpPayload, FtpRequest } from './ftp-protocol';
