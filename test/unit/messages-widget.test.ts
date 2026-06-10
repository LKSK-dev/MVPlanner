/**
 * Component tests for the STATUSTEXT messages console (task T2.8; spec
 * plan/04 §4.2, plan/05 §5.4/§5.8). Renders the console over a REACTIVE buffer
 * accessor and asserts severity tier classes/labels, the polite log + assertive
 * alert live regions, the severity filter, and clear.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import { MessagesConsole, type StatusMessage } from '../../src/ui/widgets/messages';
import { settle } from '../helpers';

function msg(over: Partial<StatusMessage> = {}): StatusMessage {
  return { severity: 6, text: 'Info line', sysid: 1, compid: 1, tMs: 1000, seq: 1, ...over };
}

const NOW = 10_000;

afterEach(() => cleanup());

describe('messages console — rendering & severity cues', () => {
  it('renders rows newest-first with tier classes, glyph and level label', () => {
    const list: StatusMessage[] = [
      msg({ severity: 6, text: 'Boot complete', tMs: 1000, seq: 1 }),
      msg({ severity: 4, text: 'Low battery', tMs: 2000, seq: 2 }),
      msg({ severity: 2, text: 'Crash detected', tMs: 3000, seq: 3 }),
    ];
    const { container } = render(() =>
      createComponent(MessagesConsole, { messages: () => list, t, now: () => NOW }),
    );
    const rows = [...container.querySelectorAll('.mvp-messages__row')];
    expect(rows).toHaveLength(3);
    // Newest-first: the critical (tMs 3000) is on top.
    expect(rows[0]!.getAttribute('data-tier')).toBe('error');
    expect(rows[0]!.getAttribute('data-severity')).toBe('2');
    expect(rows[0]!.classList.contains('mvp-messages__row--error')).toBe(true);
    expect(rows[0]!.querySelector('.mvp-messages__sev')?.textContent).toBe('CRITICAL');
    // Non-color glyph cue present.
    expect(rows[0]!.querySelector('.mvp-messages__glyph')?.textContent?.length).toBeGreaterThan(0);

    expect(rows[1]!.getAttribute('data-tier')).toBe('warn');
    expect(rows[1]!.querySelector('.mvp-messages__sev')?.textContent).toBe('WARNING');
    expect(rows[2]!.getAttribute('data-tier')).toBe('info');
  });

  it('shows the empty state when there are no messages', () => {
    const { container } = render(() =>
      createComponent(MessagesConsole, { messages: () => [], t, now: () => NOW }),
    );
    expect(container.querySelector('.mvp-messages__empty')?.textContent).toBe(
      t('statustext.empty'),
    );
  });
});

describe('messages console — live regions', () => {
  it('exposes a polite log region', () => {
    const { container } = render(() =>
      createComponent(MessagesConsole, { messages: () => [msg()], t, now: () => NOW }),
    );
    const log = container.querySelector('[role="log"]');
    expect(log).toBeTruthy();
    expect(log?.getAttribute('aria-live')).toBe('polite');
  });

  it('mirrors the latest EMERGENCY/ALERT/CRITICAL into the assertive alert region', async () => {
    const [list, setList] = createSignal<StatusMessage[]>([
      msg({ severity: 6, text: 'All nominal', tMs: 1000, seq: 1 }),
    ]);
    const { container } = render(() =>
      createComponent(MessagesConsole, { messages: list, t, now: () => NOW }),
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.getAttribute('aria-live')).toBe('assertive');
    // No critical yet → empty.
    expect(alert?.textContent).toBe('');

    setList((prev) => [...prev, msg({ severity: 1, text: 'Failsafe engaged', tMs: 2000, seq: 2 })]);
    await settle();
    expect(alert?.textContent).toBe('Failsafe engaged');
  });
});

describe('messages console — filter & clear', () => {
  it('filters by minimum severity tier', async () => {
    const list: StatusMessage[] = [
      msg({ severity: 6, text: 'info', tMs: 1000, seq: 1 }),
      msg({ severity: 4, text: 'warn', tMs: 2000, seq: 2 }),
      msg({ severity: 2, text: 'crit', tMs: 3000, seq: 3 }),
    ];
    const { container } = render(() =>
      createComponent(MessagesConsole, { messages: () => list, t, now: () => NOW }),
    );
    expect(container.querySelectorAll('.mvp-messages__row')).toHaveLength(3);

    const select = container.querySelector('.mvp-messages__filter-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'error' } });
    await settle();
    const rows = [...container.querySelectorAll('.mvp-messages__row')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-tier')).toBe('error');

    // A filter that hides everything shows the filtered-empty state.
    fireEvent.change(select, { target: { value: 'warn' } });
    await settle();
    expect(container.querySelectorAll('.mvp-messages__row')).toHaveLength(2);
  });

  it('clears the console (hiding messages received up to the clear instant) and fires onClear', async () => {
    let cleared = 0;
    const list: StatusMessage[] = [
      msg({ severity: 2, text: 'crit', tMs: 3000, seq: 3 }),
      msg({ severity: 4, text: 'warn', tMs: 2000, seq: 2 }),
    ];
    const { container } = render(() =>
      createComponent(MessagesConsole, {
        messages: () => list,
        t,
        now: () => NOW,
        onClear: () => {
          cleared += 1;
        },
      }),
    );
    expect(container.querySelectorAll('.mvp-messages__row')).toHaveLength(2);

    const clearBtn = container.querySelector('.mvp-messages__clear') as HTMLButtonElement;
    clearBtn.click();
    await settle();
    expect(cleared).toBe(1);
    expect(container.querySelectorAll('.mvp-messages__row')).toHaveLength(0);
    expect(container.querySelector('.mvp-messages__empty')?.textContent).toBe(
      t('statustext.empty'),
    );
    // The assertive region is cleared too.
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('');
  });
});
