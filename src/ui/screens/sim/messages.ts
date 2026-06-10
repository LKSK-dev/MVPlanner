/**
 * Sim & Dev Tools i18n strings (M7 assembly; spec plan/05 §5.9, plan/06
 * §6.1/§6.5/§6.7).
 *
 * The Sim screen hub owns its `sim.*`, `extmgr.*` and `extprompt.*` keys and
 * contributes them at IMPORT TIME via the public {@link registerMessages} seam —
 * it never edits the central English catalog. Registration is guarded so the
 * barrel + the components can both import it without a double-register throw.
 */
import { registerMessages } from '../../../core/i18n';

/** The shipped English `sim.*` / `extmgr.*` / `extprompt.*` strings. */
export const SIM_MESSAGES: Readonly<Record<string, string>> = {
  // Hub.
  'sim.title': 'Sim & Dev Tools',
  'sim.tabs.label': 'Sim & Dev Tools sections',
  'sim.tab.help': 'SITL & Connect',
  'sim.tab.extensions': 'Extensions',
  'sim.tab.console': 'Scripting Console',
  'sim.tab.api': 'API Reference',
  'sim.help.title': 'Connect to a simulator (SITL)',
  'sim.help.intro':
    'MVPlanner has no built-in simulator. Run ArduPilot or PX4 SITL and bridge it to a WebSocket the app can connect to.',
  'sim.help.step.bridge':
    'Start the companion bridge (bridge/ in the repo) pointing at your SITL TCP/UDP endpoint.',
  'sim.help.step.connect':
    'Open the Connection drawer, pick the WebSocket transport and enter the bridge URL.',
  'sim.help.step.fly':
    'Use the Flight screen to arm, take off and fly; telemetry drives every screen + extension.',

  // Extensions manager.
  'extmgr.title': 'Extensions',
  'extmgr.panel.label': 'Extensions',
  'extmgr.command.open': 'Open extensions manager',
  'extmgr.install': 'Install from file…',
  'extmgr.empty': 'No extensions installed.',
  'extmgr.enable': 'Enable',
  'extmgr.disable': 'Disable',
  'extmgr.uninstall': 'Uninstall',
  'extmgr.reload': 'Reload',
  'extmgr.permissions': 'Permissions',
  'extmgr.noPermissions': 'No permissions requested.',
  'extmgr.revoke': 'Revoke {permission}',
  'extmgr.highRisk': 'high-risk',
  'extmgr.granted': 'granted',
  'extmgr.status.installed': 'Installed',
  'extmgr.status.active': 'Active',
  'extmgr.status.disabled': 'Disabled',
  'extmgr.status.error': 'Error (paused)',
  'extmgr.installError': 'Could not install extension: {message}',
  'extmgr.actionError': 'Extension action failed: {message}',
  'extmgr.importUnsupported':
    'Unsupported import. Provide a JSON bundle ({ "manifest": …, "code": … }); untrusted .js source import runs in the sandboxed browser build.',

  // Install permission prompt.
  'extprompt.title': 'Install “{name}”?',
  'extprompt.body': 'This extension requests the following permissions:',
  'extprompt.none': 'This extension requests no permissions.',
  'extprompt.approve': 'Approve selected',
  'extprompt.deny': 'Deny all',
  'extprompt.highRisk': 'high-risk — can affect the vehicle',
};

let registered = false;

/** Register the Sim & Dev Tools English catalog once (idempotent). */
export function registerSimMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(SIM_MESSAGES);
}

registerSimMessages();
