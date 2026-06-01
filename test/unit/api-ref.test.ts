/** Unit tests for the T7.5 extension API reference parser and view. */
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPABILITY_MAP, type ApiMethodSpec } from '../../src/ext/api';
import {
  ApiReference,
  buildBundledApiReferenceMembers,
  extractApiReferenceMembers,
  formatApiReferencePermission,
  type ApiReferenceMember,
} from '../../src/ui/screens/sim/api-ref';

const t = (key: string): string => {
  const labels: Record<string, string> = {
    'apiref.title': 'Extension API Reference',
    'apiref.description': 'API docs',
    'apiref.search.label': 'Search API members',
    'apiref.search.placeholder': 'Search…',
    'apiref.empty': 'No API members match the filter.',
    'apiref.permission': 'Required permission',
    'apiref.permission.none': 'None',
    'apiref.permission.unlisted': 'Not listed',
    'apiref.copy': 'Copy signature',
    'apiref.copy.done': 'Copied',
    'apiref.group.connection': 'Connection',
    'apiref.group.params': 'Parameters',
    'apiref.group.mavlink': 'MAVLink',
    'apiref.group.net': 'Networking',
    'apiref.group.notify': 'Notifications',
  };
  return labels[key] ?? key;
};

const D_TS = `
export interface ExtContext {
  connection: {
    /** Current link state. */
    state(): ConnState;
  };

  mavlink: {
    /** Send a MAVLink message. */
    send?(name: string, fields: Record<string, unknown>): void;
  };

  /** Present only when the corresponding permission is granted. */
  params?: ParamClient;

  net?: { fetch(url: string, init?: RequestInit): Promise<Response> };
  notify: { info(m: string): void };
}

export interface ParamClient {
  /** Read a parameter from the local cache. */
  get(name: string): Param | undefined;
  set(name: string, value: number): Promise<void>;
}
`;

const CAPABILITIES = [
  { method: 'connection.state', permission: null },
  { method: 'mavlink.send', permission: 'mavlink:send' },
  { method: 'params.get', permission: 'telemetry:read' },
  { method: 'params.set', permission: 'params:write' },
  { method: 'net.fetch', permission: null, net: true },
  { method: 'notify.info', permission: 'notify' },
] satisfies readonly ApiMethodSpec[];

afterEach(() => cleanup());

describe('extractApiReferenceMembers', () => {
  it('extracts signatures, TSDoc and required permissions', () => {
    const members = extractApiReferenceMembers(D_TS, CAPABILITIES);

    expect(members.map((member) => member.path)).toEqual([
      'connection.state',
      'mavlink.send',
      'params.get',
      'params.set',
      'net.fetch',
      'notify.info',
    ]);

    const send = members.find((member) => member.path === 'mavlink.send');
    expect(send?.signature).toBe(
      'ctx.mavlink.send(name: string, fields: Record<string, unknown>): void',
    );
    expect(send?.description).toBe('Send a MAVLink message.');
    expect(send?.permission).toBe('mavlink:send');

    const net = members.find((member) => member.path === 'net.fetch');
    expect(net?.permission).toBe('net:<host>');
    expect(formatApiReferencePermission(net?.permission)).toBe('net:<host>');

    const state = members.find((member) => member.path === 'connection.state');
    expect(state?.description).toBe('Current link state.');
    expect(formatApiReferencePermission(state?.permission)).toBe('None');
  });

  it('covers every method in the bundled capability map', () => {
    const memberPaths = new Set(buildBundledApiReferenceMembers().map((member) => member.path));

    for (const spec of CAPABILITY_MAP) {
      expect(memberPaths.has(spec.method), spec.method).toBe(true);
    }
  });
});

describe('ApiReference', () => {
  it('renders the grouped list and filters by search query', async () => {
    const members: readonly ApiReferenceMember[] = extractApiReferenceMembers(D_TS, CAPABILITIES);
    const { getByLabelText, queryByText } = render(() =>
      createComponent(ApiReference, { members, t }),
    );

    expect(queryByText('ctx.mavlink.send')).not.toBeNull();
    expect(queryByText('ctx.params.set')).not.toBeNull();
    expect(queryByText('Networking')).not.toBeNull();

    fireEvent.input(getByLabelText('Search API members'), { target: { value: 'params.set' } });

    expect(queryByText('ctx.params.set')).not.toBeNull();
    expect(queryByText('ctx.mavlink.send')).toBeNull();
  });
});
