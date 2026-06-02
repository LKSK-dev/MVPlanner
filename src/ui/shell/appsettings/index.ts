/**
 * App Settings pane public surface (spec docs/appsettings). The shell mounts
 * {@link AppSettingsPane} inside an {@link AppSettingsContext} provider; the
 * brand trigger + global command toggle it. Sections are assembled in
 * `./sections`.
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
