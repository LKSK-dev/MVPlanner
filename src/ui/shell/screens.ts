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

/** Build placeholder panels for every screen, in {@link SCREEN_ORDER}. */
export function createScreenPanels(): PanelDef[] {
  return SCREEN_ORDER.map(createScreenPanel);
}
