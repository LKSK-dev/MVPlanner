/**
 * App Settings pane public surface (spec docs/appsettings). The shell mounts
 * {@link AppSettingsPane} inside an {@link AppSettingsContext} provider; the
 * brand trigger + global command toggle it. Sections are assembled in
 * `./sections`. Also hosts the pane's injectable models: the Storage Manager
 * (`./storage-manager`) and the Network egress-transparency section
 * (`./network`, whose import registers the `settings.network.*` i18n strings
 * as a side effect).
 */
export {
  AppSettingsContext,
  createAppSettingsControl,
  useAppSettings,
  type AppSettingsContextValue,
  type AppSettingsSection,
  type AppSettingsSectionDeps,
  type ConfirmFn,
  type TFn,
} from './context';
export { AppSettingsPane, type AppSettingsPaneProps } from './pane';
export { buildAppSettingsSections } from './sections';
export { createLiveKeybinds, type LiveKeybinds } from './live-keybinds';
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
