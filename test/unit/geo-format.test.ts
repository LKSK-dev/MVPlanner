/**
 * Coordinate-format tests (task T3.8; spec plan/05 §5.9). Pure: no DOM.
 * DD/DMS round-trip; UTM + MGRS validated against documented reference points
 * and analytic anchors (central meridian, equator, hemispheres, antimeridian).
 */
import { describe, it, expect } from 'vitest';
import {
  formatDD,
  parseDD,
  formatDMS,
  parseDMS,
  formatLatLon,
  parseLatLon,
  utmZone,
  latBand,
  latLonToUtm,
  utmToLatLon,
  formatUTM,
  latLonToMgrs,
} from '../../src/geo/format';

describe('decimal degrees (DD)', () => {
  it('formats signed and hemisphere styles', () => {
    expect(formatDD(38.9594, -76.07209, { fractionDigits: 5 })).toBe('38.95940°, -76.07209°');
    expect(formatDD(38.9594, -76.07209, { fractionDigits: 5, hemisphere: true })).toBe(
      '38.95940° N, 76.07209° W',
    );
  });

  it('parses signed, hemisphere, and reversed-order inputs', () => {
    expect(parseDD('38.9594, -76.07209')).toEqual({ lat: 38.9594, lon: -76.07209 });
    const h = parseDD('38.95940° N, 76.07209° W');
    expect(h?.lat).toBeCloseTo(38.9594, 6);
    expect(h?.lon).toBeCloseTo(-76.07209, 6);
    // hemisphere letters disambiguate order
    const r = parseDD('76.07209° W 38.95940° N');
    expect(r?.lat).toBeCloseTo(38.9594, 6);
    expect(r?.lon).toBeCloseTo(-76.07209, 6);
  });

  it('round-trips and rejects out-of-range / garbage', () => {
    const p = parseDD(formatDD(-33.8688, 151.2093, { fractionDigits: 6 }));
    expect(p?.lat).toBeCloseTo(-33.8688, 6);
    expect(p?.lon).toBeCloseTo(151.2093, 6);
    expect(parseDD('200, 0')).toBeNull();
    expect(parseDD('not a coordinate')).toBeNull();
  });
});

describe('degrees/minutes/seconds (DMS)', () => {
  it('formats with padded degrees and hemisphere', () => {
    expect(formatDMS(38.9594, -76.07209)).toBe('38°57′33.84″N 076°04′19.52″W');
  });

  it('carries seconds rounding so 60″ never appears', () => {
    // 0.99999° → 59′59.96″ rounds to 1°00′00.00″N
    expect(formatDMS(0.999999, 0)).toBe('01°00′00.00″N 000°00′00.00″E');
  });

  it('round-trips through parseDMS', () => {
    const p = parseDMS(formatDMS(38.9594, -76.07209, { secondsFractionDigits: 4 }));
    expect(p?.lat).toBeCloseTo(38.9594, 5);
    expect(p?.lon).toBeCloseTo(-76.07209, 5);
    expect(parseDMS('00°00′00″N 000°00′00″E')).toEqual({ lat: 0, lon: 0 });
  });
});

describe('UTM (WGS84)', () => {
  it('computes zone with antimeridian + Norway/Svalbard exceptions', () => {
    expect(utmZone(0, -177)).toBe(1);
    expect(utmZone(0, 177)).toBe(60);
    expect(utmZone(0, 180)).toBe(60); // wraps, not 61
    expect(utmZone(0, 3)).toBe(31);
    expect(utmZone(60, 5)).toBe(32); // Norway widening
    expect(utmZone(75, 20)).toBe(33); // Svalbard
  });

  it('latitude band letters', () => {
    expect(latBand(0)).toBe('N');
    expect(latBand(48.24949)).toBe('U');
    expect(latBand(-33.9)).toBe('H');
    expect(latBand(80)).toBe('X');
  });

  it('central-meridian + equator anchors are exact', () => {
    const cm = latLonToUtm(0, 3); // zone 31 central meridian
    expect(cm.zone).toBe(31);
    expect(cm.easting).toBeCloseTo(500000, 3);
    expect(cm.northing).toBeCloseTo(0, 3);
    expect(cm.northern).toBe(true);
    expect(cm.hemisphere).toBe('N');
  });

  it('matches a documented reference point (Vienna, 33U)', () => {
    const u = latLonToUtm(48.24949, 16.4145);
    expect(u.zone).toBe(33);
    expect(u.band).toBe('U');
    expect(u.easting).toBeCloseTo(605004.4, 1);
    expect(u.northing).toBeCloseTo(5344997.7, 1);
  });

  it('applies southern false-northing + hemisphere (Cape Town, 34H)', () => {
    const u = latLonToUtm(-33.9249, 18.4241);
    expect(u.zone).toBe(34);
    expect(u.band).toBe('H');
    expect(u.northern).toBe(false);
    expect(u.hemisphere).toBe('S');
    expect(u.northing).toBeGreaterThan(6_000_000);
    expect(u.northing).toBeLessThan(7_000_000);
  });

  it('round-trips forward → inverse across hemispheres', () => {
    for (const [lat, lon] of [
      [48.24949, 16.4145],
      [-33.9249, 18.4241],
      [0, 3],
      [60.0, -120.0],
      [-45.5, 170.2],
    ] as const) {
      const back = utmToLatLon(latLonToUtm(lat, lon));
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });

  it('formatUTM renders zone/band/easting/northing (rounded metres)', () => {
    expect(formatUTM(48.24949, 16.4145)).toBe('33U 605004 5344998');
  });
});

describe('MGRS (WGS84)', () => {
  it('matches the canonical reference vector', () => {
    // Standard Snyder/proj4 vector (mgrs lib truncates: 5344997.70 → 44997).
    expect(latLonToMgrs(48.24949, 16.4145)).toBe('33UXP0500444997');
  });

  it('honours accuracy + spaces options', () => {
    expect(latLonToMgrs(48.24949, 16.4145, { accuracy: 2 })).toBe('33UXP0544');
    expect(latLonToMgrs(48.24949, 16.4145, { spaces: true })).toBe('33U XP 05004 44997');
  });

  it('handles equator and both hemispheres without throwing', () => {
    expect(latLonToMgrs(0, 3)).toMatch(/^31N[A-Z]{2}\d{10}$/);
    expect(latLonToMgrs(-33.9249, 18.4241)).toMatch(/^34H[A-Z]{2}\d{10}$/);
  });
});

describe('formatLatLon / parseLatLon dispatch', () => {
  it('dispatches each CoordinateFormat', () => {
    expect(formatLatLon(48.24949, 16.4145, 'dd')).toBe('48.249490°, 16.414500°');
    expect(formatLatLon(48.24949, 16.4145, 'dms')).toBe('48°14′58.16″N 016°24′52.20″E');
    expect(formatLatLon(48.24949, 16.4145, 'utm')).toBe('33U 605004 5344998');
    expect(formatLatLon(48.24949, 16.4145, 'mgrs')).toBe('33UXP0500444997');
  });

  it('parses dd/dms (auto-detect) and rejects utm/mgrs', () => {
    expect(parseLatLon('38.9594, -76.07209', 'dd')).toEqual({ lat: 38.9594, lon: -76.07209 });
    expect(parseLatLon('38°57′33.84″N 076°04′19.52″W')?.lat).toBeCloseTo(38.9594, 5);
    expect(() => parseLatLon('33UXP0500444996', 'mgrs')).toThrow();
  });
});
