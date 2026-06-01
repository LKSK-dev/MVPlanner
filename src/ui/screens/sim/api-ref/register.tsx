/**
 * Registration glue for the extension API reference panel (task T7.5).
 *
 * `createApiReferencePanel` returns a normal dockable {@link PanelDef}. The
 * optional `registerApiReference` helper also contributes an `apiref.open`
 * command so integrations can surface it in the command palette and decide how
 * their workspace should reveal the registered panel.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { CommandDef, PanelApi, PanelDef, UiRegistry } from '../../../../contracts';
import { buildExtApiDts, CAPABILITY_MAP } from '../../../../ext/api';
import { EXT_API_VERSION } from '../../../../version';
import { ApiReference, type ApiReferenceT } from './api-reference';
import { extractApiReferenceMembers, type ApiReferenceMember } from './model';
import './messages';

/** Stable panel id for the dockable API reference. */
export const API_REFERENCE_PANEL_ID = 'apiref.panel';

/** Stable command id used to reveal the API reference from the palette. */
export const API_REFERENCE_COMMAND_ID = 'apiref.open';

/** Options for constructing/registering the API reference panel. */
export interface ApiReferencePanelOptions {
  /** Pre-extracted members for tests or alternate declaration sources. */
  readonly members?: readonly ApiReferenceMember[];
}

/** Options for palette registration. */
export interface ApiReferenceRegistrationOptions extends ApiReferencePanelOptions {
  /** Integration hook that reveals/docks the already-registered panel. */
  readonly openPanel?: (panelId: string) => void;
}

/** Extract members from the bundled extension declaration and capability map. */
export function buildBundledApiReferenceMembers(): ApiReferenceMember[] {
  return extractApiReferenceMembers(buildExtApiDts(EXT_API_VERSION), CAPABILITY_MAP);
}

/** Build the dockable API reference panel. */
export function createApiReferencePanel(
  t: ApiReferenceT,
  opts: ApiReferencePanelOptions = {},
): PanelDef {
  const members = opts.members ?? buildBundledApiReferenceMembers();
  return {
    id: API_REFERENCE_PANEL_ID,
    title: t('apiref.title'),
    icon: 'api',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(ApiReference, {
            members,
            t: api.t,
          }),
        el,
      );
    },
  };
}

/** Register the dockable panel and its command-palette entry. */
export function registerApiReference(
  registry: UiRegistry,
  t: ApiReferenceT,
  opts: ApiReferenceRegistrationOptions = {},
): () => void {
  const offPanel = registry.registerPanel(createApiReferencePanel(t, opts));
  const command: CommandDef = {
    id: API_REFERENCE_COMMAND_ID,
    title: t('apiref.command.open'),
    run: () => {
      if (opts.openPanel !== undefined) {
        opts.openPanel(API_REFERENCE_PANEL_ID);
      } else {
        registry.toast('info', t('apiref.openHint'));
      }
    },
  };
  const offCommand = registry.registerCommand(command);

  return () => {
    offCommand();
    offPanel();
  };
}
