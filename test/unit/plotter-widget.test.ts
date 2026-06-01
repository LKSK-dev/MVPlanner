/** Plotter component tests for the happy-dom guarded path (T6.4). */
import { cleanup, render } from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../../src/core/i18n';
import { Plotter } from '../../src/ui/widgets/plotter';
import type { PlotterSeriesInput } from '../../src/ui/widgets/plotter';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function point(t: number, value: number) {
  return { t, min: value, max: value, first: value, last: value, mean: value, count: 1, value };
}

afterEach(() => cleanup());

describe('Plotter component', () => {
  it('mounts without throwing when happy-dom has no 2d canvas context', async () => {
    const series: PlotterSeriesInput[] = [
      { id: 'roll', label: 'ATT.Roll', axisId: 'deg', samples: [point(1, 2)] },
    ];

    expect(() => render(() => createComponent(Plotter, { series }))).not.toThrow();
    await settle();
  });

  it('updates its accessible summary when the selected series changes', async () => {
    const [series, setSeries] = createSignal<readonly PlotterSeriesInput[]>([
      { id: 'roll', label: 'ATT.Roll', axisId: 'deg', samples: [point(1, 2)] },
    ]);
    const { container } = render(() =>
      createComponent(Plotter, {
        get series() {
          return series();
        },
      }),
    );
    await settle();

    const region = container.querySelector('.mvp-plotter');
    expect(region?.getAttribute('aria-label')).toBe(
      t('plotter.summary.series', { count: 1, series: 'ATT.Roll' }),
    );

    setSeries([
      { id: 'roll', label: 'ATT.Roll', axisId: 'deg', samples: [point(1, 2)] },
      { id: 'pitch', label: 'ATT.Pitch', axisId: 'deg', samples: [point(1, 3)] },
    ]);
    await settle();

    expect(region?.getAttribute('aria-label')).toBe(
      t('plotter.summary.series', { count: 2, series: 'ATT.Roll, ATT.Pitch' }),
    );
  });

  it('renders the no-series summary and empty state', async () => {
    const { container } = render(() => createComponent(Plotter, { series: [] }));
    await settle();

    expect(container.querySelector('.mvp-plotter')?.getAttribute('aria-label')).toBe(
      t('plotter.summary.empty'),
    );
    expect(container.querySelector('.mvp-plotter__empty')?.textContent).toBe(t('plotter.empty'));
  });
});
