/**
 * `ui/widgets/split` public surface.
 *
 * A reusable, accessible two-pane splitter: the {@link ResizableSplit} Solid
 * component plus the pure {@link nextSplitRatio} ratio math it is built on.
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Mounting also needs `import './split.css'` via
 * the component.
 */
export { ResizableSplit, type ResizableSplitProps } from './split';
export { nextSplitRatio } from './resize';
