/**
 * Unit conversion + formatter tests (task T3.8; spec plan/05 §5.9). Pure: no
 * DOM. Conversions are checked against internationally-defined factors; format
 * strings against the expected suffix-per-system.
 */
import { describe, it, expect } from 'vitest';
import {
  // conversions
  metersToFeet,
  feetToMeters,
  metersToKilometers,
  metersToMiles,
  metersToNauticalMiles,
  msToKmh,
  msToKnots,
  msToMph,
  msToFeetPerMinute,
  feetPerMinuteToMs,
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  // formatters
  formatAltitude,
  formatDistance,
  formatSpeed,
  formatClimb,
  formatTemperature,
  formatVoltage,
  formatCurrent,
  formatPercent,
  formatAngle,
} from '../../src/core/units';

describe('conversions (known values)', () => {
  it('length: metres ↔ feet/km/mi/nm', () => {
    expect(feetToMeters(1)).toBeCloseTo(0.3048, 10);
    expect(metersToFeet(1)).toBeCloseTo(3.280839895, 8);
    expect(metersToFeet(1000)).toBeCloseTo(3280.839895, 5);
    expect(metersToKilometers(2500)).toBeCloseTo(2.5, 10);
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 10);
    expect(metersToNauticalMiles(1852)).toBeCloseTo(1, 10);
    // round-trip
    expect(feetToMeters(metersToFeet(123.456))).toBeCloseTo(123.456, 9);
  });

  it('speed: m/s ↔ km/h / kt / mph', () => {
    expect(msToKmh(1)).toBeCloseTo(3.6, 10);
    expect(msToKnots(1)).toBeCloseTo(1.943844492, 8);
    expect(msToMph(1)).toBeCloseTo(2.236936292, 8);
    expect(msToKnots(0.514444444)).toBeCloseTo(1, 6); // 1 kt ≈ 0.5144 m/s
  });

  it('climb: m/s ↔ ft/min', () => {
    expect(msToFeetPerMinute(1)).toBeCloseTo(196.8503937, 6);
    expect(msToFeetPerMinute(2.5)).toBeCloseTo(492.1259843, 6);
    expect(feetPerMinuteToMs(msToFeetPerMinute(3.3))).toBeCloseTo(3.3, 10);
  });

  it('temperature: °C ↔ °F', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(celsiusToFahrenheit(-40)).toBe(-40);
    expect(fahrenheitToCelsius(32)).toBe(0);
    expect(fahrenheitToCelsius(212)).toBeCloseTo(100, 10);
  });
});

describe('formatters: suffix per system', () => {
  it('altitude metric=m, imperial=ft', () => {
    expect(formatAltitude(10, 'metric')).toBe('10.0 m');
    expect(formatAltitude(10, 'imperial')).toBe('33 ft'); // 32.808 → 33
    expect(formatAltitude(10, 'imperial', { fractionDigits: 1 })).toBe('32.8 ft');
  });

  it('speed metric=m/s, imperial=mph (kt opt-in)', () => {
    expect(formatSpeed(10, 'metric')).toBe('10.0 m/s');
    expect(formatSpeed(10, 'imperial')).toBe('22.4 mph');
    expect(formatSpeed(10, 'imperial', { unit: 'kt' })).toBe('19.4 kt');
    expect(formatSpeed(10, 'metric', { unit: 'km/h' })).toBe('36.0 km/h');
  });

  it('climb metric=m/s, imperial=ft/min', () => {
    expect(formatClimb(2.5, 'metric')).toBe('2.5 m/s');
    expect(formatClimb(-1.5, 'metric')).toBe('-1.5 m/s');
    expect(formatClimb(2.5, 'imperial')).toBe('492 ft/min');
  });

  it('temperature metric=°C, imperial=°F', () => {
    expect(formatTemperature(20, 'metric')).toBe('20.0 °C');
    expect(formatTemperature(20, 'imperial')).toBe('68.0 °F');
  });

  it('distance auto-scales short → long', () => {
    expect(formatDistance(500, 'metric')).toBe('500 m');
    expect(formatDistance(1500, 'metric')).toBe('1.50 km');
    expect(formatDistance(2000, 'imperial')).toBe('1.24 mi');
    expect(formatDistance(500, 'imperial')).toBe('1,640 ft');
  });

  it('distance honours unit / longUnit overrides', () => {
    expect(formatDistance(1852, 'metric', { longUnit: 'nm' })).toBe('1.00 nm');
    expect(formatDistance(5000, 'metric', { unit: 'm' })).toBe('5,000 m');
    expect(formatDistance(800, 'metric', { longUnit: 'km', longThresholdM: 500 })).toBe('0.80 km');
  });

  it('pass-throughs are system-independent', () => {
    expect(formatVoltage(12.34)).toBe('12.3 V');
    expect(formatCurrent(5.5)).toBe('5.5 A');
    expect(formatPercent(78)).toBe('78%');
    expect(formatAngle(45)).toBe('45°');
  });

  it('withUnit:false returns the bare number', () => {
    expect(formatAltitude(10, 'metric', { withUnit: false })).toBe('10.0');
    expect(formatSpeed(10, 'imperial', { withUnit: false })).toBe('22.4');
  });
});
