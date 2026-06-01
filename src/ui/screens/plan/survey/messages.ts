/**
 * i18n registration for the Survey / grid panel (task T4.5; spec plan/04 §4.3
 * survey/grid, conventions plan/implementation/00 §0.3).
 *
 * Contributes the `survey.*` namespace to the English catalog via the public
 * {@link registerMessages} seam — never editing the i18n internals. Registration
 * runs once at import and is idempotent; the panel barrel imports this for its
 * side effect.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `survey.*` strings owned by the Survey / grid panel. */
export const SURVEY_MESSAGES: Readonly<Record<string, string>> = {
  'survey.title': 'Survey / Grid',
  'survey.region.label': 'Survey grid generator',

  // Sections.
  'survey.section.camera': 'Camera',
  'survey.section.coverage': 'Coverage',
  'survey.section.layout': 'Layout',
  'survey.section.estimates': 'Estimates',

  // Camera fields.
  'survey.camera.sensorWidth': 'Sensor width (mm)',
  'survey.camera.sensorHeight': 'Sensor height (mm)',
  'survey.camera.focalLength': 'Focal length (mm)',
  'survey.camera.imageWidth': 'Image width (px)',
  'survey.camera.imageHeight': 'Image height (px)',

  // Coverage fields.
  'survey.coverage.altitude': 'Altitude (m)',
  'survey.coverage.frontlap': 'Frontlap (%)',
  'survey.coverage.sidelap': 'Sidelap (%)',

  // Layout fields.
  'survey.layout.angle': 'Grid angle (°)',
  'survey.layout.speed': 'Speed (m/s)',
  'survey.layout.cameraTrigger': 'Insert camera trigger commands',

  // Estimates.
  'survey.estimate.gsd': 'GSD',
  'survey.estimate.gsdValue': '{cm} cm/px',
  'survey.estimate.lineSpacing': 'Line spacing',
  'survey.estimate.triggerDistance': 'Trigger distance',
  'survey.estimate.lineCount': 'Lines',
  'survey.estimate.photoCount': 'Photos',
  'survey.estimate.area': 'Area',
  'survey.estimate.pathLength': 'Path length',
  'survey.estimate.duration': 'Flight time',
  'survey.estimate.meters': '{n} m',
  'survey.estimate.hectares': '{n} ha',
  'survey.estimate.minutes': '{n} min',

  // Actions / status.
  'survey.generate': 'Generate grid',
  'survey.needPolygon': 'Draw a survey polygon on the map to generate a grid.',
  'survey.invalid': 'Cannot generate a grid with the current settings.',
};

let registered = false;

/** Register the `survey.*` English catalog once (idempotent). */
export function registerSurveyMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(SURVEY_MESSAGES);
}

registerSurveyMessages();
