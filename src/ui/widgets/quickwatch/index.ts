/**
 * `ui/widgets/quickwatch` public surface (task T2.9; spec plan/04 §4.2 "Quick"
 * tab + mini-plot, plan/05 §5.4/§5.5).
 *
 * A small, themeable, accessible widget: the operator picks any live NUMERIC
 * `message.field` to watch and sees it as a chip with a live value + a tiny
 * sparkline. It takes a reactive {@link QuickWatchSource} prop (browse + sample)
 * plus an initial watch list and an `onChange`; it never reaches into the
 * host/store directly — T2.11 wires the source onto the host inspector data and
 * persists the watch list via the store.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Importing this module registers the
 * `quickwatch.*` i18n strings as a side effect; mounting the widget also
 * requires `import './quickwatch.css'` (integration step).
 *
 * @see ./README.md for the data-source contract, what is pure-tested, and how
 *   to test.
 */
import './messages';

export { QuickWatch } from './quickwatch';
export {
  createQuickWatchPanel,
  registerQuickWatch,
  QUICKWATCH_PANEL_ID,
  type QuickWatchPanelOptions,
} from './register';
export { QUICKWATCH_MESSAGES } from './messages';
export { RingBuffer } from './ring';
export {
  sparklinePath,
  sparklinePoints,
  type SparklineOptions,
  type SparklinePoint,
} from './sparkline';
export { formatWatchValue } from './format';
export { pathOf, parsePath, samePath } from './path';
export type { QuickWatchField, QuickWatchProps, QuickWatchSource, TFn } from './types';
