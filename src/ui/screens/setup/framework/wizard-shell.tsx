/**
 * WizardShell — the Setup screen framework (task T5.2; spec plan/04 §4.4,
 * plan/05 §5.4 Setup).
 *
 * Renders the left STEP LIST (each step: icon? + title + completion-state badge)
 * and the right guided PANE (active step's content + an optional per-step
 * safety/info callout + Back / Mark-complete / Next navigation). It is purely a
 * framework: it owns navigation, completion tracking and the callout, but holds
 * NO calibration/param logic — concrete steps (T5.3–T5.10) inject that through
 * the {@link SetupStep} registry and the {@link SetupStepApi} handed to
 * `render`.
 *
 * Completion derives from each step's `status` accessor (e.g. param-derived) or
 * an explicit override set via the api ("Mark complete"). Accessibility: the
 * step list is a vertical `role="tablist"` with roving tabindex + arrow/Home/End
 * keyboard navigation; the pane is the matching `role="tabpanel"`.
 *
 * Only the active step is mounted: switching steps unmounts the previous step's
 * content (its `onCleanup` runs), which is the right default for live setup
 * flows (e.g. a calibration must stop when you navigate away).
 */
import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { SafetyCallout } from './safety-callout';
import {
  navTargetId,
  nextStepId,
  prevStepId,
  resolveInitialStepId,
  type StepNavKey,
} from './navigation';
import {
  resolveSettledStatus,
  statusMessageKey,
  summarizeCompletion,
  toDisplayStatus,
} from './status';
import type { SetupStep, SetupStepApi, SettledStatus, StepStatus, TFn } from './types';
import './messages';

/** {@link WizardShell} props. */
export interface WizardShellProps {
  /** Ordered step registry; the concrete setup UIs contribute these. */
  steps: readonly SetupStep[];
  /** i18n translate function. */
  t: TFn;
  /** Optional initial active step id (defaults to the first step). */
  initialStepId?: string;
  /** Notified whenever the active step changes (for screen-level wiring). */
  onActiveStepChange?: (id: string) => void;
}

/** The setup wizard shell: left step list + right guided pane. */
export const WizardShell: Component<WizardShellProps> = (props) => {
  const t = props.t;

  const [activeId, setActiveId] = createSignal<string | undefined>(
    resolveInitialStepId(props.steps, props.initialStepId),
  );
  const [overrides, setOverrides] = createSignal<ReadonlyMap<string, SettledStatus>>(
    new Map<string, SettledStatus>(),
  );

  const tabEls = new Map<string, HTMLButtonElement>();

  /** The effective active id: the selection if still present, else the first. */
  const effectiveActiveId = createMemo<string | undefined>(() => {
    const id = activeId();
    if (id !== undefined && props.steps.some((s) => s.id === id)) return id;
    return props.steps[0]?.id;
  });

  const activeStep = createMemo<SetupStep | undefined>(() => {
    const id = effectiveActiveId();
    return props.steps.find((s) => s.id === id);
  });

  const settledOf = (step: SetupStep): SettledStatus => resolveSettledStatus(step, overrides());

  const summary = createMemo(() => summarizeCompletion(props.steps, settledOf));

  const select = (id: string | undefined): void => {
    if (id === undefined || !props.steps.some((s) => s.id === id)) return;
    setActiveId(id);
    props.onActiveStepChange?.(id);
  };

  const setStatusFor = (id: string, status: SettledStatus): void => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(id, status);
      return next;
    });
  };

  const clearStatusFor = (id: string): void => {
    setOverrides((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const makeApi = (step: SetupStep): SetupStepApi => ({
    t,
    setStatus: (status: SettledStatus): void => setStatusFor(step.id, status),
    markComplete: (): void => setStatusFor(step.id, 'done'),
    clearStatus: (): void => clearStatusFor(step.id),
    next: (): void => select(nextStepId(props.steps, step.id)),
    prev: (): void => select(prevStepId(props.steps, step.id)),
    isActive: (): boolean => effectiveActiveId() === step.id,
  });

  const onKeyDown = (e: KeyboardEvent): void => {
    let nav: StepNavKey | undefined;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        nav = 'next';
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        nav = 'prev';
        break;
      case 'Home':
        nav = 'first';
        break;
      case 'End':
        nav = 'last';
        break;
      default:
        return;
    }
    e.preventDefault();
    const target = navTargetId(props.steps, effectiveActiveId(), nav);
    select(target);
    if (target !== undefined) tabEls.get(target)?.focus();
  };

  return (
    <section
      class="mvp-setup-wizard"
      data-screen="setup"
      role="region"
      aria-label={t('setup.title')}
    >
      <div class="mvp-setup-wizard__layout">
        <nav class="mvp-setup-wizard__steps">
          <p class="mvp-setup-wizard__progress" aria-live="polite">
            {t('setup.progress', { done: summary().complete, total: summary().total })}
          </p>
          <ul
            class="mvp-setup-wizard__steplist"
            role="tablist"
            aria-orientation="vertical"
            aria-label={t('setup.steps.label')}
            onKeyDown={onKeyDown}
          >
            <For
              each={props.steps}
              fallback={
                <li class="mvp-setup-wizard__empty" role="status">
                  {t('setup.empty')}
                </li>
              }
            >
              {(step) => {
                const isActive = (): boolean => effectiveActiveId() === step.id;
                const display = (): StepStatus => toDisplayStatus(settledOf(step), isActive());
                return (
                  <li class="mvp-setup-wizard__step" role="presentation">
                    <button
                      type="button"
                      role="tab"
                      class="mvp-setup-wizard__steptab"
                      classList={{ 'is-active': isActive() }}
                      data-status={display()}
                      id={`mvp-setup-tab-${step.id}`}
                      aria-controls={`mvp-setup-panel-${step.id}`}
                      aria-selected={isActive()}
                      tabindex={isActive() ? 0 : -1}
                      ref={(el): void => {
                        tabEls.set(step.id, el);
                      }}
                      onClick={(): void => select(step.id)}
                    >
                      <Show when={step.icon}>
                        {(icon) => (
                          <span class="mvp-setup-wizard__stepicon" aria-hidden="true">
                            {icon()}
                          </span>
                        )}
                      </Show>
                      <span class="mvp-setup-wizard__steptitle">{step.title}</span>
                      <span class="mvp-setup-wizard__stepstatus" data-status={display()}>
                        {t(statusMessageKey(display()))}
                      </span>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </nav>

        <Show
          when={activeStep()}
          keyed
          fallback={
            <section class="mvp-setup-wizard__pane" role="tabpanel" tabindex={0}>
              <p class="mvp-setup-wizard__paneempty" role="status">
                {t('setup.empty')}
              </p>
            </section>
          }
        >
          {(step) => {
            const api = makeApi(step);
            return (
              <section
                class="mvp-setup-wizard__pane"
                role="tabpanel"
                id={`mvp-setup-panel-${step.id}`}
                aria-labelledby={`mvp-setup-tab-${step.id}`}
                tabindex={0}
              >
                <header class="mvp-setup-wizard__panehead">
                  <h2 class="mvp-setup-wizard__panetitle">{step.title}</h2>
                </header>

                <Show when={step.safetyNote}>
                  {(note) => <SafetyCallout note={note()} t={t} />}
                </Show>

                <div class="mvp-setup-wizard__panebody">{step.render(api)}</div>

                <footer class="mvp-setup-wizard__nav">
                  <button
                    type="button"
                    class="mvp-setup-wizard__navbtn mvp-setup-wizard__navbtn--prev"
                    disabled={prevStepId(props.steps, step.id) === undefined}
                    onClick={(): void => api.prev()}
                  >
                    {t('setup.prev')}
                  </button>
                  <Show when={step.allowManualComplete !== false}>
                    <button
                      type="button"
                      class="mvp-setup-wizard__navbtn mvp-setup-wizard__navbtn--complete"
                      onClick={(): void => {
                        api.markComplete();
                        api.next();
                      }}
                    >
                      {t('setup.markComplete')}
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="mvp-setup-wizard__navbtn mvp-setup-wizard__navbtn--next"
                    disabled={nextStepId(props.steps, step.id) === undefined}
                    onClick={(): void => api.next()}
                  >
                    {t('setup.next')}
                  </button>
                </footer>
              </section>
            );
          }}
        </Show>
      </div>
    </section>
  );
};
