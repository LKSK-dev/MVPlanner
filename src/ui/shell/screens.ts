/**
 * The six top-level screens (T0.7; spec plan/05 §5.2). For M0 each screen is an
 * empty, labelled placeholder panel — real screen contents land in later
 * milestones (M2–M7). Screens are registered as {@link PanelDef}s so they mount
 * through the same dock/panel surface extensions use (contract
 * `src/contracts/ui.ts`).
 */
import type { PanelApi, PanelDef, ScreenId } from '../../contracts';

/** Navigation order of the primary screens (spec plan/05 §5.2). */
export const SCREEN_ORDER: readonly ScreenId[] = [
  'flight',
  'plan',
  'setup',
  'config',
  'logs',
  'sim',
];

/** Registered panel id for a screen. */
export function screenPanelId(screen: ScreenId): string {
  return `screen.${screen}`;
}

/**
 * Real screen-panel overrides, keyed by {@link ScreenId}. A later milestone
 * builds a screen's real {@link PanelDef} (with its services wired) and installs
 * it here via {@link setScreenPanel} BEFORE the shell renders; the shell then
 * mounts that panel instead of the placeholder, keeping the rest as placeholders
 * (T2.11 replaces `flight`). The map is intentionally tiny + module-scoped so
 * the override is in place by the time {@link createScreenPanels} runs during the
 * shell's synchronous setup — no mount-order races.
 */
const screenPanelOverrides = new Map<ScreenId, PanelDef>();

/**
 * Install (or clear, when `panel` is `undefined`) the real {@link PanelDef} for
 * `screen`, replacing its placeholder. Returns a disposer that removes the
 * override (only if it is still the one installed).
 */
export function setScreenPanel(screen: ScreenId, panel: PanelDef | undefined): () => void {
  if (panel === undefined) {
    screenPanelOverrides.delete(screen);
    return () => undefined;
  }
  screenPanelOverrides.set(screen, panel);
  return () => {
    if (screenPanelOverrides.get(screen) === panel) screenPanelOverrides.delete(screen);
  };
}

/** Build the placeholder {@link PanelDef} for one screen. */
function createScreenPanel(screen: ScreenId): PanelDef {
  return {
    id: screenPanelId(screen),
    title: screen,
    mount(el: HTMLElement, api: PanelApi): () => void {
      const section = document.createElement('section');
      section.className = 'mvp-screen';
      section.setAttribute('role', 'region');
      section.setAttribute(
        'aria-label',
        api.t('a11y.screenRegion', { screen: api.t(`nav.${screen}`) }),
      );
      section.dataset['screen'] = screen;

      const title = document.createElement('h2');
      title.className = 'mvp-screen__title';
      title.textContent = api.t(`nav.${screen}`);

      const hint = document.createElement('p');
      hint.className = 'mvp-screen__hint';
      hint.textContent = api.t('screen.placeholder', { screen: api.t(`nav.${screen}`) });

      section.append(title, hint);
      el.append(section);
      return () => section.remove();
    },
  };
}

/**
 * Build the screen panels in {@link SCREEN_ORDER}: the real {@link PanelDef} for
 * any screen with an installed override ({@link setScreenPanel}), else the
 * labelled placeholder. T2.11 installs the real `flight` screen; the other five
 * remain placeholders until their milestone.
 */
export function createScreenPanels(): PanelDef[] {
  return SCREEN_ORDER.map((screen) => {
    const base = screenPanelOverrides.get(screen) ?? createScreenPanel(screen);
    // Tag each screen as a dockable, single-instance widget (category 'Screens')
    // so it appears in the layout editor's “Add widget” palette and can be tiled
    // into any workspace.
    return {
      ...base,
      meta: { ...base.meta, category: 'appsettings.layout.category.screens', singleton: true },
    };
  });
}
