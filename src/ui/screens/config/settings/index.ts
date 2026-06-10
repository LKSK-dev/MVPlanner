/**
 * `ui/screens/config/settings` public surface (task T3.7; spec plan/04 §4.5
 * planner/app settings, plan/05 §5.4 Settings, plan/07 §7.3 Storage Manager).
 * The live unit/coordinate preview model, the injectable Storage Manager and
 * the Network egress-transparency section, all consumed by the App Settings
 * pane (`ui/shell/appsettings`). The legacy `SettingsScreen` was migrated into
 * that pane and removed. Cross-module consumers (the Config screen assembly /
 * app shell) import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Importing this module registers the
 * `settings.*` i18n strings as a side effect.
 *
 * @see ./README.md for the Storage Manager injection and tests.
 */
import './messages';

export { buildPreview, PREVIEW_SAMPLE, type SettingsPreview } from './preview';
export {
  browserStorageEstimate,
  exportSettings,
  loadStorageReport,
  serializeSettings,
  DEFAULT_BLOB_NAMESPACES,
  SETTINGS_EXPORT_FILENAME,
  type NamespaceUsage,
  type StorageEstimateLike,
  type StorageManagerDeps,
  type StorageReport,
} from './storage-manager';
export { SETTINGS_MESSAGES, registerSettingsMessages } from './messages';
export {
  NetworkSection,
  createEgressLog,
  DEFAULT_EGRESS_MAX,
  type NetworkSectionProps,
  type NetworkSectionDeps,
  type LinkDestination,
  type NetGrantRow,
  type EgressLog,
  type EgressEntry,
  type EgressLogOptions,
} from './network';
