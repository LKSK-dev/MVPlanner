/**
 * Inspector widget tests (task T1.12; spec plan/04 §4.9, plan/05 §5.5).
 *
 * Renders the {@link Inspector} over a MOCK {@link InspectorSource} (no Worker)
 * and exercises the UI contract: it builds the message tree from snapshots,
 * filters on search, expands fields with dialect enum decoding, shows the hex
 * view for a selected message, and switches the active `(sysid, compid)`.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import type { DialectTable } from '../../src/contracts';
import { t } from '../../src/core/i18n';
import { Inspector } from '../../src/ui/widgets/inspector';
import type {
  InspectorRow,
  InspectorSnapshot,
  InspectorSource,
} from '../../src/ui/widgets/inspector';
import { settle } from '../helpers';

/** A tiny deterministic dialect so enum decoding does not depend on bundles. */
const TEST_DIALECT: DialectTable = {
  name: 'test',
  messages: {
    0: {
      id: 0,
      name: 'HEARTBEAT',
      crcExtra: 50,
      fields: [
        { name: 'type', type: 'uint8_t', enum: 'MAV_TYPE' },
        { name: 'custom_mode', type: 'uint32_t' },
      ],
    },
  },
  enums: {
    MAV_TYPE: [
      { value: 1, name: 'MAV_TYPE_FIXED_WING' },
      { value: 2, name: 'MAV_TYPE_QUADROTOR' },
    ],
  },
};

function makeRow(
  over: Partial<InspectorRow> & Pick<InspectorRow, 'sysid' | 'msgId' | 'name'>,
): InspectorRow {
  return {
    compid: 1,
    rateHz: 1,
    lastSeenMs: 0,
    count: 1,
    fields: {},
    raw: new Uint8Array([0xfd, 0x09, 0x00]),
    crcOk: true,
    signed: false,
    seq: 0,
    rxTimeUs: 0,
    ...over,
  };
}

const SNAPSHOT: InspectorSnapshot = {
  rev: 1,
  rows: [
    makeRow({
      sysid: 1,
      msgId: 0,
      name: 'HEARTBEAT',
      fields: { type: 2, custom_mode: 5 },
      raw: new Uint8Array([0xfd, 0x09, 0x00, 0x11, 0x22]),
    }),
    makeRow({ sysid: 1, msgId: 30, name: 'ATTITUDE', fields: { roll: 0.5 } }),
    makeRow({ sysid: 2, msgId: 1, name: 'SYS_STATUS', fields: { voltage_battery: 12000 } }),
  ],
};

/** A mock source whose captured callback the test drives. */
function makeSource(): {
  source: InspectorSource;
  push(s: InspectorSnapshot): void;
  unsubscribed: () => boolean;
} {
  let cb: ((s: InspectorSnapshot) => void) | undefined;
  let off = false;
  return {
    source: {
      subscribeInspector(callback): () => void {
        cb = callback;
        return () => {
          off = true;
        };
      },
    },
    push(s): void {
      cb?.(s);
    },
    unsubscribed: () => off,
  };
}

function mount(source: InspectorSource): HTMLElement {
  const { container } = render(() =>
    createComponent(Inspector, { source, t, dialects: [TEST_DIALECT], now: () => 0 }),
  );
  return container;
}

afterEach(() => cleanup());

describe('Inspector widget', () => {
  it('renders the message tree for the first system', async () => {
    const mock = makeSource();
    const container = mount(mock.source);
    await settle();
    mock.push(SNAPSHOT);
    await settle();

    const names = [...container.querySelectorAll('.mvp-inspector__msg-name')].map(
      (n) => n.textContent,
    );
    // System 1 is the default selection (sorted by name): ATTITUDE, HEARTBEAT.
    expect(names).toContain('HEARTBEAT');
    expect(names).toContain('ATTITUDE');
    expect(names).not.toContain('SYS_STATUS');
  });

  it('shows the empty state before any traffic', async () => {
    const mock = makeSource();
    const container = mount(mock.source);
    await settle();
    expect(container.querySelector('.mvp-inspector__empty')?.textContent).toBe(
      t('inspector.empty'),
    );
  });

  it('filters the tree on search', async () => {
    const mock = makeSource();
    const container = mount(mock.source);
    await settle();
    mock.push(SNAPSHOT);
    await settle();

    const input = container.querySelector<HTMLInputElement>('.mvp-inspector__search');
    input!.value = 'att';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    const names = [...container.querySelectorAll('.mvp-inspector__msg-name')].map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['ATTITUDE']);
  });

  it('expands fields with dialect enum decoding when a message is selected', async () => {
    const mock = makeSource();
    const container = mount(mock.source);
    await settle();
    mock.push(SNAPSHOT);
    await settle();

    const hbBtn = [...container.querySelectorAll<HTMLButtonElement>('.mvp-inspector__name')].find(
      (b) => b.textContent?.includes('HEARTBEAT'),
    );
    expect(hbBtn).toBeTruthy();
    hbBtn!.click();
    await settle();

    const fields = [...container.querySelectorAll('.mvp-inspector__field-name')].map(
      (n) => n.textContent,
    );
    expect(fields).toContain('type');
    expect(fields).toContain('custom_mode');
    // type=2 → MAV_TYPE_QUADROTOR via the test dialect.
    const enums = [...container.querySelectorAll('.mvp-inspector__field-enum')].map(
      (n) => n.textContent,
    );
    expect(enums.some((e) => e?.includes('MAV_TYPE_QUADROTOR'))).toBe(true);
  });

  it('shows the raw hex view for the selected message', async () => {
    const mock = makeSource();
    const container = mount(mock.source);
    await settle();
    mock.push(SNAPSHOT);
    await settle();

    const hbBtn = [...container.querySelectorAll<HTMLButtonElement>('.mvp-inspector__name')].find(
      (b) => b.textContent?.includes('HEARTBEAT'),
    );
    hbBtn!.click();
    await settle();

    const hex = container.querySelector('.mvp-inspector__hex')?.textContent ?? '';
    expect(hex).toContain('FD');
    expect(hex).toContain('11');
    expect(hex).toContain('22');
    // CRC/signing status surfaced.
    expect(container.querySelector('.mvp-inspector__crc')?.textContent).toBe(t('inspector.crcOk'));
  });

  it('switches the active (sysid, compid)', async () => {
    const mock = makeSource();
    const container = mount(mock.source);
    await settle();
    mock.push(SNAPSHOT);
    await settle();

    const select = container.querySelector<HTMLSelectElement>('.mvp-inspector__select');
    expect(select).toBeTruthy();
    select!.value = '2:1';
    select!.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    const names = [...container.querySelectorAll('.mvp-inspector__msg-name')].map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['SYS_STATUS']);
  });

  it('unsubscribes the source on cleanup', async () => {
    const mock = makeSource();
    mount(mock.source);
    await settle();
    cleanup();
    expect(mock.unsubscribed()).toBe(true);
  });
});
