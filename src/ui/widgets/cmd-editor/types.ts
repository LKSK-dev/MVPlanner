/**
 * Public types for the MAV_CMD command editor widget (task T4.2; spec plan/04
 * §4.3 "full MAV_CMD command palette … with per-command parameter editors driven
 * by dialect metadata").
 *
 * The editor + picker are **controlled** components (`value` + `onChange`) over
 * the `geo/mission` {@link MissionItemModel}, so the waypoint table (T4.3) and
 * map editing (T4.4) can drive them from the same editing model.
 */
import type { MavCmdMeta, MissionItemModel } from '../../../geo/mission';
import type { TFn } from '../../../core/i18n';

export type { MavCmdMeta, MavCmdCategory, MissionItemModel } from '../../../geo/mission';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type { TFn };

/** A resolved editor field for one of the seven command slots. */
export interface EditorSlot {
  /** Slot index `0..6` (`param1..param4`, then `x`, `y`, `z`). */
  index: number;
  /** Display label (dialect metadata, or a generic fallback). */
  label: string;
  /** Current numeric value. */
  value: number;
  /** True when the dialect gives this slot no label (rendered muted). */
  unused: boolean;
  /** Which model field the slot maps to. */
  kind: 'param' | 'lat' | 'lon' | 'alt';
}

/** {@link CmdPicker} props. */
export interface CmdPickerProps {
  /** Currently-selected `MAV_CMD` value. */
  value: number;
  /** Fired with the newly-picked command value. */
  onChange: (command: number) => void;
  /** i18n translate function. */
  t: TFn;
  /**
   * Commands to offer, grouped by category in the dropdown. Defaults to the
   * full `MAV_CMD` catalog resolved against the bundled dialects (the picker
   * also offers a "Custom…" entry for an arbitrary id).
   */
  commands?: readonly MavCmdMeta[];
}

/** {@link CmdEditor} props. */
export interface CmdEditorProps {
  /** The edited mission item (controlled value). */
  value: MissionItemModel;
  /** Fired with the next item on any field change. */
  onChange: (next: MissionItemModel) => void;
  /** i18n translate function. */
  t: TFn;
  /**
   * Commands to offer in the picker. Defaults to the full `MAV_CMD` catalog
   * resolved against the bundled dialects (the picker also offers a "Custom…"
   * entry for an arbitrary id).
   */
  commands?: readonly MavCmdMeta[];
}
