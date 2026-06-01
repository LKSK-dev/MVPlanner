/** Runtime marker drawing hook for uPlot. Pure marker normalization lives in transform.ts. */
import type uPlot from 'uplot';
import { normalizePlotterMarkers } from './transform';
import type { PlotterMarker } from './types';

/** Create a uPlot draw hook that renders event/mode/error marker lines/regions. */
export function createMarkerDrawHook(
  markers: () => readonly PlotterMarker[],
): (self: uPlot) => void {
  return (self) => {
    const normalized = normalizePlotterMarkers(markers());
    if (normalized.length === 0) return;

    const { ctx, bbox } = self;
    const leftEdge = bbox.left;
    const rightEdge = bbox.left + bbox.width;
    const topEdge = bbox.top;
    const bottomEdge = bbox.top + bbox.height;

    ctx.save();
    ctx.rect(leftEdge, topEdge, bbox.width, bbox.height);
    ctx.clip();

    for (const marker of normalized) {
      const x0 = bbox.left + self.valToPos(marker.startUs, 'x');
      if (marker.endUs !== undefined) {
        const x1 = bbox.left + self.valToPos(marker.endUs, 'x');
        const regionLeft = Math.max(leftEdge, Math.min(x0, x1));
        const regionRight = Math.min(rightEdge, Math.max(x0, x1));
        if (regionRight > regionLeft) {
          ctx.fillStyle = markerFill(marker.color);
          ctx.fillRect(regionLeft, topEdge, regionRight - regionLeft, bbox.height);
        }
      }

      if (x0 < leftEdge || x0 > rightEdge) continue;
      ctx.strokeStyle = marker.color;
      ctx.lineWidth = marker.kind === 'error' ? 2 : 1;
      ctx.setLineDash(marker.kind === 'mode' ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x0, topEdge);
      ctx.lineTo(x0, bottomEdge);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = marker.color;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(marker.label, Math.min(x0 + 4, rightEdge - 40), topEdge + 4);
    }

    ctx.restore();
  };
}

function markerFill(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return `${color}26`;
  return 'rgba(148, 163, 184, 0.16)';
}
