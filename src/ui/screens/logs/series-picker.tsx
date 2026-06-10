/**
 * Series picker for the Logs screen (task T6.8; spec plan/04 §4.8 "message/field
 * tree … derived expressions").
 *
 * A searchable `message.field` tree over the {@link LogQueryIndex} descriptors:
 * the operator filters and adds numeric series to the plot, enters a derived
 * arithmetic expression (evaluated by the query engine), and removes plotted
 * series. The picker is presentational — it owns the search text + derived-input
 * draft only; the screen owns the selected-series state and the query wiring.
 */
import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import type { LogSeriesDescriptor } from '../../../data/log-query';
import type { TFn } from '../../../core/i18n';
import './messages';

export type { TFn };

/** A currently-plotted series shown in the "selected" list. */
export interface SelectedSeriesSummary {
  /** Stable series id (matches the plotter input id). */
  readonly id: string;
  /** Human-readable label, for example `ATT.Roll`. */
  readonly label: string;
}

/** A message group of fields after filtering. */
interface SeriesGroup {
  readonly message: string;
  readonly fields: readonly LogSeriesDescriptor[];
}

/** {@link SeriesPicker} props. */
export interface SeriesPickerProps {
  /** Reactive list of all selectable numeric series. */
  readonly descriptors: () => readonly LogSeriesDescriptor[];
  /** Reactive list of currently-plotted series. */
  readonly selected: () => readonly SelectedSeriesSummary[];
  /** Add `message.field` to the plot. */
  readonly onAdd: (message: string, field: string) => void;
  /** Remove a plotted series by id. */
  readonly onRemove: (id: string) => void;
  /** Add a derived expression series; returns `false` when the expression is invalid. */
  readonly onAddDerived: (expr: string) => boolean;
  /** i18n translate function. */
  readonly t: TFn;
}

/** Group + filter descriptors by message for the searchable tree. */
function groupDescriptors(
  descriptors: readonly LogSeriesDescriptor[],
  query: string,
): readonly SeriesGroup[] {
  const needle = query.trim().toLowerCase();
  const byMessage = new Map<string, LogSeriesDescriptor[]>();
  for (const descriptor of descriptors) {
    const key = `${descriptor.message}.${descriptor.field}`.toLowerCase();
    if (needle.length > 0 && !key.includes(needle)) continue;
    const bucket = byMessage.get(descriptor.message);
    if (bucket === undefined) byMessage.set(descriptor.message, [descriptor]);
    else bucket.push(descriptor);
  }
  return [...byMessage.entries()].map(([message, fields]) => ({ message, fields }));
}

/** The searchable series tree + derived-expression input. */
export const SeriesPicker: Component<SeriesPickerProps> = (props) => {
  const t = props.t;
  const [query, setQuery] = createSignal('');
  const [derived, setDerived] = createSignal('');
  const [derivedError, setDerivedError] = createSignal(false);

  const groups = createMemo<readonly SeriesGroup[]>(() =>
    groupDescriptors(props.descriptors(), query()),
  );

  const submitDerived = (): void => {
    const expr = derived().trim();
    if (expr.length === 0) return;
    const ok = props.onAddDerived(expr);
    setDerivedError(!ok);
    if (ok) setDerived('');
  };

  return (
    <section class="mvp-logs__series" aria-label={t('logs.series.label')}>
      <label class="mvp-logs__field">
        <span class="mvp-logs__field-label">{t('logs.series.search')}</span>
        <input
          class="mvp-logs__input"
          type="search"
          data-testid="logs-series-search"
          placeholder={t('logs.series.searchPlaceholder')}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </label>

      <div class="mvp-logs__series-tree" role="tree" aria-label={t('logs.series.label')}>
        <Show
          when={props.descriptors().length > 0}
          fallback={<p class="mvp-logs__hint">{t('logs.series.none')}</p>}
        >
          <Show
            when={groups().length > 0}
            fallback={<p class="mvp-logs__hint">{t('logs.series.noMatch')}</p>}
          >
            <For each={groups()}>
              {(group) => (
                <div class="mvp-logs__series-group" role="treeitem">
                  <h4 class="mvp-logs__series-message">{group.message}</h4>
                  <ul class="mvp-logs__series-fields">
                    <For each={group.fields}>
                      {(descriptor) => {
                        const label = `${descriptor.message}.${descriptor.field}`;
                        return (
                          <li class="mvp-logs__series-field">
                            <button
                              type="button"
                              class="mvp-logs__series-add"
                              data-testid="logs-series-add"
                              aria-label={t('logs.series.add', { series: label })}
                              onClick={() => props.onAdd(descriptor.message, descriptor.field)}
                            >
                              {descriptor.field}
                              <Show when={descriptor.unit !== undefined}>
                                <span class="mvp-logs__series-unit"> ({descriptor.unit})</span>
                              </Show>
                            </button>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>

      <div class="mvp-logs__derived">
        <label class="mvp-logs__field">
          <span class="mvp-logs__field-label">{t('logs.derived.label')}</span>
          <input
            class="mvp-logs__input"
            type="text"
            data-testid="logs-derived-input"
            placeholder={t('logs.derived.placeholder')}
            value={derived()}
            onInput={(e) => {
              setDerived(e.currentTarget.value);
              setDerivedError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitDerived();
              }
            }}
          />
        </label>
        <button
          type="button"
          class="mvp-logs__btn"
          data-testid="logs-derived-add"
          aria-label={t('logs.derived.add')}
          onClick={submitDerived}
        >
          {t('logs.derived.add')}
        </button>
        <Show when={derivedError()}>
          <p class="mvp-logs__error" role="alert">
            {t('logs.derived.error')}
          </p>
        </Show>
      </div>

      <div class="mvp-logs__selected" aria-label={t('logs.series.selected')}>
        <h4 class="mvp-logs__selected-title">{t('logs.series.selected')}</h4>
        <ul class="mvp-logs__selected-list">
          <For each={props.selected()}>
            {(series) => (
              <li class="mvp-logs__selected-item">
                <span class="mvp-logs__selected-label">{series.label}</span>
                <button
                  type="button"
                  class="mvp-logs__series-remove"
                  data-testid="logs-series-remove"
                  aria-label={t('logs.series.remove', { series: series.label })}
                  onClick={() => props.onRemove(series.id)}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </div>
    </section>
  );
};
