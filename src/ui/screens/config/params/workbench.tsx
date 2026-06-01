/**
 * Parameter workbench panel (task T3.4; spec plan/04 §4.5 full parameter
 * management, plan/05 §5.4 Config).
 *
 * Wires the reusable {@link ParamGrid} to a {@link ParamClient} + toolbar:
 *  - **Fetch / Refresh** the complete set (with a progress bar from
 *    `fetchAll`'s `onProgress`),
 *  - **Write changed** (calls `client.set` ONLY for staged-modified params),
 *  - **Write all** (writes every effective value),
 *  - **Save to file** and **Compare / diff** via *injected callbacks*
 *    (`onSave` / `onLoad`) — the Config assembly wires these to the param-file
 *    module (T3.5); the workbench never imports `data/paramfile`.
 *
 * It owns the fetched param set and a staged-edit buffer; the grid stays a pure
 * controlled view. The `ParamClient` + `ParamMetaStore` come in by injection so
 * tests drive it with mocks (no Worker, no host).
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import type { Param, ParamClient } from '../../../../contracts';
import {
  ParamGrid,
  computeDiff,
  type DiffRow,
  type ParamMetaResolver,
  type TFn,
} from '../../../widgets/paramgrid';
import './messages';

/** Injected file seams the Config assembly wires to the param-file module (T3.5). */
export interface ParamFileCallbacks {
  /** Persist the current effective parameter set to a file (T3.5 owns the format). */
  onSave?: (params: Param[]) => void | Promise<void>;
  /** Load a comparison set (a file or another vehicle) for the diff drawer. */
  onLoad?: () => Promise<readonly Param[] | Record<string, number>>;
}

/** {@link ParamWorkbench} props. */
export interface ParamWorkbenchProps extends ParamFileCallbacks {
  /** Parameter microservice client (the real one, or a mock in tests). */
  client: ParamClient;
  /** Metadata resolver (the `ParamMetaStore`, or a mock). */
  meta: ParamMetaResolver;
  /** i18n translate function. */
  t: TFn;
}

/** Progress of an in-flight fetch. */
interface FetchProgress {
  done: number;
  total: number;
}

/** The parameter workbench: toolbar + {@link ParamGrid} + compare drawer. */
export const ParamWorkbench: Component<ParamWorkbenchProps> = (props) => {
  const t = props.t;

  const [params, setParams] = createSignal<readonly Param[]>([]);
  const [pending, setPending] = createSignal<ReadonlyMap<string, number>>(new Map());
  const [progress, setProgress] = createSignal<FetchProgress | undefined>();
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal('');
  const [diff, setDiff] = createSignal<DiffRow[] | undefined>();

  /** name -> base (vehicle) value. */
  const baseMap = createMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const p of params()) m.set(p.name, p.value);
    return m;
  });

  /** The effective set = base overlaid with staged edits. */
  const effectiveParams = (): Param[] =>
    params().map((p) => {
      const staged = pending().get(p.name);
      return staged !== undefined ? { ...p, value: staged } : p;
    });

  const changedCount = createMemo(() => pending().size);

  onMount(() => {
    const off = props.client.onChange((p) => {
      // Reflect vehicle-confirmed values into the base set; drop a now-matching
      // staged edit so a written/echoed value no longer shows as modified.
      setParams((prev) => {
        let found = false;
        const next = prev.map((cur) => {
          if (cur.name !== p.name) return cur;
          found = true;
          return { ...cur, value: p.value };
        });
        return found ? next : [...next, p];
      });
      setPending((prev) => {
        const staged = prev.get(p.name);
        if (staged === undefined || staged !== p.value) return prev;
        const nextMap = new Map(prev);
        nextMap.delete(p.name);
        return nextMap;
      });
    });
    onCleanup(off);
  });

  const onEdit = (name: string, value: number): void => {
    setPending((prev) => {
      const next = new Map(prev);
      if (baseMap().get(name) === value) next.delete(name);
      else next.set(name, value);
      return next;
    });
  };

  const reportError = (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(t('params.status.error', { message }));
  };

  const fetchAll = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    setStatus('');
    setProgress(undefined);
    try {
      const result = await props.client.fetchAll((done, total) => setProgress({ done, total }));
      setParams(result);
      setPending(new Map());
      setStatus(t('params.status.fetched', { n: result.length }));
    } catch (err) {
      reportError(err);
    } finally {
      setProgress(undefined);
      setBusy(false);
    }
  };

  /** Write only the staged-modified params (the diff against the base). */
  const writeChanged = async (): Promise<void> => {
    if (busy()) return;
    const base = baseMap();
    const entries = [...pending()].filter(([name, value]) => base.get(name) !== value);
    if (entries.length === 0) return;
    setBusy(true);
    setStatus('');
    try {
      for (const [name, value] of entries) await props.client.set(name, value);
      commit(new Map(entries));
      setStatus(t('params.status.wrote', { n: entries.length }));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Write every parameter's effective value to the vehicle. */
  const writeAll = async (): Promise<void> => {
    if (busy()) return;
    const all = effectiveParams();
    if (all.length === 0) return;
    setBusy(true);
    setStatus('');
    try {
      for (const p of all) await props.client.set(p.name, p.value);
      commit(new Map(all.map((p) => [p.name, p.value])));
      setStatus(t('params.status.wrote', { n: all.length }));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Fold written values into the base set and drop them from the staged map. */
  const commit = (written: ReadonlyMap<string, number>): void => {
    setParams((prev) =>
      prev.map((p) => {
        const v = written.get(p.name);
        return v !== undefined ? { ...p, value: v } : p;
      }),
    );
    setPending((prev) => {
      const next = new Map(prev);
      for (const name of written.keys()) next.delete(name);
      return next;
    });
  };

  const save = async (): Promise<void> => {
    if (!props.onSave || busy()) return;
    setBusy(true);
    try {
      const snapshot = effectiveParams();
      await props.onSave(snapshot);
      setStatus(t('params.status.saved', { n: snapshot.length }));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const compare = async (): Promise<void> => {
    if (!props.onLoad || busy()) return;
    setBusy(true);
    setStatus('');
    try {
      const other = await props.onLoad();
      setDiff(computeDiff(effectiveParams(), other));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const fmt = (v: number | undefined): string =>
    v === undefined ? t('params.diff.missing') : Number(v.toPrecision(8)).toString();

  return (
    <section class="mvp-paramwb" role="region" aria-label={t('params.title')}>
      <div class="mvp-paramwb__toolbar" role="toolbar" aria-label={t('params.toolbar.label')}>
        <button
          type="button"
          class="mvp-paramwb__btn"
          disabled={busy()}
          onClick={() => void fetchAll()}
        >
          {params().length === 0 ? t('params.fetch') : t('params.refresh')}
        </button>
        <button
          type="button"
          class="mvp-paramwb__btn"
          disabled={busy() || changedCount() === 0}
          onClick={() => void writeChanged()}
        >
          {t('params.writeChanged')}
        </button>
        <button
          type="button"
          class="mvp-paramwb__btn"
          disabled={busy() || params().length === 0}
          onClick={() => void writeAll()}
        >
          {t('params.writeAll')}
        </button>
        <Show when={props.onSave}>
          <button
            type="button"
            class="mvp-paramwb__btn"
            disabled={busy() || params().length === 0}
            onClick={() => void save()}
          >
            {t('params.save')}
          </button>
        </Show>
        <Show when={props.onLoad}>
          <button
            type="button"
            class="mvp-paramwb__btn"
            disabled={busy()}
            onClick={() => void compare()}
          >
            {t('params.compare')}
          </button>
        </Show>
        <Show when={changedCount() > 0}>
          <span class="mvp-paramwb__changed" role="status">
            {t('params.changedCount', { n: changedCount() })}
          </span>
        </Show>
      </div>

      <Show when={progress()}>
        {(p) => (
          <div class="mvp-paramwb__progress">
            <label class="mvp-paramgrid__label" for="mvp-paramwb-progress">
              {t('params.progress', { done: p().done, total: p().total })}
            </label>
            <progress
              id="mvp-paramwb-progress"
              class="mvp-paramwb__bar"
              aria-label={t('params.progressLabel')}
              max={p().total > 0 ? p().total : undefined}
              value={p().total > 0 ? p().done : undefined}
            />
          </div>
        )}
      </Show>

      <Show when={status() !== ''}>
        <p class="mvp-paramwb__status" role="status">
          {status()}
        </p>
      </Show>

      <div class="mvp-paramwb__body">
        <div class="mvp-paramwb__grid">
          <ParamGrid
            rows={() => params()}
            pending={() => pending()}
            meta={props.meta}
            onEdit={onEdit}
            t={t}
          />
        </div>

        <Show when={diff()}>
          {(rows) => (
            <aside class="mvp-paramwb__diff" aria-label={t('params.diff.title')}>
              <header class="mvp-paramwb__diff-head">
                <h3>{t('params.diff.title')}</h3>
                <span class="mvp-paramgrid__label">
                  {t('params.diff.summary', { n: rows().length })}
                </span>
                <button
                  type="button"
                  class="mvp-paramwb__diff-close"
                  aria-label={t('params.diff.close')}
                  onClick={() => setDiff(undefined)}
                >
                  ✕
                </button>
              </header>
              <Show
                when={rows().length > 0}
                fallback={
                  <p class="mvp-paramwb__diff-empty" role="status">
                    {t('params.diff.empty')}
                  </p>
                }
              >
                <table class="mvp-paramwb__diff-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('params.diff.name')}</th>
                      <th scope="col">{t('params.diff.current')}</th>
                      <th scope="col">{t('params.diff.other')}</th>
                      <th scope="col">{t('params.diff.delta')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={rows()}>
                      {(d) => (
                        <tr data-name={d.name}>
                          <th scope="row" class="mvp-paramwb__diff-name">
                            {d.name}
                          </th>
                          <td>{fmt(d.current)}</td>
                          <td>{fmt(d.other)}</td>
                          <td class="mvp-paramwb__diff-delta">{fmt(d.delta)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </aside>
          )}
        </Show>
      </div>
    </section>
  );
};
