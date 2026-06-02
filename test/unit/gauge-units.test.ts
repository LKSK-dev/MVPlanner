/**
 * unitsFromResolved: the gauge UnitHook honors the resolved per-quantity units
 * (P0 audit fix — instruments were hard-wired metric).
 */
import { describe, expect, it } from 'vitest';
import { unitsFromResolved } from '../../src/ui/widgets/gauges';
import { resolveUnits } from '../../src/core/units';
import type { AppSettings } from '../../src/contracts';

const BASE: AppSettings = {
  units: 'metric',
  coordinateFormat: 'dd',
  theme: 'dark',
  language: 'en',
  audioAlerts: false,
  confirmDestructive: true,
};

describe('unitsFromResolved (gauge UnitHook)', () => {
  it('renders metric units for the metric preset', () => {
    const u = unitsFromResolved(resolveUnits(BASE));
    expect(u.altitude(100).unitKey).toBe('gauges.unit.m');
    expect(u.speed(10).unitKey).toBe('gauges.unit.ms');
    expect(u.climb(2).unitKey).toBe('gauges.unit.ms');
  });

  it('renders imperial units for the imperial preset', () => {
    const u = unitsFromResolved(resolveUnits({ ...BASE, units: 'imperial' }));
    expect(u.altitude(100).unitKey).toBe('gauges.unit.ft');
    expect(u.speed(10).unitKey).toBe('gauges.unit.mph');
    expect(u.climb(2).unitKey).toBe('gauges.unit.ftmin');
    // 100 m ≈ 328 ft
    expect(u.altitude(100).value).toMatch(/3[0-9]{2}/);
  });

  it('honors per-quantity overrides (speed in knots regardless of preset)', () => {
    const u = unitsFromResolved(resolveUnits({ ...BASE, unitPreferences: { speed: 'kt' } }));
    expect(u.speed(10).unitKey).toBe('gauges.unit.kt');
  });

  it('auto distance scales m→km (metric) and ft→mi (imperial)', () => {
    const m = unitsFromResolved(resolveUnits(BASE));
    expect(m.distance(50).unitKey).toBe('gauges.unit.m');
    expect(m.distance(5000).unitKey).toBe('gauges.unit.km');
    const i = unitsFromResolved(resolveUnits({ ...BASE, units: 'imperial' }));
    expect(i.distance(50).unitKey).toBe('gauges.unit.ft');
    expect(i.distance(5000).unitKey).toBe('gauges.unit.mi');
  });
});
