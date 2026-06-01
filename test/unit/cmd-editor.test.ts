/**
 * MAV_CMD command editor widget tests (task T4.2; spec plan/04 §4.3).
 *
 * Renders {@link CmdEditor} over a mock `onChange` and asserts the
 * metadata-driven slot labels for `NAV_WAYPOINT` + `DO_CHANGE_SPEED`, that
 * editing a slot fires `onChange` with the right field updated, that the picker
 * changes the command, and that the frame select maps to the right `MAV_FRAME`.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import {
  MAV_FRAME_GLOBAL_INT,
  MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
  type MissionItemModel,
} from '../../src/geo/mission';
import { CmdEditor } from '../../src/ui/widgets/cmd-editor';

const NAV_WAYPOINT = 16;
const DO_CHANGE_SPEED = 178;

function item(over: Partial<MissionItemModel> = {}): MissionItemModel {
  return {
    command: NAV_WAYPOINT,
    frame: MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
    params: [0, 0, 0, 0],
    lat: 47.1,
    lon: 8.5,
    alt: 30,
    autocontinue: true,
    ...over,
  };
}

function mount(value: MissionItemModel, onChange: (next: MissionItemModel) => void): HTMLElement {
  const { container } = render(() => createComponent(CmdEditor, { value, onChange, t }));
  return container;
}

function slotLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.mvp-cmd-editor__slot-label')].map((n) =>
    (n.textContent ?? '').trim(),
  );
}

afterEach(() => cleanup());

describe('CmdEditor widget', () => {
  it('labels every slot from NAV_WAYPOINT metadata', () => {
    const container = mount(item(), () => {});
    const labels = slotLabels(container);
    expect(labels).toContain('Hold');
    expect(labels).toContain('Accept Radius');
    expect(labels).toContain('Pass Radius');
    expect(labels).toContain('Yaw');
    expect(labels.some((l) => l.startsWith('Latitude'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Longitude'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Altitude'))).toBe(true);
  });

  it('labels DO_CHANGE_SPEED params and mutes its unused position slots', () => {
    const container = mount(item({ command: DO_CHANGE_SPEED }), () => {});
    const labels = slotLabels(container);
    expect(labels).toContain('Speed Type');
    expect(labels).toContain('Speed');
    expect(labels).toContain('Throttle');
    expect(labels).toContain('Relative');
    // The x/y/z slots are unused for DO_CHANGE_SPEED → muted + generic label.
    const muted = container.querySelectorAll('.mvp-cmd-editor__slot--unused');
    expect(muted.length).toBe(3);
  });

  it('fires onChange with the updated param when a param slot is edited', () => {
    const onChange = vi.fn();
    const container = mount(item(), onChange);
    const inputs = container.querySelectorAll<HTMLInputElement>('.mvp-cmd-editor__slot-input');
    // First input is param1 (Hold).
    const hold = inputs[0]!;
    hold.value = '7';
    hold.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0] as MissionItemModel;
    expect(next.params[0]).toBe(7);
    expect(next.command).toBe(NAV_WAYPOINT);
  });

  it('fires onChange with the updated latitude when the position slot is edited', () => {
    const onChange = vi.fn();
    const container = mount(item(), onChange);
    const latInput = container.querySelector<HTMLInputElement>(
      '.mvp-cmd-editor__slot[data-kind="lat"] .mvp-cmd-editor__slot-input',
    );
    expect(latInput).toBeTruthy();
    latInput!.value = '51.5';
    latInput!.dispatchEvent(new Event('input', { bubbles: true }));

    const next = onChange.mock.calls.at(-1)![0] as MissionItemModel;
    expect(next.lat).toBe(51.5);
  });

  it('fires onChange with the new command from the picker', () => {
    const onChange = vi.fn();
    const container = mount(item(), onChange);
    const picker = container.querySelector<HTMLSelectElement>('.mvp-cmd-editor__picker');
    expect(picker).toBeTruthy();
    // The curated set includes DO_CHANGE_SPEED (178).
    expect([...picker!.querySelectorAll('option')].some((o) => o.value === '178')).toBe(true);
    picker!.value = '178';
    picker!.dispatchEvent(new Event('change', { bubbles: true }));

    const next = onChange.mock.calls.at(-1)![0] as MissionItemModel;
    expect(next.command).toBe(DO_CHANGE_SPEED);
  });

  it('maps the frame select back to a MAV_FRAME value', () => {
    const onChange = vi.fn();
    const container = mount(item(), onChange);
    const frame = container.querySelector<HTMLSelectElement>('.mvp-cmd-editor__frame');
    expect(frame).toBeTruthy();
    // Default item is relative (6) → reflected as the selected option.
    expect(frame!.value).toBe('relative');
    frame!.value = 'amsl';
    frame!.dispatchEvent(new Event('change', { bubbles: true }));

    const next = onChange.mock.calls.at(-1)![0] as MissionItemModel;
    expect(next.frame).toBe(MAV_FRAME_GLOBAL_INT);
  });
});
