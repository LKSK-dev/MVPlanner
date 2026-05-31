/**
 * `core/audit` public surface (task T2.7; spec plan/08 §8.3 destructive-action
 * gating + audit, §8.8 exportable action audit log).
 *
 * A small, pure service that records every vehicle action (command / param-set /
 * mission-write) with its origin and async result, into a bounded ring with
 * subscribe + JSON/text export. The Flight actions bar (T2.7) writes to it; the
 * extension sandbox (T7.2) writes to it with the extension id as `origin`; a
 * viewer panel renders it. Cross-module consumers import from here, never deep
 * paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the API, the entry shape, and how to test it.
 */
export { RingAuditLog, createAuditLog, type AuditLog } from './audit-log';
export {
  DEFAULT_MAX_ENTRIES,
  type AuditEntry,
  type AuditEntryInput,
  type AuditPatch,
  type AuditKind,
  type AuditStatus,
  type AuditOrigin,
  type AuditValue,
  type AuditParams,
  type AuditListener,
  type AuditLogOptions,
} from './types';
