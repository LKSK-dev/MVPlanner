/**
 * Component tests for the gauges widget (task T2.2; spec plan/04 §4.2,
 * plan/05 §5.5/§5.8). Renders gauges/cards/panel over REACTIVE accessors and
 * asserts the accessible text output, reactive updates, configurable selection,
 * and that the canvas dials render safely under happy-dom's stub 2D context.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type { VehicleState } from '../../src/contracts';
import {
  AttitudeGauge,
  BatteryGauge,
  GpsGauge,
  InstrumentPanel,
  LinkGauge,
  RcGauge,
  metricUnits,
  type RcState,
} from '../../src/ui/widgets/gauges';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function vehicle(over: Partial<VehicleState> = {}): VehicleState {
  return {
    sysid: 1,
    compid: 1,
    mavType: 2,
    autopilot: 3,
    vehicleClass: 'copter',
    armed: false,
    mode: 'STABILIZE',
    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
    link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 4, signed: false },
    lastHeartbeatMs: 0,
    ...over,
  };
}

afterEach(() => cleanup());

describe('value-card gauges', () => {
  it('renders battery readings with a title and units', () => {
    const { container } = render(() =>
      createComponent(BatteryGauge, {
        vehicle: () => vehicle({ battery: { voltageV: 12.3, currentA: 5, remainingPct: 80 } }),
        t,
        units: metricUnits,
      }),
    );
    expect(container.querySelector('.mvp-gauge__title')?.textContent).toBe('Battery');
    const nums = [...container.querySelectorAll('.mvp-gauge__reading-number')].map(
      (n) => n.textContent,
    );
    expect(nums).toContain('12.3');
    expect(nums).toContain('80');
    expect(container.querySelector('[aria-label="Battery"]')).toBeTruthy();
  });

  it('updates reactively and reflects status as a data attribute (not color-only)', async () => {
    const [veh, setVeh] = createSignal<VehicleState | undefined>(
      vehicle({ battery: { voltageV: 12, remainingPct: 80 } }),
    );
    const { container } = render(() =>
      createComponent(BatteryGauge, { vehicle: veh, t, units: metricUnits }),
    );
    const remaining = (): Element | null =>
      [...container.querySelectorAll('.mvp-gauge__reading')].find((d) =>
        d.querySelector('.mvp-gauge__reading-label')?.textContent?.includes('Remaining'),
      ) ?? null;
    expect(remaining()?.getAttribute('data-status')).toBe('ok');

    setVeh(vehicle({ battery: { voltageV: 11, remainingPct: 8 } }));
    await settle();
    expect(remaining()?.getAttribute('data-status')).toBe('error');
    expect(remaining()?.querySelector('.mvp-gauge__reading-number')?.textContent).toBe('8');
  });

  it('shows the GPS no-fix empty state with a textual value', () => {
    const { container } = render(() =>
      createComponent(GpsGauge, { vehicle: () => vehicle(), t, units: metricUnits }),
    );
    // No gps sub-object → the none placeholder, never a blank cell.
    const nums = [...container.querySelectorAll('.mvp-gauge__reading-number')].map(
      (n) => n.textContent,
    );
    expect(nums.every((v) => (v?.length ?? 0) > 0)).toBe(true);
  });

  it('link gauge falls back to the vehicle embedded link stats', () => {
    const { container } = render(() =>
      createComponent(LinkGauge, { vehicle: () => vehicle(), t, units: metricUnits }),
    );
    const nums = [...container.querySelectorAll('.mvp-gauge__reading-number')].map(
      (n) => n.textContent,
    );
    expect(nums).toContain('4.0'); // rateHz from vehicle.link
  });

  it('rc gauge renders its empty state when no RC source is present', () => {
    const { container } = render(() =>
      createComponent(RcGauge, { vehicle: () => vehicle(), t, units: metricUnits }),
    );
    expect(container.textContent).toContain(t('gauges.rc.none'));

    cleanup();
    const rc = (): RcState => ({ inputs: [1500, 1600], outputs: [1000] });
    const second = render(() =>
      createComponent(RcGauge, { vehicle: () => vehicle(), rc, t, units: metricUnits }),
    );
    const labels = [...second.container.querySelectorAll('.mvp-gauge__reading-label')].map(
      (n) => n.textContent,
    );
    expect(labels).toContain('In 1');
    expect(labels).toContain('Out 1');
  });
});

describe('canvas gauge', () => {
  it('renders an accessible label + live text readout without a real 2D context', async () => {
    const [veh, setVeh] = createSignal<VehicleState | undefined>(undefined);
    const { container } = render(() =>
      createComponent(AttitudeGauge, { vehicle: veh, t, units: metricUnits }),
    );
    expect(container.querySelector('canvas')).toBeTruthy();
    expect(container.querySelector('[aria-label="Attitude"]')).toBeTruthy();
    // Undefined vehicle → none placeholder; canvas getContext('2d') is null → no throw.
    expect(container.querySelector('.mvp-gauge__value')?.textContent).toBe(t('gauges.value.none'));

    setVeh(vehicle({ attitude: { rollRad: Math.PI / 6, pitchRad: 0, yawRad: 0 } }));
    await settle();
    const text = container.querySelector('.mvp-gauge__value')?.textContent ?? '';
    expect(text).toContain('Roll');
    expect(text).toContain('30'); // 30°
  });
});

describe('instrument panel', () => {
  it('renders only the selected gauges, in order', () => {
    const { container } = render(() =>
      createComponent(InstrumentPanel, {
        vehicle: () => vehicle(),
        t,
        selection: ['battery', 'attitude'],
      }),
    );
    const titles = [...container.querySelectorAll('.mvp-gauge__title')].map((n) => n.textContent);
    expect(titles).toEqual(['Battery', 'Attitude']);
    expect(container.querySelectorAll('.mvp-gauge--card')).toHaveLength(1);
    expect(container.querySelectorAll('.mvp-gauge--canvas')).toHaveLength(1);
    expect(container.querySelector('[aria-label="Instruments"]')).toBeTruthy();
  });

  it('defaults to every registered gauge', () => {
    const { container } = render(() =>
      createComponent(InstrumentPanel, { vehicle: () => vehicle(), t }),
    );
    expect(container.querySelectorAll('.mvp-gauge__title')).toHaveLength(12);
  });
});
