/**
 * {@link AuditPanel} — the action audit-log viewer (task T2.7; spec plan/08 §8.8
 * "action audit log exportable for incident review", plan/05 §5.8 a11y).
 *
 * A simple newest-first list over an {@link AuditLog}, with per-row time / kind /
 * status / origin / summary / result, plus JSON + text export and a clear
 * button. It subscribes to the log and re-renders on every append/update/clear.
 *
 * Host-free + testable: export is delegated to an injected {@link
 * AuditPanelProps.onExport} (the host/integration wires the actual download), so
 * the panel never touches the DOM download path itself.
 */
import { For, Show, createSignal, onCleanup, type Component } from 'solid-js';
import { formatTime } from '../../../../core/i18n';
import type { AuditEntry, AuditLog, AuditStatus } from '../../../../core/audit';
import type { TFn } from './types';

/** Export format requested from {@link AuditPanelProps.onExport}. */
export type AuditExportFormat = 'json' | 'text';

/** Props for {@link AuditPanel}. */
export interface AuditPanelProps {
  /** The audit log to view. */
  audit: AuditLog;
  /** i18n translate function. */
  t: TFn;
  /** Invoked when the user exports; receives the serialised content + format. */
  onExport?: (content: string, format: AuditExportFormat) => void;
}

/** i18n key for a status badge. */
function statusKey(status: AuditStatus): string {
  return `audit.status.${status}`;
}

/** The audit-log viewer panel. */
export const AuditPanel: Component<AuditPanelProps> = (props) => {
  const t = props.t;
  const [entries, setEntries] = createSignal<readonly AuditEntry[]>(props.audit.list());
  const off = props.audit.subscribe(setEntries);
  onCleanup(off);

  // Newest-first for display (the log stores oldest-first).
  const rows = (): AuditEntry[] => [...entries()].reverse();

  const exportAs = (format: AuditExportFormat): void => {
    const content = format === 'json' ? props.audit.exportJson() : props.audit.exportText();
    props.onExport?.(content, format);
  };

  return (
    <section class="mvp-audit" role="region" aria-label={t('audit.region.label')}>
      <div class="mvp-audit__toolbar">
        <h2 class="mvp-audit__title">{t('audit.title')}</h2>
        <div class="mvp-audit__actions">
          <button
            type="button"
            class="mvp-audit__btn"
            aria-label={t('audit.export.json')}
            onClick={() => exportAs('json')}
          >
            {t('audit.export.json')}
          </button>
          <button
            type="button"
            class="mvp-audit__btn"
            aria-label={t('audit.export.text')}
            onClick={() => exportAs('text')}
          >
            {t('audit.export.text')}
          </button>
          <button
            type="button"
            class="mvp-audit__btn"
            aria-label={t('audit.clear')}
            onClick={() => props.audit.clear()}
          >
            {t('audit.clear')}
          </button>
        </div>
      </div>

      <ul class="mvp-audit__log" role="log" aria-live="polite" aria-label={t('audit.region.label')}>
        <Show
          when={rows().length > 0}
          fallback={
            <li class="mvp-audit__empty" role="presentation">
              {t('audit.empty')}
            </li>
          }
        >
          <For each={rows()}>
            {(e) => (
              <li
                class="mvp-audit__row"
                classList={{
                  'mvp-audit__row--ok': e.status === 'ok',
                  'mvp-audit__row--error': e.status === 'error',
                  'mvp-audit__row--pending': e.status === 'pending',
                  'mvp-audit__row--cancelled': e.status === 'cancelled',
                }}
                data-status={e.status}
                data-kind={e.kind}
                aria-label={t('audit.row.label', {
                  summary: e.summary,
                  status: t(statusKey(e.status)),
                  origin: e.origin,
                })}
              >
                <span class="mvp-audit__time">{formatTime(e.tMs)}</span>
                <span class="mvp-audit__kind">{t(`audit.kind.${e.kind}`)}</span>
                <span class="mvp-audit__status">{t(statusKey(e.status))}</span>
                <span class="mvp-audit__origin">{e.origin}</span>
                <span class="mvp-audit__summary">{e.summary}</span>
                <span class="mvp-audit__result">{e.result ?? ''}</span>
              </li>
            )}
          </For>
        </Show>
      </ul>
    </section>
  );
};
