/**
 * M8 feature-wiring integration tests (T8.5 forwarding, T8.6 joystick gating,
 * T8.7 voice alerts, T8.9 antenna tracker). These cover the GLUE added when the
 * built+unit-tested M8 modules were mounted into the app — not the modules'
 * internals (which have their own suites).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent, createRoot } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type {
  AppState,
  DecodedMessage,
  LinkStats,
  Store,
  Transport,
  TransportFactory,
  VehicleState,
} from '../../src/contracts';
import { createAppStore } from '../../src/core/store';
import { createUiRegistry } from '../../src/ui/shell';
import { createAudioAlertService } from '../../src/core/audio';
import { wireAudioAlerts } from '../../src/ui/screens/flight';
import { wireTracker } from '../../src/ui/screens/setup';
import {
  GatedManualControlService,
  transportSuitability,
  wireManualControl,
  type ManualGate,
} from '../../src/ui/shell/connection/manual-wiring';
import {
  ForwardControl,
  createForwardController,
} from '../../src/ui/shell/connection/forward-control';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => cleanup());

function makeVehicle(over: Partial<VehicleState> = {}): VehicleState {
  return {
    sysid: 1,
    compid: 1,
    mavType: 2,
    autopilot: 3,
    vehicleClass: 'copter',
    armed: false,
    mode: 'STABILIZE',
    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
    link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false },
    lastHeartbeatMs: 0,
    ...over,
  };
}

function zeroLink(): LinkStats {
  return { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
}

// ---------------------------------------------------------------------------
// T8.7 — voice/audio alerts wiring
// ---------------------------------------------------------------------------

describe('wireAudioAlerts (T8.7)', () => {
  it('speaks on an active-vehicle mode change and respects the audio toggle', async () => {
    const speak = vi.fn<(text: string, opts: { volume: number }) => void>();
    const tone = vi.fn();
    const service = createAudioAlertService({ speak, tone, now: () => 1000 });

    await createRoot(async (dispose) => {
      const store: Store<AppState> = createAppStore();
      wireAudioAlerts({ service, host: { onMessage: () => () => undefined }, store });

      store.patch((s) => {
        s.vehicles[1] = makeVehicle({ mode: 'STABILIZE' });
        s.activeSysid = 1;
      });
      await settle();
      expect(speak).not.toHaveBeenCalled();

      store.patch((s) => {
        s.vehicles[1] = makeVehicle({ mode: 'AUTO' });
      });
      await settle();
      expect(speak).toHaveBeenCalledTimes(1);

      // Mute via the app-wide toggle: a further transition is suppressed.
      speak.mockClear();
      store.patch((s) => {
        s.settings.audioAlerts = false;
      });
      store.patch((s) => {
        s.vehicles[1] = makeVehicle({ mode: 'LOITER' });
      });
      await settle();
      expect(speak).not.toHaveBeenCalled();

      dispose();
    });
  });

  it('feeds STATUSTEXT events to the service', async () => {
    const speak = vi.fn();
    const service = createAudioAlertService({ speak, tone: vi.fn(), now: () => 5000 });
    const spy = vi.spyOn(service, 'processStatusText');
    let statusCb: ((msg: DecodedMessage) => void) | undefined;

    await createRoot(async (dispose) => {
      const store: Store<AppState> = createAppStore();
      wireAudioAlerts({
        service,
        host: {
          onMessage: (_names, cb) => {
            statusCb = cb;
            return () => undefined;
          },
        },
        store,
      });

      statusCb?.({
        name: 'STATUSTEXT',
        msgId: 253,
        sysid: 1,
        compid: 1,
        seq: 0,
        crcOk: true,
        signed: false,
        rxTimeUs: 0,
        raw: new Uint8Array(0),
        fields: { severity: 2, text: 'Failsafe: battery' },
      });
      await settle();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 2, text: 'Failsafe: battery' }),
        undefined,
      );
      dispose();
    });
  });
});

// ---------------------------------------------------------------------------
// T8.6 — joystick transport gating
// ---------------------------------------------------------------------------

describe('joystick transport gating (T8.6)', () => {
  it('classifies transports by suitability', () => {
    expect(transportSuitability('serial')).toBe('ok');
    expect(transportSuitability('bluetooth')).toBe('ok');
    expect(transportSuitability('websocket')).toBe('warn');
    expect(transportSuitability('webrtc')).toBe('warn');
    expect(transportSuitability('replay')).toBe('blocked');
    expect(transportSuitability(undefined)).toBe('blocked');
  });

  it('refuses to start on a blocked link and warns on a high-latency link', () => {
    const onBlocked = vi.fn();
    const onWarn = vi.fn();
    let suitability: ReturnType<ManualGate['suitability']> = 'blocked';
    const gate: ManualGate = { suitability: () => suitability, onBlocked, onWarn };
    const service = new GatedManualControlService({ send: vi.fn() }, gate);

    service.start();
    expect(service.isActive()).toBe(false);
    expect(onBlocked).toHaveBeenCalledTimes(1);

    suitability = 'warn';
    service.start();
    expect(service.isActive()).toBe(true);
    expect(onWarn).toHaveBeenCalledTimes(1);
    service.stop();

    onWarn.mockClear();
    suitability = 'ok';
    service.start();
    expect(service.isActive()).toBe(true);
    expect(onWarn).not.toHaveBeenCalled();
    service.dispose();
  });

  it('registers a dockable panel + ⌘K command and gates enabling by transport', () => {
    const registry = createUiRegistry();
    const store = createAppStore();
    const toast = vi.fn();
    let factoryId: string | undefined = 'replay';

    const off = wireManualControl({
      host: { sendMessage: vi.fn() },
      store,
      registry,
      getFactoryId: () => factoryId,
      t,
      gamepad: () => undefined,
      toast,
    });

    expect(registry.panels().some((p) => p.id === 'widget.joystick')).toBe(true);
    const cmd = registry.commands().find((c) => c.id === 'joystick.open');
    expect(cmd).toBeDefined();

    // Pop the joystick out via the command; the widget mounts.
    void cmd!.run();
    const win = document.querySelector('.mvp-floating-panel--joystick');
    expect(win?.querySelector('.mvp-joystick')).toBeTruthy();

    // Enable on a blocked (replay) link: the widget toggle does not activate.
    const toggle = win!.querySelector('.mvp-joystick__toggle') as HTMLButtonElement;
    toggle.click();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(win!.querySelector('.mvp-joystick__status--active')).toBeNull();

    // A suitable link lets it activate.
    factoryId = 'serial';
    toggle.click();
    expect(win!.querySelector('.mvp-joystick__status--active')).toBeTruthy();

    off();
    expect(registry.panels().some((p) => p.id === 'widget.joystick')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T8.9 — antenna tracker reachability
// ---------------------------------------------------------------------------

describe('wireTracker (T8.9)', () => {
  it('registers a dockable panel + ⌘K command that pops out the tracker panel', () => {
    const registry = createUiRegistry();
    const off = wireTracker({
      host: { sendMessage: vi.fn(), onMessage: () => () => undefined },
      getActiveVehicle: () => undefined,
      registry,
      t,
    });

    expect(registry.panels().some((p) => p.id === 'widget.tracker')).toBe(true);
    const cmd = registry.commands().find((c) => c.id === 'tracker.open');
    expect(cmd).toBeDefined();

    cmd!.run();
    const win = document.querySelector('.mvp-floating-panel--tracker');
    expect(win?.querySelector('.mvp-tracker')).toBeTruthy();

    off();
    expect(document.querySelector('.mvp-floating-panel--tracker')).toBeNull();
    expect(registry.panels().some((p) => p.id === 'widget.tracker')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T8.5 — MAVLink forwarding
// ---------------------------------------------------------------------------

function fakeTransport(written: Uint8Array[]): Transport {
  return {
    id: 'fake-target',
    capabilities: { duplex: true, reconnect: false },
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    readable: new ReadableStream<Uint8Array>(),
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        written.push(chunk);
      },
    }),
    onState: () => () => undefined,
    stats: zeroLink,
  };
}

function fakeFactory(transport: Transport): TransportFactory {
  return {
    id: 'fake-target',
    label: 'Fake',
    isSupported: () => true,
    configSchema: {},
    create: () => transport,
  };
}

describe('createForwardController (T8.5)', () => {
  it('rebroadcasts the host raw frames to the secondary transport', async () => {
    const written: Uint8Array[] = [];
    const target = fakeTransport(written);
    let rawCb: ((frame: { raw: Uint8Array }) => void) | undefined;
    const host = {
      onRawFrame(cb: (frame: { raw: Uint8Array }) => void): () => void {
        rawCb = cb;
        return () => {
          rawCb = undefined;
        };
      },
    };

    const controller = createForwardController({ host, factories: [fakeFactory(target)] });
    expect(controller.isForwarding()).toBe(false);

    await controller.start('fake-target', {});
    expect(controller.isForwarding()).toBe(true);
    expect(controller.targetId()).toBe('fake-target');

    rawCb?.({ raw: new Uint8Array([1, 2, 3]) });
    await new Promise((r) => setTimeout(r, 20));

    expect(written.length).toBeGreaterThan(0);
    expect(Array.from(written[0] ?? [])).toEqual([1, 2, 3]);
    expect(controller.stats()?.running).toBe(true);

    await controller.stop();
    expect(controller.isForwarding()).toBe(false);
  });
});

describe('ForwardControl (T8.5)', () => {
  it('renders a target picker + start button and starts forwarding', async () => {
    const controller = {
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
      isForwarding: () => false,
      targetId: () => undefined,
      stats: () => undefined,
      dispose: vi.fn(),
    };
    const factories: TransportFactory[] = [fakeFactory(fakeTransport([]))];

    const { container } = render(() => createComponent(ForwardControl, { controller, factories }));
    expect(container.querySelector('[data-testid="forward-control"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="forward-target"]')).toBeTruthy();

    (container.querySelector('[data-testid="forward-start"]') as HTMLButtonElement).click();
    await settle();
    expect(controller.start).toHaveBeenCalledWith('fake-target', expect.any(Object));
  });
});
