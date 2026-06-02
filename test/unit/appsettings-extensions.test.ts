/**
 * App Settings → Extensions section: renders the shared ExtensionsManager when a
 * controller is wired, and an unavailable hint otherwise.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';
import { t } from '../../src/core/i18n';
import { ExtensionsSection } from '../../src/ui/shell/appsettings/sections/extensions';
import type { AppSettingsSectionDeps } from '../../src/ui/shell/appsettings';
import type { ExtensionsController } from '../../src/ui/screens/sim';
import type { Permission } from '../../src/contracts';

afterEach(cleanup);

function fakeController(): ExtensionsController {
  return {
    states: () => [],
    grants: () => new Map<string, readonly Permission[]>(),
    init: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined),
    installFromFile: vi.fn(async () => undefined),
  };
}

function deps(extensions?: ExtensionsController): AppSettingsSectionDeps {
  return {
    t,
    ...(extensions !== undefined ? { extensions } : {}),
  } as unknown as AppSettingsSectionDeps;
}

describe('ExtensionsSection', () => {
  it('renders the extensions manager when a controller is provided', () => {
    const { container } = render(() =>
      createComponent(ExtensionsSection, { deps: deps(fakeController()) }),
    );
    expect(container.querySelector('.mvp-extmgr')).toBeTruthy();
  });

  it('shows an unavailable hint without a controller', () => {
    const { container } = render(() => createComponent(ExtensionsSection, { deps: deps() }));
    expect(
      container.querySelector('[data-testid="appsettings-extensions-unavailable"]'),
    ).toBeTruthy();
    expect(container.querySelector('.mvp-extmgr')).toBeNull();
  });
});
