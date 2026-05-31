/**
 * STATUSTEXT messages console (task T2.8; spec plan/04 §4.2, plan/05 §5.4/§5.8).
 *
 * A scrollback of vehicle STATUSTEXT messages with MAV_SEVERITY coloring mapped
 * onto the shared error/warn/info tiers — each row also carries a non-color cue
 * (a glyph + the full level name) per §5.8. A severity filter and a clear action
 * sit in the toolbar; entries are shown newest-first so the latest are visible
 * without scrolling.
 *
 * Accessibility: the scrollback is an ARIA live region (`role="log"`,
 * `aria-live="polite"`) so screen readers announce new messages; a separate
 * visually-hidden `role="alert"` (`aria-live="assertive"`) region mirrors the
 * most recent EMERGENCY/ALERT/CRITICAL message so it interrupts (spec §5.8).
 *
 * The component is a pure read view over a REACTIVE buffer accessor
 * ({@link MessagesConsoleProps.messages}) supplied by the caller (T2.11) — it
 * never touches the host/store, so it is unit-testable with mock data.
 */
import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { formatTime } from '../../../core/i18n';
import {
  isAssertiveSeverity,
  severityNameKey,
  severityTier,
  tierGlyph,
  tierRank,
} from './severity';
import { DEFAULT_MAX_RENDER, type MessagesConsoleProps, type StatusMessage } from './types';

/** Filter selection: minimum tier to show. */
type TierFilter = 'all' | 'warn' | 'error';

/** Minimum tier rank implied by a {@link TierFilter}. */
function filterRank(filter: TierFilter): number {
  switch (filter) {
    case 'all':
      return tierRank('info');
    case 'warn':
      return tierRank('warn');
    case 'error':
      return tierRank('error');
  }
}

/** Newest-first ordering: by `tMs` desc, then `seq` desc as a stable tiebreaker. */
function byNewest(a: StatusMessage, b: StatusMessage): number {
  return b.tMs - a.tMs || (b.seq ?? 0) - (a.seq ?? 0);
}

/** The STATUSTEXT scrollback console. */
export const MessagesConsole: Component<MessagesConsoleProps> = (props) => {
  const nowFn = (): number => (props.now ?? Date.now)();
  const maxRender = (): number => props.maxRender ?? DEFAULT_MAX_RENDER;

  const [filter, setFilter] = createSignal<TierFilter>('all');
  // Hide everything received at/before the last clear instant, so clearing works
  // even when the caller's buffer is read-only; the caller may also empty it.
  const [clearedAt, setClearedAt] = createSignal<number | undefined>();

  /** Buffer minus entries hidden by the clear cutoff (filter-independent). */
  const afterClear = createMemo<StatusMessage[]>(() => {
    const cut = clearedAt();
    const all = props.messages();
    return cut === undefined ? [...all] : all.filter((m) => m.tMs > cut);
  });

  /** Visible rows: clear cutoff → severity filter → newest-first → capped. */
  const visible = createMemo<StatusMessage[]>(() => {
    const min = filterRank(filter());
    return afterClear()
      .filter((m) => tierRank(severityTier(m.severity)) >= min)
      .sort(byNewest)
      .slice(0, maxRender());
  });

  /** Most recent EMERGENCY/ALERT/CRITICAL message text (drives the alert region). */
  const latestAlert = createMemo<string>(() => {
    let best: StatusMessage | undefined;
    for (const m of afterClear()) {
      if (!isAssertiveSeverity(m.severity)) continue;
      if (best === undefined || byNewest(m, best) < 0) best = m;
    }
    return best?.text ?? '';
  });

  const emptyKey = createMemo<string>(() =>
    afterClear().length === 0 ? 'statustext.empty' : 'statustext.empty.filtered',
  );

  const clear = (): void => {
    setClearedAt(nowFn());
    props.onClear?.();
  };

  const t = props.t;

  const rowLabel = (m: StatusMessage): string =>
    t('statustext.row.label', {
      severity: t(severityNameKey(m.severity)),
      sysid: m.sysid,
      compid: m.compid,
      time: formatTime(m.tMs),
      text: m.text,
    });

  return (
    <section class="mvp-messages" role="region" aria-label={t('statustext.title')}>
      <div class="mvp-messages__toolbar">
        <label class="mvp-messages__filter">
          <span class="mvp-messages__filter-label">{t('statustext.filter.label')}</span>
          <select
            class="mvp-messages__filter-select"
            aria-label={t('statustext.filter.label')}
            value={filter()}
            onChange={(e) => setFilter(e.currentTarget.value as TierFilter)}
          >
            <option value="all">{t('statustext.filter.all')}</option>
            <option value="warn">{t('statustext.filter.warn')}</option>
            <option value="error">{t('statustext.filter.error')}</option>
          </select>
        </label>

        <button
          type="button"
          class="mvp-messages__clear"
          aria-label={t('statustext.clear')}
          onClick={clear}
        >
          {t('statustext.clear')}
        </button>
      </div>

      {/* Assertive region: announces only the latest critical-or-worse message. */}
      <div class="mvp-messages__sr-only" role="alert" aria-live="assertive">
        {latestAlert()}
      </div>

      <ul
        class="mvp-messages__log"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t('statustext.log.label')}
      >
        <Show
          when={visible().length > 0}
          fallback={
            <li class="mvp-messages__empty" role="presentation">
              {t(emptyKey())}
            </li>
          }
        >
          <For each={visible()}>
            {(m) => {
              const tier = severityTier(m.severity);
              return (
                <li
                  class="mvp-messages__row"
                  classList={{
                    'mvp-messages__row--error': tier === 'error',
                    'mvp-messages__row--warn': tier === 'warn',
                    'mvp-messages__row--info': tier === 'info',
                  }}
                  data-tier={tier}
                  data-severity={m.severity}
                  aria-label={rowLabel(m)}
                >
                  <span class="mvp-messages__time">{formatTime(m.tMs)}</span>
                  <span class="mvp-messages__badge">
                    <span class="mvp-messages__glyph" aria-hidden="true">
                      {tierGlyph(tier)}
                    </span>
                    <span class="mvp-messages__sev">{t(severityNameKey(m.severity))}</span>
                  </span>
                  <span class="mvp-messages__text">{m.text}</span>
                  <span class="mvp-messages__src">
                    {m.sysid}/{m.compid}
                  </span>
                </li>
              );
            }}
          </For>
        </Show>
      </ul>
    </section>
  );
};
