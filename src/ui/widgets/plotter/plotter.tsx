/** Solid wrapper around uPlot for log time-series plotting (T6.4). */
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { t } from '../../../core/i18n';
import './messages';
import './plotter.css';
import { createMarkerDrawHook } from './markers';
import {
  buildPlotterModel,
  buildPlotterOptions,
  cursorIndexToTime,
  cursorTimeToIndex,
} from './transform';
import type { PlotterModel, PlotterProps } from './types';

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 320;

/** uPlot-backed log plotter. It no-ops safely when a 2D canvas is unavailable. */
export const Plotter: Component<PlotterProps> = (props) => {
  let host: HTMLDivElement | undefined;
  let plot: uPlot | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let activeStructureKey = '';
  const [mounted, setMounted] = createSignal(false);
  const [canvasAvailable, setCanvasAvailable] = createSignal(true);
  const [size, setSize] = createSignal({
    width: props.width ?? DEFAULT_WIDTH,
    height: props.height ?? DEFAULT_HEIGHT,
  });

  const model = createMemo<PlotterModel>(() => buildPlotterModel(props.series));
  const markerSignature = createMemo<string>(() =>
    (props.markers ?? [])
      .map(
        (marker) =>
          `${marker.id}:${marker.kind}:${marker.label}:${marker.startUs}:${marker.endUs ?? ''}:${marker.color ?? ''}`,
      )
      .join('|'),
  );
  const summary = createMemo<string>(() => {
    if (props.series.length === 0) return t('plotter.summary.empty');
    return t('plotter.summary.series', {
      count: props.series.length,
      series: props.series.map((entry) => entry.label).join(', '),
    });
  });

  const destroyPlot = (): void => {
    plot?.destroy();
    plot = undefined;
    activeStructureKey = '';
  };

  const createPlot = (nextModel: PlotterModel): void => {
    if (host === undefined) return;
    if (!canUseCanvas2d()) {
      setCanvasAvailable(false);
      return;
    }
    setCanvasAvailable(true);
    const nextSize = size();
    const opts = buildRuntimeOptions(nextModel, nextSize.width, nextSize.height, props, () =>
      model(),
    );
    plot = new uPlot(opts, nextModel.data, host);
    activeStructureKey = nextModel.structureKey;
  };

  onMount(() => {
    setMounted(true);
    if (host !== undefined && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry === undefined) return;
        const width = Math.max(
          1,
          Math.round(entry.contentRect.width || props.width || DEFAULT_WIDTH),
        );
        const height = Math.max(
          1,
          Math.round(entry.contentRect.height || props.height || DEFAULT_HEIGHT),
        );
        setSize({ width, height });
        plot?.setSize({ width, height });
      });
      resizeObserver.observe(host);
    }
  });

  createEffect(() => {
    if (!mounted()) return;
    const nextModel = model();
    const nextSize = size();
    if (plot === undefined) {
      createPlot(nextModel);
      return;
    }
    if (activeStructureKey !== nextModel.structureKey) {
      destroyPlot();
      createPlot(nextModel);
      return;
    }
    plot.setSize({ width: nextSize.width, height: nextSize.height });
    plot.setData(nextModel.data, true);
    plot.redraw(true, true);
  });

  createEffect(() => {
    if (!mounted()) return;
    const p = plot;
    if (p === undefined) return;
    markerSignature();
    p.redraw(false, false);
  });

  createEffect(() => {
    if (!mounted()) return;
    const p = plot;
    if (p === undefined) return;
    const timeUs = props.cursorUs;
    if (timeUs === undefined || timeUs === null) {
      p.setLegend({}, false);
      return;
    }
    const idx = cursorTimeToIndex(model().aligned.x, timeUs);
    if (idx === null) return;
    const left = p.valToPos(timeUs, 'x');
    const top = Math.max(0, p.bbox.height / 2);
    p.setCursor({ left, top }, false);
    p.setLegend({ idx }, false);
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    destroyPlot();
  });

  return (
    <section
      class={`mvp-plotter${props.class === undefined ? '' : ` ${props.class}`}`}
      role="region"
      aria-label={summary()}
    >
      <div class="mvp-plotter__surface" ref={host} aria-hidden="true" />
      <p class="mvp-plotter__summary" aria-live="polite">
        {summary()}
      </p>
      {props.series.length === 0 ? <p class="mvp-plotter__empty">{t('plotter.empty')}</p> : null}
      {!canvasAvailable() ? (
        <p class="mvp-plotter__empty">{t('plotter.canvasUnavailable')}</p>
      ) : null}
    </section>
  );
};

function buildRuntimeOptions(
  plotModel: PlotterModel,
  width: number,
  height: number,
  props: PlotterProps,
  currentModel: () => PlotterModel,
): uPlot.Options {
  const opts = buildPlotterOptions(props.series, width, height);
  const cursorHook = (self: uPlot): void => {
    const idx = typeof self.cursor.idx === 'number' ? self.cursor.idx : null;
    props.onCursor?.(cursorIndexToTime(currentModel().aligned.x, idx));
  };
  const markerHook = createMarkerDrawHook(() => props.markers ?? []);
  return {
    ...opts,
    data: plotModel.data,
    hooks: {
      setCursor: [cursorHook],
      draw: [markerHook],
    },
  };
}

function canUseCanvas2d(): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  try {
    return typeof canvas.getContext === 'function' && canvas.getContext('2d') !== null;
  } catch {
    return false;
  }
}
