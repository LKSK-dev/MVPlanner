/**
 * Public view types for the STATUSTEXT messages console (task T2.8; spec
 * plan/04 §4.2, plan/05 §5.4/§5.8).
 *
 * {@link StatusMessage} is a widget-LOCAL view model — it is NOT part of the
 * frozen MAVLink contracts (`src/contracts/mavlink.ts`). T2.11 accumulates a
 * bounded buffer of these (e.g. from `host.onMessage(['STATUSTEXT'])`, via the
 * {@link import('./parse').statusMessageFromDecoded} helper) and feeds it in
 * through the reactive {@link MessagesConsoleProps.messages} accessor, so the
 * console never reaches into the host/store directly and stays unit-testable
 * with mock data.
 */

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * One STATUSTEXT entry as the console renders it. `severity` is the raw
 * MAV_SEVERITY value (0 EMERGENCY .. 7 DEBUG); `tier`/glyph/label are derived by
 * {@link import('./severity')}. `text` is the NUL-trimmed message text.
 */
export interface StatusMessage {
  /** Raw MAV_SEVERITY value (0..7). */
  severity: number;
  /** NUL-trimmed STATUSTEXT text. */
  text: string;
  /** Originating system id. */
  sysid: number;
  /** Originating component id. */
  compid: number;
  /** Wall-clock receive time in milliseconds (used for ordering + timestamp). */
  tMs: number;
  /**
   * Stable per-entry sequence used as the render key and as a tiebreaker when
   * two entries share a `tMs`. T2.11 supplies a monotonically increasing value.
   */
  seq?: number;
}

/**
 * {@link import('./messages').MessagesConsole} props. The data input is a
 * REACTIVE accessor over a bounded buffer owned by the caller (T2.11), so the
 * console re-renders as entries are appended/evicted.
 */
export interface MessagesConsoleProps {
  /** Reactive accessor for the current bounded STATUSTEXT buffer. */
  messages: () => readonly StatusMessage[];
  /** i18n translate function. */
  t: TFn;
  /**
   * Optional callback invoked when the user clears the console. The caller may
   * empty its buffer; the console also hides everything received up to the
   * clear instant, so clearing works even when the buffer is read-only.
   */
  onClear?: () => void;
  /** Clock for the clear cutoff + relative timing (default `Date.now`). */
  now?: () => number;
  /** Cap on rendered rows (newest kept); defaults to {@link DEFAULT_MAX_RENDER}. */
  maxRender?: number;
}

/** Default cap on rendered scrollback rows. */
export const DEFAULT_MAX_RENDER = 500;
