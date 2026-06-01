/**
 * Rally points editor component tests (task T4.7; spec plan/04 §4.3 rally,
 * plan/05 §5.3 Plan). Mounts {@link RallyPanel} with a spy `onChange` and
 * asserts add / remove / edit of rally points (including clearing an optional
 * extra) flow through the pure model.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { RallyPanel } from '../../src/ui/screens/plan/rally';
import { createRally, addRallyPoint, type Rally } from '../../src/geo/rally';

afterEach(() => cleanup());

/** The last `Rally` a spy received. */
function last(onChange: ReturnType<typeof vi.fn>): Rally {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as Rally;
}

describe('RallyPanel', () => {
  it('shows the empty state and a default altitude with no points', () => {
    const { getByTestId } = render(() => createComponent(RallyPanel, {}));
    expect(getByTestId('rally-empty')).toBeTruthy();
    expect((getByTestId('rally-default-alt') as HTMLInputElement).value).toBe('50');
    expect(getByTestId('rally-count').textContent).toContain('0');
  });

  it('adds a rally point on Add', () => {
    const onChange = vi.fn<(r: Rally) => void>();
    const { getByTestId } = render(() => createComponent(RallyPanel, { onChange }));
    (getByTestId('rally-add') as HTMLButtonElement).click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(last(onChange).points).toHaveLength(1);
    expect(getByTestId('rally-row-0')).toBeTruthy();
  });

  it('edits lat/lon/alt and the optional break alt', () => {
    const onChange = vi.fn<(r: Rally) => void>();
    const initial = addRallyPoint(createRally(), { lat: 0, lon: 0 });
    const { getByTestId } = render(() => createComponent(RallyPanel, { value: initial, onChange }));

    fireEvent.input(getByTestId('rally-lat-0'), { target: { value: '-35.36' } });
    fireEvent.input(getByTestId('rally-lon-0'), { target: { value: '149.16' } });
    fireEvent.input(getByTestId('rally-alt-0'), { target: { value: '120' } });
    fireEvent.input(getByTestId('rally-break-alt-0'), { target: { value: '40' } });

    const point = last(onChange).points[0];
    expect(point).toEqual({ lat: -35.36, lon: 149.16, alt: 120, breakAlt: 40 });
  });

  it('clears an optional extra when its input is emptied', () => {
    const onChange = vi.fn<(r: Rally) => void>();
    const initial = addRallyPoint(createRally(), { lat: 1, lon: 2 }, { breakAlt: 40 });
    const { getByTestId } = render(() => createComponent(RallyPanel, { value: initial, onChange }));
    expect((getByTestId('rally-break-alt-0') as HTMLInputElement).value).toBe('40');

    fireEvent.input(getByTestId('rally-break-alt-0'), { target: { value: '' } });
    const point = last(onChange).points[0];
    expect(point && 'breakAlt' in point).toBe(false);
  });

  it('removes a rally point', () => {
    const onChange = vi.fn<(r: Rally) => void>();
    let initial = addRallyPoint(createRally(), { lat: 1, lon: 2 });
    initial = addRallyPoint(initial, { lat: 3, lon: 4 });
    const { getByTestId } = render(() => createComponent(RallyPanel, { value: initial, onChange }));

    (getByTestId('rally-remove-0') as HTMLButtonElement).click();
    const points = last(onChange).points;
    expect(points).toHaveLength(1);
    expect(points[0]?.lat).toBe(3);
  });
});
