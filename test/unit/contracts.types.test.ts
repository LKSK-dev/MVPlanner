import { describe, it, expect } from 'vitest';
import { CONTRACTS_VERSION } from '../../src/contracts';
import type {
  Transport,
  ConnState,
  Mission,
  AppState,
  AppSettings,
  MapSourceSetting,
} from '../../src/contracts';

describe('contracts', () => {
  it('exposes a frozen contract version', () => {
    expect(typeof CONTRACTS_VERSION).toBe('string');
    expect(CONTRACTS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ---------------------------------------------------------------------------
// Compile-time conformance checks (verified by `npm run typecheck`, which
// includes test/). These prove the seams are implementable, per T0.3.
// ---------------------------------------------------------------------------
const _conn: ConnState = { kind: 'closed' };
const _mission: Mission = { type: 'mission', items: [] };

const _transport: Transport = {
  id: 'replay',
  capabilities: { duplex: false, reconnect: false },
  open: async () => {},
  close: async () => {},
  readable: new ReadableStream<Uint8Array>(),
  writable: new WritableStream<Uint8Array>(),
  onState: () => () => {},
  stats: () => ({
    bytesIn: 0,
    bytesOut: 0,
    packetsIn: 0,
    lossPct: 0,
    rateHz: 0,
    signed: false,
  }),
};

const _state: AppState = {
  connection: { kind: 'closed' },
  vehicles: {},
  settings: {
    units: 'metric',
    coordinateFormat: 'dd',
    theme: 'dark',
    language: 'en',
    audioAlerts: true,
    confirmDestructive: true,
  },
  layout: { activeScreen: 'flight', workspaces: {} },
};

// T3.7 additive AppSettings fields (contracts 1.3.0): optional `mapSource`
// (`MapSourceSetting`) + `telemetryRateHz`. They are optional, so omitting them
// (as in `_state` above) still type-checks; here we prove they are accepted.
const _mapSource: MapSourceSetting = { urlTemplate: '{z}/{x}/{y}', apiKey: 'k' };
const _extendedSettings: AppSettings = {
  units: 'imperial',
  coordinateFormat: 'mgrs',
  theme: 'field',
  language: 'en',
  audioAlerts: false,
  confirmDestructive: true,
  mapSource: _mapSource,
  telemetryRateHz: 10,
};

void _conn;
void _mission;
void _transport;
void _state;
void _extendedSettings;
