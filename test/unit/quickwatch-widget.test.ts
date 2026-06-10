/**
 * Quick-watch widget tests (task T2.9; spec plan/04 §4.2 "Quick" tab + mini-plot).
 *
 * Renders {@link QuickWatch} over a MOCK {@link QuickWatchSource} (no Worker) and
 * exercises the UI contract: it lists watchable numeric fields, adds a watch
 * (chip appears with the live value), updates the value + sparkline live on new
 * data, and removes a watch. The sparkline polyline reflects the sampled values.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import { QuickWatch } from '../../src/ui/widgets/quickwatch';
import type { QuickWatchField, QuickWatchSource } from '../../src/ui/widgets/quickwatch';
import { settle } from '../helpers';

/** A mock source whose values + notifications the test drives. */
function makeSource(fields: QuickWatchField[]): {
  source: QuickWatchSource;
  set(path: string, value: number): void;
  tick(): void;
  unsubscribed(): boolean;
} {
  const values = new Map<string, number>();
  let cbs: Array<() => void> = [];
  let off = false;
  return {
    source: {
      listFields: () => fields,
      sample: (msg, field) => values.get(`${msg}.${field}`),
      subscribe(cb): () => void {
        cbs.push(cb);
        return () => {
          off = true;
          cbs = cbs.filter((c) => c !== cb);
        };
      },
    },
    set(path, value): void {
      values.set(path, value);
    },
    tick(): void {
      for (const cb of cbs) cb();
    },
    unsubscribed: () => off,
  };
}

const FIELDS: QuickWatchField[] = [
  { msg: 'VFR_HUD', field: 'airspeed' },
  { msg: 'SYS_STATUS', field: 'voltage_battery' },
];

function mount(
  source: QuickWatchSource,
  extra: Partial<Parameters<typeof QuickWatch>[0]> = {},
): HTMLElement {
  const { container } = render(() => createComponent(QuickWatch, { source, t, ...extra }));
  return container;
}

const chipPaths = (c: HTMLElement): (string | null)[] =>
  [...c.querySelectorAll('.mvp-quickwatch__path')].map((n) => n.textContent);

afterEach(() => cleanup());

describe('QuickWatch widget', () => {
  it('shows the empty state and lists watchable fields', async () => {
    const mock = makeSource(FIELDS);
    const c = mount(mock.source);
    await settle();

    expect(c.querySelector('.mvp-quickwatch__empty')?.textContent).toBe(t('quickwatch.empty'));
    const options = [...c.querySelectorAll('.mvp-quickwatch__add')].map((b) => b.textContent);
    expect(options).toEqual(['VFR_HUD.airspeed', 'SYS_STATUS.voltage_battery']);
  });

  it('adds a watch → a chip appears with the live value', async () => {
    const mock = makeSource(FIELDS);
    mock.set('VFR_HUD.airspeed', 12);
    const changes: ReadonlyArray<QuickWatchField>[] = [];
    const c = mount(mock.source, { onChange: (w) => changes.push(w) });
    await settle();

    const addBtn = [...c.querySelectorAll<HTMLButtonElement>('.mvp-quickwatch__add')].find((b) =>
      b.textContent?.includes('VFR_HUD.airspeed'),
    );
    addBtn!.click();
    await settle();

    expect(chipPaths(c)).toEqual(['VFR_HUD.airspeed']);
    expect(c.querySelector('.mvp-quickwatch__value')?.textContent).toBe('12');
    expect(changes.at(-1)).toEqual([{ msg: 'VFR_HUD', field: 'airspeed' }]);
    // The added field leaves the picker.
    const options = [...c.querySelectorAll('.mvp-quickwatch__add')].map((b) => b.textContent);
    expect(options).toEqual(['SYS_STATUS.voltage_battery']);
  });

  it('updates the value and sparkline live on new data', async () => {
    const mock = makeSource(FIELDS);
    mock.set('VFR_HUD.airspeed', 10);
    const c = mount(mock.source, { watches: [{ msg: 'VFR_HUD', field: 'airspeed' }] });
    await settle();

    expect(c.querySelector('.mvp-quickwatch__value')?.textContent).toBe('10');
    const firstPoints = c.querySelector('.mvp-quickwatch__spark-line')?.getAttribute('points');

    mock.set('VFR_HUD.airspeed', 25);
    mock.tick();
    await settle();
    mock.set('VFR_HUD.airspeed', 40);
    mock.tick();
    await settle();

    expect(c.querySelector('.mvp-quickwatch__value')?.textContent).toBe('40');
    const polyline = c.querySelector('.mvp-quickwatch__spark-line');
    expect(polyline).toBeTruthy();
    const points = polyline!.getAttribute('points') ?? '';
    // Three samples now → three coordinate pairs, and the path changed.
    expect(points.trim().split(/\s+/).length).toBe(3);
    expect(points).not.toBe(firstPoints);
    // a11y: the chip text label carries the field + current value.
    expect(c.querySelector('.mvp-quickwatch__chip')?.getAttribute('aria-label')).toBe(
      t('quickwatch.chip', { path: 'VFR_HUD.airspeed', value: '40' }),
    );
  });

  it('removes a watch → the chip disappears and onChange fires', async () => {
    const mock = makeSource(FIELDS);
    mock.set('VFR_HUD.airspeed', 5);
    const changes: ReadonlyArray<QuickWatchField>[] = [];
    const c = mount(mock.source, {
      watches: [{ msg: 'VFR_HUD', field: 'airspeed' }],
      onChange: (w) => changes.push(w),
    });
    await settle();
    expect(chipPaths(c)).toEqual(['VFR_HUD.airspeed']);

    c.querySelector<HTMLButtonElement>('.mvp-quickwatch__remove')!.click();
    await settle();

    expect(chipPaths(c)).toEqual([]);
    expect(c.querySelector('.mvp-quickwatch__empty')).toBeTruthy();
    expect(changes.at(-1)).toEqual([]);
    // The field returns to the picker.
    const options = [...c.querySelectorAll('.mvp-quickwatch__add')].map((b) => b.textContent);
    expect(options).toContain('VFR_HUD.airspeed');
  });

  it('filters the picker on search', async () => {
    const mock = makeSource(FIELDS);
    const c = mount(mock.source);
    await settle();

    const input = c.querySelector<HTMLInputElement>('.mvp-quickwatch__search');
    input!.value = 'volt';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    const options = [...c.querySelectorAll('.mvp-quickwatch__add')].map((b) => b.textContent);
    expect(options).toEqual(['SYS_STATUS.voltage_battery']);
  });

  it('shows the no-fields picker state when nothing is observed', async () => {
    const mock = makeSource([]);
    const c = mount(mock.source);
    await settle();
    expect(c.querySelector('.mvp-quickwatch__picker-empty')?.textContent).toBe(
      t('quickwatch.noFields'),
    );
  });

  it('unsubscribes the source on cleanup', async () => {
    const mock = makeSource(FIELDS);
    mount(mock.source);
    await settle();
    cleanup();
    expect(mock.unsubscribed()).toBe(true);
  });
});
