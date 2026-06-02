/**
 * MAV_CMD command picker (task T4.2; spec plan/04 §4.3 "full MAV_CMD command
 * palette"). A controlled `<select>` grouped by command category (NAV / DO /
 * CONDITION / OTHER), rendered from the dialect-metadata catalog, plus a
 * "Custom…" option that reveals a numeric input for an arbitrary `MAV_CMD` id.
 *
 * Controlled: it reflects `props.value` and calls `props.onChange` with the
 * chosen `MAV_CMD` value; the parent owns the edited mission item. A command
 * whose id is absent from the offered list is treated as custom: the picker
 * selects "Custom…" and shows the numeric id (the editor's generic slot
 * fallback still labels and edits its slots).
 */
import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { allCommandMetas, categoryKey, groupCommands } from './catalog';
import type { CmdPickerProps } from './types';

/**
 * Sentinel `<option>` value for the "Custom…" entry. A non-numeric string so it
 * never collides with a real `MAV_CMD` id.
 */
export const CUSTOM_OPTION_VALUE = '__custom__';

/** A grouped `MAV_CMD` `<select>`; emits the picked command value. */
export const CmdPicker: Component<CmdPickerProps> = (props) => {
  const commands = createMemo(() => props.commands ?? allCommandMetas());
  const groups = createMemo(() => groupCommands(commands()));

  /** True once the user explicitly chose "Custom…" from the dropdown. */
  const [customForced, setCustomForced] = createSignal(false);
  /** A command not present in the offered list is implicitly custom. */
  const inList = createMemo(() => commands().some((meta) => meta.value === props.value));
  const isCustom = createMemo(() => customForced() || !inList());
  const selectValue = createMemo(() => (isCustom() ? CUSTOM_OPTION_VALUE : String(props.value)));

  const onSelect = (e: Event): void => {
    const target = e.currentTarget as HTMLSelectElement;
    if (target.value === CUSTOM_OPTION_VALUE) {
      setCustomForced(true);
      return;
    }
    setCustomForced(false);
    const next = Number(target.value);
    if (Number.isFinite(next)) props.onChange(next);
  };

  const onCustomInput = (e: Event): void => {
    const target = e.currentTarget as HTMLInputElement;
    const next = Number(target.value);
    if (Number.isInteger(next) && next >= 0) props.onChange(next);
  };

  return (
    <>
      <select
        class="mvp-cmd-editor__picker"
        aria-label={props.t('cmd.editor.picker')}
        value={selectValue()}
        onChange={onSelect}
      >
        <For each={groups()}>
          {(group) => (
            <optgroup label={props.t(categoryKey(group.category))}>
              <For each={group.commands}>
                {(meta) => <option value={String(meta.value)}>{meta.shortName}</option>}
              </For>
            </optgroup>
          )}
        </For>
        <option value={CUSTOM_OPTION_VALUE}>{props.t('cmd.custom')}</option>
      </select>
      <Show when={isCustom()}>
        <input
          class="mvp-cmd-editor__custom-input"
          type="number"
          step="1"
          min="0"
          aria-label={props.t('cmd.custom')}
          placeholder={props.t('cmd.customPlaceholder')}
          value={String(props.value)}
          onInput={onCustomInput}
          onChange={onCustomInput}
        />
      </Show>
    </>
  );
};
