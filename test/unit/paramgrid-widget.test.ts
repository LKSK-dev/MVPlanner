/**
 * Parameter grid component tests (task T3.4; spec plan/04 §4.5).
 *
 * Mounts the controlled {@link ParamGrid} over plain accessors + a one-method
 * {@link ParamMetaResolver} mock and exercises the UI contract: tree grouping,
 * search filtering, the four type-aware editors (float / int / enum / bitmask)
 * each reporting through `onEdit`, and the modified / out-of-range highlights.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createComponent, createSignal, type Accessor, type Setter } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import { ParamGrid } from '../../src/ui/widgets/paramgrid';
import type { Param, ParamMeta, ParamMetaResolver } from '../../src/ui/widgets/paramgrid';
import { MAV_PARAM_TYPE } from '../../src/mavlink/microservices/param';
import { settle } from '../helpers';

const REAL = MAV_PARAM_TYPE.REAL32;
const INT = MAV_PARAM_TYPE.INT32;

function param(name: string, value: number, type = REAL, meta?: ParamMeta): Param {
  return meta ? { name, value, type, meta } : { name, value, type };
}

function resolver(table: Record<string, ParamMeta>): ParamMetaResolver {
  return { get: (name) => table[name] };
}

interface Harness {
  container: HTMLElement;
  edits: Array<{ name: string; value: number }>;
  setParams: Setter<readonly Param[]>;
  setPending: Setter<ReadonlyMap<string, number>>;
}

function mount(
  initial: readonly Param[],
  meta: ParamMetaResolver,
  pending0: ReadonlyMap<string, number> = new Map(),
): Harness {
  const edits: Array<{ name: string; value: number }> = [];
  const [params, setParams] = createSignal<readonly Param[]>(initial);
  const [pending, setPending] = createSignal<ReadonlyMap<string, number>>(pending0);
  const rows: Accessor<readonly Param[]> = params;
  const { container } = render(() =>
    createComponent(ParamGrid, {
      rows,
      pending,
      meta,
      t,
      onEdit: (name, value) => edits.push({ name, value }),
    }),
  );
  return { container, edits, setParams, setPending };
}

function input(container: HTMLElement, name: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(
    `input[aria-label="${t('params.valueFor', { name })}"]`,
  );
  if (!el) throw new Error(`no value input for ${name}`);
  return el;
}

afterEach(() => cleanup());

describe('ParamGrid widget', () => {
  const meta = resolver({
    ATC_RAT_RLL_P: { min: 0, max: 0.35, increment: 0.005, description: 'Roll rate P' },
    BATT_MONITOR: { values: { 0: 'Disabled', 4: 'Analog V+I' } },
    LOG_BITMASK: { bitmask: { 0: 'Fast attitude', 1: 'Medium', 2: 'GPS' } },
  });
  const params = [
    param('ATC_RAT_RLL_P', 0.1),
    param('ATC_RAT_PIT_P', 0.1),
    param('BATT_MONITOR', 0, INT),
    param('LOG_BITMASK', 0b001, INT),
  ];

  it('renders rows and reports a float edit', async () => {
    const h = mount(params, meta);
    await settle();
    const el = input(h.container, 'ATC_RAT_RLL_P');
    el.value = '0.2';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.edits).toContainEqual({ name: 'ATC_RAT_RLL_P', value: 0.2 });
  });

  it('reports an int (spinner) edit rounded to integer', async () => {
    const h = mount([param('WPNAV_SPEED', 500, INT)], resolver({}));
    await settle();
    const el = input(h.container, 'WPNAV_SPEED');
    el.value = '750.4';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.edits).toContainEqual({ name: 'WPNAV_SPEED', value: 750 });
  });

  it('reports an enum dropdown edit as the numeric value', async () => {
    const h = mount(params, meta);
    await settle();
    const select = h.container.querySelector<HTMLSelectElement>(
      `select[aria-label="${t('params.valueFor', { name: 'BATT_MONITOR' })}"]`,
    );
    expect(select).toBeTruthy();
    select!.value = '4';
    select!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.edits).toContainEqual({ name: 'BATT_MONITOR', value: 4 });
  });

  it('reports a bitmask checkbox toggle as the summed value', async () => {
    // LOG_BITMASK starts at 0b001 (bit 0 set); toggling bit 2 on → 0b101 = 5.
    const h = mount(params, meta);
    await settle();
    const boxes = h.container.querySelectorAll<HTMLInputElement>(
      `fieldset[aria-label="${t('params.valueFor', { name: 'LOG_BITMASK' })}"] input[type="checkbox"]`,
    );
    expect(boxes.length).toBe(3);
    const gps = boxes[2]!; // bit 2
    gps.checked = true;
    gps.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.edits).toContainEqual({ name: 'LOG_BITMASK', value: 5 });
  });

  it('filters rows on search (name + description)', async () => {
    const h = mount(params, meta);
    await settle();
    const search = h.container.querySelector<HTMLInputElement>('.mvp-paramgrid__search')!;
    search.value = 'roll rate'; // description of ATC_RAT_RLL_P only
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const names = [...h.container.querySelectorAll('.mvp-paramgrid__pname')].map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['ATC_RAT_RLL_P']);
  });

  it('groups by prefix in tree view', async () => {
    const h = mount(params, meta);
    await settle();
    const treeBtn = [
      ...h.container.querySelectorAll<HTMLButtonElement>('.mvp-paramgrid__viewbtn'),
    ].find((b) => b.textContent === t('params.view.tree'))!;
    treeBtn.click();
    await settle();
    const groups = [...h.container.querySelectorAll('.mvp-paramgrid__group-toggle')].map(
      (n) => n.textContent ?? '',
    );
    // ATC group has 2 members, BATT and LOG one each.
    expect(groups.some((g) => g.includes('ATC') && g.includes('2'))).toBe(true);
    expect(groups.some((g) => g.includes('BATT'))).toBe(true);
    expect(groups.some((g) => g.includes('LOG'))).toBe(true);
  });

  it('highlights modified and out-of-range rows', async () => {
    // pending pushes ATC_RAT_RLL_P to 0.9 — modified AND above max 0.35.
    const h = mount(params, meta, new Map([['ATC_RAT_RLL_P', 0.9]]));
    await settle();
    const row = h.container.querySelector<HTMLElement>('tr[data-name="ATC_RAT_RLL_P"]')!;
    expect(row.classList.contains('is-modified')).toBe(true);
    expect(row.classList.contains('is-oor')).toBe(true);
    // a non-color cue (flag icon) is present too.
    expect(row.querySelector('.mvp-paramgrid__flag--mod')).toBeTruthy();
    expect(row.querySelector('.mvp-paramgrid__flag--oor')).toBeTruthy();
  });

  it('shows the empty state with no params', async () => {
    const h = mount([], resolver({}));
    await settle();
    expect(h.container.querySelector('.mvp-paramgrid__empty')?.textContent).toBe(t('params.empty'));
  });
});
