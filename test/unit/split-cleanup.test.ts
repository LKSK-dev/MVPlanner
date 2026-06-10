/**
 * ResizableSplit drag-listener lifecycle tests (audit E4). A pointerdown
 * attaches window-scoped `pointermove`/`pointerup`/`pointercancel` listeners;
 * these assert the pair is torn down on pointerup, on `pointercancel`, AND on a
 * mid-drag unmount (the leak the audit found), so no orphan handlers keep
 * resizing a disposed component.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { ResizableSplit } from '../../src/ui/widgets/split';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Mount a splitter and return its separator element. */
function mountSplit(onRatio: (next: number) => void = () => undefined): HTMLElement {
  const { container } = render(() =>
    createComponent(ResizableSplit, {
      ratio: () => 1,
      onRatio,
      label: 'Split',
    }),
  );
  const handle = container.querySelector('[role="separator"]');
  if (!(handle instanceof HTMLElement)) throw new Error('separator not rendered');
  return handle;
}

describe('ResizableSplit — window listener lifecycle (audit E4)', () => {
  it('removes the move/up/cancel listeners on pointerup', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const handle = mountSplit();

    fireEvent.pointerDown(handle, { clientY: 10, pointerId: 1 });
    const added = add.mock.calls.map((c) => c[0]);
    expect(added).toContain('pointermove');
    expect(added).toContain('pointerup');
    expect(added).toContain('pointercancel');

    fireEvent.pointerUp(window, { pointerId: 1 });
    const removed = remove.mock.calls.map((c) => c[0]);
    expect(removed).toContain('pointermove');
    expect(removed).toContain('pointerup');
    expect(removed).toContain('pointercancel');
  });

  it('removes the active listeners on pointercancel', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const handle = mountSplit();

    fireEvent.pointerDown(handle, { clientY: 10, pointerId: 1 });
    fireEvent(window, new Event('pointercancel'));
    const removed = remove.mock.calls.map((c) => c[0]);
    expect(removed).toContain('pointermove');
    expect(removed).toContain('pointerup');
    expect(removed).toContain('pointercancel');
  });

  it('removes the active listeners on a mid-drag unmount (no leak)', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const onRatio = vi.fn();
    const handle = mountSplit(onRatio);

    fireEvent.pointerDown(handle, { clientY: 10, pointerId: 1 });
    cleanup(); // unmount mid-drag

    const removed = remove.mock.calls.map((c) => c[0]);
    expect(removed).toContain('pointermove');
    expect(removed).toContain('pointerup');
    expect(removed).toContain('pointercancel');

    // A post-unmount move must not reach the (disposed) ratio callback.
    onRatio.mockClear();
    fireEvent.pointerMove(window, { clientY: 50, pointerId: 1 });
    expect(onRatio).not.toHaveBeenCalled();
  });
});
