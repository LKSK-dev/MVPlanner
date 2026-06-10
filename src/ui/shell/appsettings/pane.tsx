/**
 * App Settings pane (spec docs/appsettings §3/§4): a left overlay drawer that
 * opens from the top-left brand. Hosts the app-wide settings sections behind a
 * keyboard-navigable rail (ARIA tablist). Accessible: labelled dialog, focus
 * moves in on open and is restored on close, Escape/backdrop/× close, copy via
 * `t()`, honors reduced motion (CSS).
 */
import { For, Show, createEffect, type Component, type JSX } from 'solid-js';
import type {
  AppSettingsContextValue,
  AppSettingsSection,
  AppSettingsSectionDeps,
} from './context';
import './messages';

/** {@link AppSettingsPane} props. */
export interface AppSettingsPaneProps {
  /** Pane control (open/close/section state). */
  readonly control: AppSettingsContextValue;
  /** Registered sections, in rail order. */
  readonly sections: readonly AppSettingsSection[];
  /** Shared section dependencies. */
  readonly deps: AppSettingsSectionDeps;
}

/** The App Settings overlay drawer. Renders nothing unless open. */
export const AppSettingsPane: Component<AppSettingsPaneProps> = (props) => {
  const t = props.deps.t;
  const control = props.control;
  let panelEl: HTMLDivElement | undefined;
  let restoreFocusEl: HTMLElement | null = null;

  const activeId = (): string => {
    const current = control.section();
    return props.sections.some((s) => s.id === current)
      ? current
      : (props.sections[0]?.id ?? current);
  };
  const activeSection = (): AppSettingsSection | undefined =>
    props.sections.find((s) => s.id === activeId());

  // Focus in on open; restore to the trigger on close.
  createEffect(() => {
    if (control.isOpen()) {
      restoreFocusEl = document.activeElement as HTMLElement | null;
      queueMicrotask(() => panelEl?.focus());
    } else if (restoreFocusEl) {
      const el = restoreFocusEl;
      restoreFocusEl = null;
      queueMicrotask(() => el.focus?.());
    }
  });

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      control.close();
      return;
    }
    if (e.key !== 'Tab') return;
    // Trap Tab/Shift+Tab between the first and last focusable child (matches
    // the alert-center / command-palette modal pattern).
    const focusables = Array.from(
      panelEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const current = document.activeElement;
    if (e.shiftKey) {
      if (current === first || current === panelEl) {
        e.preventDefault();
        last.focus();
      }
    } else if (current === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Roving arrow-key navigation across the rail tabs.
  const onRailKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const ids = props.sections.map((s) => s.id);
    const i = ids.indexOf(activeId());
    if (i < 0) return;
    const next = e.key === 'ArrowDown' ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length;
    const id = ids[next];
    if (id !== undefined) control.setSection(id);
    // Roving tabindex: move DOM focus to the newly-active rail tab.
    const rail = e.currentTarget as HTMLElement | null;
    rail?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <Show when={control.isOpen()}>
      <div class="mvp-appsettings-overlay">
        <button
          type="button"
          class="mvp-appsettings__backdrop"
          aria-label={t('appsettings.close')}
          tabindex={-1}
          onClick={() => control.close()}
        />
        <aside
          class="mvp-appsettings"
          id="mvp-appsettings"
          role="dialog"
          aria-modal="true"
          aria-label={t('appsettings.title')}
          ref={panelEl}
          tabindex={-1}
          onKeyDown={onKeyDown}
        >
          <header class="mvp-appsettings__header">
            <h2 class="mvp-appsettings__title">{t('appsettings.title')}</h2>
            <button
              type="button"
              class="mvp-appsettings__close"
              data-testid="appsettings-close"
              aria-label={t('appsettings.close')}
              onClick={() => control.close()}
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <div class="mvp-appsettings__body">
            <nav
              class="mvp-appsettings__rail"
              role="tablist"
              aria-orientation="vertical"
              aria-label={t('appsettings.title')}
              onKeyDown={onRailKeyDown}
            >
              <For each={props.sections}>
                {(s) => (
                  <button
                    type="button"
                    role="tab"
                    class="mvp-appsettings__tab"
                    classList={{ 'mvp-appsettings__tab--active': activeId() === s.id }}
                    aria-selected={activeId() === s.id}
                    data-testid={`appsettings-tab-${s.id}`}
                    tabindex={activeId() === s.id ? 0 : -1}
                    onClick={() => control.setSection(s.id)}
                  >
                    {t(s.labelKey)}
                  </button>
                )}
              </For>
            </nav>

            <section
              class="mvp-appsettings__section"
              role="tabpanel"
              aria-label={activeSection() ? t(activeSection()!.labelKey) : t('appsettings.title')}
              data-section={activeId()}
            >
              {activeSection()?.render(props.deps) as JSX.Element}
            </section>
          </div>
        </aside>
      </div>
    </Show>
  );
};
