/**
 * Detachable floating-panel helper (M8 integration glue).
 *
 * Mirrors the MAVLink inspector's pop-out window (T1.12): it appends a non-modal
 * `role="dialog"` host to `<body>`, renders arbitrary content into it via an
 * injected `mount` callback, moves focus in, and closes on Escape / the close
 * button / an explicit {@link FloatingPanelHandle.close}. It lets the M8 widgets
 * (joystick, antenna tracker) be reached from the ⌘K command palette without
 * hard-wiring them into a screen tree.
 *
 * The shell owns the dock; this is only a lightweight detached surface so a
 * registered panel can also be popped out from a command.
 */

/** A live floating-panel window handle. */
export interface FloatingPanelHandle {
  /** Close the window and restore focus to the previously-focused element. */
  close(): void;
}

/** Options for {@link openFloatingPanel}. */
export interface FloatingPanelOptions {
  /** Accessible window title (also shown in the header). */
  readonly title: string;
  /** Close-button accessible label. */
  readonly closeLabel: string;
  /** Extra class for the host element (for per-widget styling). */
  readonly className?: string;
  /** Render the body content; returns a disposer for the rendered root. */
  readonly mount: (body: HTMLElement) => () => void;
  /**
   * Invoked exactly once when the panel closes — via ✕, Escape or
   * {@link FloatingPanelHandle.close} — so callers can clear their handle.
   */
  readonly onClose?: () => void;
}

/**
 * Open a detachable, non-modal floating panel. Returns a handle whose
 * {@link FloatingPanelHandle.close} tears the window down.
 */
export function openFloatingPanel(opts: FloatingPanelOptions): FloatingPanelHandle {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const host = document.createElement('div');
  host.className =
    opts.className === undefined ? 'mvp-floating-panel' : `mvp-floating-panel ${opts.className}`;
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'false');
  host.setAttribute('aria-label', opts.title);

  const header = document.createElement('header');
  header.className = 'mvp-floating-panel__head';

  const heading = document.createElement('h2');
  heading.className = 'mvp-floating-panel__title';
  heading.textContent = opts.title;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mvp-floating-panel__close';
  closeBtn.setAttribute('aria-label', opts.closeLabel);
  closeBtn.textContent = '✕';

  header.append(heading, closeBtn);

  const body = document.createElement('div');
  body.className = 'mvp-floating-panel__body';

  host.append(header, body);
  document.body.appendChild(host);

  const disposeRender = opts.mount(body);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    host.removeEventListener('keydown', onKeyDown);
    disposeRender();
    host.remove();
    previouslyFocused?.focus?.();
    opts.onClose?.();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  host.addEventListener('keydown', onKeyDown);
  closeBtn.addEventListener('click', close);
  closeBtn.focus();

  return { close };
}
