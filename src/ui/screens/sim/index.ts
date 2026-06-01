/**
 * `ui/screens/sim` public surface (M7 assembly; spec plan/05 §5.4, plan/06).
 *
 * The Sim screen is the developer hub: SITL/Connect help + the Extensions
 * Manager, Scripting Console and API Reference. {@link createSimDevTools} is the
 * single entry App calls to instantiate the manager/console/api-ref over the
 * wired extension system and install the hub over the `sim` placeholder.
 * Importing this barrel registers the `sim.*` / `extmgr.*` / `extprompt.*` i18n
 * strings as a side effect.
 */
import './messages';

export { createSimDevTools, type SimDevTools, type SimDevToolsDeps } from './register';
export {
  createExtServices,
  type ExtServicesDeps,
  type ExtServicesHandle,
  type ExtHost,
} from './services';
export {
  createInstallPromptController,
  InstallPromptHost,
  type InstallPromptController,
  type InstallPromptHostProps,
} from './install-prompt';
export {
  createExtensionsController,
  type ExtensionsController,
  type ExtensionsControllerDeps,
} from './controller';
export {
  ExtensionsManager,
  createExtensionsManagerPanel,
  EXTENSIONS_MANAGER_PANEL_ID,
  EXTENSIONS_MANAGER_COMMAND_ID,
  type ExtensionsManagerProps,
} from './extensions-manager';
export { SimDevHub, type SimDevHubProps } from './dev-hub';
export { SIM_MESSAGES, registerSimMessages } from './messages';

// Re-export the API reference sub-surface for one import site.
export { ApiReference, registerApiReference, createApiReferencePanel } from './api-ref';
