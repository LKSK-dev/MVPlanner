/**
 * Geofence editor panel (task T4.6; spec plan/04 §4.3 Geofence, plan/05 §5.3
 * Plan).
 *
 * Manages the geofence **shape list** (add/remove inclusion/exclusion polygons
 * and circles, toggle inclusion, edit circle radius) and the non-spatial
 * **limits** (min/max altitude + breach action). The model + conversion are pure
 * and live in `geo/fence`; this panel is presentation + wiring only.
 *
 * Polygon **vertex drawing** is owned by the map editor (T4.4): a polygon added
 * here starts empty and the row shows its vertex count. The current {@link Fence}
 * is reported through {@link FencePanelProps.onChange} so the Plan assembly
 * (T4.10) can convert it (`fenceToMission` + `fenceParams`) and upload it.
 */
import { For, Index, Show, createMemo, createSignal, type Component } from 'solid-js';
import { t as defaultT } from '../../../../core/i18n';
import {
  FENCE_BREACH_ACTIONS,
  addCircle,
  addPolygon,
  createFence,
  removeShape,
  setBreachAction,
  setCircleRadius,
  setInclusion,
  setMaxAlt,
  setMinAlt,
  type Fence,
  type FenceCircle,
  type FenceInclusion,
} from '../../../../geo/fence';
import './messages';
import './fence.css';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** {@link FencePanel} props. */
export interface FencePanelProps {
  /** Optional initial fence; defaults to an empty fence with default limits. */
  initial?: Fence;
  /**
   * Optional CONTROLLED value accessor. When provided the panel renders from
   * `value()` (a shared Plan-screen signal) instead of its own internal state,
   * so map-drawn vertices and panel edits stay in sync; edits are reported via
   * `onChange` only. Omit it for the uncontrolled (self-managed) behaviour.
   */
  value?: () => Fence;
  /** Called with the new {@link Fence} whenever the model changes. */
  onChange?: (fence: Fence) => void;
  /** i18n translate function (default the app `t`). */
  t?: TFn;
}

/** Parse a numeric input, falling back to `prev` when the text is not finite. */
function num(raw: string, prev: number): number {
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) ? v : prev;
}

/** The Geofence editor panel. */
export const FencePanel: Component<FencePanelProps> = (props) => {
  const t = props.t ?? defaultT;
  const [internal, setInternal] = createSignal<Fence>(props.initial ?? createFence());
  /** The active fence: the controlled accessor when present, else internal state. */
  const fence = (): Fence => props.value?.() ?? internal();

  /** Apply a pure edit op and emit the result (controlled mode skips local state). */
  const apply = (next: Fence): void => {
    if (props.value === undefined) setInternal(next);
    props.onChange?.(next);
  };
  const edit = (mutate: (f: Fence) => Fence): void => apply(mutate(fence()));

  const breachAction = (): number => fence().breachAction;

  return (
    <section class="mvp-fence" role="region" aria-label={t('fence.region.label')}>
      {/* Shapes ------------------------------------------------------------ */}
      <section class="mvp-fence__section" aria-label={t('fence.section.shapes')}>
        <h2 class="mvp-fence__heading">{t('fence.section.shapes')}</h2>

        <Show
          when={fence().shapes.length > 0}
          fallback={
            <p class="mvp-fence__hint" data-testid="fence-empty">
              {t('fence.shapes.empty')}
            </p>
          }
        >
          <ul class="mvp-fence__shapes" data-testid="fence-shapes">
            {/*
             * `Index` (not `For`) keys rows by position, so editing a shape —
             * which replaces the shape object at the same index — updates the
             * existing row in place instead of recreating it. Recreating the
             * row would tear down + remount the radius <input>, dropping focus
             * after every keystroke (the "one character at a time" bug).
             */}
            <Index each={fence().shapes}>
              {(shape, index) => {
                const circle = createMemo<FenceCircle | undefined>(() => {
                  const sh = shape();
                  return sh.kind === 'circle' ? sh : undefined;
                });
                const vertexCount = (): number => {
                  const sh = shape();
                  return sh.kind === 'polygon' ? sh.vertices.length : 0;
                };
                return (
                  <li class="mvp-fence__shape" data-testid="fence-shape">
                    <span class="mvp-fence__shape-label">
                      {t('fence.shape.label', {
                        inclusion: t(`fence.inclusion.${shape().inclusion}`),
                        kind: t(`fence.kind.${shape().kind}`),
                      })}
                    </span>

                    <select
                      class="mvp-fence__select"
                      data-testid="fence-shape-inclusion"
                      value={shape().inclusion}
                      onChange={(e) =>
                        edit((f) => setInclusion(f, index, e.currentTarget.value as FenceInclusion))
                      }
                    >
                      <option value="inclusion">{t('fence.inclusion.inclusion')}</option>
                      <option value="exclusion">{t('fence.inclusion.exclusion')}</option>
                    </select>

                    <Show
                      when={circle()}
                      fallback={
                        <span class="mvp-fence__shape-detail" data-testid="fence-shape-vertices">
                          {t('fence.shape.vertices', { n: vertexCount() })}
                        </span>
                      }
                    >
                      {(c) => (
                        <label class="mvp-fence__radius">
                          <span class="mvp-fence__shape-detail">{t('fence.shape.radius')}</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            class="mvp-fence__input"
                            data-testid="fence-shape-radius"
                            value={c().radiusM}
                            onInput={(e) =>
                              edit((f) =>
                                setCircleRadius(f, index, num(e.currentTarget.value, c().radiusM)),
                              )
                            }
                          />
                        </label>
                      )}
                    </Show>

                    <button
                      type="button"
                      class="mvp-fence__remove"
                      data-testid="fence-shape-remove"
                      aria-label={t('fence.shape.remove')}
                      onClick={() => edit((f) => removeShape(f, index))}
                    >
                      ✕
                    </button>
                  </li>
                );
              }}
            </Index>
          </ul>
        </Show>

        <div class="mvp-fence__add">
          <button
            type="button"
            class="mvp-fence__btn"
            data-testid="fence-add-incl-polygon"
            onClick={() => edit((f) => addPolygon(f, 'inclusion'))}
          >
            {t('fence.add.inclusionPolygon')}
          </button>
          <button
            type="button"
            class="mvp-fence__btn"
            data-testid="fence-add-excl-polygon"
            onClick={() => edit((f) => addPolygon(f, 'exclusion'))}
          >
            {t('fence.add.exclusionPolygon')}
          </button>
          <button
            type="button"
            class="mvp-fence__btn"
            data-testid="fence-add-incl-circle"
            onClick={() => edit((f) => addCircle(f, 'inclusion'))}
          >
            {t('fence.add.inclusionCircle')}
          </button>
          <button
            type="button"
            class="mvp-fence__btn"
            data-testid="fence-add-excl-circle"
            onClick={() => edit((f) => addCircle(f, 'exclusion'))}
          >
            {t('fence.add.exclusionCircle')}
          </button>
        </div>
      </section>

      {/* Limits ------------------------------------------------------------ */}
      <section class="mvp-fence__section" aria-label={t('fence.section.limits')}>
        <h2 class="mvp-fence__heading">{t('fence.section.limits')}</h2>

        <label class="mvp-fence__field">
          <span class="mvp-fence__label">{t('fence.limits.minAlt')}</span>
          <input
            type="number"
            step="1"
            class="mvp-fence__input"
            data-testid="fence-min-alt"
            value={fence().minAltM}
            onInput={(e) => edit((f) => setMinAlt(f, num(e.currentTarget.value, f.minAltM)))}
          />
        </label>

        <label class="mvp-fence__field">
          <span class="mvp-fence__label">{t('fence.limits.maxAlt')}</span>
          <input
            type="number"
            step="1"
            class="mvp-fence__input"
            data-testid="fence-max-alt"
            value={fence().maxAltM}
            onInput={(e) => edit((f) => setMaxAlt(f, num(e.currentTarget.value, f.maxAltM)))}
          />
        </label>

        <label class="mvp-fence__field">
          <span class="mvp-fence__label">{t('fence.limits.breachAction')}</span>
          <select
            class="mvp-fence__select"
            data-testid="fence-breach-action"
            value={breachAction()}
            onChange={(e) => edit((f) => setBreachAction(f, num(e.currentTarget.value, f.breachAction)))}
          >
            <For each={FENCE_BREACH_ACTIONS}>
              {(action) => <option value={action}>{t(`fence.action.${action}`)}</option>}
            </For>
          </select>
        </label>
      </section>
    </section>
  );
};
