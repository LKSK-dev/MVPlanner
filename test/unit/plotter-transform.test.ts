/** Pure plotter transform tests (T6.4). */
import { describe, expect, it } from 'vitest';
import {
  alignSeriesToCommonX,
  buildPlotterModel,
  buildPlotterOptions,
  cursorIndexToTime,
  cursorTimeToIndex,
  normalizePlotterMarkers,
  scaleKeyForAxis,
} from '../../src/ui/widgets/plotter/transform';
import type { PlotterMarker, PlotterSeriesInput } from '../../src/ui/widgets/plotter/types';

function point(t: number, value: number) {
  return { t, min: value, max: value, first: value, last: value, mean: value, count: 1, value };
}

function bucket(t: number, min: number, max: number, mean: number) {
  return { t, min, max, first: min, last: max, mean, count: 10 };
}

describe('plotter pure transforms', () => {
  it('aligns two downsampled series onto a common x array', () => {
    const series: PlotterSeriesInput[] = [
      {
        id: 'roll',
        label: 'ATT.Roll',
        axisId: 'deg',
        samples: [point(3, 30), bucket(1, 8, 12, 10)],
      },
      { id: 'pitch', label: 'ATT.Pitch', axisId: 'deg', samples: [point(2, 20), point(3, 33)] },
    ];

    const aligned = alignSeriesToCommonX(series);

    expect(aligned.x).toEqual([1, 2, 3]);
    expect(aligned.y).toEqual([
      [10, null, 30],
      [null, 20, 33],
    ]);
  });

  it('builds uPlot data with one mean/value line per input series', () => {
    const series: PlotterSeriesInput[] = [
      { id: 'a', label: 'A', axisId: 'left', samples: [bucket(1_000_000, 1, 9, 5)] },
      { id: 'b', label: 'B', axisId: 'right', samples: [point(1_000_000, 7)] },
    ];

    const model = buildPlotterModel(series);

    expect(model.data).toEqual([[1_000_000], [5], [7]]);
    expect(model.structureKey).toContain('a:A:left');
  });

  it('assigns multi-axis series to distinct y scales and alternating axes', () => {
    const series: PlotterSeriesInput[] = [
      { id: 'roll', label: 'Roll', axisId: 'deg', samples: [] },
      { id: 'alt', label: 'Alt', axisId: 'm', samples: [] },
      { id: 'des', label: 'Desired', axisId: 'deg', samples: [] },
    ];

    const opts = buildPlotterOptions(series, 800, 300);

    expect(opts.series).toHaveLength(4);
    expect(opts.series[1]?.scale).toBe(scaleKeyForAxis('deg'));
    expect(opts.series[2]?.scale).toBe(scaleKeyForAxis('m'));
    expect(opts.series[3]?.scale).toBe(scaleKeyForAxis('deg'));
    expect(opts.scales?.[scaleKeyForAxis('deg')]).toBeTruthy();
    expect(opts.scales?.[scaleKeyForAxis('m')]).toBeTruthy();
    expect(opts.axes?.[1]?.side).toBe(3);
    expect(opts.axes?.[2]?.side).toBe(1);
  });

  it('maps cursor timestamps to nearest common-x indices and back', () => {
    const times = [1_000, 2_000, 4_000, 8_000];

    expect(cursorTimeToIndex(times, 500)).toBe(0);
    expect(cursorTimeToIndex(times, 3_100)).toBe(2);
    expect(cursorTimeToIndex(times, 9_000)).toBe(3);
    expect(cursorIndexToTime(times, 2)).toBe(4_000);
    expect(cursorIndexToTime(times, 99)).toBeNull();
  });

  it('normalizes valid markers and drops invalid timestamps', () => {
    const markers: PlotterMarker[] = [
      { id: 'event', kind: 'event', label: 'EV', startUs: 10 },
      { id: 'mode', kind: 'mode', label: 'AUTO', startUs: 20, endUs: 40, color: '#abcdef' },
      { id: 'bad', kind: 'error', label: 'bad', startUs: Number.NaN },
      { id: 'backwards', kind: 'error', label: 'E', startUs: 50, endUs: 45 },
    ];

    const normalized = normalizePlotterMarkers(markers);

    expect(normalized).toHaveLength(3);
    expect(normalized[0]?.color).toBe('#ffd166');
    expect(normalized[1]).toEqual({
      id: 'mode',
      kind: 'mode',
      label: 'AUTO',
      startUs: 20,
      endUs: 40,
      color: '#abcdef',
    });
    expect(normalized[2]?.endUs).toBeUndefined();
  });
});
