/**
 * Egress transparency (task T8.12; spec plan/07 §7.7, plan/08 §8.3): the egress
 * log records/lists/clears and notifies subscribers, and the Settings → Network
 * section lists the configured map host, active links, extension `net:` grants
 * and the live egress log, with a working clear-log control + a no-phone-home
 * statement.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createAppStore } from '../../src/core/store';
import {
  NetworkSection,
  createEgressLog,
  type LinkDestination,
  type NetGrantRow,
} from '../../src/ui/screens/config/settings';
import { settle } from '../helpers';

afterEach(cleanup);

describe('createEgressLog', () => {
  it('records newest-first, clears, and notifies subscribers', () => {
    let ticks = 0;
    const log = createEgressLog({ now: () => ++ticks });
    let notified = 0;
    const off = log.subscribe(() => (notified += 1));

    log.record({ extId: 'a', url: 'https://x.test/1', host: 'x.test' });
    log.record({ extId: 'b', url: 'https://y.test/2', host: 'y.test' });
    expect(notified).toBe(2);

    const rows = log.list();
    expect(rows.map((r) => r.host)).toEqual(['y.test', 'x.test']); // newest-first
    expect(rows[0]?.extId).toBe('b');

    log.clear();
    expect(log.list()).toEqual([]);
    expect(notified).toBe(3);

    off();
    log.record({ extId: 'c', url: 'https://z.test', host: 'z.test' });
    expect(notified).toBe(3); // unsubscribed
  });

  it('bounds the ring to `max` entries', () => {
    const log = createEgressLog({ max: 2 });
    log.record({ extId: 'a', url: 'u1', host: 'h1' });
    log.record({ extId: 'b', url: 'u2', host: 'h2' });
    log.record({ extId: 'c', url: 'u3', host: 'h3' });
    expect(log.list().map((r) => r.host)).toEqual(['h3', 'h2']);
  });
});

describe('NetworkSection', () => {
  it('lists destinations and clears the egress log', async () => {
    const store = createAppStore({
      settings: {
        units: 'metric',
        coordinateFormat: 'dd',
        theme: 'dark',
        language: 'en',
        audioAlerts: true,
        confirmDestructive: true,
        mapSource: { urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png' },
      },
    });
    const egress = createEgressLog();
    egress.record({ extId: 'demo-ext', url: 'https://api.example/data', host: 'api.example' });
    const links = (): readonly LinkDestination[] => [
      { kind: 'websocket', label: 'ws://sitl:5760' },
    ];
    const grants = async (): Promise<readonly NetGrantRow[]> => [
      { extId: 'demo-ext', host: 'api.example' },
    ];

    const { getByTestId } = render(() =>
      createComponent(NetworkSection, {
        store,
        deps: { egress, links, netGrants: grants },
        t: (k: string) => k,
      }),
    );
    await settle();

    expect(getByTestId('network-no-phone-home').textContent).toContain('noPhoneHome');
    expect(getByTestId('network-map').textContent).toContain('tiles.example');
    expect(getByTestId('network-links').textContent).toContain('ws://sitl:5760');
    expect(getByTestId('network-grants').textContent).toContain('api.example');
    expect(getByTestId('network-egress').textContent).toContain('api.example');

    fireEvent.click(getByTestId('network-clear-egress'));
    await settle();
    expect(getByTestId('network-egress').querySelector('[data-egress-host]')).toBeNull();
  });
});
