/**
 * `ui/widgets/hud` public surface (task T2.1; spec plan/04 §4.2 HUD,
 * plan/05 §5.4/§5.5/§5.8). A canvas-rendered artificial-horizon head-up display
 * that binds to a reactive `vehicle` accessor (plus an optional STATUSTEXT line)
 * and paints attitude, heading, speeds, altitude, climb, throttle, battery, GPS,
 * EKF/vibe, mode, a prominent ARMED state, time and a STATUSTEXT ticker.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). The Flight screen (T2.11) mounts {@link Hud}
 * with a store selector; this widget never reads the store/context itself.
 *
 * Importing this module registers the widget's `hud.*` i18n strings (via
 * `./messages`). Mounting also requires `import './hud.css'` (integration step).
 *
 * @see ./README.md for the prop contract, what is pure-tested vs canvas-deferred,
 *   and how to test.
 */
export { Hud, type HudProps } from './hud';
export { buildHudLabels, HUD_MESSAGES } from './messages';
export { readHudColors, DEFAULT_HUD_COLORS } from './colors';
export { drawHud } from './render';
export type { StatusTextAccessor, TFn, VehicleAccessor } from './types';
export {
  // Geometry + formatting (pure, unit-tested)
  buildHudModel,
  hudA11ySummary,
  hudSignature,
  radToDeg,
  degToRad,
  wrapDeg360,
  wrapDeg180,
  pitchPixels,
  pitchLadderRungs,
  headingTapeTicks,
  fmtMeters,
  fmtSpeed,
  fmtClimb,
  fmtThrottle,
  fmtBattery,
  fmtGps,
  gpsFixLabel,
  fmtEkf,
  fmtVibe,
  fmtHeading,
  fmtClock,
  DEFAULT_HUD_LABELS,
  HUD_DASH,
  // Types
  type HudColors,
  type HudLabels,
  type HudModel,
  type HudReadouts,
  type PitchRung,
  type HeadingTick,
} from './model';
