/**
 * App Settings → Recents section (spec docs/appsettings §5.1/§7.3). Lists the
 * recently opened/saved plans, logs, tlogs and param files newest-first, with a
 * relative timestamp + human size per row. Each row can be re-opened (when an
 * `openRecent` handler is wired and/or the content is cached) or removed, and
 * the whole list can be cleared.
 *
 * Pure UI over {@link RecentsStore}: the list is held in a signal seeded from
 * `recents.subscribe`, so it restyles/updates live as recents change.
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import type { AppSettingsSectionDeps } from '../context';
import type { RecentEntry } from '../../../../core/recents';

/** Size unit ladder (binary, 1024-step). */
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Format a byte count as a short human-readable string (binary units).
 * Pure: `formatBytes(1536) === '1.5 KB'`, `formatBytes(0) === '0 B'`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const unit = SIZE_UNITS[unitIndex] ?? 'B';
  const rounded = unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}

/**
 * Format the gap between `nowMs` and `thenMs` as a compact relative time.
 * Pure and clamped at zero (future timestamps read as `just now`).
 */
export function relativeTime(nowMs: number, thenMs: number): string {
  const deltaMs = Math.max(0, nowMs - thenMs);
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * The Recents section body. Renders the recents list with open/remove/clear
 * controls; degrades gracefully when no `openRecent` handler is wired.
 */
export const RecentsSection: Component<{ deps: AppSettingsSectionDeps }> = (props) => {
  const { deps } = props;
  const t = deps.t;
  const [entries, setEntries] = createSignal<readonly RecentEntry[]>([]);

  onMount(() => {
    const unsub = deps.recents.subscribe((next) => {
      setEntries(next);
    });
    onCleanup(unsub);
  });

  /** Newest-first view of the current entries. */
  const items = createMemo(() => [...entries()].sort((a, b) => b.openedAt - a.openedAt));

  /** Open is unavailable when the content is not cached and nothing can re-open it. */
  const openDisabled = (entry: RecentEntry): boolean =>
    !entry.cached && deps.openRecent === undefined;

  return (
    <div class="mvp-appsettings__field">
      <Show
        when={items().length > 0}
        fallback={<p class="mvp-appsettings__hint">{t('appsettings.recents.empty')}</p>}
      >
        <For each={items()}>
          {(entry) => {
            const disabled = openDisabled(entry);
            const meta = (): string =>
              `${t(`appsettings.recents.kind.${entry.kind}`)} · ${relativeTime(
                Date.now(),
                entry.openedAt,
              )} · ${formatBytes(entry.sizeBytes)}`;
            return (
              <div class="mvp-appsettings__recent">
                <div>
                  <div class="mvp-appsettings__recent-name">{entry.name}</div>
                  <div class="mvp-appsettings__recent-meta">{meta()}</div>
                  <Show when={disabled}>
                    <div class="mvp-appsettings__hint">{t('appsettings.recents.uncached')}</div>
                  </Show>
                </div>
                <div class="mvp-appsettings__actions">
                  <button
                    type="button"
                    class="mvp-appsettings__btn"
                    disabled={disabled}
                    aria-label={`${t('appsettings.recents.open')}: ${entry.name}`}
                    onClick={() => {
                      void deps.openRecent?.(entry);
                    }}
                  >
                    {t('appsettings.recents.open')}
                  </button>
                  <button
                    type="button"
                    class="mvp-appsettings__btn"
                    aria-label={`${t('appsettings.recents.remove')}: ${entry.name}`}
                    onClick={() => {
                      void deps.recents.remove(entry.id);
                    }}
                  >
                    {t('appsettings.recents.remove')}
                  </button>
                </div>
              </div>
            );
          }}
        </For>
        <div class="mvp-appsettings__actions">
          <button
            type="button"
            class="mvp-appsettings__btn mvp-appsettings__btn--danger"
            aria-label={t('appsettings.recents.clear')}
            onClick={() => {
              void deps.recents.clear();
            }}
          >
            {t('appsettings.recents.clear')}
          </button>
        </div>
      </Show>
    </div>
  );
};
