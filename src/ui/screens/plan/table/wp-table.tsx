/**
 * Editable waypoint table (task T4.3; spec plan/04 §4.3 table, plan/05 §5.4
 * Plan, §5.7 undo).
 *
 * A spreadsheet-like, keyboard-editable table over a `geo/mission`
 * {@link MissionModel}. **Controlled**: the parent owns the model via
 * `props.model()` and receives every edit through `props.onChange`. Per row the
 * user can pick the command ({@link CmdPicker}), altitude frame, lat/lon/alt and
 * the current flag, expand a full {@link CmdEditor} for the command parameters,
 * and insert / delete / reorder rows. A bounded **undo/redo** stack (pure, see
 * `./undo`) is driven by buttons and Ctrl/Cmd-Z / Shift+Ctrl/Cmd-Z. Totals
 * (distance/time/waypoints) come from `estimateMission`, units-formatted.
 */
import { For, Show, createMemo, createSignal, type Component, type JSX } from 'solid-js';
import { t as defaultT } from '../../../../core/i18n';
import {
  ALT_FRAMES,
  addWaypoint,
  altFrameToMavFrame,
  deleteItem,
  insertItem,
  makeWaypoint,
  reorder,
  setCurrent,
  setDefaultAlt,
  setItem,
  type AltFrame,
  type MissionItemModel,
  type MissionModel,
} from '../../../../geo/mission';
import { CmdEditor, CmdPicker } from '../../../widgets/cmd-editor';
import { missionTotals, toRows } from './rows';
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  emptyHistory,
  record,
  redo as historyRedo,
  undo as historyUndo,
  type History,
} from './undo';
import { DEFAULT_UNDO_LIMIT, type TFn, type WaypointTableProps } from './types';
import './messages';
import './wp-table.css';

/** i18n key for an {@link AltFrame} option label (shared with the command editor). */
function frameKey(frame: AltFrame): string {
  return `mission.frame.${frame}`;
}

/** Parse a numeric input, falling back to `prev` when the text is not finite. */
function num(raw: string, prev: number): number {
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) ? v : prev;
}

/** The editable waypoint table. */
export const WaypointTable: Component<WaypointTableProps> = (props) => {
  const t: TFn = props.t ?? defaultT;
  const limit = (): number => props.undoLimit ?? DEFAULT_UNDO_LIMIT;

  const [history, setHistory] = createSignal<History<MissionModel>>(emptyHistory<MissionModel>());
  const [expanded, setExpanded] = createSignal<number | null>(null);

  const rows = createMemo(() => toRows(props.model()));
  const totals = createMemo(() =>
    missionTotals(props.model(), {
      ...(props.units ? { units: props.units() } : {}),
      ...(props.cruiseSpeedMps !== undefined ? { cruiseSpeedMps: props.cruiseSpeedMps } : {}),
    }),
  );

  /** Record the current model into history and emit `next` (no-op when unchanged). */
  const commit = (next: MissionModel): void => {
    const current = props.model();
    if (next === current) return;
    setHistory(record(history(), current, limit()));
    props.onChange(next);
  };

  const onUndo = (): void => {
    const step = historyUndo(history(), props.model());
    if (!step) return;
    setHistory(step.history);
    props.onChange(step.value);
  };

  const onRedo = (): void => {
    const step = historyRedo(history(), props.model(), limit());
    if (!step) return;
    setHistory(step.history);
    props.onChange(step.value);
  };

  // --- edit operations ----------------------------------------------------
  const editItem = (index: number, patch: Partial<MissionItemModel>): void => {
    commit(setItem(props.model(), index, patch));
  };
  const replaceItem = (index: number, next: MissionItemModel): void => {
    commit(setItem(props.model(), index, next));
  };
  const onAdd = (): void => {
    commit(addWaypoint(props.model(), { lat: 0, lon: 0 }));
  };
  const onInsert = (index: number): void => {
    const model = props.model();
    const row = model.items[index];
    const point = row ? { lat: row.lat, lon: row.lon } : { lat: 0, lon: 0 };
    commit(insertItem(model, index + 1, makeWaypoint(model, point)));
  };
  const onDelete = (index: number): void => {
    if (expanded() === index) setExpanded(null);
    commit(deleteItem(props.model(), index));
  };
  const onMove = (from: number, to: number): void => {
    commit(reorder(props.model(), from, to));
  };
  const onSetCurrent = (index: number): void => {
    commit(setCurrent(props.model(), index));
  };
  const onDefaultAlt = (raw: string): void => {
    commit(setDefaultAlt(props.model(), num(raw, props.model().defaultAlt)));
  };
  const toggleExpand = (index: number): void => {
    setExpanded((prev) => (prev === index ? null : index));
  };

  const onFrame = (index: number, value: string): void => {
    editItem(index, { frame: altFrameToMavFrame(value as AltFrame) });
  };

  /** Ctrl/Cmd-Z = undo, Shift+Ctrl/Cmd-Z (or Ctrl/Cmd-Y) = redo. */
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) onRedo();
      else onUndo();
    } else if (key === 'y') {
      e.preventDefault();
      onRedo();
    }
  };

  const colCount = 8;

  const renderRow = (row: ReturnType<typeof rows>[number]): JSX.Element => (
    <>
      <tr
        class="mvp-wptable__row"
        classList={{ 'mvp-wptable__row--current': row.isCurrent }}
        data-seq={row.seq}
      >
        <th scope="row" class="mvp-wptable__seq">
          {row.seq + 1}
        </th>
        <td class="mvp-wptable__cell mvp-wptable__cell--command">
          <CmdPicker
            value={row.command}
            onChange={(command) => editItem(row.seq, { command })}
            t={t}
            {...(props.commands ? { commands: props.commands } : {})}
          />
        </td>
        <td class="mvp-wptable__cell mvp-wptable__cell--frame">
          <select
            class="mvp-wptable__select"
            aria-label={t('plan.table.cell.frame', { seq: row.seq + 1 })}
            value={row.altFrame}
            onChange={(e) => onFrame(row.seq, e.currentTarget.value)}
          >
            <For each={ALT_FRAMES}>
              {(frame) => <option value={frame}>{t(frameKey(frame))}</option>}
            </For>
          </select>
        </td>
        <td class="mvp-wptable__cell mvp-wptable__cell--num">
          <input
            class="mvp-wptable__input"
            type="number"
            step="any"
            aria-label={t('plan.table.cell.lat', { seq: row.seq + 1 })}
            disabled={!row.hasPosition}
            value={String(row.lat)}
            onChange={(e) => editItem(row.seq, { lat: num(e.currentTarget.value, row.lat) })}
          />
        </td>
        <td class="mvp-wptable__cell mvp-wptable__cell--num">
          <input
            class="mvp-wptable__input"
            type="number"
            step="any"
            aria-label={t('plan.table.cell.lon', { seq: row.seq + 1 })}
            disabled={!row.hasPosition}
            value={String(row.lon)}
            onChange={(e) => editItem(row.seq, { lon: num(e.currentTarget.value, row.lon) })}
          />
        </td>
        <td class="mvp-wptable__cell mvp-wptable__cell--num">
          <input
            class="mvp-wptable__input"
            type="number"
            step="any"
            aria-label={t('plan.table.cell.alt', { seq: row.seq + 1 })}
            value={String(row.alt)}
            onChange={(e) => editItem(row.seq, { alt: num(e.currentTarget.value, row.alt) })}
          />
        </td>
        <td class="mvp-wptable__cell mvp-wptable__cell--current">
          <input
            type="radio"
            name="mvp-wptable-current"
            aria-label={t('plan.table.cell.current', { seq: row.seq + 1 })}
            checked={row.isCurrent}
            onChange={() => onSetCurrent(row.seq)}
          />
        </td>
        <td class="mvp-wptable__cell mvp-wptable__cell--actions">
          <button
            type="button"
            class="mvp-wptable__btn"
            aria-label={t('plan.table.action.expand', { seq: row.seq + 1 })}
            aria-expanded={expanded() === row.seq}
            data-testid={`wp-expand-${row.seq}`}
            onClick={() => toggleExpand(row.seq)}
          >
            ⋯
          </button>
          <button
            type="button"
            class="mvp-wptable__btn"
            aria-label={t('plan.table.action.up', { seq: row.seq + 1 })}
            disabled={row.seq === 0}
            data-testid={`wp-up-${row.seq}`}
            onClick={() => onMove(row.seq, row.seq - 1)}
          >
            ↑
          </button>
          <button
            type="button"
            class="mvp-wptable__btn"
            aria-label={t('plan.table.action.down', { seq: row.seq + 1 })}
            disabled={row.seq === rows().length - 1}
            data-testid={`wp-down-${row.seq}`}
            onClick={() => onMove(row.seq, row.seq + 1)}
          >
            ↓
          </button>
          <button
            type="button"
            class="mvp-wptable__btn"
            aria-label={t('plan.table.action.insert', { seq: row.seq + 1 })}
            data-testid={`wp-insert-${row.seq}`}
            onClick={() => onInsert(row.seq)}
          >
            +
          </button>
          <button
            type="button"
            class="mvp-wptable__btn mvp-wptable__btn--danger"
            aria-label={t('plan.table.action.delete', { seq: row.seq + 1 })}
            data-testid={`wp-delete-${row.seq}`}
            onClick={() => onDelete(row.seq)}
          >
            ✕
          </button>
        </td>
      </tr>
      <Show when={expanded() === row.seq}>
        <tr class="mvp-wptable__editor-row">
          <td class="mvp-wptable__editor-cell" colSpan={colCount}>
            <CmdEditor
              value={props.model().items[row.seq] ?? props.model().items[0]!}
              onChange={(next) => replaceItem(row.seq, next)}
              t={t}
              {...(props.commands ? { commands: props.commands } : {})}
            />
          </td>
        </tr>
      </Show>
    </>
  );

  return (
    <section
      class="mvp-wptable"
      role="region"
      aria-label={t('plan.table.region.label')}
      onKeyDown={onKeyDown}
    >
      <header class="mvp-wptable__toolbar">
        <div class="mvp-wptable__group">
          <button
            type="button"
            class="mvp-wptable__btn mvp-wptable__btn--primary"
            data-testid="wp-add"
            onClick={onAdd}
          >
            {t('plan.table.action.add')}
          </button>
          <button
            type="button"
            class="mvp-wptable__btn"
            aria-label={t('plan.table.action.undo')}
            disabled={!historyCanUndo(history())}
            data-testid="wp-undo"
            onClick={onUndo}
          >
            ↶
          </button>
          <button
            type="button"
            class="mvp-wptable__btn"
            aria-label={t('plan.table.action.redo')}
            disabled={!historyCanRedo(history())}
            data-testid="wp-redo"
            onClick={onRedo}
          >
            ↷
          </button>
        </div>
        <label class="mvp-wptable__group mvp-wptable__defalt">
          <span>{t('plan.table.defaultAlt')}</span>
          <input
            class="mvp-wptable__input"
            type="number"
            step="any"
            data-testid="wp-default-alt"
            value={String(props.model().defaultAlt)}
            onChange={(e) => onDefaultAlt(e.currentTarget.value)}
          />
        </label>
        <dl class="mvp-wptable__totals" data-testid="wp-totals">
          <dt>{t('plan.table.total.distance')}</dt>
          <dd data-testid="wp-total-distance">{totals().distance}</dd>
          <dt>{t('plan.table.total.time')}</dt>
          <dd data-testid="wp-total-time">{totals().time}</dd>
          <dt>{t('plan.table.total.waypoints')}</dt>
          <dd data-testid="wp-total-waypoints">{totals().waypoints}</dd>
        </dl>
      </header>

      <table class="mvp-wptable__table">
        <caption class="mvp-wptable__caption">{t('plan.table.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('plan.table.col.seq')}</th>
            <th scope="col">{t('plan.table.col.command')}</th>
            <th scope="col">{t('plan.table.col.frame')}</th>
            <th scope="col">{t('plan.table.col.lat')}</th>
            <th scope="col">{t('plan.table.col.lon')}</th>
            <th scope="col">{t('plan.table.col.alt')}</th>
            <th scope="col">{t('plan.table.col.current')}</th>
            <th scope="col">{t('plan.table.col.actions')}</th>
          </tr>
        </thead>
        <tbody>
          <Show
            when={rows().length > 0}
            fallback={
              <tr>
                <td class="mvp-wptable__empty" colSpan={colCount} data-testid="wp-empty">
                  {t('plan.table.empty')}
                </td>
              </tr>
            }
          >
            <For each={rows()}>{(row) => renderRow(row)}</For>
          </Show>
        </tbody>
      </table>
    </section>
  );
};
