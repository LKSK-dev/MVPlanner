/**
 * Waypoint table component tests (task T4.3; spec plan/04 §4.3 table, plan/05
 * §5.7 undo). Mounts {@link WaypointTable} in a controlled harness (a Solid
 * signal mirrors `model`/`onChange`) and asserts cell editing, insert / delete /
 * reorder, undo / redo restoration and live totals.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { addWaypoint, createMission, type MissionModel } from '../../src/geo/mission';
import { WaypointTable } from '../../src/ui/screens/plan/table';

/** A controlled two-waypoint mission, ~111 m apart. */
function seed(): MissionModel {
  let m = createMission('mission', { defaultAlt: 30 });
  m = addWaypoint(m, { lat: 47.0, lon: 8.0 });
  m = addWaypoint(m, { lat: 47.001, lon: 8.0 });
  return m;
}

/** Mount the table wired to a signal; expose the live model getter. */
function mount(initial: MissionModel = seed()) {
  const [model, setModel] = createSignal<MissionModel>(initial);
  const utils = render(() =>
    createComponent(WaypointTable, { model, onChange: (next) => setModel(next) }),
  );
  return { ...utils, model };
}

afterEach(() => cleanup());

describe('WaypointTable', () => {
  it('renders one row per item with totals', () => {
    const { container, getByTestId } = mount();
    expect(container.querySelectorAll('tbody tr.mvp-wptable__row')).toHaveLength(2);
    expect(getByTestId('wp-total-waypoints').textContent).toBe('2');
  });

  it('shows an empty state for a mission with no items', () => {
    const { getByTestId } = mount(createMission());
    expect(getByTestId('wp-empty')).toBeTruthy();
    expect(getByTestId('wp-total-waypoints').textContent).toBe('0');
  });

  it('edits an altitude cell through onChange', () => {
    const { container, model } = mount();
    const altInput = container.querySelector<HTMLInputElement>(
      'tr[data-seq="0"] input[aria-label="Altitude for waypoint 1"]',
    );
    expect(altInput).toBeTruthy();
    fireEvent.change(altInput!, { target: { value: '125' } });
    expect(model().items[0]?.alt).toBe(125);
  });

  it('adds and deletes waypoints', () => {
    const { getByTestId, model } = mount();
    fireEvent.click(getByTestId('wp-add'));
    expect(model().items).toHaveLength(3);
    fireEvent.click(getByTestId('wp-delete-2'));
    expect(model().items).toHaveLength(2);
  });

  it('inserts a waypoint after a row', () => {
    const { getByTestId, model } = mount();
    fireEvent.click(getByTestId('wp-insert-0'));
    expect(model().items).toHaveLength(3);
  });

  it('reorders rows with move up/down', () => {
    const { getByTestId, model } = mount();
    const before = model().items[0]?.lat;
    fireEvent.click(getByTestId('wp-down-0'));
    expect(model().items[1]?.lat).toBe(before);
  });

  it('undo and redo restore the model', () => {
    const { getByTestId, model } = mount();
    fireEvent.click(getByTestId('wp-add'));
    expect(model().items).toHaveLength(3);

    fireEvent.click(getByTestId('wp-undo'));
    expect(model().items).toHaveLength(2);

    fireEvent.click(getByTestId('wp-redo'));
    expect(model().items).toHaveLength(3);
  });

  it('updates totals after an edit', () => {
    const { getByTestId, model } = mount();
    const wpBefore = getByTestId('wp-total-waypoints').textContent;
    fireEvent.click(getByTestId('wp-add'));
    // The added waypoint is at null-island (0,0) so it is not counted as a path
    // point, but deleting a real one changes the count.
    fireEvent.click(getByTestId('wp-delete-0'));
    expect(model().items).toHaveLength(2);
    expect(getByTestId('wp-total-waypoints').textContent).not.toBe(wpBefore);
  });

  it('sets the default altitude', () => {
    const { getByTestId, model } = mount();
    fireEvent.change(getByTestId('wp-default-alt'), { target: { value: '55' } });
    expect(model().defaultAlt).toBe(55);
  });

  it('expands a row into the command editor', () => {
    const { getByTestId, container } = mount();
    fireEvent.click(getByTestId('wp-expand-0'));
    expect(container.querySelector('.mvp-cmd-editor')).toBeTruthy();
  });

  it('undoes via the keyboard (Ctrl-Z)', () => {
    const { getByTestId, container, model } = mount();
    fireEvent.click(getByTestId('wp-add'));
    expect(model().items).toHaveLength(3);
    const region = container.querySelector('.mvp-wptable')!;
    fireEvent.keyDown(region, { key: 'z', ctrlKey: true });
    expect(model().items).toHaveLength(2);
  });
});
