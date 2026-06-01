/**
 * `ui/screens/config/settings` public surface (task T3.7; spec plan/04 §4.5
 * planner/app settings, plan/05 §5.4 Settings, plan/07 §7.3 Storage Manager).
 * The App Settings screen (editing `store.settings`), its live unit/coordinate
 * preview model and the injectable Storage Manager. Cross-module consumers (the
 * Config screen assembly / app shell) import from here, never deep paths
 * (conventions plan/implementation/00 §0.3). Importing this module registers the
 * `settings.*` i18n strings as a side effect.
 *
 * @see ./README.md for the editor wiring, Storage Manager injection and tests.
 */
import './messages';

export {
  SettingsScreen,
  type SettingsScreenProps,
  type ConfirmFn,
  type TFn,
} from './settings-screen';
export { createSettingsPanel, SETTINGS_PANEL_ID, type SettingsPanelDeps } from './register';
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
