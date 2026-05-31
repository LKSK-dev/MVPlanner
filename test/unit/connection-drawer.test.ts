import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import type { AppState, ConnState, LinkStats, Store, VehicleState } from '../../src/contracts';
import type { Capabilities } from '../../src/core/capabilities';
import { createAppStore } from '../../src/core/store';
import { t } from '../../src/core/i18n';
import {
  Shell,
  createUiRegistry,
  type ShellContextValue,
  type ShellRegistry,
} from '../../src/ui/shell';
import { ConnectionProvider } from '../../src/ui/shell/connection';
import { normalizeConfigSchema } from '../../src/ui/shell/connection';
import { BUILTIN_TRANSPORT_FACTORIES } from '../../src/transport';
import type { HostTelemetry, MavlinkHostLike } from '../../src/transport/manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function zeroLink(): LinkStats {
  return { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
}

function makeVehicle(sysid: number, overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    sysid,
    compid: 1,
    mavType: 2,
    autopilot: 3,
    vehicleClass: 'copter',
    armed: false,
    mode: 'STABILIZE',
    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
    link: zeroLink(),
    lastHeartbeatMs: 0,
    ...overrides,
  };
}

function makeCaps(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    webSerial: true,
    webBluetooth: false,
    webUsb: false,
    fileSystemAccess: false,
    wasm: true,
    secureContext: true,
    offscreenCanvas: false,
    crossOriginIsolated: false,
    webSpeech: false,
    gamepad: false,
    ...overrides,
  };
}

class MockHost implements MavlinkHostLike {
  readonly connectCalls: Array<{ factoryId: string; config: unknown }> = [];
  disconnectCalls = 0;
  disposeCalls = 0;
  readonly sentMessages: Array<{ name: string; fields: Record<string, unknown> }> = [];
  private readonly stateCbs = new Set<(s: ConnState) => void>();
  private readonly teleCbs = new Set<(t: HostTelemetry) => void>();
  private _stats: LinkStats = zeroLink();

  connect(factoryId: string, config: unknown): Promise<void> {
    this.connectCalls.push({ factoryId, config });
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.emitState({ kind: 'closed' });
    return Promise.resolve();
  }
  sendMessage(name: string, fields: Record<string, unknown>): Promise<void> {
    this.sentMessages.push({ name, fields });
    return Promise.resolve();
  }
  onState(cb: (s: ConnState) => void): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }
  onTelemetry(cb: (t: HostTelemetry) => void): () => void {
    this.teleCbs.add(cb);
    return () => this.teleCbs.delete(cb);
  }
  stats(): LinkStats {
    return this._stats;
  }
  dispose(): Promise<void> {
    this.disposeCalls += 1;
    return Promise.resolve();
  }
  emitState(s: ConnState): void {
    for (const cb of this.stateCbs) cb(s);
  }
  emitTelemetry(tel: HostTelemetry): void {
    for (const cb of this.teleCbs) cb(tel);
  }
  setStats(s: LinkStats): void {
    this._stats = s;
  }
}

interface Harness {
  container: HTMLElement;
  store: Store<AppState>;
  registry: ShellRegistry;
  host: MockHost;
}

function mountApp(host: MockHost, caps: Capabilities = makeCaps()): Harness {
  const store = createAppStore();
  const registry = createUiRegistry();
  const ctx: ShellContextValue = { store, registry, capabilities: caps, panelApi: { store, t } };
  const { container } = render(() =>
    createComponent(ConnectionProvider, {
      store,
      registry,
      host,
      // Lazy getter so <Shell> mounts INSIDE the ConnectionContext.Provider
      // (matching how JSX children resolve in App.tsx), not eagerly outside it.
      get children() {
        return createComponent(Shell, { ctx });
      },
    }),
  );
  return { container, store, registry, host };
}

function openDrawer(container: HTMLElement): void {
  const chip = container.querySelector<HTMLButtonElement>('.mvp-chip--button');
  chip!.click();
}

function fire(target: EventTarget, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true }));
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

// Ensure WebSocket is defined so the websocket transport reports supported.
let priorWebSocket: unknown;
beforeEach(() => {
  priorWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = class {};
});
afterEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = priorWebSocket;
});

// ---------------------------------------------------------------------------
// Schema normalization (pure)
// ---------------------------------------------------------------------------

describe('normalizeConfigSchema', () => {
  it('reads the serial baud-rate select shape', () => {
    const serial = BUILTIN_TRANSPORT_FACTORIES.find((f) => f.id === 'serial')!;
    const fields = normalizeConfigSchema('serial', serial.configSchema);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ kind: 'select', key: 'baudRate' });
  });

  it('reads the websocket url string field', () => {
    const ws = BUILTIN_TRANSPORT_FACTORIES.find((f) => f.id === 'websocket')!;
    const fields = normalizeConfigSchema('websocket', ws.configSchema);
    const url = fields.find((f) => f.key === 'url');
    expect(url).toMatchObject({ kind: 'text', key: 'url', required: true });
  });

  it('reads the replay file + speed fields', () => {
    const replay = BUILTIN_TRANSPORT_FACTORIES.find((f) => f.id === 'replay')!;
    const fields = normalizeConfigSchema('replay', replay.configSchema);
    expect(fields.find((f) => f.key === 'data')).toMatchObject({ kind: 'file' });
    expect(fields.find((f) => f.key === 'speed')).toMatchObject({ kind: 'number' });
  });

  it('returns an empty list for an unrecognized schema', () => {
    expect(normalizeConfigSchema('x', null)).toEqual([]);
    expect(normalizeConfigSchema('x', 42)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Drawer component
// ---------------------------------------------------------------------------

describe('ConnectionDrawer — transport filtering', () => {
  it('marks each transport per factory.isSupported() with a hint when unsupported', async () => {
    const host = new MockHost();
    const { container } = mountApp(host);
    openDrawer(container);
    await settle();

    expect(container.querySelector('[data-testid="connection-drawer"]')).toBeTruthy();

    for (const factory of BUILTIN_TRANSPORT_FACTORIES) {
      const el = container.querySelector<HTMLElement>(`[data-testid="transport-${factory.id}"]`);
      expect(el).toBeTruthy();
      const supported = factory.isSupported();
      expect(el!.getAttribute('data-supported')).toBe(String(supported));
      const radio = el!.querySelector<HTMLInputElement>('input[type="radio"]');
      expect(radio!.disabled).toBe(!supported);
      const hint = el!.querySelector('.mvp-conn__transport-hint');
      if (supported) expect(hint).toBeNull();
      else expect(hint?.textContent).toBe(t('conn.transport.unsupported'));
    }
  });
});

describe('ConnectionDrawer — connect/disconnect', () => {
  it('selecting websocket + Connect calls host.connect with the form config', async () => {
    const host = new MockHost();
    const { container } = mountApp(host);
    openDrawer(container);
    await settle();

    const wsRadio = container.querySelector<HTMLInputElement>('input[value="websocket"]');
    wsRadio!.checked = true;
    fire(wsRadio!, 'change');
    await settle();

    const urlInput = container.querySelector<HTMLInputElement>('#mvp-conn-field-url');
    expect(urlInput).toBeTruthy();
    urlInput!.value = 'ws://localhost:5760';
    fire(urlInput!, 'input');
    await settle();

    const connectBtn = container.querySelector<HTMLButtonElement>('[data-testid="connect-btn"]');
    expect(connectBtn!.disabled).toBe(false);
    connectBtn!.click();
    await settle();
    await settle();

    expect(host.connectCalls).toEqual([
      { factoryId: 'websocket', config: { url: 'ws://localhost:5760' } },
    ]);
  });

  it('reflects ConnState transitions and swaps Connect → Disconnect', async () => {
    const host = new MockHost();
    const { container } = mountApp(host);
    openDrawer(container);
    await settle();

    const stateEl = (): string =>
      container.querySelector('[data-testid="connection-state"]')!.textContent ?? '';
    expect(stateEl()).toBe(t('conn.closed'));
    expect(container.querySelector('[data-testid="connect-btn"]')).toBeTruthy();

    host.emitState({ kind: 'opening' });
    await settle();
    expect(stateEl()).toBe(t('conn.opening'));

    host.emitState({ kind: 'open' });
    await settle();
    expect(stateEl()).toBe(t('conn.open'));
    // Connect is replaced by Disconnect once the link is up.
    expect(container.querySelector('[data-testid="connect-btn"]')).toBeNull();
    const disconnectBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="disconnect-btn"]',
    );
    expect(disconnectBtn).toBeTruthy();

    disconnectBtn!.click();
    await settle();
    expect(host.disconnectCalls).toBe(1);
  });

  it('renders live link diagnostics from telemetry', async () => {
    const host = new MockHost();
    host.setStats({
      bytesIn: 2048,
      bytesOut: 64,
      packetsIn: 42,
      lossPct: 2.5,
      rateHz: 18.5,
      rssi: 170,
      signed: true,
    });
    const { container } = mountApp(host);
    openDrawer(container);
    await settle();

    host.emitTelemetry({ vehicles: [makeVehicle(1)], activeSysid: 1 });
    await settle();

    const diag = (id: string): string =>
      container.querySelector(`[data-testid="${id}"]`)!.textContent ?? '';
    expect(diag('diag-packets')).toContain('42');
    expect(diag('diag-bytes-in')).toContain('2,048');
    expect(diag('diag-signed')).toBe(t('conn.yes'));
    expect(diag('diag-rssi')).toContain('170');
  });
});

describe('ConnectionDrawer — store + top-bar wiring', () => {
  it('pushes detected vehicles into the store and lights the connection chip', async () => {
    const host = new MockHost();
    const { container, store } = mountApp(host);

    // Chip starts disconnected.
    const chip = (): string => container.querySelector('.mvp-chip--button')!.textContent ?? '';
    expect(chip()).toContain(t('conn.closed'));

    host.emitState({ kind: 'open' });
    host.emitTelemetry({ vehicles: [makeVehicle(7)], activeSysid: 7 });
    await settle();

    // Store receives connection + vehicles + active selection.
    expect(store.get().connection).toEqual({ kind: 'open' });
    expect(Object.keys(store.get().vehicles)).toEqual(['7']);
    expect(store.get().activeSysid).toBe(7);
    // Top-bar connection chip reflects the live state.
    expect(chip()).toContain(t('conn.open'));
  });

  it('lets the user select the active vehicle from detected vehicles', async () => {
    const host = new MockHost();
    const { container, store } = mountApp(host);
    openDrawer(container);
    await settle();

    host.emitState({ kind: 'open' });
    host.emitTelemetry({ vehicles: [makeVehicle(1), makeVehicle(2)], activeSysid: 1 });
    await settle();

    const select = container.querySelector<HTMLSelectElement>('[data-testid="active-vehicle"]');
    expect(select).toBeTruthy();
    select!.value = '2';
    fire(select!, 'change');
    await settle();

    expect(store.get().activeSysid).toBe(2);
  });
});

describe('ConnectionProvider — command registration', () => {
  it('registers the Connect / Disconnect command which opens the drawer', async () => {
    const host = new MockHost();
    const { container, registry } = mountApp(host);

    const cmd = registry.commands().find((c) => c.id === 'connection.toggle');
    expect(cmd?.title).toBe(t('cmd.connection'));
    expect(container.querySelector('[data-testid="connection-drawer"]')).toBeNull();

    await cmd!.run();
    await settle();
    expect(container.querySelector('[data-testid="connection-drawer"]')).toBeTruthy();
  });
});
