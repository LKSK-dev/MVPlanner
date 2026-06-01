import { describe, it, expect } from 'vitest';

import {
  ParamMetaStore,
  createParamMetaStore,
  parseApmPdef,
  parseApmPdefParam,
  CURATED_PARAM_META,
} from '../../src/mavlink/param-meta';
import type { DialectTable, ParamMeta } from '../../src/contracts';

// ---------------------------------------------------------------------------
// A representative apm.pdef.json snippet (vehicle-grouped form), exercising
// Units / Range / Increment / Values (enum) / Bitmask / RebootRequired.
// ---------------------------------------------------------------------------
const SAMPLE_PDEF = {
  json: { version: 0 },
  ArduCopter: {
    ATC_RAT_RLL_P: {
      Description: 'Roll axis rate controller P gain',
      DisplayName: 'Roll P',
      User: 'Standard',
      Range: { high: '0.35', low: '0.0' },
      Increment: '0.005',
    },
    GPS_TYPE: {
      Description: 'GPS type',
      Values: { '0': 'None', '1': 'AUTO', '2': 'uBlox' },
      RebootRequired: 'True',
      ReadOnly: 'False',
    },
    LOG_BITMASK: {
      Description: 'Bitmask of log types',
      Bitmask: { '0': 'Fast Attitude', '1': 'Medium Attitude', '2': 'GPS' },
    },
    WPNAV_SPEED: {
      Description: 'WP horizontal speed',
      Units: 'm/s',
      Range: { high: '20', low: '0.2' },
    },
    // legacy comma form for Values
    THR_MODE: {
      Description: 'throttle mode',
      Values: '0:Off,1:On,2:Auto',
    },
    // only ReadOnly — no representable field → dropped
    _SKIP_ME: { ReadOnly: 'True', User: 'Advanced' },
  },
} as const;

describe('parseApmPdefParam', () => {
  it('parses units/range/increment', () => {
    const meta = parseApmPdefParam(SAMPLE_PDEF.ArduCopter.ATC_RAT_RLL_P);
    expect(meta).toEqual<ParamMeta>({
      min: 0,
      max: 0.35,
      increment: 0.005,
      description: 'Roll axis rate controller P gain',
    });
  });

  it('parses enum Values + RebootRequired', () => {
    const meta = parseApmPdefParam(SAMPLE_PDEF.ArduCopter.GPS_TYPE);
    expect(meta?.rebootRequired).toBe(true);
    expect(meta?.values).toEqual({ 0: 'None', 1: 'AUTO', 2: 'uBlox' });
  });

  it('parses Bitmask maps', () => {
    const meta = parseApmPdefParam(SAMPLE_PDEF.ArduCopter.LOG_BITMASK);
    expect(meta?.bitmask).toEqual({ 0: 'Fast Attitude', 1: 'Medium Attitude', 2: 'GPS' });
  });

  it('accepts the legacy comma Values form', () => {
    const meta = parseApmPdefParam(SAMPLE_PDEF.ArduCopter.THR_MODE);
    expect(meta?.values).toEqual({ 0: 'Off', 1: 'On', 2: 'Auto' });
  });

  it('returns undefined when no field is representable', () => {
    expect(parseApmPdefParam(SAMPLE_PDEF.ArduCopter._SKIP_ME)).toBeUndefined();
    expect(parseApmPdefParam(null)).toBeUndefined();
    expect(parseApmPdefParam('nope')).toBeUndefined();
  });
});

describe('parseApmPdef document shapes', () => {
  it('parses the vehicle-grouped form and skips document metadata', () => {
    const rec = parseApmPdef(SAMPLE_PDEF);
    expect(Object.keys(rec).sort()).toEqual(
      ['ATC_RAT_RLL_P', 'GPS_TYPE', 'LOG_BITMASK', 'THR_MODE', 'WPNAV_SPEED'].sort(),
    );
    expect(rec['WPNAV_SPEED']?.units).toBe('m/s');
  });

  it('parses a flat (single-firmware) document', () => {
    const flat = {
      ATC_ANG_RLL_P: { Description: 'angle P', Range: { high: '12', low: '3' } },
    };
    const rec = parseApmPdef(flat);
    expect(rec['ATC_ANG_RLL_P']).toEqual<ParamMeta>({ min: 3, max: 12, description: 'angle P' });
  });

  it('returns an empty record for non-object input', () => {
    expect(parseApmPdef(42)).toEqual({});
    expect(parseApmPdef(null)).toEqual({});
  });
});

describe('curated fallback', () => {
  const store = createParamMetaStore();

  it('seeds metadata for common params out-of-the-box', () => {
    expect(store.get('WPNAV_SPEED')?.units).toBe('cm/s');
    expect(store.get('RTL_ALT')?.units).toBe('cm');
    expect(store.get('ARMING_CHECK')?.bitmask?.[3]).toBe('GPS lock');
    expect(store.get('BATT_MONITOR')?.values?.[4]).toBe('Analog Voltage and Current');
    expect(store.get('BATT_MONITOR')?.rebootRequired).toBe(true);
    expect(store.get('SERIAL1_PROTOCOL')?.values?.[-1]).toBe('None');
  });

  it('resolves QuadPlane Q_* frame metadata with friendly labels', () => {
    expect(store.get('Q_ENABLE')?.values?.[1]).toBe('Enabled');
    expect(store.get('Q_ENABLE')?.rebootRequired).toBe(true);
    expect(store.get('Q_FRAME_CLASS')?.values?.[1]).toBe('Quad');
    expect(store.get('Q_FRAME_CLASS')?.values?.[4]).toBe('OctaQuad');
    expect(store.get('Q_FRAME_CLASS')?.values?.[10]).toBe('Tailsitter');
    expect(store.get('Q_FRAME_CLASS')?.rebootRequired).toBe(true);
    expect(store.get('Q_FRAME_TYPE')?.values?.[1]).toBe('X');
  });

  it('exposes a compact curated table (~30-50 params)', () => {
    const n = Object.keys(CURATED_PARAM_META).length;
    expect(n).toBeGreaterThanOrEqual(30);
    expect(n).toBeLessThanOrEqual(60);
  });

  it('is case-insensitive', () => {
    expect(store.get('rtl_alt')).toBe(store.get('RTL_ALT'));
    expect(store.get('Wpnav_Speed')?.units).toBe('cm/s');
  });

  it('falls back across instance numbering', () => {
    // de-instanced: BATT2_MONITOR → BATT_MONITOR
    expect(store.get('BATT2_MONITOR')).toBe(store.get('BATT_MONITOR'));
    // instance-1: RC9_MIN → RC1_MIN
    expect(store.get('RC9_MIN')).toBe(store.get('RC1_MIN'));
    expect(store.get('RC1_MIN')?.units).toBe('PWM');
  });

  it('returns undefined for unknown params', () => {
    expect(store.get('NOPE_DOES_NOT_EXIST')).toBeUndefined();
    expect(store.has('NOPE_DOES_NOT_EXIST')).toBe(false);
  });
});

describe('loadApmPdef merge/override', () => {
  it('overrides curated fields and adds new params', () => {
    const store = createParamMetaStore();
    const before = store.size;
    expect(store.get('WPNAV_SPEED')?.units).toBe('cm/s');

    const merged = store.loadApmPdef(SAMPLE_PDEF);
    expect(merged).toBe(5); // ATC_RAT_RLL_P, GPS_TYPE, LOG_BITMASK, WPNAV_SPEED, THR_MODE

    // Imported Units overrides the curated value...
    expect(store.get('WPNAV_SPEED')?.units).toBe('m/s');
    // ...while curated-only fields the import did not provide are preserved.
    expect(store.get('WPNAV_SPEED')?.increment).toBe(50);

    // A param not in the curated set is newly added.
    expect(before).toBeLessThan(store.size);
    expect(store.get('THR_MODE')?.values?.[2]).toBe('Auto');
  });

  it('works on an empty store for pure import', () => {
    const store = createParamMetaStore({ curated: false });
    expect(store.size).toBe(0);
    store.loadApmPdef(SAMPLE_PDEF);
    expect(store.get('GPS_TYPE')?.values?.[2]).toBe('uBlox');
    expect(store.get('WPNAV_SPEED')?.increment).toBeUndefined();
  });
});

describe('enrichFromDialect', () => {
  const dialect: DialectTable = {
    name: 'test',
    messages: {},
    enums: {
      MY_ENUM: [
        { value: 0, name: 'MY_ENUM_OFF', description: 'Off' },
        { value: 1, name: 'MY_ENUM_ON' }, // no description → uses name
      ],
      MY_BITS: [
        { value: 1, name: 'BIT0', description: 'Bit Zero' },
        { value: 2, name: 'BIT1', description: 'Bit One' },
        { value: 3, name: 'COMBO', description: 'Combined' }, // not power-of-two → dropped
      ],
    },
  };

  it('fills missing values/bitmask from dialect enums', () => {
    const store = new ParamMetaStore();
    const n = store.enrichFromDialect(dialect, {
      FOO: { enum: 'MY_ENUM' },
      BAR: { enum: 'MY_BITS', bitmask: true },
      MISSING: { enum: 'NO_SUCH_ENUM' },
    });
    expect(n).toBe(2);
    expect(store.get('FOO')?.values).toEqual({ 0: 'Off', 1: 'MY_ENUM_ON' });
    expect(store.get('BAR')?.bitmask).toEqual({ 0: 'Bit Zero', 1: 'Bit One' });
  });

  it('does not override existing values', () => {
    const store = new ParamMetaStore({ FOO: { values: { 0: 'Keep' } } });
    const n = store.enrichFromDialect(dialect, { FOO: { enum: 'MY_ENUM' } });
    expect(n).toBe(0);
    expect(store.get('FOO')?.values).toEqual({ 0: 'Keep' });
  });
});
