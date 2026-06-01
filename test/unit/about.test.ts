/** Unit coverage for the T9.2 About panel and bundled notices asset. */
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_VERSION, BUILD_HASH, EXT_API_VERSION } from '../../src/version';
import { BUILTIN_DIALECTS } from '../../src/mavlink/dialects';
import { createUiRegistry } from '../../src/ui/shell';
import {
  ABOUT_COMMAND_ID,
  ABOUT_PANEL_ID,
  AboutPanel,
  NOTICES_TEXT,
  bundledDialectInfo,
  registerAbout,
} from '../../src/ui/shell/about';
import { ABOUT_MESSAGES } from '../../src/ui/shell/about/messages';

const t = (key: string): string => ABOUT_MESSAGES[key] ?? key;

function clearFloatingAbout(): void {
  for (const el of document.querySelectorAll('.mvp-floating-panel--about')) el.remove();
}

afterEach(() => {
  cleanup();
  clearFloatingAbout();
});

describe('AboutPanel', () => {
  it('renders app/API/build metadata, bundled dialects and generated notices', () => {
    const { container, getByText } = render(() => createComponent(AboutPanel, { t }));

    expect(getByText(`MVPlanner ${APP_VERSION}`)).toBeTruthy();
    expect(getByText(EXT_API_VERSION)).toBeTruthy();
    expect(getByText(BUILD_HASH)).toBeTruthy();
    expect(container.textContent).toContain('no telemetry');
    for (const dialect of BUILTIN_DIALECTS) expect(container.textContent).toContain(dialect.name);

    const notices = container.querySelector<HTMLElement>('[data-testid="about-notices"]');
    expect(notices?.textContent?.length).toBeGreaterThan(1000);
    expect(notices?.textContent).toContain('solid-js@');
    expect(notices?.textContent).toContain('@codemirror/state@');
  });

  it('builds deterministic dialect rows from the bundled dialect tables', () => {
    const rows = bundledDialectInfo(t);

    expect(rows.map((row) => row.name)).toEqual(
      [...BUILTIN_DIALECTS].map((dialect) => dialect.name).sort((a, b) => a.localeCompare(b)),
    );
    expect(rows.every((row) => row.version.length > 0)).toBe(true);
  });
});

describe('About registration', () => {
  it('registers a dockable panel and palette command that opens the About viewer', () => {
    const registry = createUiRegistry();
    const dispose = registerAbout(registry, t);

    expect(registry.getPanel(ABOUT_PANEL_ID)?.title).toBe('About MVPlanner');
    const command = registry.commands().find((entry) => entry.id === ABOUT_COMMAND_ID);
    expect(command?.title).toBe('About MVPlanner');

    command?.run();
    const floating = document.querySelector<HTMLElement>('.mvp-floating-panel--about');
    expect(floating?.textContent).toContain(`MVPlanner ${APP_VERSION}`);
    expect(floating?.textContent).toContain('Third-party licenses');

    dispose();
    expect(registry.getPanel(ABOUT_PANEL_ID)).toBeUndefined();
    expect(registry.commands().some((entry) => entry.id === ABOUT_COMMAND_ID)).toBe(false);
  });
});

describe('generated NOTICES asset', () => {
  it('is non-empty, deterministic text for bundled runtime dependencies', () => {
    expect(NOTICES_TEXT).toContain('MVPlanner Third-Party Notices');
    expect(NOTICES_TEXT).toContain('Package count: 23');
    expect(NOTICES_TEXT).toContain('idb@8.0.3');
    expect(NOTICES_TEXT).toContain('uplot@1.6.32');
    expect(NOTICES_TEXT).toContain('License: MIT');
    expect(NOTICES_TEXT.endsWith('\n')).toBe(true);
  });
});
