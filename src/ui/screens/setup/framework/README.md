# `ui/screens/setup/framework` — Setup wizard framework (T5.2)

Spec: `plan/04` §4.4 (Initial Setup), `plan/05` §5.4 (Setup screen: left step
list with completion state + right guided wizard pane with live feedback +
"what this does / safety" callouts).

A reusable, **content-agnostic** wizard shell that the per-step setup UIs plug
into. It owns navigation, completion tracking and the safety/info callout — and
deliberately holds **no** calibration or param logic. Those live in the concrete
steps: T5.3 frame, T5.4 accel, T5.5 compass, T5.6 radio, T5.7 modes, T5.8
failsafe, T5.9 battery, T5.10 motors. The Setup screen assembly (T5.12) composes
the registry and mounts the shell.

## What it renders

- **Left step list** — a vertical `role="tablist"`; each tab shows an optional
  icon, the step title and a completion-state badge (`todo` / `active` / `done`
  / `warning` / `na`). Roving tabindex + Arrow/Home/End keyboard navigation.
- **Right guided pane** — the active step's `render(api)` content, preceded by an
  optional per-step `SafetyCallout` banner, with Back / Mark-complete / Next
  navigation. It is the matching `role="tabpanel"`.

Only the **active** step is mounted; switching steps unmounts the previous
step's content (its `onCleanup` runs) — the right default for live flows (a
calibration should stop when you leave it).

## How T5.3–T5.10 register a step

Each module exports a `SetupStep` (or a factory returning one) and the screen
assembly passes the ordered array to `WizardShell`:

```tsx
import { WizardShell, type SetupStep } from '../framework';

const frameStep: SetupStep = {
  id: 'frame',
  title: t('setup.frame.title'),
  icon: '🛠',
  safetyNote: t('setup.frame.safety'), // optional callout body
  status: () => (frameWritten() ? 'done' : 'todo'), // optional derived status
  allowManualComplete: false, // hide built-in "Mark complete"
  render: (api) => <FrameSetup client={paramClient} api={api} />,
};

<WizardShell steps={[frameStep, accelStep /* … */]} t={t} />;
```

### `SetupStep`

| field                  | meaning                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `id`                   | stable, unique; used for tab/panel ids + override keys         |
| `title`                | display title (the module resolves it via `t()`)               |
| `icon?`                | decorative glyph/short text before the title (`aria-hidden`)   |
| `safetyNote?`          | "what this does / safety" callout body shown above content     |
| `status?`              | reactive accessor deriving settled status (e.g. param-derived) |
| `allowManualComplete?` | show the built-in "Mark complete" button (default `true`)      |
| `render(api)`          | render the guided content; receives `SetupStepApi`             |

### `SetupStepApi` (injection surface passed to `render`)

- `t` — the i18n function.
- `setStatus(status)` / `markComplete()` / `clearStatus()` — report completion
  explicitly. An explicit status **wins over** the `status` accessor until
  `clearStatus()` is called.
- `next()` / `prev()` — move through the wizard.
- `isActive()` — reactive: is this step the active one.

### Status semantics

- Settled statuses: `todo` · `done` · `warning` · `na`. The shell adds the
  transient `active` badge for the selected step **while it is still `todo`**.
- Completion: `done` **or** `na` counts as complete; `warning` does **not**.
  Resolution precedence is explicit override → `status` accessor → `todo`.

## Public API

- `WizardShell(props)` — Solid component (`steps`, `t`, `initialStepId?`,
  `onActiveStepChange?`).
- `SafetyCallout(props)` — the callout banner (`note`, `t`, `kind?` =
  `'safety' | 'info'`, `title?`).
- Pure helpers (unit-tested, no Solid/DOM): `resolveSettledStatus`,
  `toDisplayStatus`, `isComplete`, `summarizeCompletion`, `statusMessageKey`;
  `stepIndex`, `clampIndex`, `nextStepId`, `prevStepId`, `resolveInitialStepId`,
  `navTargetId`.
- `registerSetupMessages()` — registers the framework's `setup.*` English
  strings (also runs as an import side effect of `WizardShell`). Per-step modules
  register their own `setup.<step>.*` namespaces.

## How to test

- `test/unit/setup-framework-status.test.ts` — the pure status/derivation +
  navigation logic.
- `test/unit/setup-framework-widget.test.ts` — the `WizardShell` over a stub
  step registry: renders steps with statuses, switching active swaps the pane,
  the safety callout shows for a step with a note, completion reflects status.

> **Integration note.** Per the task boundary this framework does NOT edit the
> Setup screen assembly or `App.tsx`; composing the concrete steps and importing
> `./wizard-shell.css` is the screen-assembly (T5.12) integration step.
