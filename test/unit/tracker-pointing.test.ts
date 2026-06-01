import { describe, it, expect } from 'vitest';
import {
  bearingDeg,
  computePointing,
  groundDistanceM,
  normalizeAzimuthDeg,
  type GeoPoint,
} from '../../src/ui/screens/setup/tracker/pointing';

const origin: GeoPoint = { lat: 0, lon: 0, altM: 0 };

describe('normalizeAzimuthDeg', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeAzimuthDeg(0)).toBe(0);
    expect(normalizeAzimuthDeg(360)).toBe(0);
    expect(normalizeAzimuthDeg(450)).toBe(90);
    expect(normalizeAzimuthDeg(-90)).toBe(270);
    expect(normalizeAzimuthDeg(-360)).toBe(0);
  });
});

describe('bearingDeg', () => {
  it('points to the cardinal directions', () => {
    expect(bearingDeg(origin, { lat: 1, lon: 0, altM: 0 })).toBeCloseTo(0, 5);
    expect(bearingDeg(origin, { lat: 0, lon: 1, altM: 0 })).toBeCloseTo(90, 5);
    expect(bearingDeg(origin, { lat: -1, lon: 0, altM: 0 })).toBeCloseTo(180, 5);
    expect(bearingDeg(origin, { lat: 0, lon: -1, altM: 0 })).toBeCloseTo(270, 5);
  });

  it('returns 0 for coincident points', () => {
    expect(bearingDeg(origin, { lat: 0, lon: 0, altM: 0 })).toBe(0);
  });
});

describe('groundDistanceM', () => {
  it('is one degree of arc for a one-degree offset at the equator', () => {
    // (π/180) * 6_371_000 ≈ 111194.9 m
    expect(groundDistanceM(origin, { lat: 0, lon: 1, altM: 0 })).toBeCloseTo(111194.9, 0);
    expect(groundDistanceM(origin, { lat: 1, lon: 0, altM: 0 })).toBeCloseTo(111194.9, 0);
  });

  it('ignores altitude', () => {
    expect(groundDistanceM(origin, { lat: 0, lon: 0, altM: 1000 })).toBeCloseTo(0, 6);
  });
});

describe('computePointing', () => {
  it('aims straight up for a vehicle directly overhead', () => {
    const p = computePointing({ lat: 47, lon: 8, altM: 500 }, { lat: 47, lon: 8, altM: 1500 });
    expect(p.groundDistanceM).toBeCloseTo(0, 6);
    expect(p.elevationDeg).toBeCloseTo(90, 5);
    expect(p.distanceM).toBeCloseTo(1000, 5);
    expect(p.azimuthDeg).toBe(0);
  });

  it('reports a negative elevation for a vehicle below the tracker', () => {
    const p = computePointing({ lat: 10, lon: 10, altM: 1000 }, { lat: 10, lon: 10, altM: 400 });
    expect(p.elevationDeg).toBeCloseTo(-90, 5);
    expect(p.distanceM).toBeCloseTo(600, 5);
  });

  it('computes a 45° elevation when the climb equals the ground distance', () => {
    const tracker: GeoPoint = { lat: 0, lon: 0, altM: 0 };
    const ground = groundDistanceM(tracker, { lat: 0, lon: 0.01, altM: 0 });
    const vehicle: GeoPoint = { lat: 0, lon: 0.01, altM: ground };
    const p = computePointing(tracker, vehicle);
    expect(p.azimuthDeg).toBeCloseTo(90, 4);
    expect(p.elevationDeg).toBeCloseTo(45, 5);
    expect(p.distanceM).toBeCloseTo(ground * Math.SQRT2, 5);
  });

  it('combines bearing, ground distance and elevation consistently', () => {
    const tracker: GeoPoint = { lat: 51.5, lon: -0.12, altM: 30 };
    const vehicle: GeoPoint = { lat: 51.52, lon: -0.1, altM: 130 };
    const p = computePointing(tracker, vehicle);
    expect(p.azimuthDeg).toBeCloseTo(bearingDeg(tracker, vehicle), 6);
    expect(p.groundDistanceM).toBeCloseTo(groundDistanceM(tracker, vehicle), 6);
    const expectedElev = (Math.atan2(100, p.groundDistanceM) * 180) / Math.PI;
    expect(p.elevationDeg).toBeCloseTo(expectedElev, 6);
  });
});
