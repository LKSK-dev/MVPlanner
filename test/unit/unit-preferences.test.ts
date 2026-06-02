/**
 * Per-quantity unit preferences + formatter facade tests (App Settings → Units).
 */
import { describe, expect, it } from 'vitest';
import { resolveUnits, createUnitFormatter } from '../../src/core/units';
import type { AppSettings } from '../../src/contracts';

const BASE: AppSettings = {
  units: 'metric',
  coordinateFormat: 'dd',
  theme: 'dark',
  language: 'en',
  audioAlerts: false,
  confirmDestructive: true,
};

describe('resolveUnits', () => {
  it('derives per-quantity defaults from the metric/imperial preset', () => {
    const m = resolveUnits(BASE);
    expect(m).toMatchObject({
      altitude: 'm',
      speed: 'm/s',
      verticalSpeed: 'm/s',
      temperature: 'C',
      distance: 'auto',
    });
    const i = resolveUnits({ ...BASE, units: 'imperial' });
    expect(i).toMatchObject({
      altitude: 'ft',
      speed: 'mph',
      verticalSpeed: 'ft/min',
      temperature: 'F',
    });
  });

  it('applies per-quantity overrides over the preset', () => {
    const r = resolveUnits({
      ...BASE,
      units: 'metric',
      unitPreferences: { altitude: 'ft', speed: 'kt', distance: 'nm', heading: 'mil' },
    });
    expect(r.altitude).toBe('ft');
    expect(r.speed).toBe('kt');
    expect(r.distance).toBe('nm');
    expect(r.heading).toBe('mil');
  });

  it('coordinate falls back to coordinateFormat then to the override', () => {
    expect(resolveUnits({ ...BASE, coordinateFormat: 'dms' }).coordinate).toBe('dms');
    expect(resolveUnits({ ...BASE, unitPreferences: { coordinate: 'mgrs' } }).coordinate).toBe(
      'mgrs',
    );
  });
});

describe('createUnitFormatter', () => {
  it('formats values in the resolved units', () => {
    const f = createUnitFormatter(resolveUnits({ ...BASE, units: 'imperial' }));
    expect(f.altitude(100)).toMatch(/ft$/);
    expect(f.speed(10)).toMatch(/mph$/);
    expect(f.climb(2)).toMatch(/ft\/min$/);
    expect(f.temperature(0)).toMatch(/°F$/);
  });

  it('honors a forced distance unit + mil heading', () => {
    const f = createUnitFormatter(
      resolveUnits({ ...BASE, unitPreferences: { distance: 'km', heading: 'mil' } }),
    );
    expect(f.distance(2000)).toMatch(/km$/);
    expect(f.heading(180)).toMatch(/mil$/);
  });
});
