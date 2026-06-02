/**
 * Session-scoped Plan state (spec docs/appsettings PLAN-0.3 F4.1). The dock
 * disposes + re-mounts a screen panel on every tab switch (see `ui/shell/dock`),
 * so the Plan screen's local mission/fence/rally/survey signals would be lost
 * when leaving the Plan tab. {@link createPlanSession} holds those signals in an
 * App-lifetime object injected into the Plan panel, so a re-mounted Plan screen
 * rehydrates the in-progress plan for the current session.
 *
 * UI-ephemeral state (active tool, drawer tab, status line) is intentionally NOT
 * persisted here — only the plan data the user is editing.
 */
import { createSignal, type Accessor, type Setter } from 'solid-js';
import { createMission, type MissionModel } from '../../../geo/mission';
import { createFence, type Fence } from '../../../geo/fence';
import { createRally, type Rally } from '../../../geo/rally';
import type { LatLon } from '../../../geo/format';

/** The persisted plan-editing signals (get + set per slice). */
export interface PlanSession {
  readonly mission: Accessor<MissionModel>;
  readonly setMission: Setter<MissionModel>;
  readonly fence: Accessor<Fence>;
  readonly setFence: Setter<Fence>;
  readonly rally: Accessor<Rally>;
  readonly setRally: Setter<Rally>;
  readonly surveyPolygon: Accessor<readonly LatLon[]>;
  readonly setSurveyPolygon: Setter<readonly LatLon[]>;
}

/** Create an App-lifetime {@link PlanSession} seeded with empty plan state. */
export function createPlanSession(): PlanSession {
  const [mission, setMission] = createSignal<MissionModel>(createMission('mission'));
  const [fence, setFence] = createSignal<Fence>(createFence());
  const [rally, setRally] = createSignal<Rally>(createRally());
  const [surveyPolygon, setSurveyPolygon] = createSignal<readonly LatLon[]>([]);
  return {
    mission,
    setMission,
    fence,
    setFence,
    rally,
    setRally,
    surveyPolygon,
    setSurveyPolygon,
  };
}
