/**
 * `geo/survey` public surface (task T4.5; spec plan/04 §4.3 survey/grid).
 *
 * Dependency-free, DOM-free lawn-mower (boustrophedon) survey-grid generation:
 * photogrammetry camera math, polygon-clipped sweep lines, survey estimates, and
 * a {@link Mission} converter. Cross-module consumers import from here, never
 * deep paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the API, formulas and how to test.
 */
export {
  altitudeFromGsd,
  gsdFromAltitude,
  groundFootprint,
  lineSpacingFromSidelap,
  triggerDistanceFromFrontlap,
  DEFAULT_CAMERA,
} from './camera';

export { generateGrid, resolveSensor, DEFAULT_SURVEY_SPEED_MS } from './grid';

export {
  surveyToMission,
  CMD_NAV_WAYPOINT,
  CMD_DO_SET_CAM_TRIGG_DIST,
  FRAME_GLOBAL_RELATIVE_ALT,
  type SurveyMissionOptions,
} from './waypoints';

export { polygonAreaM2, polygonCentroid, toPlanar, toLatLon, type PlanarPoint } from './geometry';

export type {
  CameraModel,
  SensorSpec,
  SurveyCameraSpec,
  SurveyDirectSpec,
  ResolvedSensor,
  SurveyOptions,
  SurveyEstimates,
  SurveyGrid,
  GridLine,
} from './types';
