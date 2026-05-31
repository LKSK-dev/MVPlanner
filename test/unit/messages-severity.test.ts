/**
 * Pure-logic tests for the STATUSTEXT console (task T2.8; spec plan/04 §4.2,
 * plan/05 §5.8): the MAV_SEVERITY → tier mapping, assertive classification,
 * severity-name keys, tier ranking, and STATUSTEXT text/frame parsing.
 */
import { describe, it, expect } from 'vitest';
import type { DecodedMessage } from '../../src/contracts';
import {
  clampSeverity,
  severityTier,
  isAssertiveSeverity,
  severityNameKey,
  tierGlyph,
  tierRank,
  parseStatusText,
  statusMessageFromDecoded,
} from '../../src/ui/widgets/messages';

describe('severityTier', () => {
  it('maps 0..3 (EMERGENCY..ERROR) to error', () => {
    for (const s of [0, 1, 2, 3]) expect(severityTier(s)).toBe('error');
  });

  it('maps 4..5 (WARNING/NOTICE) to warn', () => {
    expect(severityTier(4)).toBe('warn');
    expect(severityTier(5)).toBe('warn');
  });

  it('maps 6..7 (INFO/DEBUG) to info', () => {
    expect(severityTier(6)).toBe('info');
    expect(severityTier(7)).toBe('info');
  });

  it('clamps out-of-range and fractional severities', () => {
    expect(severityTier(-1)).toBe('error'); // clamps to 0
    expect(severityTier(99)).toBe('info'); // clamps to 7
    expect(severityTier(2.4)).toBe('error'); // rounds to 2
    expect(clampSeverity(Number.NaN)).toBe(6); // default INFO
  });
});

describe('isAssertiveSeverity', () => {
  it('is assertive only for EMERGENCY/ALERT/CRITICAL (0..2)', () => {
    expect([0, 1, 2].map(isAssertiveSeverity)).toEqual([true, true, true]);
    expect([3, 4, 5, 6, 7].map(isAssertiveSeverity)).toEqual([false, false, false, false, false]);
  });
});

describe('severityNameKey / glyph / rank', () => {
  it('returns the level-name key per severity', () => {
    expect(severityNameKey(0)).toBe('statustext.severity.emergency');
    expect(severityNameKey(2)).toBe('statustext.severity.critical');
    expect(severityNameKey(4)).toBe('statustext.severity.warning');
    expect(severityNameKey(6)).toBe('statustext.severity.info');
  });

  it('gives a distinct non-color glyph per tier', () => {
    const glyphs = new Set([tierGlyph('error'), tierGlyph('warn'), tierGlyph('info')]);
    expect(glyphs.size).toBe(3);
  });

  it('ranks tiers info < warn < error', () => {
    expect(tierRank('info')).toBeLessThan(tierRank('warn'));
    expect(tierRank('warn')).toBeLessThan(tierRank('error'));
  });
});

describe('parseStatusText', () => {
  it('passes through an already-decoded string', () => {
    expect(parseStatusText('GPS: 3D fix')).toBe('GPS: 3D fix');
  });

  it('decodes a char-code array and stops at the first NUL', () => {
    const codes = [...'Armed'].map((c) => c.charCodeAt(0)).concat(0, 65, 66);
    expect(parseStatusText(codes)).toBe('Armed');
  });

  it('trims trailing NUL/whitespace and handles missing text', () => {
    expect(parseStatusText('Calibrating\u0000\u0000')).toBe('Calibrating');
    expect(parseStatusText('  padded  ')).toBe('padded');
    expect(parseStatusText(undefined)).toBe('');
    expect(parseStatusText(42)).toBe('');
  });
});

describe('statusMessageFromDecoded', () => {
  function frame(fields: Record<string, unknown>): DecodedMessage {
    return {
      sysid: 7,
      compid: 1,
      seq: 12,
      msgId: 253,
      name: 'STATUSTEXT',
      fields: fields as DecodedMessage['fields'],
      crcOk: true,
      signed: false,
      rxTimeUs: 0,
      raw: new Uint8Array(),
    };
  }

  it('extracts severity, text, sysid/compid and defaults seq to the frame seq', () => {
    const m = statusMessageFromDecoded(frame({ severity: 2, text: 'Crash detected' }), 1000);
    expect(m).toMatchObject({
      severity: 2,
      text: 'Crash detected',
      sysid: 7,
      compid: 1,
      tMs: 1000,
      seq: 12,
    });
  });

  it('decodes char[] text and defaults severity to INFO when absent', () => {
    const codes = [...'Ready'].map((c) => c.charCodeAt(0));
    const m = statusMessageFromDecoded(frame({ text: codes }), 5, 99);
    expect(m.text).toBe('Ready');
    expect(m.severity).toBe(6);
    expect(m.seq).toBe(99);
  });
});
