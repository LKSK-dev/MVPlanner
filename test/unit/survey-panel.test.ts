/**
 * Survey / grid panel component tests (task T4.5; spec plan/04 §4.3 survey/grid,
 * plan/05 §5.3 Plan). Mounts {@link SurveyPanel} with an injected polygon and a
 * spy `onGenerate`, asserting the empty/live states, the live estimates and that
 * Generate hands back a {@link Mission}.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { SurveyPanel, createSurveyPanel } from '../../src/ui/screens/plan/survey';
import type { Mission, PanelApi } from '../../src/contracts';
import type { LatLon } from '../../src/geo/format';
import type { CameraModel } from '../../src/geo/survey';
import { createAppStore } from '../../src/core/store';
import { t } from '../../src/core/i18n';

/** Clean test camera: 72 m × 48 m footprint at 100 m. */
const CAMERA: CameraModel = {
  sensorWidthMm: 36,
  sensorHeightMm: 24,
  focalLengthMm: 50,
  imageWidthPx: 6000,
  imageHeightPx: 4000,
};

const mPerDeg = 111319.49079327357;
function rect(halfWidthM: number, halfHeightM: number): LatLon[] {
  const dLon = halfWidthM / mPerDeg;
  const dLat = halfHeightM / mPerDeg;
  return [
    { lat: -dLat, lon: -dLon },
    { lat: -dLat, lon: dLon },
    { lat: dLat, lon: dLon },
    { lat: dLat, lon: -dLon },
  ];
}

afterEach(() => cleanup());

describe('SurveyPanel', () => {
  it('shows a hint and disables Generate without a polygon', () => {
    const onGenerate = vi.fn();
    const { getByTestId } = render(() => createComponent(SurveyPanel, { polygon: [], onGenerate }));
    expect((getByTestId('survey-generate') as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('survey-status').textContent).not.toBe('');
  });

  it('renders live estimates for a polygon', () => {
    const onGenerate = vi.fn();
    const { getByTestId } = render(() =>
      createComponent(SurveyPanel, {
        polygon: rect(290, 185),
        onGenerate,
        initial: { camera: CAMERA, altitudeM: 100, frontlapPct: 75, sidelapPct: 60, angleDeg: 0 },
      }),
    );
    expect(getByTestId('survey-estimates')).toBeTruthy();
    expect(getByTestId('survey-est-lines').textContent).toBe('21');
    expect(Number(getByTestId('survey-est-photos').textContent)).toBeGreaterThan(0);
  });

  it('createSurveyPanel reads the polygon reactively (Generate enables as it grows)', () => {
    // Guards the dockable-panel wiring (T4.5/register): the polygon must be a
    // reactive getter, not a one-time snapshot, so Generate enables once the
    // map editor has drawn >= 3 vertices.
    const [poly, setPoly] = createSignal<LatLon[]>([]);
    const onGenerate = vi.fn<(m: Mission) => void>();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const api: PanelApi = { store: createAppStore(), t };
    const dispose = createSurveyPanel({ polygon: () => poly(), onGenerate }).mount(host, api);
    const generate = (): HTMLButtonElement =>
      host.querySelector('[data-testid="survey-generate"]') as HTMLButtonElement;

    expect(generate().disabled).toBe(true);
    setPoly(rect(290, 185));
    expect(generate().disabled).toBe(false);

    if (typeof dispose === 'function') dispose();
    host.remove();
  });

  it('generates a mission via onGenerate', () => {
    const onGenerate = vi.fn<(m: Mission) => void>();
    const { getByTestId } = render(() =>
      createComponent(SurveyPanel, {
        polygon: rect(290, 185),
        onGenerate,
        initial: { altitudeM: 100 },
      }),
    );
    (getByTestId('survey-generate') as HTMLButtonElement).click();
    expect(onGenerate).toHaveBeenCalledTimes(1);
    const mission = onGenerate.mock.calls[0]?.[0];
    expect(mission?.type).toBe('mission');
    expect(mission?.items.some((i) => i.command === 16)).toBe(true);
  });
});
