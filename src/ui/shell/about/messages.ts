/** English i18n strings owned by the About panel (T9.2). */
import { registerMessages } from '../../../core/i18n';

/** About-panel English catalog entries. */
export const ABOUT_MESSAGES: Record<string, string> = {
  'about.title': 'About MVPlanner',
  'about.command.open': 'About MVPlanner',
  'about.close': 'Close About MVPlanner',
  'about.description': 'Version and bundled-license information for this offline ground station.',
  'about.appVersion': 'App version',
  'about.apiVersion': 'Extension API version',
  'about.buildHash': 'Build hash',
  'about.dialects': 'Bundled MAVLink dialects',
  'about.dialectVersion': 'Version',
  'about.localFirst':
    'Local-first: MVPlanner runs in your browser with no telemetry, analytics, or phone-home network calls.',
  'about.licenses': 'Third-party licenses',
  'about.licensesSummary': 'Runtime dependencies bundled into this single-file build.',
  'about.noticesEmpty': 'No bundled third-party notices were generated.',
  'about.versionUnavailable': 'bundled table',
};

registerMessages(ABOUT_MESSAGES);
