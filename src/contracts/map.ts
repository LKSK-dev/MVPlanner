/**
 * Map engine abstraction seam (impl 02 §2.6; spec plan/02 §2.5, plan/04 §4.2). FROZEN.
 */

export interface BasemapSource {
  id: string;
  kind: 'xyz' | 'wms' | 'vector';
  url: string;
  apiKey?: string;
}

export interface MapRenderCtx {
  project(lat: number, lon: number): [number, number];
  canvas: HTMLCanvasElement;
}

export interface MapLayer {
  id: string;
  render(ctx: MapRenderCtx): void;
}

export type Bbox = [west: number, south: number, east: number, north: number];

export interface MapEngine {
  addLayer(layer: MapLayer): () => void;
  on(ev: 'click' | 'move', cb: (e: { lat: number; lon: number }) => void): () => void;
  setBasemap(source: BasemapSource): void;
  prefetch(bbox: Bbox, zoomRange: [number, number]): Promise<void>;
}
