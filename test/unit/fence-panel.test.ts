/**
 * Geofence editor panel component tests (task T4.6; spec plan/04 §4.3 Geofence,
 * plan/05 §5.3 Plan). Mounts {@link FencePanel} with a spy `onChange` and
 * asserts add/remove/edit of shapes and the limits/breach-action controls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { FencePanel } from '../../src/ui/screens/plan/fence';
import { FenceBreachAction, type Fence } from '../../src/geo/fence';

afterEach(() => cleanup());

describe('FencePanel', () => {
  it('starts empty and adds an inclusion polygon', () => {
    const onChange = vi.fn<(f: Fence) => void>();
    const { getByTestId, queryAllByTestId } = render(() =>
      createComponent(FencePanel, { onChange }),
    );
    expect(getByTestId('fence-empty')).toBeTruthy();

    getByTestId('fence-add-incl-polygon').click();
    expect(onChange).toHaveBeenCalledTimes(1);
    const fence = onChange.mock.calls[0]?.[0];
    expect(fence?.shapes).toHaveLength(1);
    expect(fence?.shapes[0]?.kind).toBe('polygon');
    expect(fence?.shapes[0]?.inclusion).toBe('inclusion');
    expect(queryAllByTestId('fence-shape')).toHaveLength(1);
  });

  it('adds a circle and edits its radius', () => {
    const onChange = vi.fn<(f: Fence) => void>();
    const { getByTestId } = render(() => createComponent(FencePanel, { onChange }));

    getByTestId('fence-add-excl-circle').click();
    const radius = getByTestId('fence-shape-radius') as HTMLInputElement;
    fireEvent.input(radius, { target: { value: '250' } });

    const last = onChange.mock.calls.at(-1)?.[0];
    const circle = last?.shapes[0];
    expect(circle?.kind).toBe('circle');
    expect(circle?.kind === 'circle' && circle.radiusM).toBe(250);
    expect(circle?.inclusion).toBe('exclusion');
  });

  it('removes a shape', () => {
    const onChange = vi.fn<(f: Fence) => void>();
    const { getByTestId, queryAllByTestId } = render(() =>
      createComponent(FencePanel, { onChange }),
    );
    getByTestId('fence-add-incl-circle').click();
    expect(queryAllByTestId('fence-shape')).toHaveLength(1);

    getByTestId('fence-shape-remove').click();
    expect(queryAllByTestId('fence-shape')).toHaveLength(0);
    expect(onChange.mock.calls.at(-1)?.[0]?.shapes).toHaveLength(0);
  });

  it('edits limits and breach action', () => {
    const onChange = vi.fn<(f: Fence) => void>();
    const { getByTestId } = render(() => createComponent(FencePanel, { onChange }));

    fireEvent.input(getByTestId('fence-min-alt'), { target: { value: '15' } });
    fireEvent.input(getByTestId('fence-max-alt'), { target: { value: '200' } });
    fireEvent.change(getByTestId('fence-breach-action'), {
      target: { value: String(FenceBreachAction.AlwaysLand) },
    });

    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last?.minAltM).toBe(15);
    expect(last?.maxAltM).toBe(200);
    expect(last?.breachAction).toBe(FenceBreachAction.AlwaysLand);
  });
});
