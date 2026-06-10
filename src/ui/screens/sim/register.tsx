/**
 * Sim & Dev Tools wiring (M7 assembly; spec plan/05 §5.4, plan/06
 * §6.1/§6.5/§6.7).
 *
 * {@link createSimDevTools} is the single integration site App calls to light up
 * the extension developer surface:
 *  - builds the {@link ConsoleController} whose `makeContext` assembles a
 *    {@link assembleExtContext} over the wired system broker for the
 *    user-controlled scripting permission profile (vehicle-affecting calls share
 *    the same broker as extensions);
 *  - registers the scripting console + API reference panels and palette commands;
 *  - builds the extensions-manager controller + panel + palette command;
 *  - composes the `sim` screen as the {@link SimDevHub} and installs it over the
 *    placeholder via {@link setScreenPanel};
 *  - restores persisted installs, loads the bundled examples and binds macros.
 *
 * Everything is torn down via the returned {@link SimDevTools.dispose}.
 */
import { createComponent, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type {
  AppState,
  FileIo,
  KvStore,
  Permission,
  PanelApi,
  PanelDef,
  Store,
  UiRegistry,
} from '../../../contracts';
import {
  type EventsBus,
  type ExtApiServices,
  type ExtensionSystem,
  assembleExtContext,
  buildExtApiDts,
} from '../../../ext/api';
import { DisposeRegistry, type ExtModule } from '../../../ext/host';
import type { GrantPrompt } from '../../../ext/permissions';
import { SCRIPTING_EXT_ID } from '../../../ext/scripting';
import { EXT_API_VERSION } from '../../../version';
import { setScreenPanel, screenPanelId } from '../../shell';
import {
  createConsoleController,
  createScriptingConsolePanel,
  registerScriptingConsole,
  type MakeContext,
} from '../../widgets/console';
import { createApiReferencePanel, registerApiReference } from './api-ref';
import { createExtensionsManagerPanel, EXTENSIONS_MANAGER_COMMAND_ID } from './extensions-manager';
import { createExtensionsController, type ExtensionsController } from './controller';
import { SimDevHub } from './dev-hub';
import './messages';
import './sim.css';
import './extensions-manager.css';
import './install-prompt.css';
import './api-ref/api-reference.css';
import type { TFn } from '../../../core/i18n';
import '../../widgets/console/console.css';

export type { TFn };

/** Construction dependencies for {@link createSimDevTools}. */
export interface SimDevToolsDeps {
  /** The wired extension system (one instance, instantiated by App). */
  readonly system: ExtensionSystem;
  /** The adapted service ports the console context wraps. */
  readonly services: ExtApiServices;
  /** The shared inter-extension/console event bus. */
  readonly events: EventsBus;
  /** Install-time permission prompt (rendered at the app root by App). */
  readonly prompt: GrantPrompt;
  /** Storage file picker for extension import. */
  readonly files: FileIo;
  /** KV store backing the console snippets / macros / grants. */
  readonly storage: KvStore;
  /** The shell UI registry. */
  readonly registry: UiRegistry;
  /** The shared app store (screen navigation for palette commands). */
  readonly store: Store<AppState>;
  /** i18n translate fn. */
  readonly t: TFn;
  /** Bundled example modules to install at init. */
  readonly examples?: readonly ExtModule[];
}

/** The wired dev tools: the disposer plus the controllers (for tests). */
export interface SimDevTools {
  /** Tear down every registration, the hub override and the console scope. */
  dispose(): void;
  /** The extensions-manager controller. */
  readonly manager: ExtensionsController;
  /** Run the async startup (restore + load examples + bind macros). */
  ready(): Promise<void>;
}

/** Wire the Sim & Dev Tools hub + extension system surface. See file header. */
export function createSimDevTools(deps: SimDevToolsDeps): SimDevTools {
  const { system, services, events, registry, store, t } = deps;

  // Console scripting context: assembled over the SAME broker as extensions so
  // vehicle-affecting console calls share the audit + armed-aware confirm. The
  // user-controlled scripting grants are mirrored into the broker grant store
  // (synchronous cache write) before the context is built.
  const consoleScope = new DisposeRegistry();
  const makeContext: MakeContext = (grantList) => {
    const granted = new Set<Permission>(grantList);
    void system.grants.set(SCRIPTING_EXT_ID, [...grantList]);
    return assembleExtContext({
      extId: SCRIPTING_EXT_ID,
      granted,
      broker: system.broker,
      services,
      dispose: consoleScope,
      version: EXT_API_VERSION,
      events,
    });
  };

  const consoleController = createConsoleController({
    makeContext,
    storage: deps.storage,
    registry,
    events: { on: (event, cb) => events.on(event, () => cb()) },
  });

  const apiDts = buildExtApiDts();

  // Controlled hub tab so palette commands can reveal the right pane.
  const [activeTab, setActiveTab] = createSignal<string>('help');
  const reveal = (tab: string): void => {
    setActiveTab(tab);
    store.patch((s) => {
      s.layout.activeScreen = 'sim';
    });
  };

  // Console + API reference: dockable panels + palette commands.
  const offConsole = registerScriptingConsole(registry, consoleController, t, { apiDts }, () =>
    reveal('console'),
  );
  const offApiRef = registerApiReference(registry, t, { openPanel: () => reveal('api') });

  // Extensions manager: controller + dockable panel + palette command.
  const manager = createExtensionsController({
    system,
    prompt: deps.prompt,
    files: deps.files,
    notify: {
      info: (m) => registry.toast('info', m),
      warn: (m) => registry.toast('warn', m),
      error: (m) => registry.toast('error', m),
    },
    t,
    ...(deps.examples !== undefined ? { examples: deps.examples } : {}),
  });
  const managerPanel = createExtensionsManagerPanel(manager, t);
  const offManagerPanel = registry.registerPanel(managerPanel);
  const offManagerCmd = registry.registerCommand({
    id: EXTENSIONS_MANAGER_COMMAND_ID,
    title: t('extmgr.command.open'),
    run: () => reveal('extensions'),
  });

  // The hub panels (fresh instances mounted inside the hub, distinct from the
  // dockable registrations above but sharing the same controllers).
  const consolePanel = createScriptingConsolePanel(consoleController, t, { apiDts });
  const apiRefPanel = createApiReferencePanel(t);

  const hubPanel: PanelDef = {
    id: screenPanelId('sim'),
    title: t('sim.title'),
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(SimDevHub, {
            managerPanel,
            consolePanel,
            apiRefPanel,
            api,
            t: api.t,
            active: activeTab,
            onActivate: setActiveTab,
          }),
        el,
      );
    },
  };
  const offScreen = setScreenPanel('sim', hubPanel);

  let macrosOff: (() => void) | undefined;

  const ready = async (): Promise<void> => {
    await manager.init();
    macrosOff = await consoleController.bindSavedMacros();
  };

  return {
    manager,
    ready,
    dispose(): void {
      macrosOff?.();
      offScreen();
      offManagerCmd();
      offManagerPanel();
      offApiRef();
      offConsole();
      consoleScope.dispose();
    },
  };
}
