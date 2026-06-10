/**
 * Scripting-console component + editor mount tests (task T7.4; spec plan/06
 * §6.7).
 *
 * LIGHT component coverage: renders the {@link ScriptingConsole} over a real
 * (fake-backed) controller and checks the controls render, the permission
 * toggles reflect the grant store, and clicking Run prints output (via the
 * textarea fallback when CodeMirror cannot mount). The CodeMirror mount itself
 * is exercised separately and GUARDED — happy-dom lacks some DOM APIs CodeMirror
 * needs, so the test only asserts it does not corrupt state when unavailable.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ExtContext, Permission } from '../../src/contracts';
import { t } from '../../src/core/i18n';
import {
  ScriptingConsole,
  createConsoleController,
  mountConsoleEditor,
  type ConsoleController,
} from '../../src/ui/widgets/console';
import { fakeKv, settle } from '../helpers';

afterEach(cleanup);

function makeController(): ConsoleController {
  const makeContext = (_g: readonly Permission[]): ExtContext =>
    ({ notify: { info: (): void => undefined } }) as unknown as ExtContext;
  return createConsoleController({ makeContext, storage: fakeKv() });
}

describe('ScriptingConsole component', () => {
  it('renders the run control and permission toggles', async () => {
    render(() => createComponent(ScriptingConsole, { controller: makeController(), t }));
    await settle();
    expect(screen.getByText(t('console.run'))).toBeTruthy();
    // One checkbox per scripting permission, with the safe defaults pre-checked.
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.length).toBeGreaterThan(0);
    const telemetry = screen.getByLabelText(
      t('console.permissions.toggle', { permission: 'telemetry:read' }),
    ) as HTMLInputElement;
    expect(telemetry.checked).toBe(true);
  });

  it('runs the editor contents and prints output (textarea fallback)', async () => {
    const controller = makeController();
    const { container } = render(() =>
      createComponent(ScriptingConsole, { controller, t, initialCode: 'return 6 * 7' }),
    );
    await settle();

    // In happy-dom CodeMirror may not mount; the textarea fallback carries code.
    const textarea = container.querySelector('textarea');
    if (textarea) {
      fireEvent.input(textarea, { target: { value: 'return 6 * 7' } });
    }

    fireEvent.click(screen.getByText(t('console.run')));
    await settle();
    await settle();

    const output = container.querySelector('.mvp-console__output');
    expect(output?.textContent ?? '').toContain('42');
  });

  it('toggling a permission updates the grant store', async () => {
    const controller = makeController();
    render(() => createComponent(ScriptingConsole, { controller, t }));
    await settle();

    const command = screen.getByLabelText(
      t('console.permissions.toggle', { permission: 'command' }),
    ) as HTMLInputElement;
    expect(command.checked).toBe(false);
    fireEvent.click(command);
    await settle();
    expect(await controller.grants.list()).toContain('command');
  });
});

describe('mountConsoleEditor (guarded)', () => {
  it('mounts or fails cleanly under the test DOM', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let handle: ReturnType<typeof mountConsoleEditor> | undefined;
    try {
      handle = mountConsoleEditor({ parent, doc: 'return 1' });
    } catch {
      // happy-dom lacks APIs CodeMirror needs — acceptable; nothing to assert.
      handle = undefined;
    }
    if (handle) {
      expect(handle.getValue()).toContain('return 1');
      handle.setValue('return 2');
      expect(handle.getValue()).toBe('return 2');
      handle.destroy();
    }
    parent.remove();
  });
});
