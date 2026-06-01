/** Default audio output seams for T8.7 voice alerts + tones. */
import type { AudioAlert, AudioSpeak, AudioTone } from './types';

const TONE_FREQUENCIES: Readonly<Record<AudioAlert['tone'], number>> = Object.freeze({
  info: 660,
  warning: 880,
  critical: 1100,
});

const TONE_DURATIONS_MS: Readonly<Record<AudioAlert['tone'], number>> = Object.freeze({
  info: 120,
  warning: 180,
  critical: 260,
});

/**
 * Web Speech API implementation for spoken alerts.
 *
 * It is a no-op in non-browser/test environments or browsers without speech
 * synthesis, keeping service construction safe during SSR and unit tests.
 */
export const defaultSpeak: AudioSpeak = (text, options): void => {
  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.volume = Math.max(0, Math.min(1, options.volume));
  if (options.lang !== undefined && options.lang.length > 0) utterance.lang = options.lang;
  window.speechSynthesis.speak(utterance);
};

/**
 * AudioContext beep implementation for tonal alerts.
 *
 * The context is created lazily on the first tone so importing the audio module
 * has no side effects. In unsupported environments the function is a no-op.
 */
export function createDefaultTone(): AudioTone {
  let context: AudioContext | undefined;
  return (alert, options): void => {
    if (typeof window === 'undefined' || window.AudioContext === undefined) return;
    context ??= new window.AudioContext();
    const ctx = context;
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    const now = ctx.currentTime;
    const duration = TONE_DURATIONS_MS[alert.tone] / 1_000;
    const volume = Math.max(0, Math.min(1, options.volume));

    osc.type = alert.tone === 'critical' ? 'square' : 'sine';
    osc.frequency.value = TONE_FREQUENCIES[alert.tone];
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.18), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.addEventListener('ended', () => {
      osc.disconnect();
      gain.disconnect();
    });
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        // Browser autoplay policies may reject until user gesture; stay silent.
      });
    }
  };
}
