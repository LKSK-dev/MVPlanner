/**
 * Parameter workbench tests (task T3.4; spec plan/04 §4.5).
 *
 * Mounts {@link ParamWorkbench} over a MOCK {@link ParamClient} (returns a param
 * set, records `set()` calls + progress) and a one-method
 * {@link ParamMetaResolver} mock, then exercises the workbench contract: Fetch
 * populates the grid (and drives progress), an edit marks a row modified, Write
 * changed calls `set()` ONLY for the modified param, and the compare drawer
 * computes deltas vs an injected other-set.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import { ParamWorkbench } from '../../src/ui/screens/config/params';
import type { Param, ParamClient } from '../../src/contracts';
import type { ParamMeta, ParamMetaResolver } from '../../src/ui/widgets/paramgrid';
import { MAV_PARAM_TYPE } from '../../src/mavlink/microservices/param';
import { settle } from '../helpers';

const REAL = MAV_PARAM_TYPE.REAL32;
const INT = MAV_PARAM_TYPE.INT32;

function param(name: string, value: number, type = REAL): Param {
  return { name, value, type };
}

function resolver(table: Record<string, ParamMeta>): ParamMetaResolver {
  return { get: (name) => table[name] };
}

/** Mock ParamClient: returns a fixed set, records `set()` calls + progress. */
class MockParamClient implements ParamClient {
  readonly sets: Array<{ name: string; value: number }> = [];
  readonly progress: Array<[number, number]> = [];
  constructor(private readonly data: readonly Param[]) {}

  async fetchAll(onProgress?: (done: number, total: number) => void): Promise<Param[]> {
    const n = this.data.length;
    this.data.forEach((_, i) => {
      this.progress.push([i + 1, n]);
      onProgress?.(i + 1, n);
    });
    return this.data.map((p) => ({ ...p }));
  }
  get(name: string): Param | undefined {
    return this.data.find((p) => p.name === name);
  }
  async set(name: string, value: number): Promise<void> {
    this.sets.push({ name, value });
  }
  onChange(): () => void {
    return () => {};
  }
}

function valueInput(container: HTMLElement, name: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(
    `input[aria-label="${t('params.valueFor', { name })}"]`,
  );
  if (!el) throw new Error(`no value input for ${name}`);
  return el;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const el = [...container.querySelectorAll<HTMLButtonElement>('.mvp-paramwb__btn')].find(
    (b) => b.textContent === label,
  );
  if (!el) throw new Error(`no button "${label}"`);
  return el;
}

afterEach(() => cleanup());

describe('ParamWorkbench', () => {
  const meta = resolver({ ATC_RAT_RLL_P: { min: 0, max: 0.35, increment: 0.005 } });
  const data = [param('ATC_RAT_RLL_P', 0.1), param('WPNAV_SPEED', 500, INT)];

  function mount(
    client: ParamClient,
    extra: Partial<{
      onSave: (p: Param[]) => void;
      onLoad: () => Promise<readonly Param[] | Record<string, number>>;
    }> = {},
  ): HTMLElement {
    const { container } = render(() =>
      createComponent(ParamWorkbench, { client, meta, t, ...extra }),
    );
    return container;
  }

  it('fetches into the grid and drives progress', async () => {
    const client = new MockParamClient(data);
    const container = mount(client);
    await settle();
    button(container, t('params.fetch')).click();
    await settle();
    await settle();

    expect(client.progress.length).toBe(2);
    expect(client.progress.at(-1)).toEqual([2, 2]);
    const names = [...container.querySelectorAll('.mvp-paramgrid__pname')].map(
      (n) => n.textContent,
    );
    expect(names).toContain('ATC_RAT_RLL_P');
    expect(names).toContain('WPNAV_SPEED');
  });

  it('edit marks modified and Write changed calls set() only for the modified param', async () => {
    const client = new MockParamClient(data);
    const container = mount(client);
    await settle();
    button(container, t('params.fetch')).click();
    await settle();
    await settle();

    const el = valueInput(container, 'ATC_RAT_RLL_P');
    el.value = '0.2';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    // row is now modified.
    const row = container.querySelector<HTMLElement>('tr[data-name="ATC_RAT_RLL_P"]')!;
    expect(row.classList.contains('is-modified')).toBe(true);

    button(container, t('params.writeChanged')).click();
    await settle();
    await settle();

    expect(client.sets).toEqual([{ name: 'ATC_RAT_RLL_P', value: 0.2 }]);
  });

  it('Write all writes every parameter', async () => {
    const client = new MockParamClient(data);
    const container = mount(client);
    await settle();
    button(container, t('params.fetch')).click();
    await settle();
    await settle();

    button(container, t('params.writeAll')).click();
    await settle();
    await settle();

    expect(client.sets.map((s) => s.name).sort()).toEqual(['ATC_RAT_RLL_P', 'WPNAV_SPEED']);
  });

  it('compare drawer computes deltas vs an injected other-set', async () => {
    const client = new MockParamClient(data);
    const other: Record<string, number> = { ATC_RAT_RLL_P: 0.5, WPNAV_SPEED: 500 };
    const container = mount(client, { onLoad: () => Promise.resolve(other) });
    await settle();
    button(container, t('params.fetch')).click();
    await settle();
    await settle();

    button(container, t('params.compare')).click();
    await settle();
    await settle();

    const drawer = container.querySelector('.mvp-paramwb__diff');
    expect(drawer).toBeTruthy();
    const rows = [...container.querySelectorAll('.mvp-paramwb__diff-table tbody tr')];
    // Only ATC differs (0.1 vs 0.5); WPNAV equal → omitted.
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.getAttribute('data-name')).toBe('ATC_RAT_RLL_P');
    const cells = [...r.querySelectorAll('td')].map((c) => c.textContent);
    // current, other, delta
    expect(cells[0]).toBe('0.1');
    expect(cells[1]).toBe('0.5');
    expect(cells[2]).toBe('-0.4');
  });
});
