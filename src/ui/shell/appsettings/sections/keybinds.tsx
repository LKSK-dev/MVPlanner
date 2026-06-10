/**
 * App Settings → Keybinds section (spec docs/appsettings §5.4/§7.5). Lists every
 * registered command with its effective chord and lets the user rebind it by
 * clicking the chord and pressing a key combination. Conflicts are rejected and
 * announced via a live region; overrides can be reset per-row or all at once.
 *
 * Pure view over the live {@link KeybindRegistry}; persistence is delegated to
 * `deps.persistKeybinds`. The shell owns the global dispatcher — this section
 * only reads/writes the registry and re-renders from `list()` after each change.
 */
import { For, Show, createSignal, onCleanup, type Component } from 'solid-js';
import type { AppSettingsSectionDeps } from '../context';
import type { KeybindRow } from '../../../../core/keybinds';
import {
  chordFromEvent,
  formatChord,
  normalizeChord,
  type ChordKeyEvent,
} from '../../../../core/keybinds';

/**
 * The Keybinds section. Seeds its row list from `deps.keybinds.list()` and
 * re-reads it after every binding change so the UI stays in sync with the
 * registry.
 */
export const KeybindsSection: Component<{ deps: AppSettingsSectionDeps }> = (props) => {
  const deps = props.deps;
  const t = deps.t;

  const [rows, setRows] = createSignal<KeybindRow[]>(deps.keybinds.list());
  /** The command id currently capturing a key combination, if any. */
  const [capturing, setCapturing] = createSignal<string | undefined>(undefined);
  /** Conflict announcement for the live region (empty when none). */
  const [message, setMessage] = createSignal('');

  /** Re-read the registry after a change. */
  const refresh = (): void => {
    setRows(deps.keybinds.list());
  };

  /** Enter capture mode for `commandId`, clearing any prior conflict. Raises the
   * global capture lock so the shell dispatcher ignores the captured chord. */
  const startCapture = (commandId: string): void => {
    setMessage('');
    setCapturing(commandId);
    deps.setKeybindCapturing?.(true);
  };

  /** Leave capture mode, lower the lock, and clear any conflict message. */
  const cancelCapture = (): void => {
    setCapturing(undefined);
    setMessage('');
    deps.setKeybindCapturing?.(false);
  };

  // Safety: always lower the lock if the section unmounts mid-capture.
  onCleanup(() => deps.setKeybindCapturing?.(false));

  /** Try to bind `chord` to `commandId`; returns false (with a message) on
   * conflict. Shared by press-capture and manual text entry. */
  const tryBind = (commandId: string, chord: string): boolean => {
    const conflictId = deps.keybinds.conflict(chord, commandId);
    if (conflictId !== undefined) {
      const conflictTitle = rows().find((r) => r.commandId === conflictId)?.title ?? conflictId;
      setMessage(t('appsettings.keybinds.conflict', { command: conflictTitle }));
      return false;
    }
    deps.keybinds.setOverride(commandId, chord);
    deps.persistKeybinds();
    refresh();
    return true;
  };

  /** Commit a manually-typed shortcut (e.g. "Shift+1"). */
  const commitManual = (commandId: string, raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === '') return;
    const chord = normalizeChord(trimmed);
    if (chord === undefined) {
      setMessage(t('appsettings.keybinds.invalid'));
      return;
    }
    if (tryBind(commandId, chord)) setMessage('');
  };

  /**
   * Handle a keydown while capturing for `commandId`: cancel on Escape, reject
   * (and announce) conflicts, otherwise set the override and persist.
   */
  const onCaptureKeyDown = (event: KeyboardEvent, commandId: string): void => {
    event.preventDefault();
    if (event.key === 'Escape') {
      cancelCapture();
      return;
    }
    const keyEvent: ChordKeyEvent = {
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    };
    const chord = chordFromEvent(keyEvent);
    if (chord === undefined) return; // bare modifier — keep waiting
    if (tryBind(commandId, chord)) cancelCapture();
  };

  /** Reset a single command's override back to its default. */
  const resetRow = (commandId: string): void => {
    deps.keybinds.clearOverride(commandId);
    deps.persistKeybinds();
    refresh();
  };

  /** Reset every override at once. */
  const resetAll = (): void => {
    deps.keybinds.clearAll();
    deps.persistKeybinds();
    refresh();
  };

  /** Label for a row's chord button. */
  const chordLabel = (row: KeybindRow): string => {
    if (capturing() === row.commandId) return t('appsettings.keybinds.press');
    return row.chord !== undefined ? formatChord(row.chord) : t('appsettings.keybinds.unbound');
  };

  /** The live-region announcement: conflict first, else the capture prompt. */
  const status = (): string => {
    if (message() !== '') return message();
    return capturing() !== undefined ? t('appsettings.keybinds.press') : '';
  };

  return (
    <div data-section-body="keybinds">
      <p class="mvp-appsettings__hint">{t('appsettings.keybinds.intro')}</p>

      <For each={rows()}>
        {(row) => (
          <div class="mvp-appsettings__keyrow">
            <span>{row.title}</span>
            <div class="mvp-appsettings__actions">
              <input
                type="text"
                class="mvp-appsettings__input mvp-appsettings__kbd-input"
                aria-label={t('appsettings.keybinds.manual', { command: row.title })}
                placeholder={t('appsettings.keybinds.manualPlaceholder')}
                data-testid={`keybind-manual-${row.commandId}`}
                value={row.chord !== undefined ? formatChord(row.chord) : ''}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitManual(row.commandId, event.currentTarget.value);
                  }
                }}
                onChange={(event) => {
                  commitManual(row.commandId, event.currentTarget.value);
                }}
              />
              <button
                type="button"
                class="mvp-appsettings__kbd"
                aria-label={t('appsettings.keybinds.rebind', { command: row.title })}
                data-testid={`keybind-chord-${row.commandId}`}
                onClick={() => {
                  startCapture(row.commandId);
                }}
                onKeyDown={(event) => {
                  if (capturing() === row.commandId) onCaptureKeyDown(event, row.commandId);
                }}
                onBlur={() => {
                  // Focus left mid-capture: lower the lock so global shortcuts
                  // never stay disabled.
                  if (capturing() === row.commandId) cancelCapture();
                }}
              >
                {chordLabel(row)}
              </button>
              <Show when={row.isOverride}>
                <button
                  type="button"
                  class="mvp-appsettings__btn"
                  data-testid={`keybind-reset-${row.commandId}`}
                  onClick={() => {
                    resetRow(row.commandId);
                  }}
                >
                  {t('appsettings.keybinds.reset')}
                </button>
              </Show>
            </div>
          </div>
        )}
      </For>

      <div class="mvp-appsettings__actions">
        <button
          type="button"
          class="mvp-appsettings__btn"
          data-testid="keybind-reset-all"
          onClick={() => {
            resetAll();
          }}
        >
          {t('appsettings.keybinds.resetAll')}
        </button>
      </div>

      <div class="mvp-appsettings__hint" role="status" aria-live="polite">
        {status()}
      </div>
    </div>
  );
};
