# tlog playback UI + preset analyses (T6.6)

Spec: `plan/04` §4.7 (playback) + §4.8 (preset analyses). Deps: the replay
transport (`src/transport/replay`, T1.8) and the MAVLink host (`src/mavlink/host`,
T1.9). This module owns **only** the playback control surface and the preset
definitions; the chart rendering is the plotter's job (T6.4) and the wiring into
the host's active link is the Logs assembly's job (T6.8).

## What's here

| File            | Role                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| `timeline.ts`   | **Pure** playback state machine: position / play / pause / speed / seek.   |
| `controller.ts` | `PlaybackController` seam + a `ReplayTransport` adapter + open helpers.    |
| `presets.ts`    | Preset analysis definitions + `presetFieldSpec` (the plotter spec).        |
| `playback.tsx`  | `PlaybackControls` — the Solid control bar (play/step/scrub/speed/preset). |
| `messages.ts`   | `logs.playback.*` i18n (registered at import via `registerMessages`).      |
| `playback.css`  | Layout (colours via design tokens).                                        |

Import from the barrel (`index.ts`), never deep paths.

## Control API (for T6.8 / the plotter)

The control bar is driven entirely through an injected **`PlaybackController`**,
so it is decoupled from the worker-importing host and unit-testable with a mock:

```ts
interface PlaybackController {
  play(): void;
  pause(): void;
  step(): void;
  seek(timeUs: number): void; // relative µs from the log start
  setSpeed(speed: number): void; // 0.1×–32×
  subscribe(listener: (p: PlaybackProgress) => void): () => void;
}
interface PlaybackProgress {
  positionUs: number;
  totalUs: number;
  ended: boolean;
}
```

Wire it to a real `ReplayTransport` (additive `resume/pause/step/seek/setSpeed`
methods) with the provided helpers:

```ts
import { openTlog, createReplayController, PlaybackControls } from '@/ui/screens/logs/playback';

// `transport` is a factory-created ReplayTransport; `data` is the tlog bytes
// (from a provided ArrayBuffer or `loadTlogBytes(fileIo)`).
const controller = await openTlog({ data, transport }); // parses duration, starts paused
// Feed live positions as the host replays frames:
controller.report(currentTimeUs, atEnd);

render(() => <PlaybackControls controller={controller} t={t}
  totalUs={tlogTotalUs(data)} onSelectPreset={(spec) => plotter.applyPreset(spec)} />, el);
```

`openTlog` opens the transport, parses the total duration up front (so the scrub
slider has a range), and pauses immediately so the UI starts paused. The Logs
assembly owns connecting the same transport as the host's active link and calling
`report(...)` from wherever it observes replayed frame timestamps.

The timeline reducers (`play`/`pause`/`seek`/`setSpeed`/`stepped`/`withProgress`)
are exported for advanced wiring and are 100% pure.

## Preset field-spec shape (for T6.4 / T6.8)

Picking a preset calls `onSelectPreset(spec, preset)` with an
**`AnalysisFieldSpec`** (or `undefined` for "None"):

```ts
interface AnalysisFieldSpec {
  presetId: string;
  series: ReadonlyArray<{
    id: string;
    labelKey: string; // i18n key for the series label
    axis: string; // series sharing an axis share a plot axis
    fields: ReadonlyArray<{ message: string; field: string }>; // MAVLink msg.field
  }>;
}
```

Shipped presets (spec §4.8): `vibration`, `ekf`, `battery`, `gps`, `pid`
(PID setpoint-vs-actual = `PID_TUNING.desired` vs `PID_TUNING.achieved` on a
shared axis). Field references use MAVLink message + field names because presets
analyse a replayed tlog stream.

## Accessibility

The scrub control is a native range input (implicit `role="slider"`) with an
`aria-valuetext` timecode; every button/select is labelled; the time readout is
an `aria-live="polite"` region that announces position changes.

## Test

```
export npm_config_cache="$PWD/.npm-cache"
npx vitest run test/unit/logs-playback*.test.ts
npx eslint src/ui/screens/logs/playback test/unit/logs-playback*.test.ts
```
