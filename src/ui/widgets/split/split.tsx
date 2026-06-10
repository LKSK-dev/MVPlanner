/**
 * Resizable pane splitter (spec plan/05 §5.3/§5.4).
 *
 * A small, accessible `role="separator"` drag handle that resizes a two-pane
 * split. The two panes are laid out by the consumer at `ratio` fr over `1` fr
 * (CSS grid/flex); this component only reads/writes that `ratio` signal in
 * response to pointer drags and ArrowUp/ArrowDown keys. The ratio math lives in
 * the pure, tested {@link nextSplitRatio} helper; the component is a thin DOM +
 * a11y shell with no layout opinion beyond its own gutter chrome.
 *
 * The splitter measures its parent element to convert a pointer delta (CSS px)
 * into an fr ratio, so it adapts to whatever container it is dropped into.
 */
import { onCleanup, type Component } from 'solid-js';
import { nextSplitRatio } from './resize';
import './split.css';

/** Default minimum first-pane ratio (`fr`). */
const DEFAULT_MIN = 0.3;
/** Default maximum first-pane ratio (`fr`). */
const DEFAULT_MAX = 4;
/** Default keyboard step in CSS pixels (ArrowUp/ArrowDown). */
const DEFAULT_STEP_PX = 24;

/** {@link ResizableSplit} props. */
export interface ResizableSplitProps {
  /** Current first-pane ratio (`fr`) accessor. */
  readonly ratio: () => number;
  /** Commit a new (already-clamped) first-pane ratio. */
  readonly onRatio: (next: number) => void;
  /** Accessible label for the separator. */
  readonly label: string;
  /** Split axis (default `'horizontal'` — a row separator dragged vertically). */
  readonly orientation?: 'horizontal' | 'vertical';
  /** Minimum first-pane ratio (default {@link DEFAULT_MIN}). */
  readonly min?: number;
  /** Maximum first-pane ratio (default {@link DEFAULT_MAX}). */
  readonly max?: number;
  /** Keyboard step in CSS pixels (default {@link DEFAULT_STEP_PX}). */
  readonly stepPx?: number;
  /** Extra class appended for layout placement (e.g. a grid-area). */
  readonly class?: string;
}

/** A draggable, keyboard-accessible two-pane splitter. */
export const ResizableSplit: Component<ResizableSplitProps> = (props) => {
  const orientation = (): 'horizontal' | 'vertical' => props.orientation ?? 'horizontal';
  const min = (): number => props.min ?? DEFAULT_MIN;
  const max = (): number => props.max ?? DEFAULT_MAX;
  const stepPx = (): number => props.stepPx ?? DEFAULT_STEP_PX;

  let handle!: HTMLDivElement;

  /** Tears down the window listeners of the in-flight drag (if any). */
  let endActiveDrag: (() => void) | undefined;
  onCleanup(() => endActiveDrag?.());

  /** Flexible extent (CSS px) of the parent along the split axis. */
  const totalPx = (): number => {
    const parent = handle.parentElement;
    if (parent === null) return 0;
    const rect = parent.getBoundingClientRect();
    return orientation() === 'horizontal' ? rect.height : rect.width;
  };

  const onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    const horizontal = orientation() === 'horizontal';
    const start = horizontal ? e.clientY : e.clientX;
    const startRatio = props.ratio();
    const total = totalPx();
    const pointerId = e.pointerId;
    handle.setPointerCapture?.(pointerId);

    const move = (ev: PointerEvent): void => {
      const delta = (horizontal ? ev.clientY : ev.clientX) - start;
      props.onRatio(nextSplitRatio(startRatio, delta, total, min(), max()));
    };
    const up = (): void => {
      handle.releasePointerCapture?.(pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      endActiveDrag = undefined;
    };
    endActiveDrag?.();
    endActiveDrag = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    let delta = 0;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') delta = -stepPx();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') delta = stepPx();
    else return;
    e.preventDefault();
    props.onRatio(nextSplitRatio(props.ratio(), delta, totalPx(), min(), max()));
  };

  return (
    <div
      ref={handle}
      class={props.class === undefined ? 'mvp-split' : `mvp-split ${props.class}`}
      role="separator"
      aria-orientation={orientation()}
      aria-label={props.label}
      tabindex="0"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
};
