/**
 * MAV_CMD command picker (task T4.2; spec plan/04 §4.3 "full MAV_CMD command
 * palette"). A controlled `<select>` grouped by command category (NAV / DO /
 * CONDITION / OTHER), rendered from the dialect-metadata catalog.
 *
 * Controlled: it reflects `props.value` and calls `props.onChange` with the
 * chosen `MAV_CMD` value; the parent owns the edited mission item.
 */
import { For, createMemo, type Component } from 'solid-js';
import { categoryKey, curatedCommandMetas, groupCommands } from './catalog';
import type { CmdPickerProps } from './types';

/** A grouped `MAV_CMD` `<select>`; emits the picked command value. */
export const CmdPicker: Component<CmdPickerProps> = (props) => {
  const commands = createMemo(() => props.commands ?? curatedCommandMetas());
  const groups = createMemo(() => groupCommands(commands()));

  const onSelect = (e: Event): void => {
    const target = e.currentTarget as HTMLSelectElement;
    const next = Number(target.value);
    if (Number.isFinite(next)) props.onChange(next);
  };

  return (
    <select
      class="mvp-cmd-editor__picker"
      aria-label={props.t('cmd.editor.picker')}
      value={String(props.value)}
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
    </select>
  );
};
