/**
 * Plan tool rail (task T4.10; spec plan/05 §5.4 Plan "left tool rail (add WP,
 * survey, fence, rally, measure, import)").
 *
 * A vertical rail of mutually-exclusive tool buttons that drive the active
 * {@link PlanToolMode} plus an Import action. Presentation only: the active mode
 * + the handlers are injected by the Plan screen, which owns the shared signal.
 */
import { For, type Component } from 'solid-js';
import { t as defaultT } from '../../../core/i18n';
import type { PlanToolMode } from './map-edit';

/** The i18n translate function (matches `core/i18n` `t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** {@link ToolRail} props. */
export interface ToolRailProps {
  /** The active tool mode. */
  mode: () => PlanToolMode;
  /** Switch the active tool. */
  onMode: (mode: PlanToolMode) => void;
  /** Open / import a mission file. */
  onImport: () => void;
  /** i18n translate function (default the app `t`). */
  t?: TFn;
}

/** One rail entry: a tool mode + its label key + a glyph. */
interface ToolEntry {
  readonly mode: PlanToolMode;
  readonly labelKey: string;
  readonly glyph: string;
}

/** The tool entries in rail order (spec §5.4). */
const TOOLS: readonly ToolEntry[] = [
  { mode: 'select', labelKey: 'plan.tool.select', glyph: '\u2196' },
  { mode: 'add-waypoint', labelKey: 'plan.tool.addWaypoint', glyph: '\u25c9' },
  { mode: 'draw-survey-polygon', labelKey: 'plan.tool.survey', glyph: '\u25a6' },
  { mode: 'draw-fence-polygon', labelKey: 'plan.tool.fencePolygon', glyph: '\u2b1f' },
  { mode: 'draw-fence-circle', labelKey: 'plan.tool.fenceCircle', glyph: '\u25ef' },
  { mode: 'place-rally', labelKey: 'plan.tool.rally', glyph: '\u2691' },
  { mode: 'measure', labelKey: 'plan.tool.measure', glyph: '📏' },
];

/** The Plan tool rail. */
export const ToolRail: Component<ToolRailProps> = (props) => {
  const t = (): TFn => props.t ?? defaultT;

  return (
    <nav class="mvp-plan__rail" role="toolbar" aria-orientation="vertical" aria-label={t()('plan.tool.rail.label')}>
      <For each={TOOLS}>
        {(tool) => (
          <button
            type="button"
            class="mvp-plan__tool"
            classList={{ 'mvp-plan__tool--active': props.mode() === tool.mode }}
            data-testid={`plan-tool-${tool.mode}`}
            aria-pressed={props.mode() === tool.mode}
            aria-label={t()(tool.labelKey)}
            title={t()(tool.labelKey)}
            onClick={() => props.onMode(tool.mode)}
          >
            <span aria-hidden="true">{tool.glyph}</span>
          </button>
        )}
      </For>
      <button
        type="button"
        class="mvp-plan__tool mvp-plan__tool--import"
        data-testid="plan-tool-import"
        aria-label={t()('plan.tool.import')}
        title={t()('plan.tool.import')}
        onClick={() => props.onImport()}
      >
        <span aria-hidden="true">{'\u2191'}</span>
      </button>
    </nav>
  );
};
