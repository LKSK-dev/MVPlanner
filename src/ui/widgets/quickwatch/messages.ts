/**
 * Quick-watch i18n strings (task T2.9; conventions plan/implementation/00 §0.3,
 * spec plan/05 §5.9).
 *
 * The widget owns its `quickwatch.*` keys and contributes them at IMPORT TIME
 * via the public {@link registerMessages} seam — it never edits the central
 * English catalog or the i18n internals. Importing this module (the component
 * and the barrel both do) is enough to make `t('quickwatch.*')` resolve.
 */
import { registerMessages } from '../../../core/i18n';

/** The shipped English `quickwatch.*` strings. */
export const QUICKWATCH_MESSAGES: Readonly<Record<string, string>> = {
  'quickwatch.title': 'Quick watch',
  'quickwatch.panel.label': 'Quick watch',
  'quickwatch.search': 'Search fields',
  'quickwatch.searchPlaceholder': 'Filter message.field\u2026',
  'quickwatch.add': 'Watch {path}',
  'quickwatch.remove': 'Stop watching {path}',
  'quickwatch.empty': 'No fields watched. Pick a numeric field to watch it live.',
  'quickwatch.noFields': 'No numeric fields available yet.',
  'quickwatch.noMatches': 'No fields match the filter.',
  'quickwatch.value.none': '\u2014',
  'quickwatch.chip': '{path}: {value}',
  'quickwatch.open': 'Open Quick Watch',
};

registerMessages(QUICKWATCH_MESSAGES);
