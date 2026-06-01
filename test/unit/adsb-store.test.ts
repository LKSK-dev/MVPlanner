/** Unit tests for the pure ADS-B TrafficStore and MAVLink tap. */
import { describe, expect, it, vi } from 'vitest';
import type { DecodedMessage, FieldValue } from '../../src/contracts';
import {
  TrafficStore,
  connectTrafficStore,
  formatIcaoAddress,
  parseAdsbVehicleMessage,
  type AdsbMessageSource,
} from '../../src/ui/widgets/map/layers/adsb';

function adsbMessage(overrides: Partial<Record<string, FieldValue>> = {}): DecodedMessage {
  return {
    sysid: 1,
    compid: 1,
    seq: 7,
    msgId: 246,
    name: 'ADSB_VEHICLE',
    fields: {
      ICAO_address: 0xabc123,
      lat: 377_749_000,
      lon: -1_224_194_000,
      altitude: 123_450,
      heading: 9_001,
      hor_velocity: 2_345,
      flags: 31,
      callsign: 'N123AB  ',
      emitter_type: 1,
      tslc: 0,
      ...overrides,
    },
    crcOk: true,
    signed: false,
    rxTimeUs: 0,
    raw: new Uint8Array([1, 2, 3]),
  };
}

describe('TrafficStore', () => {
  it('normalizes ADSB_VEHICLE fields and formats ICAO addresses', () => {
    const parsed = parseAdsbVehicleMessage(adsbMessage(), 10_000);
    expect(parsed).toBeDefined();
    if (!parsed) throw new Error('expected parsed traffic');
    expect(parsed.icaoAddress).toBe(0xabc123);
    expect(parsed.icaoHex).toBe('ABC123');
    expect(formatIcaoAddress(0x42)).toBe('000042');
    expect(parsed.lat).toBeCloseTo(37.7749, 7);
    expect(parsed.lon).toBeCloseTo(-122.4194, 7);
    expect(parsed.altitudeM).toBeCloseTo(123.45, 6);
    expect(parsed.headingDeg).toBeCloseTo(90.01, 6);
    expect(parsed.horizontalVelocityMps).toBeCloseTo(23.45, 6);
    expect(parsed.callsign).toBe('N123AB');
    expect(parsed.lastSeenMs).toBe(10_000);
  });

  it('updates by ICAO address and returns a stable sorted snapshot', () => {
    let now = 1_000;
    const store = new TrafficStore({ now: (): number => now });
    store.ingestMessage(adsbMessage({ ICAO_address: 0x000002, callsign: 'TWO' }));
    now = 2_000;
    store.ingestMessage(adsbMessage({ ICAO_address: 0x000001, callsign: 'ONE' }));
    now = 3_000;
    store.ingestMessage(adsbMessage({ ICAO_address: 0x000002, callsign: 'TWO2', altitude: 2000 }));

    const all = store.all();
    expect(all.map((a) => a.icaoHex)).toEqual(['000001', '000002']);
    const updated = store.get(0x000002);
    expect(updated?.callsign).toBe('TWO2');
    expect(updated?.altitudeM).toBe(2);
  });

  it('ages from ADS-B tslc and evicts stale aircraft', () => {
    let now = 100_000;
    const store = new TrafficStore({ now: (): number => now, staleTimeoutMs: 10_000 });
    store.ingestMessage(adsbMessage({ tslc: 4 }));
    expect(store.size()).toBe(1);
    now = 105_999;
    expect(store.evictStale()).toBe(0);
    expect(store.size()).toBe(1);
    now = 107_001;
    expect(store.evictStale()).toBe(1);
    expect(store.size()).toBe(0);
  });

  it('ignores non-ADSB messages and invalid coordinates', () => {
    const store = new TrafficStore({ now: (): number => 0 });
    const heartbeat: DecodedMessage = { ...adsbMessage(), msgId: 0, name: 'HEARTBEAT' };
    expect(store.ingestMessage(heartbeat)).toBeUndefined();
    expect(store.ingestMessage(adsbMessage({ lat: 910_000_000 }))).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it('wires a host onMessage tap with an injected clock', () => {
    const store = new TrafficStore({ now: (): number => 0 });
    let listener: ((msg: DecodedMessage) => void) | undefined;
    let unsubscribed = false;
    const onMessage = vi.fn<AdsbMessageSource['onMessage']>((names, cb) => {
      expect(names).toEqual(['ADSB_VEHICLE']);
      listener = cb;
      return (): void => {
        unsubscribed = true;
      };
    });
    const source: AdsbMessageSource = { onMessage };

    const unsubscribe = connectTrafficStore(source, store, { now: (): number => 42_000 });
    expect(onMessage).toHaveBeenCalledTimes(1);
    const cb = listener;
    expect(cb).toBeDefined();
    if (!cb) throw new Error('expected ADS-B listener');
    cb(adsbMessage({ tslc: 2 }));
    expect(store.get(0xabc123, 42_000)?.lastSeenMs).toBe(40_000);
    unsubscribe();
    expect(unsubscribed).toBe(true);
  });
});
