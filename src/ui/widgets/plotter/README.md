# Plotter widget

Task T6.4 implements the Logs/DataFlash plotter as a Solid wrapper around
[uPlot](https://github.com/leeoniya/uPlot).

## API

```tsx
<Plotter
  series={[
    { id: 'att-roll', label: 'ATT.Roll', axisId: 'deg', samples: rollPoints },
    { id: 'baro-alt', label: 'BARO.Alt', axisId: 'm', samples: altPoints },
  ]}
  markers={[{ id: 'm1', kind: 'mode', label: 'AUTO', startUs: 12_000_000 }]}
  cursorUs={externalCursorUs}
  onCursor={(timeUs) => syncMapTrack(timeUs)}
/>
```

- `series[].samples` are the `LogQueryIndex.querySeries()` /
  `evaluateDerived()` points: `{ t, min, max, mean, count, value? }`.
- `axisId` groups series onto a y-scale. Distinct axis ids get separate uPlot
  scales and alternating left/right axes.
- `cursorUs` moves uPlot's cursor programmatically for T6.5 map-track sync.
- `onCursor` emits the nearest aligned log timestamp when the user moves the
  cursor, or `null` when there is no valid point.
- `markers` render event/mode/error vertical lines; `endUs` turns a marker into a
  shaded region.

## Bucket plotting choice

The query engine preserves bucket extrema (`min`/`max`) for large logs. This v1
plotter intentionally renders one line per selected series: `value` for
full-resolution points, otherwise bucket `mean`. This keeps uPlot's data aligned
and the component small/testable. A future min/max band can be added without
changing the input contract.

## Testing notes

`transform.ts` is pure and unit-tested without a DOM: common-x alignment,
uPlot data/options, multi-axis scale assignment, cursor time/index mapping, and
marker normalization.

`Plotter` guards uPlot construction by probing a real 2D canvas context. In
happy-dom the probe fails, so the component renders the accessible summary and
empty surface without instantiating uPlot. Canvas drawing, zoom/pan interaction,
and marker pixels are deferred to browser e2e/perf coverage.
