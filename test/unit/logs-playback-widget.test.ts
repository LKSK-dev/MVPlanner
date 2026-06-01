/**
 * tlog playback control-bar widget tests (task T6.6; spec plan/04 §4.7/§4.8,
 * plan/05 §5.5).
 *
 * Renders {@link PlaybackControls} over a MOCK {@link PlaybackController} (no
 * Worker / real transport) and asserts the control contract: play/pause toggles,
 * the scrub slider updates the readout + calls `seek`, the speed selector applies,
 * `step` advances (and is reflected via a progress report), and picking a preset
 * returns the right field spec.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import {
  PlaybackControls,
  type AnalysisFieldSpec,
  type AnalysisPreset,
  type PlaybackController,
  type PlaybackProgress,
} from '../../src/ui/screens/logs/playback';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A mock controller whose captured subscriber the test drives via `push`. */
function makeController(): {
  controller: PlaybackController;
  push(p: PlaybackProgress): void;
  unsubscribed: () => boolean;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  step: ReturnType<typeof vi.fn>;
  seek: ReturnType<typeof vi.fn>;
  setSpeed: ReturnType<typeof vi.fn>;
} {
  let cb: ((p: PlaybackProgress) => void) | undefined;
  let off = false;
  const play = vi.fn<() => void>();
  const pause = vi.fn<() => void>();
  const step = vi.fn<() => void>();
  const seek = vi.fn<(t: number) => void>();
  const setSpeed = vi.fn<(n: number) => void>();
  return {
    controller: {
      play,
      pause,
      step,
      seek,
      setSpeed,
      subscribe(listener): () => void {
        cb = listener;
        return () => {
          off = true;
          cb = undefined;
        };
      },
    },
    push: (p) => cb?.(p),
    unsubscribed: () => off,
    play,
    pause,
    step,
    seek,
    setSpeed,
  };
}

function mount(
  controller: PlaybackController,
  extra?: {
    onSelectPreset?: (
      spec: AnalysisFieldSpec | undefined,
      preset: AnalysisPreset | undefined,
    ) => void;
  },
): HTMLElement {
  const { container } = render(() =>
    createComponent(PlaybackControls, {
      controller,
      t,
      totalUs: 10_000_000, // 10 s log.
      ...(extra?.onSelectPreset ? { onSelectPreset: extra.onSelectPreset } : {}),
    }),
  );
  return container;
}

afterEach(() => cleanup());

describe('PlaybackControls widget', () => {
  it('toggles play and pause on the transport button', async () => {
    const m = makeController();
    const container = mount(m.controller);
    await settle();

    const playBtn = container.querySelector<HTMLButtonElement>('.mvp-playback__play');
    expect(playBtn).toBeTruthy();
    expect(playBtn!.getAttribute('aria-label')).toBe(t('logs.playback.play'));

    playBtn!.click();
    await settle();
    expect(m.play).toHaveBeenCalledTimes(1);
    expect(playBtn!.getAttribute('aria-label')).toBe(t('logs.playback.pause'));
    expect(playBtn!.getAttribute('aria-pressed')).toBe('true');

    playBtn!.click();
    await settle();
    expect(m.pause).toHaveBeenCalledTimes(1);
    expect(playBtn!.getAttribute('aria-label')).toBe(t('logs.playback.play'));
  });

  it('scrub slider seeks the controller and updates the readout', async () => {
    const m = makeController();
    const container = mount(m.controller);
    await settle();

    const scrub = container.querySelector<HTMLInputElement>('.mvp-playback__scrub');
    expect(scrub).toBeTruthy();
    expect(scrub!.max).toBe('10000000');

    scrub!.value = '5000000';
    scrub!.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(m.seek).toHaveBeenCalledWith(5_000_000);
    const readout = container.querySelector('.mvp-playback__time')?.textContent;
    expect(readout).toBe('0:05 / 0:10');
    expect(scrub!.getAttribute('aria-valuetext')).toBe('0:05 / 0:10');
  });

  it('applies a speed change', async () => {
    const m = makeController();
    const container = mount(m.controller);
    await settle();

    const speed = container.querySelector<HTMLSelectElement>('.mvp-playback__speed');
    expect(speed).toBeTruthy();
    speed!.value = '4';
    speed!.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(m.setSpeed).toHaveBeenCalledWith(4);
  });

  it('steps one frame and reflects the reported position', async () => {
    const m = makeController();
    const container = mount(m.controller);
    await settle();

    const stepBtn = container.querySelector<HTMLButtonElement>('.mvp-playback__step');
    stepBtn!.click();
    await settle();
    expect(m.step).toHaveBeenCalledTimes(1);

    // The wiring reports the advanced position; the readout tracks it.
    m.push({ positionUs: 2_000_000, totalUs: 10_000_000, ended: false });
    await settle();
    expect(container.querySelector('.mvp-playback__time')?.textContent).toBe('0:02 / 0:10');

    // Play button shows paused after a step.
    expect(container.querySelector('.mvp-playback__play')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('returns the field spec when a preset is selected', async () => {
    const m = makeController();
    const onSelectPreset =
      vi.fn<(spec: AnalysisFieldSpec | undefined, preset: AnalysisPreset | undefined) => void>();
    const container = mount(m.controller, { onSelectPreset });
    await settle();

    const preset = container.querySelector<HTMLSelectElement>('.mvp-playback__preset');
    expect(preset).toBeTruthy();
    preset!.value = 'pid';
    preset!.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(onSelectPreset).toHaveBeenCalledTimes(1);
    const [spec, picked] = onSelectPreset.mock.calls[0]!;
    expect(picked?.id).toBe('pid');
    expect(spec?.presetId).toBe('pid');
    const fields = spec!.series.flatMap((s) => s.fields.map((f) => `${f.message}.${f.field}`));
    expect(fields).toContain('PID_TUNING.desired');
    expect(fields).toContain('PID_TUNING.achieved');

    // Choosing "None" clears the selection.
    preset!.value = '';
    preset!.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(onSelectPreset).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it('disables transport controls until a log duration is known', async () => {
    const m = makeController();
    const { container } = render(() =>
      createComponent(PlaybackControls, { controller: m.controller, t }),
    );
    await settle();
    expect(container.querySelector<HTMLButtonElement>('.mvp-playback__play')!.disabled).toBe(true);

    // A progress report carrying the total enables them.
    m.push({ positionUs: 0, totalUs: 8_000_000, ended: false });
    await settle();
    expect(container.querySelector<HTMLButtonElement>('.mvp-playback__play')!.disabled).toBe(false);
  });

  it('unsubscribes the controller on cleanup', async () => {
    const m = makeController();
    mount(m.controller);
    await settle();
    cleanup();
    expect(m.unsubscribed()).toBe(true);
  });
});
