/**
 * ADS-B traffic map layer (task T8.8; spec plan/04 §4.2). The layer is
 * display-only: it projects the current traffic snapshot, draws each aircraft as
 * a heading-rotated icon and labels it with callsign + altitude. Hover/selection
 * are supplied as accessors so the Flight screen can wire pointer hit-testing
 * without changing the frozen `MapLayer` contract.
 */
import type { MapLayer } from '../../../../../contracts';
import { drawLabel, fillPolygon } from '../draw';
import type { DataAccessor } from '../types';
import { projectTrafficTargets, trafficLabel } from './geometry';
import type { TrafficAircraft } from './store';

/** Visual/accessor options for {@link createAdsbTrafficLayer}. */
export interface AdsbTrafficLayerOptions {
  /** Layer id (default `'adsb.traffic'`). */
  id?: string;
  /** Aircraft icon size in device pixels (default 24). */
  iconSizePx?: number;
  /** Icon fill colour (default amber). */
  color?: string;
  /** Icon outline/label colour (default white). */
  outline?: string;
  /** Highlight colour for the hovered aircraft. */
  hoverColor?: string;
  /** Highlight colour for the selected aircraft. */
  selectedColor?: string;
  /** Whether text labels are drawn (default true). */
  showLabels?: boolean;
  /** Current hovered ICAO address. */
  hoveredIcaoAddress?: DataAccessor<number>;
  /** Current selected ICAO address. */
  selectedIcaoAddress?: DataAccessor<number>;
}

/** Create a display-only ADS-B traffic {@link MapLayer}. */
export function createAdsbTrafficLayer(
  data: DataAccessor<readonly TrafficAircraft[]>,
  options: AdsbTrafficLayerOptions = {},
): MapLayer {
  const id = options.id ?? 'adsb.traffic';
  const iconSizePx = options.iconSizePx ?? 24;
  const color = options.color ?? '#ffcc33';
  const outline = options.outline ?? '#ffffff';
  const hoverColor = options.hoverColor ?? '#7dd3fc';
  const selectedColor = options.selectedColor ?? '#fb7185';
  const showLabels = options.showLabels ?? true;

  return {
    id,
    render(ctx): void {
      const traffic = data();
      if (!traffic || traffic.length === 0) return;
      const hoveredIcaoAddress = options.hoveredIcaoAddress?.();
      const selectedIcaoAddress = options.selectedIcaoAddress?.();
      const targets = projectTrafficTargets(traffic, ctx.project, {
        iconSizePx,
        ...(hoveredIcaoAddress !== undefined ? { hoveredIcaoAddress } : {}),
        ...(selectedIcaoAddress !== undefined ? { selectedIcaoAddress } : {}),
      });

      const g = ctx.canvas.getContext('2d');
      if (!g) return;
      for (const target of targets) {
        const fill = target.selected ? selectedColor : target.hovered ? hoverColor : color;
        fillPolygon(g, target.icon, {
          fill,
          stroke: outline,
          width: target.selected || target.hovered ? 2.25 : 1.25,
        });
        if (showLabels) {
          const labelOptions = {
            color: outline,
            dx: 0,
            dy: 0,
            ...(target.selected || target.hovered
              ? { font: '600 12px system-ui, sans-serif' }
              : {}),
          };
          drawLabel(g, target.labelAnchor, trafficLabel(target.aircraft), labelOptions);
        }
      }
    },
  };
}
