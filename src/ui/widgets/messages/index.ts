/**
 * `ui/widgets/messages` public surface (task T2.8; spec plan/04 §4.2 messages,
 * plan/05 §5.4/§5.8). A STATUSTEXT console: a severity-colored scrollback with a
 * filter + clear, rendered from a REACTIVE buffer accessor, with ARIA live
 * regions (polite log + assertive alert) so screen readers announce new
 * messages.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Importing this module registers the
 * `statustext.*` i18n strings as a side effect. T2.11 owns the wiring: it
 * accumulates a bounded buffer (e.g. from `host.onMessage(['STATUSTEXT'])` via
 * {@link statusMessageFromDecoded}) and feeds it through `messages`.
 *
 * @see ./README.md for the view type, prop API, severity mapping and testing.
 */
import './i18n';

export { MessagesConsole } from './messages';
export { statusMessageFromDecoded, parseStatusText } from './parse';
export {
  severityTier,
  severityNameKey,
  isAssertiveSeverity,
  clampSeverity,
  tierGlyph,
  tierRank,
  MIN_SEVERITY,
  MAX_SEVERITY,
  ASSERTIVE_MAX_SEVERITY,
  type SeverityTier,
} from './severity';
export { STATUSTEXT_MESSAGES, registerStatusTextMessages } from './i18n';
export {
  DEFAULT_MAX_RENDER,
  type StatusMessage,
  type MessagesConsoleProps,
  type TFn,
} from './types';
