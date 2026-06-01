# DataFlash log query engine

Task T6.3 builds a columnar query layer over decoded DataFlash records.

```ts
import { buildLogQueryIndex } from './log-query';

const index = buildLogQueryIndex(records, { metadata: decoder.getMetadata() });
index.listSeries();
index.querySeries('ATT', 'Roll', { fromUs: 1_000_000, toUs: 2_000_000 }, 2_000);
index.evaluateDerived('ATT.Roll - ATT.DesRoll', undefined, 2_000);
```

Design notes:

- Records are consumed once and not retained. Each `(message, numeric field)` is
  stored as typed arrays: `Float64Array` timestamps and `Float64Array` values.
- Timestamps come from `TimeUS` (including safe `bigint` values from `q`/`Q`
  fields) or a monotonically increasing synthetic counter when absent.
- `querySeries` uses binary search to slice the requested time window, then
  returns full-resolution points when the slice is small enough or min/max bucket
  points when `maxPoints` is exceeded. Buckets include `min`, `max`, `first`,
  `last`, `mean`, and `count` so narrow peaks are preserved for plotting.
- `evaluateDerived` parses a small safe expression grammar (numbers, series refs
  like `ATT.Roll`, `+ - * /`, unary signs, and parentheses). It does not use
  `eval` or `Function`. Referenced series are aligned by nearest timestamp using
  the first reference as the output time base.
