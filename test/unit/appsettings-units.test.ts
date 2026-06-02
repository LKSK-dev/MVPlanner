/**
 * App Settings → Units & Language section tests (spec docs/appsettings §3/§7/§9).
 *
 * Renders {@link UnitsSection} + {@link LanguageSection} over a fresh
 * `createAppStore()` and asserts the unit select patches `settings.units` (and
 * the live preview re-renders), and the language select patches
 * `settings.language`. The sections only read `deps.store` + `deps.t`, so the
 * remaining {@link AppSettingsSectionDeps} fields are stubbed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { AppState, Store } from '../../src/contracts';
import { createAppStore } from '../../src/core/store';
import { registerLocale, t } from '../../src/core/i18n';
import type { AppSettingsSectionDeps } from '../../src/ui/shell/appsettings/context';
import { UnitsSection } from '../../src/ui/shell/appsettings/sections/units';
import { LanguageSection } from '../../src/ui/shell/appsettings/sections/language';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(cleanup);

/** Build section deps backed by a real store; unused seams are stubbed. */
function makeDeps(store: Store<AppState>): AppSettingsSectionDeps {
  return { store, t } as unknown as AppSettingsSectionDeps;
}

describe('UnitsSection', () => {
  it('patches settings.units and re-renders the live preview', async () => {
    const store = createAppStore();
    const deps = makeDeps(store);
    const { getByTestId } = render(() => createComponent(UnitsSection, { deps }));

    const altitude = getByTestId('appsettings-units-preview-altitude');
    expect(altitude.textContent ?? '').toMatch(/\bm$/); // metric → metres

    fireEvent.change(getByTestId('appsettings-units-system'), {
      target: { value: 'imperial' },
    });
    await settle();

    expect(store.get().settings.units).toBe('imperial');
    expect(altitude.textContent ?? '').toMatch(/\bft$/); // imperial → feet
  });

  it('patches settings.coordinateFormat and re-renders the coordinate preview', async () => {
    const store = createAppStore();
    const deps = makeDeps(store);
    const { getByTestId } = render(() => createComponent(UnitsSection, { deps }));

    const coord = getByTestId('appsettings-units-preview-coord');
    const ddCoord = coord.textContent ?? '';

    fireEvent.change(getByTestId('appsettings-units-coord'), { target: { value: 'dms' } });
    await settle();

    expect(store.get().settings.coordinateFormat).toBe('dms');
    expect(coord.textContent ?? '').not.toBe(ddCoord);
  });
});

describe('LanguageSection', () => {
  it('patches settings.language from the selected locale', async () => {
    registerLocale('fr', { 'appsettings.language.label': 'Langue' });
    const store = createAppStore();
    const deps = makeDeps(store);
    const { getByTestId } = render(() => createComponent(LanguageSection, { deps }));

    expect(store.get().settings.language).toBe('en');

    fireEvent.change(getByTestId('appsettings-language'), { target: { value: 'fr' } });
    await settle();

    expect(store.get().settings.language).toBe('fr');
  });
});
