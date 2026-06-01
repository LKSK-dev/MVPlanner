/**
 * i18n registration for the parameter workbench (task T3.4; conventions
 * plan/implementation/00 §0.3, spec plan/05 §5.4 Config / §5.9).
 *
 * Contributes the workbench's `params.*` toolbar / diff strings to the English
 * catalog via the public {@link registerMessages} seam (never editing i18n
 * internals). The grid widget registers its own disjoint `params.*` keys, so
 * the merge never warns. Registration runs once at import and is idempotent.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `params.*` strings owned by the workbench panel. */
export const PARAM_WORKBENCH_MESSAGES: Readonly<Record<string, string>> = {
  'params.title': 'Parameters',
  'params.toolbar.label': 'Parameter actions',
  'params.fetch': 'Fetch',
  'params.refresh': 'Refresh',
  'params.writeChanged': 'Write changed',
  'params.writeAll': 'Write all',
  'params.save': 'Save to file',
  'params.compare': 'Compare / diff',
  'params.progress': 'Fetching parameters: {done} / {total}',
  'params.progressLabel': 'Fetch progress',
  'params.busy': 'Working…',
  'params.changedCount': '{n} changed',
  'params.status.fetched': 'Fetched {n} parameters.',
  'params.status.wrote': 'Wrote {n} parameters.',
  'params.status.saved': 'Saved {n} parameters.',
  'params.status.error': 'Operation failed: {message}',

  // Compare / diff drawer.
  'params.diff.title': 'Compare with loaded set',
  'params.diff.name': 'Name',
  'params.diff.current': 'Current',
  'params.diff.other': 'Other',
  'params.diff.delta': 'Δ',
  'params.diff.close': 'Close compare',
  'params.diff.empty': 'No differences.',
  'params.diff.summary': '{n} differences',
  'params.diff.missing': '—',
};

let registered = false;

/** Register the workbench's `params.*` English catalog once (idempotent). */
export function registerParamWorkbenchMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(PARAM_WORKBENCH_MESSAGES);
}

registerParamWorkbenchMessages();
