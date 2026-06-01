/**
 * Registration glue for the Survey / grid panel (task T4.5; spec plan/05 §5.3
 * Plan dock).
 *
 * Builds a dockable {@link PanelDef} (`plan.survey`) that mounts
 * {@link SurveyPanel} with an injected polygon provider and `onGenerate`
 * callback. The Plan screen assembly (or a workspace) references the panel by
 * {@link SURVEY_PANEL_ID}; the panel mounts a fresh Solid root via `render()`
 * (the same imperative pattern the settings / inspector panels use), capturing
 * its deps by closure.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { Mission, PanelApi, PanelDef } from '../../../../contracts';
import type { LatLon } from '../../../../geo/format';
import { SurveyPanel, type SurveyConfig } from './survey-panel';
import './messages';

/** Stable panel id (workspaces/extensions may dock the survey panel by this id). */
export const SURVEY_PANEL_ID = 'plan.survey';

/** Construction dependencies for the Survey panel. */
export interface SurveyPanelDeps {
  /** Returns the current survey polygon (owned by the map editor, T4.4). */
  readonly polygon: () => LatLon[];
  /** Receives the generated survey mission. */
  readonly onGenerate: (mission: Mission) => void;
  /** Optional initial camera/coverage/layout values. */
  readonly initial?: Partial<SurveyConfig>;
}

/** Build the dockable `plan.survey` {@link PanelDef} bound to its deps. */
export function createSurveyPanel(deps: SurveyPanelDeps): PanelDef {
  return {
    id: SURVEY_PANEL_ID,
    title: 'Survey / Grid',
    icon: 'grid',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(SurveyPanel, {
            polygon: deps.polygon(),
            onGenerate: deps.onGenerate,
            t: api.t,
            ...(deps.initial !== undefined ? { initial: deps.initial } : {}),
          }),
        el,
      );
    },
  };
}
