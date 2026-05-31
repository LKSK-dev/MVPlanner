/**
 * Public types for the Quick-watch widget (task T2.9; spec plan/04 §4.2 "Quick"
 * tab + "live tuning/quick-graph of arbitrary numeric fields", plan/05
 * §5.4/§5.5).
 *
 * The widget lets the operator pick any live NUMERIC MAVLink field
 * (`message.field`, e.g. `VFR_HUD.airspeed`, `SYS_STATUS.voltage_battery`) and
 * watch it as a chip with a live value + a tiny sparkline. It is decoupled from
 * the worker-importing MAVLink host via the structural {@link QuickWatchSource}
 * seam: anything that can list watchable fields and sample their current numeric
 * value satisfies it (the real host adapter does, and tests inject a lightweight
 * mock — no Worker is spun). T2.11 wires `QuickWatchSource` onto the host's
 * inspector / `onMessage` data and persists the watch list via the store.
 */

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * One watchable / watched numeric field path, split into its MAVLink message
 * name and field name. The canonical string form is `\`${msg}.${field}\`` (see
 * {@link import('./path').pathOf}).
 */
export interface QuickWatchField {
  /** MAVLink message name, e.g. `'VFR_HUD'`. */
  msg: string;
  /** Numeric field name within the message, e.g. `'airspeed'`. */
  field: string;
}

/**
 * The minimal reactive surface the Quick-watch widget needs.
 *
 * - {@link listFields} hands out a snapshot of the NUMERIC `message.field` paths
 *   currently observed, so the picker can browse them.
 * - {@link sample} returns the current numeric value for a `(msg, field)`, or
 *   `undefined` when the field is absent or non-numeric.
 * - {@link subscribe} notifies the widget when the underlying data may have
 *   changed (a new frame arrived); the widget then re-reads {@link listFields}
 *   and {@link sample}. This is the seam that makes values + sparklines live.
 *
 * The real host adapter (T2.11) implements this over the inspector snapshot /
 * `onMessage` tap; tests implement it with plain in-memory maps.
 */
export interface QuickWatchSource {
  /** Snapshot of all currently-watchable NUMERIC `message.field` paths. */
  listFields(): readonly QuickWatchField[];
  /** Current numeric value for `(msg, field)`, or `undefined` if absent/non-numeric. */
  sample(msg: string, field: string): number | undefined;
  /**
   * Subscribe to data-change notifications. `cb` fires whenever values or the
   * set of available fields may have changed. Returns an unsubscribe function.
   */
  subscribe(cb: () => void): () => void;
}

/** {@link import('./quickwatch').QuickWatch} props. */
export interface QuickWatchProps {
  /** Live data source (a host adapter, or a mock in tests). */
  source: QuickWatchSource;
  /** i18n translate function. */
  t: TFn;
  /**
   * Initial watch list (uncontrolled). T2.11 seeds this from the persisted
   * store; subsequent changes are reported via {@link onChange}.
   */
  watches?: readonly QuickWatchField[];
  /** Called with the next watch list whenever a field is added/removed. */
  onChange?: (watches: readonly QuickWatchField[]) => void;
  /** Recent-sample ring capacity per watch (default 60). */
  capacity?: number;
  /** Sparkline pixel size (defaults: 64×20). */
  sparkline?: { width?: number; height?: number };
}
