/**
 * Rally points editor panel (task T4.7; spec plan/04 §4.3 rally, plan/05 §5.3
 * Plan).
 *
 * Manages a {@link Rally} model — a list of rally points with **add / remove /
 * edit** of the numeric fields (lat/lon/alt plus optional break altitude and
 * landing direction). Map placement of points is owned by the map editor (T4.4)
 * and is out of scope here; this panel manages the model + numeric fields only.
 * Every edit is handed back via {@link RallyPanelProps.onChange} so the Plan
 * assembly can serialise it to a `MISSION_TYPE_RALLY` mission
 * (`geo/rally` `rallyToMission`) and upload it via the `MissionClient`. The
 * value is injected so the panel unit-tests without a map or mission service.
 */
import { Index, Show, createSignal, type Component } from 'solid-js';
import { t as defaultT, type TFn } from '../../../../core/i18n';
import {
  addRallyPoint,
  createRally,
  deleteRallyPoint,
  setDefaultAlt,
  setRallyPoint,
  type Rally,
  type RallyPatch,
} from '../../../../geo/rally';
import './messages';
import './rally.css';

export type { TFn };

/** {@link RallyPanel} props. */
export interface RallyPanelProps {
  /** Initial rally model (uncontrolled seed); defaults to an empty rally set. */
  value?: Rally;
  /**
   * Optional CONTROLLED model accessor. When provided the panel renders from
   * `model()` (a shared Plan-screen signal) instead of its own internal state,
   * so map-placed points and panel edits stay in sync; edits are reported via
   * `onChange` only. Omit it for the uncontrolled (self-managed) behaviour.
   */
  model?: () => Rally;
  /** Called with the updated rally model after every edit. */
  onChange?: (rally: Rally) => void;
  /** i18n translate function (default the app `t`). */
  t?: TFn;
}

/** Parse a numeric input, falling back to `prev` when the text is not finite. */
function num(raw: string, prev: number): number {
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) ? v : prev;
}

/**
 * Parse an optional numeric input: empty/blank clears the field (`undefined`),
 * otherwise the parsed finite value (or `prev` when not finite).
 */
function optNum(raw: string, prev: number | undefined): number | undefined {
  if (raw.trim() === '') return undefined;
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) ? v : prev;
}

/** The Rally points editor panel. */
export const RallyPanel: Component<RallyPanelProps> = (props) => {
  const t = props.t ?? defaultT;
  const [internal, setInternal] = createSignal<Rally>(props.value ?? createRally());
  /** The active rally set: the controlled accessor when present, else internal state. */
  const rally = (): Rally => props.model?.() ?? internal();

  /** Apply a pure model transform (controlled mode skips local state). */
  const apply = (next: Rally): void => {
    if (props.model === undefined) setInternal(next);
    props.onChange?.(next);
  };

  const onAdd = (): void => {
    apply(addRallyPoint(rally(), { lat: 0, lon: 0 }));
  };
  const onRemove = (index: number): void => {
    apply(deleteRallyPoint(rally(), index));
  };
  const onEdit = (index: number, patch: RallyPatch): void => {
    apply(setRallyPoint(rally(), index, patch));
  };
  const onDefaultAlt = (raw: string): void => {
    apply(setDefaultAlt(rally(), num(raw, rally().defaultAlt)));
  };

  return (
    <section class="mvp-rally" role="region" aria-label={t('rally.region.label')}>
      <header class="mvp-rally__header">
        <h2 class="mvp-rally__heading">{t('rally.title')}</h2>
        <span class="mvp-rally__count" data-testid="rally-count">
          {t('rally.count', { n: rally().points.length })}
        </span>
      </header>

      <label class="mvp-rally__field">
        <span class="mvp-rally__label">{t('rally.defaultAlt')}</span>
        <input
          type="number"
          step="1"
          class="mvp-rally__input"
          data-testid="rally-default-alt"
          value={rally().defaultAlt}
          onInput={(e) => onDefaultAlt(e.currentTarget.value)}
        />
      </label>

      <Show
        when={rally().points.length > 0}
        fallback={
          <p class="mvp-rally__hint" data-testid="rally-empty">
            {t('rally.empty')}
          </p>
        }
      >
        <ol class="mvp-rally__list" data-testid="rally-list">
          {/*
           * `Index` (not `For`) keys rows by position. Editing a field replaces
           * the point object at the same index; `Index` updates the existing
           * row in place rather than recreating it, so the focused <input> is
           * not torn down + remounted after each keystroke (the "one character
           * at a time" bug).
           */}
          <Index each={rally().points}>
            {(point, index) => (
              <li class="mvp-rally__row" data-testid={`rally-row-${index}`}>
                <span class="mvp-rally__row-label">{t('rally.point', { n: index + 1 })}</span>
                <label class="mvp-rally__cell">
                  <span class="mvp-rally__label">{t('rally.field.lat')}</span>
                  <input
                    type="number"
                    step="0.0000001"
                    class="mvp-rally__input"
                    data-testid={`rally-lat-${index}`}
                    value={point().lat}
                    onInput={(e) => onEdit(index, { lat: num(e.currentTarget.value, point().lat) })}
                  />
                </label>
                <label class="mvp-rally__cell">
                  <span class="mvp-rally__label">{t('rally.field.lon')}</span>
                  <input
                    type="number"
                    step="0.0000001"
                    class="mvp-rally__input"
                    data-testid={`rally-lon-${index}`}
                    value={point().lon}
                    onInput={(e) => onEdit(index, { lon: num(e.currentTarget.value, point().lon) })}
                  />
                </label>
                <label class="mvp-rally__cell">
                  <span class="mvp-rally__label">{t('rally.field.alt')}</span>
                  <input
                    type="number"
                    step="1"
                    class="mvp-rally__input"
                    data-testid={`rally-alt-${index}`}
                    value={point().alt}
                    onInput={(e) => onEdit(index, { alt: num(e.currentTarget.value, point().alt) })}
                  />
                </label>
                <label class="mvp-rally__cell">
                  <span class="mvp-rally__label">{t('rally.field.breakAlt')}</span>
                  <input
                    type="number"
                    step="1"
                    class="mvp-rally__input"
                    data-testid={`rally-break-alt-${index}`}
                    value={point().breakAlt ?? ''}
                    onInput={(e) => onEdit(index, { breakAlt: optNum(e.currentTarget.value, point().breakAlt) })}
                  />
                </label>
                <label class="mvp-rally__cell">
                  <span class="mvp-rally__label">{t('rally.field.landDir')}</span>
                  <input
                    type="number"
                    step="1"
                    class="mvp-rally__input"
                    data-testid={`rally-land-dir-${index}`}
                    value={point().landDir ?? ''}
                    onInput={(e) => onEdit(index, { landDir: optNum(e.currentTarget.value, point().landDir) })}
                  />
                </label>
                <button
                  type="button"
                  class="mvp-rally__remove"
                  data-testid={`rally-remove-${index}`}
                  aria-label={t('rally.remove', { n: index + 1 })}
                  onClick={() => onRemove(index)}
                >
                  ×
                </button>
              </li>
            )}
          </Index>
        </ol>
      </Show>

      <div class="mvp-rally__actions">
        <button
          type="button"
          class="mvp-rally__btn"
          data-testid="rally-add"
          onClick={onAdd}
        >
          {t('rally.add')}
        </button>
      </div>
    </section>
  );
};
