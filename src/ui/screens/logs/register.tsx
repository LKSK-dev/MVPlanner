/**
 * Registration glue for the Logs & analysis screen (task T6.8; spec plan/05
 * §5.2 screen registration).
 *
 * Builds the REAL `screen.logs` {@link PanelDef} that mounts {@link LogsScreen}
 * with the app/host-scoped seams (file I/O, tile-cache blob store, the host send
 * + inspector source). {@link App} installs it through
 * {@link import('../../shell').setScreenPanel} BEFORE the shell renders, so the
 * dock mounts the real screen for `logs` and keeps the rest as placeholders.
 *
 * The panel mounts a fresh Solid root via `render()` (the same imperative
 * pattern the Flight/inspector panels use), capturing the seams by closure.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { BlobStore, FileIo, PanelApi, PanelDef } from '../../../contracts';
import { screenPanelId } from '../../shell';
import type { InspectorSource } from '../../../ui/widgets/inspector';
import type { MsgSenderSend } from '../../../ui/widgets/msg-sender';
import { LogsScreen } from './logs-screen';
import './messages';

/** Stable panel id for the Logs screen (`screen.logs`). */
export const LOGS_SCREEN_PANEL_ID = screenPanelId('logs');

/** The i18n translate function (matches `core/i18n` `t` / `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Construction dependencies for the Logs screen panel. */
export interface LogsScreenPanelDeps {
  /** File picker I/O for opening logs + saving CSV. */
  readonly files: FileIo;
  /** Blob store backing the map tile cache. */
  readonly blobs: BlobStore;
  /** Host send seam for the message sender. */
  readonly send: MsgSenderSend;
  /** Live inspector stream source (omitted when no host is connected). */
  readonly inspectorSource?: InspectorSource;
  /** i18n translate function. */
  readonly t: TFn;
}

/** Build the real `screen.logs` {@link PanelDef} bound to the seams. */
export function createLogsScreenPanel(deps: LogsScreenPanelDeps): PanelDef {
  return {
    id: LOGS_SCREEN_PANEL_ID,
    title: deps.t('nav.logs'),
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(LogsScreen, {
            files: deps.files,
            blobs: deps.blobs,
            send: deps.send,
            t: api.t,
            ...(deps.inspectorSource !== undefined
              ? { inspectorSource: deps.inspectorSource }
              : {}),
          }),
        el,
      );
    },
  };
}
