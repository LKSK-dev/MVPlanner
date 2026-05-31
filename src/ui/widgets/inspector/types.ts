/**
 * Public types for the MAVLink inspector widget (task T1.12; spec plan/04 §4.9,
 * plan/05 §5.4/§5.5).
 *
 * The widget is decoupled from the worker-importing {@link
 * import('../../../mavlink/host').MavlinkHost} via the structural
 * {@link InspectorSource} seam: anything that can hand out on-demand
 * {@link InspectorSnapshot}s satisfies it (the real host does, and tests inject
 * a lightweight mock — no Worker is spun).
 */
import type { InspectorSnapshot } from '../../../mavlink/host';

export type { InspectorSnapshot, InspectorRow } from '../../../mavlink/host';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The minimal surface the inspector needs to receive live data: subscribe to
 * the ON-DEMAND inspector stream and get a disposer. The real
 * {@link import('../../../mavlink/host').MavlinkHost} satisfies this structurally
 * through its `subscribeInspector` method.
 */
export interface InspectorSource {
  /**
   * Subscribe to the full inspector table; `cb` fires per emitted snapshot.
   * Returns an unsubscribe function that tears the underlying stream down.
   */
  subscribeInspector(cb: (snapshot: InspectorSnapshot) => void, opts?: { hz?: number }): () => void;
}
