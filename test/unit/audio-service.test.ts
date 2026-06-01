/** Unit tests for the T8.7 audio alert service injection seams/settings. */
import { describe, expect, it, vi } from 'vitest';
import type { KvStore, VehicleState } from '../../src/contracts';
import {
  AUDIO_SETTINGS_KEY,
  AUDIO_SETTINGS_NAMESPACE,
  createAudioAlertService,
} from '../../src/core/audio';
import type { AudioAlert, AudioSpeak, AudioTone } from '../../src/core/audio';

function vehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    sysid: 1,
    compid: 1,
    mavType: 2,
    autopilot: 3,
    vehicleClass: 'copter',
    armed: false,
    mode: 'STABILIZE',
    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
    battery: { voltageV: 12, remainingPct: 80 },
    gps: { fix: 3, sats: 10, hdop: 0.8 },
    ekfOk: true,
    link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 1, signed: false },
    lastHeartbeatMs: 1_000,
    ...overrides,
  };
}

class MemoryKv implements KvStore {
  readonly data = new Map<string, unknown>();
  readonly setCalls: Array<{ ns: string; key: string; value: unknown }> = [];

  async get<T>(ns: string, key: string): Promise<T | undefined> {
    return this.data.get(`${ns}/${key}`) as T | undefined;
  }

  async set<T>(ns: string, key: string, v: T): Promise<void> {
    this.data.set(`${ns}/${key}`, v);
    this.setCalls.push({ ns, key, value: v });
  }

  async del(ns: string, key: string): Promise<void> {
    this.data.delete(`${ns}/${key}`);
  }
}

describe('createAudioAlertService', () => {
  it('calls injected speak and tone for fired alerts', async () => {
    let now = 1_000;
    const speak = vi.fn<AudioSpeak>();
    const tone = vi.fn<AudioTone>();
    const service = createAudioAlertService({
      speak,
      tone,
      now: () => now,
      translate: (key, vars) =>
        key === 'audio.alert.modeChange' ? `Mode ${String(vars?.mode)}` : key,
    });

    await service.processVehicleState(vehicle({ mode: 'LOITER' }));
    now = 2_000;
    const result = await service.processVehicleState(vehicle({ mode: 'RTL' }));

    expect(result.fired.map((a) => a.kind)).toEqual(['mode-change']);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('Mode RTL', { volume: 0.8 });
    expect(tone).toHaveBeenCalledTimes(1);
    expect(tone.mock.calls[0]?.[0].kind).toBe('mode-change');
  });

  it('respects global mute and per-category mute', async () => {
    const speak = vi.fn<AudioSpeak>();
    const tone = vi.fn<AudioTone>();
    let now = 1_000;
    const service = createAudioAlertService({ speak, tone, now: () => now });

    await service.setGlobalMute(true);
    await service.processVehicleState(vehicle({ armed: false }));
    now = 2_000;
    const muted = await service.processVehicleState(vehicle({ armed: true }));
    expect(muted.detected.map((a) => a.kind)).toEqual(['armed']);
    expect(muted.fired).toEqual([]);
    expect(speak).not.toHaveBeenCalled();
    expect(tone).not.toHaveBeenCalled();

    service.reset();
    await service.setGlobalMute(false);
    await service.setCategoryMuted('battery', true);
    await service.processVehicleState(vehicle({ battery: { voltageV: 12.1, remainingPct: 25 } }));
    now = 3_000;
    const battery = await service.processVehicleState(
      vehicle({ battery: { voltageV: 11.5, remainingPct: 19 } }),
    );
    expect(battery.detected.map((a) => a.kind)).toEqual(['battery-low']);
    expect(battery.fired).toEqual([]);
    expect(speak).not.toHaveBeenCalled();
    expect(tone).not.toHaveBeenCalled();
  });

  it('rate-limits fired alerts using the injected clock', async () => {
    let now = 1_000;
    const speak = vi.fn<AudioSpeak>();
    const tone = vi.fn<AudioTone>();
    const service = createAudioAlertService({ speak, tone, now: () => now });

    await service.processStatusText({ severity: 4, text: 'GCS failsafe' }, vehicle());
    now = 2_000;
    const limited = await service.processStatusText(
      { severity: 4, text: 'GCS failsafe' },
      vehicle(),
    );
    expect(limited.detected).toEqual([]);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(tone).toHaveBeenCalledTimes(1);

    now = 40_000;
    const allowed = await service.processStatusText(
      { severity: 4, text: 'GCS failsafe' },
      vehicle(),
    );
    expect(allowed.fired.map((a) => a.kind)).toEqual(['failsafe-gcs']);
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it('persists settings through the injected KvStore and loads them', async () => {
    const store = new MemoryKv();
    const service = createAudioAlertService({
      store,
      speak: vi.fn<AudioSpeak>(),
      tone: vi.fn<AudioTone>(),
    });

    await service.updateSettings({ voiceEnabled: false, volume: 0.4, speechLang: 'en-US' });
    expect(store.setCalls).toHaveLength(1);
    expect(store.setCalls[0]).toMatchObject({
      ns: AUDIO_SETTINGS_NAMESPACE,
      key: AUDIO_SETTINGS_KEY,
    });

    const loaded = createAudioAlertService({
      store,
      speak: vi.fn<AudioSpeak>(),
      tone: vi.fn<AudioTone>(),
    });
    await loaded.loadSettings();
    expect(loaded.getSettings().voiceEnabled).toBe(false);
    expect(loaded.getSettings().volume).toBe(0.4);
    expect(loaded.getSettings().speechLang).toBe('en-US');
  });

  it('can disable voice or tones independently', async () => {
    let now = 1_000;
    const speak = vi.fn<AudioSpeak>();
    const tone = vi.fn<AudioTone>((_alert: AudioAlert) => undefined);
    const service = createAudioAlertService({
      speak,
      tone,
      now: () => now,
      settings: { voiceEnabled: false },
    });

    await service.processVehicleState(vehicle({ armed: false }));
    now = 2_000;
    await service.processVehicleState(vehicle({ armed: true }));
    expect(speak).not.toHaveBeenCalled();
    expect(tone).toHaveBeenCalledTimes(1);

    await service.updateSettings({ voiceEnabled: true, tonesEnabled: false });
    now = 10_000;
    await service.processVehicleState(vehicle({ armed: false }));
    expect(speak).toHaveBeenCalledTimes(1);
    expect(tone).toHaveBeenCalledTimes(1);
  });
});
