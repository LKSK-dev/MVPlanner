/** Plotter widget i18n strings registered through the public catalog seam. */
import { registerMessages } from '../../../core/i18n';

/** Shipped English `plotter.*` strings. */
export const PLOTTER_MESSAGES: Readonly<Record<string, string>> = {
  'plotter.title': 'Log plotter',
  'plotter.empty': 'No series selected',
  'plotter.summary.empty': 'Log plotter with no selected series.',
  'plotter.summary.series': 'Log plotter showing {count} series: {series}.',
  'plotter.canvasUnavailable': 'Plot canvas unavailable in this environment.',
};

registerMessages(PLOTTER_MESSAGES);
