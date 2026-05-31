import { describe, it, expect } from 'vitest';
import {
  detectCapabilities,
  detectRealCapabilities,
  type Capabilities,
  type CapabilityEnv,
} from '../../src/core/capabilities';

/** The full set of flags the detector must report. */
const CAPABILITY_KEYS: ReadonlyArray<keyof Capabilities> = [
  'webSerial',
  'webBluetooth',
  'webUsb',
  'fileSystemAccess',
  'wasm',
  'secureContext',
  'offscreenCanvas',
  'crossOriginIsolated',
  'webSpeech',
  'gamepad',
];

/** A mock environment where every probed capability is present. */
const allPresent: CapabilityEnv = {
  navigator: {
    serial: {},
    bluetooth: {},
    usb: {},
    getGamepads: () => [],
  },
  window: {
    showOpenFilePicker: () => undefined,
    OffscreenCanvas: function OffscreenCanvas() {},
    WebAssembly: {},
    speechSynthesis: {},
    isSecureContext: true,
    crossOriginIsolated: true,
  },
};

describe('detectCapabilities', () => {
  it('reports every flag true for an all-present environment', () => {
    const caps = detectCapabilities(allPresent);
    for (const key of CAPABILITY_KEYS) {
      expect(caps[key], key).toBe(true);
    }
  });

  it('reports every flag false for an all-absent environment', () => {
    const caps = detectCapabilities({ navigator: {}, window: {} });
    for (const key of CAPABILITY_KEYS) {
      expect(caps[key], key).toBe(false);
    }
  });

  it('reports every flag false when no environment is provided', () => {
    const caps = detectCapabilities();
    for (const key of CAPABILITY_KEYS) {
      expect(caps[key], key).toBe(false);
    }
    // Exactly the documented surface, nothing more.
    expect(Object.keys(caps).sort()).toEqual([...CAPABILITY_KEYS].sort());
  });

  it('reflects a partial environment with mixed results', () => {
    const caps = detectCapabilities({
      navigator: { serial: {} },
      window: { WebAssembly: {}, isSecureContext: true },
    });
    expect(caps).toEqual({
      webSerial: true,
      webBluetooth: false,
      webUsb: false,
      fileSystemAccess: false,
      wasm: true,
      secureContext: true,
      offscreenCanvas: false,
      crossOriginIsolated: false,
      webSpeech: false,
      gamepad: false,
    });
  });

  it('treats secureContext / crossOriginIsolated as strict booleans', () => {
    // Truthy-but-not-true values must not be reported as enabled.
    const caps = detectCapabilities({
      window: {
        isSecureContext: false,
        crossOriginIsolated: false,
      },
    });
    expect(caps.secureContext).toBe(false);
    expect(caps.crossOriginIsolated).toBe(false);
  });

  it('treats non-callable file/offscreen/gamepad slots as absent', () => {
    const caps = detectCapabilities({
      navigator: { getGamepads: {} },
      window: { showOpenFilePicker: {}, OffscreenCanvas: {} },
    });
    expect(caps.gamepad).toBe(false);
    expect(caps.fileSystemAccess).toBe(false);
    expect(caps.offscreenCanvas).toBe(false);
  });
});

describe('detectRealCapabilities', () => {
  it('runs without throwing under happy-dom and returns boolean flags', () => {
    const caps = detectRealCapabilities();
    for (const key of CAPABILITY_KEYS) {
      expect(typeof caps[key], key).toBe('boolean');
    }
  });
});
