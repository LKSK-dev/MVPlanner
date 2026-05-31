/**
 * Command palette (⌘/Ctrl-K): fuzzy search over registered commands +
 * navigation entries, fully keyboard-driven (T0.7; spec plan/05 §5.7).
 *
 * Arrow keys move the active option, Enter runs it, Escape (or a backdrop
 * click) closes. Commands come from the shell {@link ShellRegistry}; navigation
 * entries are registered as commands too, so a single fuzzy list covers both.
 *
 * Focus is captured when the overlay opens and restored when it closes
 * (Escape/run/backdrop alike), and the lone tabbable child (the input) traps
 * Tab/Shift+Tab so focus never escapes the modal.
 */
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import type { CommandDef } from '../../contracts';
import { t } from '../../core/i18n';
import { useShell } from './context';
import { fuzzyFilter } from './fuzzy';

/** Stable DOM id for a result option (used for `aria-activedescendant`). */
const optionId = (i: number): string => `mvp-pal-opt-${i}`;

/** The mounted palette overlay. Only rendered while open so its lifecycle
 * (focus capture/restore) maps cleanly onto open/close. */
const PaletteOverlay: Component<{ onClose: () => void }> = (props) => {
  const { registry } = useShell();
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);
  let inputEl: HTMLInputElement | undefined;

  const results = createMemo<readonly CommandDef[]>(() =>
    fuzzyFilter(registry.commands(), query(), (c) => c.title),
  );

  // Capture the previously-focused element before we steal focus, and restore
  // it on close — covers Escape, run and backdrop-click uniformly.
  const previouslyFocused = document.activeElement as HTMLElement | null;
  onMount(() => {
    queueMicrotask(() => inputEl?.focus());
  });
  onCleanup(() => previouslyFocused?.focus?.());

  // Keep the active index in range as the result list shrinks.
  createEffect(() => {
    const max = Math.max(0, results().length - 1);
    if (active() > max) setActive(max);
  });

  const activeId = createMemo<string | undefined>(() =>
    results().length > 0 ? optionId(active()) : undefined,
  );

  const runActive = (): void => {
    const cmd = results()[active()];
    if (!cmd) return;
    props.onClose();
    void cmd.run();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(results().length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    } else if (e.key === 'Tab') {
      // The input is the only tabbable child; keep focus inside the modal.
      e.preventDefault();
      inputEl?.focus();
    }
  };

  return (
    <div class="mvp-palette-backdrop" onClick={() => props.onClose()}>
      <div
        class="mvp-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputEl}
          class="mvp-palette__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="mvp-palette-list"
          aria-autocomplete="list"
          aria-activedescendant={activeId()}
          placeholder={t('palette.placeholder')}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <ul
          class="mvp-palette__list"
          id="mvp-palette-list"
          role="listbox"
          aria-label={t('palette.commands')}
        >
          <For each={results()}>
            {(cmd, i) => (
              <li
                id={optionId(i())}
                class="mvp-palette__item"
                role="option"
                aria-selected={i() === active()}
                classList={{ 'mvp-palette__item--active': i() === active() }}
                onMouseEnter={() => setActive(i())}
                onClick={() => {
                  props.onClose();
                  void cmd.run();
                }}
              >
                <span class="mvp-palette__title">{cmd.title}</span>
                <Show when={cmd.shortcut}>
                  <kbd class="mvp-palette__kbd">{cmd.shortcut}</kbd>
                </Show>
              </li>
            )}
          </For>
          <Show when={results().length === 0}>
            <li class="mvp-palette__empty" role="option" aria-selected="false" aria-disabled="true">
              {t('palette.noResults')}
            </li>
          </Show>
        </ul>
      </div>
    </div>
  );
};

/** Overlay command palette. Visibility is owned by the parent {@link Shell}. */
export const CommandPalette: Component<{ open: boolean; onClose: () => void }> = (props) => (
  <Show when={props.open}>
    <PaletteOverlay onClose={() => props.onClose()} />
  </Show>
);
