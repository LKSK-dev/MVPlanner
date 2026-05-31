/**
 * Quick-watch widget (task T2.9; spec plan/04 §4.2 "Quick" tab + mini-plot,
 * plan/05 §5.4/§5.5).
 *
 * The operator browses the live NUMERIC `message.field` paths (the picker) and
 * adds any of them to a watch list. Each watched field renders as a chip showing
 * the field path, its live value (also exposed as text for screen readers), and
 * a tiny SVG sparkline of recent samples. Adding/removing watches and value
 * updates all happen live.
 *
 * The widget is a pure view over the structural {@link QuickWatchSource} seam:
 * it subscribes on mount and unsubscribes on cleanup, re-reading samples on each
 * notification. It never reaches into the host/store directly — T2.11 supplies
 * the source and persists the watch list.
 */
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type Component,
} from 'solid-js';
import './messages';
import { formatWatchValue } from './format';
import { pathOf, samePath } from './path';
import { RingBuffer } from './ring';
import { sparklinePath } from './sparkline';
import type { QuickWatchField, QuickWatchProps } from './types';

/** Default recent-sample ring capacity per watch. */
const DEFAULT_CAPACITY = 60;
/** Default sparkline size in px. */
const DEFAULT_SPARK = { width: 64, height: 20 } as const;

/** The Quick-watch chips + picker + mini-plots. */
export const QuickWatch: Component<QuickWatchProps> = (props) => {
  const capacity = props.capacity ?? DEFAULT_CAPACITY;
  const spWidth = props.sparkline?.width ?? DEFAULT_SPARK.width;
  const spHeight = props.sparkline?.height ?? DEFAULT_SPARK.height;
  const t = props.t;

  // Watch list (uncontrolled: seeded from props, mutated locally, reported out).
  const [watches, setWatches] = createSignal<readonly QuickWatchField[]>(
    props.watches ? props.watches.map((w) => ({ msg: w.msg, field: w.field })) : [],
  );
  // Bumped on every source notification; tracked memos re-read live data.
  const [rev, setRev] = createSignal(0);
  // Bumped whenever a ring changes; chip memos read it to recompute sparklines.
  const [sampleVer, setSampleVer] = createSignal(0);
  const [search, setSearch] = createSignal('');

  // Non-reactive store of per-watch sample rings, keyed by `message.field`.
  const rings = new Map<string, RingBuffer>();

  /** Take one current sample for `w` into its ring (creating it on demand). */
  const sampleInto = (w: QuickWatchField): void => {
    const key = pathOf(w);
    let ring = rings.get(key);
    if (ring === undefined) {
      ring = new RingBuffer(capacity);
      rings.set(key, ring);
    }
    const v = props.source.sample(w.msg, w.field);
    if (v !== undefined && Number.isFinite(v)) ring.push(v);
  };

  onMount(() => {
    const off = props.source.subscribe(() => setRev((r) => r + 1));
    onCleanup(off);
  });

  // Sample every watched field once per source notification. `watches` is read
  // untracked so this fires only on new data, not when the list changes (adds
  // sample themselves), avoiding duplicate points on existing watches.
  createEffect(() => {
    rev();
    untrack(() => {
      for (const w of watches()) sampleInto(w);
    });
    setSampleVer((v) => v + 1);
  });

  const addWatch = (f: QuickWatchField): void => {
    const prev = watches();
    if (prev.some((w) => samePath(w, f))) return;
    const next = [...prev, { msg: f.msg, field: f.field }];
    setWatches(next);
    sampleInto(f);
    setSampleVer((v) => v + 1);
    props.onChange?.(next);
  };

  const removeWatch = (f: QuickWatchField): void => {
    const prev = watches();
    const next = prev.filter((w) => !samePath(w, f));
    if (next.length === prev.length) return;
    rings.delete(pathOf(f));
    setWatches(next);
    props.onChange?.(next);
  };

  // Available (not-yet-watched) fields for the picker, filtered by the search.
  const available = createMemo<QuickWatchField[]>(() => {
    rev();
    const watched = new Set(watches().map(pathOf));
    const q = search().trim().toLowerCase();
    return props.source
      .listFields()
      .filter((f) => !watched.has(pathOf(f)))
      .filter((f) => q === '' || pathOf(f).toLowerCase().includes(q));
  });

  const hasAnyFields = createMemo<boolean>(() => {
    rev();
    return props.source.listFields().length > 0;
  });

  return (
    <section class="mvp-quickwatch" role="region" aria-label={t('quickwatch.title')}>
      <div class="mvp-quickwatch__picker">
        <label class="mvp-quickwatch__searchbox">
          <span class="mvp-quickwatch__label">{t('quickwatch.search')}</span>
          <input
            class="mvp-quickwatch__search"
            type="search"
            aria-label={t('quickwatch.search')}
            placeholder={t('quickwatch.searchPlaceholder')}
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </label>

        <Show
          when={available().length > 0}
          fallback={
            <p class="mvp-quickwatch__picker-empty" role="status">
              {hasAnyFields() ? t('quickwatch.noMatches') : t('quickwatch.noFields')}
            </p>
          }
        >
          <ul class="mvp-quickwatch__options" aria-label={t('quickwatch.title')}>
            <For each={available()}>
              {(f) => {
                const path = pathOf(f);
                return (
                  <li class="mvp-quickwatch__option">
                    <button
                      type="button"
                      class="mvp-quickwatch__add"
                      aria-label={t('quickwatch.add', { path })}
                      onClick={() => addWatch(f)}
                    >
                      {path}
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>

      <Show
        when={watches().length > 0}
        fallback={
          <p class="mvp-quickwatch__empty" role="status">
            {t('quickwatch.empty')}
          </p>
        }
      >
        <ul class="mvp-quickwatch__chips" aria-label={t('quickwatch.title')}>
          <For each={watches()}>
            {(w) => {
              const key = pathOf(w);
              const samples = createMemo<readonly number[]>(() => {
                sampleVer();
                return rings.get(key)?.toArray() ?? [];
              });
              const current = createMemo<number | undefined>(() => {
                const s = samples();
                return s.length > 0 ? s[s.length - 1] : undefined;
              });
              const valueText = (): string => {
                const v = current();
                return v === undefined ? t('quickwatch.value.none') : formatWatchValue(v);
              };
              const points = createMemo<string>(() =>
                sparklinePath(samples(), { width: spWidth, height: spHeight }),
              );
              return (
                <li
                  class="mvp-quickwatch__chip"
                  aria-label={t('quickwatch.chip', { path: key, value: valueText() })}
                >
                  <span class="mvp-quickwatch__path">{key}</span>
                  <svg
                    class="mvp-quickwatch__spark"
                    width={spWidth}
                    height={spHeight}
                    viewBox={`0 0 ${spWidth} ${spHeight}`}
                    aria-hidden="true"
                    role="presentation"
                  >
                    <Show when={points() !== ''}>
                      <polyline class="mvp-quickwatch__spark-line" points={points()} fill="none" />
                    </Show>
                  </svg>
                  <span class="mvp-quickwatch__value">{valueText()}</span>
                  <button
                    type="button"
                    class="mvp-quickwatch__remove"
                    aria-label={t('quickwatch.remove', { path: key })}
                    onClick={() => removeWatch(w)}
                  >
                    {'\u2715'}
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </section>
  );
};
