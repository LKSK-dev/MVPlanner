/**
 * HUD widget tests (task T2.1; spec plan/04 §4.2, plan/05 §5.8).
 *
 * Mounts {@link Hud} over a reactive `vehicle` signal accessor and asserts the
 * accessibility text equivalent renders and updates without throwing. happy-dom
 * returns a `null` 2d context, so pixel output is intentionally NOT asserted
 * here (that is the canvas-deferred path — covered by the live perf/e2e rig);
 * the point is that the component mounts, reacts, and exposes the SR summary.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import type { VehicleState } from '../../src/contracts';
import { Hud } from '../../src/ui/widgets/hud';
import { settle } from '../helpers';

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
    position: { lat: 0, lon: 0, altRelM: 0, altAmslM: 100 },
    velocity: { groundMs: 0, climbMs: 0 },
    battery: { voltageV: 12.6, remainingPct: 95 },
    gps: { fix: 3, sats: 10, hdop: 1 },
    ekfOk: true,
    link: { rateHz: 0, lossPct: 0, bytesIn: 0, bytesOut: 0, packetsIn: 0, signed: false },
    lastHeartbeatMs: 0,
    ...over,
  };
}

afterEach(() => cleanup());

describe('Hud widget', () => {
  it('renders the no-vehicle a11y summary when nothing is bound', async () => {
    const { container } = render(() =>
      createComponent(Hud, { vehicle: () => undefined, now: () => 0 }),
    );
    await settle();
    const a11y = container.querySelector('.mvp-hud__a11y');
    expect(a11y?.getAttribute('aria-live')).toBe('polite');
    expect(a11y?.textContent).toBe('No vehicle data');
  });

  it('exposes the canvas as an image with a labelled summary', async () => {
    const [vehicle] = createSignal<VehicleState | undefined>(makeVehicle({ mode: 'AUTO' }));
    const { container } = render(() => createComponent(Hud, { vehicle, now: () => 0 }));
    await settle();
    const canvas = container.querySelector('.mvp-hud__canvas');
    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toContain('Mode AUTO');
    expect(container.querySelector('.mvp-hud__a11y')?.textContent).toContain('Mode AUTO');
  });

  it('updates the a11y summary when the reactive vehicle changes', async () => {
    const [vehicle, setVehicle] = createSignal<VehicleState | undefined>(
      makeVehicle({ armed: false, mode: 'LOITER' }),
    );
    const { container } = render(() => createComponent(Hud, { vehicle, now: () => 0 }));
    await settle();
    const a11y = (): string => container.querySelector('.mvp-hud__a11y')?.textContent ?? '';
    expect(a11y()).toContain('Mode LOITER');
    expect(a11y()).toContain('DISARMED');

    setVehicle(
      makeVehicle({
        armed: true,
        mode: 'AUTO',
        position: { lat: 0, lon: 0, altRelM: 25, altAmslM: 125 },
      }),
    );
    await settle();
    expect(a11y()).toContain('Mode AUTO');
    expect(a11y()).toContain('ARMED');
    expect(a11y()).toContain('altitude 25.0 m');
  });

  it('mounts and unmounts cleanly without throwing', async () => {
    const [vehicle] = createSignal<VehicleState | undefined>(makeVehicle());
    expect(() => {
      render(() => createComponent(Hud, { vehicle, statusText: () => 'Hello', now: () => 0 }));
    }).not.toThrow();
    await settle();
    expect(() => cleanup()).not.toThrow();
  });
});
