/**
 * tlog playback control bar (task T6.6; spec plan/04 §4.7, plan/05 §5.5).
 *
 * A transport-style control surface for replaying a tlog through the live app
 * stack: play/pause, single-frame step, a scrub/seek slider over the log
 * timeline, a 0.1×–32× speed selector, a current-time / total-time readout, and
 * a preset-analysis selector (spec §4.8). All control state lives in the pure
 * {@link import('./timeline').TimelineState} machine; user actions and live
 * progress are forwarded to/from the injected {@link PlaybackController}, so the
 * component is fully testable against a mock controller.
 *
 * Accessibility: the scrub control is a native range input (implicit
 * `role="slider"`) with an `aria-valuetext` timecode; every control is labelled,
 * and the time readout is an `aria-live` region announcing position changes.
 */
import {
  For,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import './messages';
import type { PlaybackController, PlaybackProgress } from './controller';
import {
  PLAYBACK_SPEEDS,
  formatTimecode,
  initialTimeline,
  seek as seekTl,
  setSpeed as setSpeedTl,
  stepped as steppedTl,
  togglePlay,
  withProgress,
  withTotal,
  type TimelineState,
} from './timeline';
import {
  ANALYSIS_PRESETS,
  getPreset,
  presetFieldSpec,
  type AnalysisFieldSpec,
  type AnalysisPreset,
} from './presets';

/** The i18n translate function (matches `core/i18n` `t` / `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** {@link PlaybackControls} props. */
export interface PlaybackControlsProps {
  /** The injected controller driving the replay transport (or a mock in tests). */
  controller: PlaybackController;
  /** i18n translate function. */
  t: TFn;
  /** Known total log duration in µs before the first progress report (default 0). */
  totalUs?: number;
  /** Externally disable every control (e.g. while a new log is loading). */
  disabled?: boolean;
  /** Speed steps to offer (default {@link PLAYBACK_SPEEDS}). */
  speeds?: readonly number[];
  /** Preset analyses to offer (default {@link ANALYSIS_PRESETS}). */
  presets?: readonly AnalysisPreset[];
  /**
   * Called when the operator picks a preset analysis: receives the resolved
   * field-selection spec (or `undefined` when "None" is chosen) for the plotter.
   */
  onSelectPreset?: (
    spec: AnalysisFieldSpec | undefined,
    preset: AnalysisPreset | undefined,
  ) => void;
}

/** The tlog playback transport control bar + preset selector. */
export const PlaybackControls: Component<PlaybackControlsProps> = (props) => {
  const t = props.t;
  const speeds = (): readonly number[] => props.speeds ?? PLAYBACK_SPEEDS;
  const presets = (): readonly AnalysisPreset[] => props.presets ?? ANALYSIS_PRESETS;

  const [timeline, setTimeline] = createSignal<TimelineState>(initialTimeline(props.totalUs ?? 0));
  const [presetId, setPresetId] = createSignal<string>('');

  onMount(() => {
    const off = props.controller.subscribe((progress: PlaybackProgress) => {
      setTimeline((s) => withProgress(s, progress));
    });
    onCleanup(off);
  });

  // Keep the timeline's total in sync when the prop changes after mount
  // (e.g. a new tlog is opened while the controls stay mounted).
  createEffect(() => {
    const total = props.totalUs ?? 0;
    setTimeline((s) => withTotal(s, total));
  });

  const disabled = createMemo<boolean>(() => props.disabled === true || timeline().totalUs <= 0);

  const onTogglePlay = (): void => {
    const next = togglePlay(timeline());
    setTimeline(next);
    if (next.playing) props.controller.play();
    else props.controller.pause();
  };

  const onStep = (): void => {
    setTimeline((s) => steppedTl(s));
    props.controller.step();
  };

  const onSeek = (raw: string): void => {
    const next = seekTl(timeline(), Number(raw));
    setTimeline(next);
    props.controller.seek(next.positionUs);
  };

  const onSpeed = (raw: string): void => {
    const next = setSpeedTl(timeline(), Number(raw));
    setTimeline(next);
    props.controller.setSpeed(next.speed);
  };

  const onPreset = (id: string): void => {
    setPresetId(id);
    const preset = id === '' ? undefined : getPreset(id);
    const spec = preset === undefined ? undefined : presetFieldSpec(preset);
    props.onSelectPreset?.(spec, preset);
  };

  const speedLabel = (n: number): string => t('logs.playback.speedValue', { n });
  const currentTimecode = (): string => formatTimecode(timeline().positionUs);
  const totalTimecode = (): string => formatTimecode(timeline().totalUs);
  const readout = (): string =>
    t('logs.playback.timeReadout', { current: currentTimecode(), total: totalTimecode() });

  return (
    <section class="mvp-playback" role="group" aria-label={t('logs.playback.region')}>
      <div class="mvp-playback__transport" role="group" aria-label={t('logs.playback.transport')}>
        <button
          type="button"
          class="mvp-playback__btn mvp-playback__play"
          aria-label={timeline().playing ? t('logs.playback.pause') : t('logs.playback.play')}
          aria-pressed={timeline().playing}
          disabled={disabled()}
          onClick={onTogglePlay}
        >
          {timeline().playing ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          class="mvp-playback__btn mvp-playback__step"
          aria-label={t('logs.playback.step')}
          disabled={disabled()}
          onClick={onStep}
        >
          ⏭
        </button>
      </div>

      <input
        class="mvp-playback__scrub"
        type="range"
        min={0}
        max={Math.max(0, timeline().totalUs)}
        step={1}
        value={timeline().positionUs}
        disabled={disabled()}
        aria-label={t('logs.playback.seek')}
        aria-valuetext={readout()}
        onInput={(e) => onSeek(e.currentTarget.value)}
      />

      <output class="mvp-playback__time" aria-live="polite" aria-label={t('logs.playback.time')}>
        {readout()}
      </output>

      <label class="mvp-playback__speedbox">
        <span class="mvp-playback__label">{t('logs.playback.speed')}</span>
        <select
          class="mvp-playback__speed"
          aria-label={t('logs.playback.speed')}
          value={String(timeline().speed)}
          disabled={disabled()}
          onChange={(e) => onSpeed(e.currentTarget.value)}
        >
          <For each={speeds()}>{(n) => <option value={String(n)}>{speedLabel(n)}</option>}</For>
        </select>
      </label>

      <label class="mvp-playback__presetbox">
        <span class="mvp-playback__label">{t('logs.playback.preset')}</span>
        <select
          class="mvp-playback__preset"
          aria-label={t('logs.playback.preset')}
          value={presetId()}
          onChange={(e) => onPreset(e.currentTarget.value)}
        >
          <option value="">{t('logs.playback.preset.none')}</option>
          <For each={presets()}>{(p) => <option value={p.id}>{t(p.labelKey)}</option>}</For>
        </select>
      </label>
    </section>
  );
};
