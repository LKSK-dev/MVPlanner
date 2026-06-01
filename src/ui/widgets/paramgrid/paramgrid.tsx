/**
 * Parameter grid widget (task T3.4; spec plan/04 §4.5, plan/05 §5.4 Config /
 * §5.5 ParamGrid).
 *
 * A flagship, reusable parameter table: flat list or grouped tree, fast
 * name/description search, sortable columns, and a per-row **type-aware editor**
 * driven by {@link import('../../../contracts').ParamMeta} — float (with
 * increment step), int (spinner), enum (dropdown) and bitmask (checkboxes). It
 * highlights **modified** rows (staged, differ from the vehicle) and
 * **out-of-range** rows (vs `meta.min`/`max`), and surfaces units, range,
 * reboot-required and the description.
 *
 * The grid is fully **controlled**: it owns no client and no values. Base params
 * + the staged-edit map come in via props; edits are reported through `onEdit`.
 * A large set still renders — the visible window is capped (see
 * {@link MAX_VISIBLE_ROWS}); narrow it with the search box.
 */
import { For, Show, createMemo, createSignal, type Component, type JSX } from 'solid-js';
import {
  bitmaskEntries,
  buildRows,
  enumEntries,
  filterRows,
  groupRows,
  hasBit,
  parseEditorValue,
  sortRows,
  toggleBit,
} from './model';
import './messages';
import type { GridView, Param, ParamMetaResolver, ParamRow, SortDir, SortKey, TFn } from './types';

/** {@link ParamGrid} props. */
export interface ParamGridProps {
  /** Accessor for the base (vehicle) parameter set. */
  rows: () => readonly Param[];
  /** Accessor for the staged-edit map (`name -> new value`). */
  pending: () => ReadonlyMap<string, number>;
  /** Metadata resolver (the `ParamMetaStore`, or a mock). */
  meta: ParamMetaResolver;
  /** Report a user edit of `name` to `value` (the workbench stages it). */
  onEdit: (name: string, value: number) => void;
  /** i18n translate function. */
  t: TFn;
  /** Initial view (default `'flat'`). */
  initialView?: GridView;
}

/** Hard cap on rendered rows so a multi-thousand set never janks the DOM. */
export const MAX_VISIBLE_ROWS = 800;

/** Compact display string for a numeric value (trims float noise). */
function displayValue(v: number, isFloat: boolean): string {
  if (!isFloat || Number.isInteger(v)) return String(v);
  return Number(v.toPrecision(8)).toString();
}

/** The parameter grid (see module doc). */
export const ParamGrid: Component<ParamGridProps> = (props) => {
  const [search, setSearch] = createSignal('');
  const [view, setView] = createSignal<GridView>(props.initialView ?? 'flat');
  const [sortKey, setSortKey] = createSignal<SortKey>('name');
  const [sortDir, setSortDir] = createSignal<SortDir>('asc');
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set<string>());
  const [openInfo, setOpenInfo] = createSignal<ReadonlySet<string>>(new Set<string>());

  const t = props.t;

  const allRows = createMemo<ParamRow[]>(() =>
    buildRows(props.rows(), props.pending(), props.meta),
  );
  const filtered = createMemo<ParamRow[]>(() => filterRows(allRows(), search()));
  const sorted = createMemo<ParamRow[]>(() => sortRows(filtered(), sortKey(), sortDir()));
  /** The capped window actually rendered. */
  const windowed = createMemo<ParamRow[]>(() => sorted().slice(0, MAX_VISIBLE_ROWS));
  const grouped = createMemo(() => groupRows(windowed()));

  const setSort = (key: SortKey): void => {
    if (sortKey() === key) setSortDir(sortDir() === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleGroup = (prefix: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  };

  const toggleInfo = (name: string): void => {
    setOpenInfo((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey() !== key ? 'none' : sortDir() === 'asc' ? 'ascending' : 'descending';

  /** Render the value editor cell for one row. */
  const valueEditor = (row: ParamRow): JSX.Element => {
    const name = row.param.name;
    const meta = row.meta;
    if (row.editor === 'enum' && meta) {
      return (
        <select
          class="mvp-paramgrid__enum"
          aria-label={t('params.valueFor', { name })}
          value={String(row.effective)}
          onChange={(e) => {
            const v = parseEditorValue('enum', e.currentTarget.value);
            if (v !== undefined) props.onEdit(name, v);
          }}
        >
          <For each={enumEntries(meta)}>
            {([value, label]) => <option value={String(value)}>{`${value} — ${label}`}</option>}
          </For>
          <Show when={enumEntries(meta).every(([v]) => v !== row.effective)}>
            <option value={String(row.effective)}>{String(row.effective)}</option>
          </Show>
        </select>
      );
    }
    if (row.editor === 'bitmask' && meta) {
      return (
        <fieldset class="mvp-paramgrid__bitmask" aria-label={t('params.valueFor', { name })}>
          <output class="mvp-paramgrid__bitval">{row.effective}</output>
          <For each={bitmaskEntries(meta)}>
            {([bit, label]) => (
              <label class="mvp-paramgrid__bit">
                <input
                  type="checkbox"
                  aria-label={t('params.bitFor', { name, bit, label })}
                  checked={hasBit(row.effective, bit)}
                  onChange={(e) =>
                    props.onEdit(name, toggleBit(row.effective, bit, e.currentTarget.checked))
                  }
                />
                <span>{label}</span>
              </label>
            )}
          </For>
        </fieldset>
      );
    }
    const isFloat = row.editor === 'float';
    const step = isFloat ? (meta?.increment ?? 'any') : 1;
    return (
      <input
        class="mvp-paramgrid__num"
        type="number"
        inputmode={isFloat ? 'decimal' : 'numeric'}
        step={String(step)}
        aria-label={t('params.valueFor', { name })}
        aria-invalid={row.outOfRange}
        value={displayValue(row.effective, isFloat)}
        onChange={(e) => {
          const v = parseEditorValue(row.editor, e.currentTarget.value);
          if (v !== undefined) props.onEdit(name, v);
        }}
      />
    );
  };

  /** Render a single data row (`<tr>`). */
  const dataRow = (row: ParamRow): JSX.Element => {
    const name = row.param.name;
    const meta = row.meta;
    const rangeLabel = (): string => {
      if (!meta) return '';
      if (meta.min !== undefined && meta.max !== undefined)
        return t('params.range', { min: meta.min, max: meta.max });
      if (meta.min !== undefined) return t('params.rangeMin', { min: meta.min });
      if (meta.max !== undefined) return t('params.rangeMax', { max: meta.max });
      return '';
    };
    const hasDesc = (): boolean => (meta?.description ?? '').length > 0;
    const infoShown = (): boolean => openInfo().has(name);
    return (
      <>
        <tr
          class="mvp-paramgrid__row"
          classList={{ 'is-modified': row.modified, 'is-oor': row.outOfRange }}
          data-name={name}
        >
          <th scope="row" class="mvp-paramgrid__cell mvp-paramgrid__name">
            <span class="mvp-paramgrid__pname">{name}</span>
            <Show when={row.modified}>
              <span
                class="mvp-paramgrid__flag mvp-paramgrid__flag--mod"
                title={t('params.modifiedTip')}
              >
                ●<span class="mvp-sr-only">{t('params.modified')}</span>
              </span>
            </Show>
            <Show when={row.outOfRange}>
              <span
                class="mvp-paramgrid__flag mvp-paramgrid__flag--oor"
                title={t('params.outOfRangeTip')}
              >
                ⚠<span class="mvp-sr-only">{t('params.outOfRange')}</span>
              </span>
            </Show>
            <Show when={meta?.rebootRequired}>
              <span
                class="mvp-paramgrid__flag mvp-paramgrid__flag--reboot"
                title={t('params.rebootTip')}
              >
                ⟳<span class="mvp-sr-only">{t('params.reboot')}</span>
              </span>
            </Show>
          </th>
          <td class="mvp-paramgrid__cell mvp-paramgrid__value">{valueEditor(row)}</td>
          <td class="mvp-paramgrid__cell mvp-paramgrid__units">{meta?.units ?? ''}</td>
          <td class="mvp-paramgrid__cell mvp-paramgrid__rangecell">{rangeLabel()}</td>
          <td class="mvp-paramgrid__cell mvp-paramgrid__infocell">
            <Show when={hasDesc()}>
              <button
                type="button"
                class="mvp-paramgrid__info-toggle"
                aria-expanded={infoShown()}
                aria-label={infoShown() ? t('params.collapseInfo') : t('params.expandInfo')}
                title={meta?.description}
                onClick={() => toggleInfo(name)}
              >
                ⓘ
              </button>
            </Show>
          </td>
        </tr>
        <Show when={infoShown() && hasDesc()}>
          <tr class="mvp-paramgrid__desc-row">
            <td class="mvp-paramgrid__desc" colSpan={5}>
              {meta?.description}
            </td>
          </tr>
        </Show>
      </>
    );
  };

  return (
    <section class="mvp-paramgrid" role="region" aria-label={t('params.grid.label')}>
      <div class="mvp-paramgrid__toolbar">
        <label class="mvp-paramgrid__searchbox">
          <span class="mvp-paramgrid__label">{t('params.search')}</span>
          <input
            class="mvp-paramgrid__search"
            type="search"
            aria-label={t('params.search')}
            placeholder={t('params.searchPlaceholder')}
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </label>
        <div class="mvp-paramgrid__viewtoggle" role="group" aria-label={t('params.view.label')}>
          <button
            type="button"
            class="mvp-paramgrid__viewbtn"
            classList={{ 'is-active': view() === 'flat' }}
            aria-pressed={view() === 'flat'}
            onClick={() => setView('flat')}
          >
            {t('params.view.flat')}
          </button>
          <button
            type="button"
            class="mvp-paramgrid__viewbtn"
            classList={{ 'is-active': view() === 'tree' }}
            aria-pressed={view() === 'tree'}
            onClick={() => setView('tree')}
          >
            {t('params.view.tree')}
          </button>
        </div>
        <span class="mvp-paramgrid__count" role="status">
          {t('params.showing', { shown: windowed().length, total: allRows().length })}
        </span>
      </div>

      <Show
        when={windowed().length > 0}
        fallback={
          <p class="mvp-paramgrid__empty" role="status">
            {allRows().length === 0 ? t('params.empty') : t('params.noMatches')}
          </p>
        }
      >
        <table class="mvp-paramgrid__table">
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort('name')}>
                <button
                  type="button"
                  class="mvp-paramgrid__sort"
                  aria-label={t('params.col.sortName')}
                  onClick={() => setSort('name')}
                >
                  {t('params.col.name')}
                </button>
              </th>
              <th scope="col" aria-sort={ariaSort('value')}>
                <button
                  type="button"
                  class="mvp-paramgrid__sort"
                  aria-label={t('params.col.sortValue')}
                  onClick={() => setSort('value')}
                >
                  {t('params.col.value')}
                </button>
              </th>
              <th scope="col">{t('params.col.units')}</th>
              <th scope="col">{t('params.col.range')}</th>
              <th scope="col">{t('params.col.info')}</th>
            </tr>
          </thead>
          <tbody>
            <Show
              when={view() === 'tree'}
              fallback={<For each={windowed()}>{(row) => dataRow(row)}</For>}
            >
              <For each={grouped()}>
                {(group) => {
                  const isCollapsed = (): boolean => collapsed().has(group.prefix);
                  return (
                    <>
                      <tr class="mvp-paramgrid__group">
                        <td class="mvp-paramgrid__group-cell" colSpan={5}>
                          <button
                            type="button"
                            class="mvp-paramgrid__group-toggle"
                            aria-expanded={!isCollapsed()}
                            aria-label={isCollapsed() ? t('params.expand') : t('params.collapse')}
                            onClick={() => toggleGroup(group.prefix)}
                          >
                            <span class="mvp-paramgrid__caret">{isCollapsed() ? '▸' : '▾'}</span>
                            {t('params.group', { prefix: group.prefix, count: group.rows.length })}
                            <Show when={group.modifiedCount > 0}>
                              <span class="mvp-paramgrid__group-badge" title={t('params.modified')}>
                                ●
                              </span>
                            </Show>
                            <Show when={group.outOfRangeCount > 0}>
                              <span
                                class="mvp-paramgrid__group-badge mvp-paramgrid__group-badge--oor"
                                title={t('params.outOfRange')}
                              >
                                ⚠
                              </span>
                            </Show>
                          </button>
                        </td>
                      </tr>
                      <Show when={!isCollapsed()}>
                        <For each={group.rows}>{(row) => dataRow(row)}</For>
                      </Show>
                    </>
                  );
                }}
              </For>
            </Show>
          </tbody>
        </table>
      </Show>
    </section>
  );
};
