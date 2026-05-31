/**
 * MAVLink inspector widget (task T1.12; spec plan/04 §4.9, plan/05 §5.4/§5.5).
 *
 * A developer power-tool: a per-`(sysid, compid)` selector, a searchable message
 * tree (each message: name + id + observed rate + last-seen, expandable to its
 * fields with enum decoding), a raw/HEX view of the selected message's latest
 * frame, and that frame's signing / CRC status.
 *
 * It is a pure read view over the host's ON-DEMAND inspector stream: it
 * subscribes on mount (via the structural {@link InspectorSource}) and
 * unsubscribes on cleanup, so the heavy per-frame table is only produced while
 * the panel is open. No DOM-blocking work happens here; the worker builds the
 * snapshot.
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import type { DialectTable, FieldValue } from '../../../contracts';
import { BUILTIN_DIALECTS } from '../../../mavlink/dialects';
import { createEnumDecoder } from './enums';
import { formatAge, formatFieldValue, formatRate } from './format';
import { formatHexDump } from './hex';
import type { InspectorRow, InspectorSnapshot, InspectorSource, TFn } from './types';

/** {@link Inspector} props. */
export interface InspectorProps {
  /** Live data source (the MAVLink host, or a mock in tests). */
  source: InspectorSource;
  /** i18n translate function. */
  t: TFn;
  /** Requested inspector cadence in Hz (host default ~6 Hz when omitted). */
  hz?: number;
  /** Dialect tables for enum decoding (default {@link BUILTIN_DIALECTS}). */
  dialects?: readonly DialectTable[];
  /** Clock for last-seen age computation (default `Date.now`). */
  now?: () => number;
}

const EMPTY_SNAPSHOT: InspectorSnapshot = { rows: [], rev: -1 };

/** Stable `(sysid, compid)` key. */
function systemKey(sysid: number, compid: number): string {
  return `${sysid}:${compid}`;
}

/** A distinct system option derived from the current rows. */
interface SystemOption {
  key: string;
  sysid: number;
  compid: number;
}

/** The MAVLink inspector message/field tree + hex + signing/CRC view. */
export const Inspector: Component<InspectorProps> = (props) => {
  const nowFn = (): number => (props.now ?? Date.now)();
  const decoder = createEnumDecoder(props.dialects ?? BUILTIN_DIALECTS);

  const [snapshot, setSnapshot] = createSignal<InspectorSnapshot>(EMPTY_SNAPSHOT);
  const [receivedAt, setReceivedAt] = createSignal(nowFn());
  const [system, setSystem] = createSignal<string | undefined>();
  const [search, setSearch] = createSignal('');
  const [expanded, setExpanded] = createSignal<ReadonlySet<number>>(new Set<number>());
  const [selectedMsgId, setSelectedMsgId] = createSignal<number | undefined>();

  onMount(() => {
    const off = props.source.subscribeInspector(
      (snap) => {
        setSnapshot(snap);
        setReceivedAt(nowFn());
      },
      props.hz !== undefined ? { hz: props.hz } : {},
    );
    onCleanup(off);
  });

  const systems = createMemo<SystemOption[]>(() => {
    const seen = new Map<string, SystemOption>();
    for (const r of snapshot().rows) {
      const key = systemKey(r.sysid, r.compid);
      if (!seen.has(key)) seen.set(key, { key, sysid: r.sysid, compid: r.compid });
    }
    return [...seen.values()].sort((a, b) => a.sysid - b.sysid || a.compid - b.compid);
  });

  /** Active system key: the explicit selection if still present, else the first. */
  const activeSystem = createMemo<string | undefined>(() => {
    const opts = systems();
    const sel = system();
    if (sel !== undefined && opts.some((o) => o.key === sel)) return sel;
    return opts[0]?.key;
  });

  const systemRows = createMemo<InspectorRow[]>(() => {
    const key = activeSystem();
    if (key === undefined) return [];
    return snapshot()
      .rows.filter((r) => systemKey(r.sysid, r.compid) === key)
      .sort((a, b) => a.name.localeCompare(b.name) || a.msgId - b.msgId);
  });

  const filteredRows = createMemo<InspectorRow[]>(() => {
    const q = search().trim().toLowerCase();
    if (q === '') return systemRows();
    return systemRows().filter(
      (r) => r.name.toLowerCase().includes(q) || r.msgId.toString().includes(q),
    );
  });

  const selectedRow = createMemo<InspectorRow | undefined>(() => {
    const id = selectedMsgId();
    if (id === undefined) return undefined;
    return systemRows().find((r) => r.msgId === id);
  });

  const toggleExpand = (msgId: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const selectMessage = (msgId: number): void => {
    setSelectedMsgId(msgId);
    setExpanded((prev) => {
      if (prev.has(msgId)) return prev;
      const next = new Set(prev);
      next.add(msgId);
      return next;
    });
  };

  const ageLabel = (lastSeenMs: number): string => {
    const parts = formatAge(receivedAt() - lastSeenMs);
    return props.t(parts.key, { n: parts.n });
  };

  const fieldEntries = (row: InspectorRow): Array<[string, FieldValue]> =>
    Object.entries(row.fields);

  const t = props.t;

  return (
    <section class="mvp-inspector" role="region" aria-label={t('inspector.title')}>
      <div class="mvp-inspector__toolbar">
        <label class="mvp-inspector__system">
          <span class="mvp-inspector__label">{t('inspector.system')}</span>
          <select
            class="mvp-inspector__select"
            aria-label={t('inspector.system')}
            value={activeSystem() ?? ''}
            disabled={systems().length === 0}
            onChange={(e) => {
              setSystem(e.currentTarget.value || undefined);
              setSelectedMsgId(undefined);
            }}
          >
            <For each={systems()}>
              {(o) => (
                <option value={o.key}>
                  {t('inspector.systemOption', { sysid: o.sysid, compid: o.compid })}
                </option>
              )}
            </For>
          </select>
        </label>

        <label class="mvp-inspector__searchbox">
          <span class="mvp-inspector__label">{t('inspector.search')}</span>
          <input
            class="mvp-inspector__search"
            type="search"
            aria-label={t('inspector.search')}
            placeholder={t('inspector.searchPlaceholder')}
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </label>
      </div>

      <div class="mvp-inspector__body">
        <Show
          when={filteredRows().length > 0}
          fallback={
            <p class="mvp-inspector__empty" role="status">
              {snapshot().rows.length === 0 ? t('inspector.empty') : t('inspector.noMatches')}
            </p>
          }
        >
          <ul class="mvp-inspector__tree" role="tree" aria-label={t('inspector.messages')}>
            <For each={filteredRows()}>
              {(row) => {
                const isExpanded = (): boolean => expanded().has(row.msgId);
                const isSelected = (): boolean => selectedMsgId() === row.msgId;
                return (
                  <li
                    class="mvp-inspector__msg"
                    role="treeitem"
                    aria-expanded={isExpanded()}
                    aria-selected={isSelected()}
                  >
                    <div class="mvp-inspector__msg-row" classList={{ 'is-selected': isSelected() }}>
                      <button
                        type="button"
                        class="mvp-inspector__caret"
                        aria-label={isExpanded() ? t('inspector.collapse') : t('inspector.expand')}
                        onClick={() => toggleExpand(row.msgId)}
                      >
                        {isExpanded() ? '▾' : '▸'}
                      </button>
                      <button
                        type="button"
                        class="mvp-inspector__name"
                        onClick={() => selectMessage(row.msgId)}
                      >
                        <span class="mvp-inspector__msg-name">{row.name}</span>
                        <span class="mvp-inspector__msg-id">#{row.msgId}</span>
                        <span class="mvp-inspector__msg-rate">
                          {t('inspector.hz', { n: formatRate(row.rateHz) })}
                        </span>
                        <span class="mvp-inspector__msg-age">{ageLabel(row.lastSeenMs)}</span>
                      </button>
                    </div>

                    <Show when={isExpanded()}>
                      <ul class="mvp-inspector__fields" role="group">
                        <For
                          each={fieldEntries(row)}
                          fallback={
                            <li class="mvp-inspector__field mvp-inspector__field--empty">
                              {t('inspector.noFields')}
                            </li>
                          }
                        >
                          {([name, value]) => {
                            const enumName = decoder.decode(row.name, name, value);
                            return (
                              <li class="mvp-inspector__field" role="treeitem">
                                <span class="mvp-inspector__field-name">{name}</span>
                                <span class="mvp-inspector__field-value">
                                  {formatFieldValue(value)}
                                  <Show when={enumName !== undefined}>
                                    <span class="mvp-inspector__field-enum"> ({enumName})</span>
                                  </Show>
                                </span>
                              </li>
                            );
                          }}
                        </For>
                      </ul>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>

        <Show
          when={selectedRow()}
          fallback={
            <aside class="mvp-inspector__detail mvp-inspector__detail--empty">
              <p role="status">{t('inspector.selectHint')}</p>
            </aside>
          }
        >
          {(row) => (
            <aside
              class="mvp-inspector__detail"
              aria-label={t('inspector.detailFor', { name: row().name })}
            >
              <header class="mvp-inspector__detail-head">
                <span class="mvp-inspector__msg-name">{row().name}</span>
                <span class="mvp-inspector__msg-id">#{row().msgId}</span>
              </header>

              <dl class="mvp-inspector__status">
                <div>
                  <dt>{t('inspector.crc')}</dt>
                  <dd
                    class="mvp-inspector__crc"
                    classList={{ 'is-bad': !row().crcOk }}
                    data-ok={row().crcOk}
                  >
                    {row().crcOk ? t('inspector.crcOk') : t('inspector.crcBad')}
                  </dd>
                </div>
                <div>
                  <dt>{t('inspector.signing')}</dt>
                  <dd class="mvp-inspector__signing" data-signed={row().signed}>
                    {row().signed
                      ? t('inspector.signedLink', { link: row().linkId ?? 0 })
                      : t('inspector.unsigned')}
                  </dd>
                </div>
                <div>
                  <dt>{t('inspector.seq')}</dt>
                  <dd>{row().seq}</dd>
                </div>
                <div>
                  <dt>{t('inspector.count')}</dt>
                  <dd>{row().count}</dd>
                </div>
              </dl>

              <h3 class="mvp-inspector__hex-title">{t('inspector.hexView')}</h3>
              <pre
                class="mvp-inspector__hex"
                tabindex="0"
                aria-label={t('inspector.hexLabel', { name: row().name })}
              >
                {formatHexDump(row().raw)}
              </pre>
            </aside>
          )}
        </Show>
      </div>
    </section>
  );
};
