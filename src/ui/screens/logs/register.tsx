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
import { createComponent, type Accessor } from 'solid-js';
import { render } from 'solid-js/web';
import type { AppState, BlobStore, FileIo, PanelApi, PanelDef, Store } from '../../../contracts';
import type { RecentsStore } from '../../../core/recents';
import type { TFn } from '../../../core/i18n';
import { screenPanelId } from '../../shell';
import type { InspectorSource } from '../../widgets/inspector';
import type { MsgSenderSend } from '../../widgets/msg-sender';
import { LogsScreen } from './logs-screen';
import './messages';

/** Stable panel id for the Logs screen (`screen.logs`). */
export const LOGS_SCREEN_PANEL_ID = screenPanelId('logs');

export type { TFn };

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
  /** App store, so `settings.mapSource` reaches the map track engine basemap. */
  readonly store?: Store<AppState>;
  /** Recents store: records opened logs/tlogs for the Recents launcher. */
  readonly recents?: RecentsStore;
  /** Pending-open accessor (App Settings → Recents “Open”), `log`/`tlog` only. */
  readonly pendingOpen?: Accessor<{ name: string; blob: Blob } | undefined>;
  /** Clear the pending-open entry once it has been loaded. */
  readonly onPendingConsumed?: () => void;
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
            ...(deps.store !== undefined ? { store: deps.store } : {}),
            ...(deps.recents !== undefined ? { recents: deps.recents } : {}),
            ...(deps.pendingOpen !== undefined ? { pendingOpen: deps.pendingOpen } : {}),
            ...(deps.onPendingConsumed !== undefined
              ? { onPendingConsumed: deps.onPendingConsumed }
              : {}),
          }),
        el,
      );
    },
  };
}
