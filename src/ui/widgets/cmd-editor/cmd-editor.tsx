/**
 * MAV_CMD parameter editor (task T4.2; spec plan/04 §4.3 "per-command parameter
 * editors driven by dialect metadata").
 *
 * A **controlled** editor over a `geo/mission` {@link MissionItemModel}: pick the
 * command (via {@link CmdPicker}), choose the altitude frame, and edit the seven
 * command slots (`param1..param4`, then `x`/`y`/`z`) each labelled from the
 * dialect metadata (with a generic fallback for slots the command does not use).
 * It reflects `props.value` and emits the next item through `props.onChange`; the
 * parent (waypoint table T4.3 / map editing T4.4) owns the mission model.
 */
import { For, Show, createMemo, type Component, type JSX } from 'solid-js';
import {
  ALT_FRAMES,
  altFrameToMavFrame,
  commandMeta,
  mavFrameToAltFrame,
  type AltFrame,
} from '../../../geo/mission';
import { applySlot, curatedCommandMetas, resolveSlots } from './catalog';
import { CmdPicker } from './cmd-picker';
import type { CmdEditorProps, EditorSlot } from './types';

/** i18n key for an {@link AltFrame} option label. */
function frameKey(frame: AltFrame): string {
  return `mission.frame.${frame}`;
}

/** The MAV_CMD parameter editor. */
export const CmdEditor: Component<CmdEditorProps> = (props) => {
  const meta = createMemo(() => commandMeta(props.value.command));
  const commands = createMemo(() => props.commands ?? curatedCommandMetas());
  const slots = createMemo(() => resolveSlots(props.value, meta(), props.t));
  const activeFrame = createMemo(() => mavFrameToAltFrame(props.value.frame));

  const paramSlots = createMemo(() => slots().filter((s) => s.kind === 'param'));
  const positionSlots = createMemo(() => slots().filter((s) => s.kind !== 'param'));

  const onCommand = (command: number): void => {
    props.onChange({ ...props.value, command });
  };

  const onFrame = (e: Event): void => {
    const target = e.currentTarget as HTMLSelectElement;
    props.onChange({ ...props.value, frame: altFrameToMavFrame(target.value as AltFrame) });
  };

  const onSlot = (slot: EditorSlot, raw: string): void => {
    const next = Number(raw);
    if (!Number.isFinite(next)) return;
    props.onChange(applySlot(props.value, slot, next));
  };

  const renderSlot = (slot: EditorSlot): JSX.Element => (
    <label
      class="mvp-cmd-editor__slot"
      classList={{ 'mvp-cmd-editor__slot--unused': slot.unused }}
      data-slot={slot.index}
      data-kind={slot.kind}
    >
      <span class="mvp-cmd-editor__slot-label">
        {slot.label}
        <Show when={slot.unused}>
          <span class="mvp-cmd-editor__slot-unused"> ({props.t('cmd.slot.unused')})</span>
        </Show>
      </span>
      <input
        class="mvp-cmd-editor__slot-input"
        type="number"
        value={String(slot.value)}
        onInput={(e) => onSlot(slot, e.currentTarget.value)}
        onChange={(e) => onSlot(slot, e.currentTarget.value)}
      />
    </label>
  );

  return (
    <div class="mvp-cmd-editor" role="group" aria-label={props.t('cmd.editor.label')}>
      <div class="mvp-cmd-editor__row">
        <label class="mvp-cmd-editor__field">
          <span class="mvp-cmd-editor__field-label">{props.t('cmd.editor.command')}</span>
          <CmdPicker
            value={props.value.command}
            onChange={onCommand}
            t={props.t}
            commands={commands()}
          />
        </label>
        <label class="mvp-cmd-editor__field">
          <span class="mvp-cmd-editor__field-label">{props.t('cmd.editor.frame')}</span>
          <select
            class="mvp-cmd-editor__frame"
            aria-label={props.t('cmd.editor.frame')}
            value={activeFrame()}
            onChange={onFrame}
          >
            <For each={ALT_FRAMES}>
              {(frame) => <option value={frame}>{props.t(frameKey(frame))}</option>}
            </For>
          </select>
        </label>
      </div>

      <Show when={meta()?.description}>
        {(desc) => <p class="mvp-cmd-editor__desc">{desc()}</p>}
      </Show>

      <fieldset class="mvp-cmd-editor__group">
        <legend class="mvp-cmd-editor__legend">{props.t('cmd.editor.params')}</legend>
        <div class="mvp-cmd-editor__slots">
          <For each={paramSlots()}>{(slot) => renderSlot(slot)}</For>
        </div>
      </fieldset>

      <fieldset class="mvp-cmd-editor__group">
        <legend class="mvp-cmd-editor__legend">{props.t('cmd.editor.position')}</legend>
        <div class="mvp-cmd-editor__slots">
          <For each={positionSlots()}>{(slot) => renderSlot(slot)}</For>
        </div>
      </fieldset>
    </div>
  );
};
