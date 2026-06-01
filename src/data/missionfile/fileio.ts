/**
 * Format auto-detection + {@link FileIo}-based load/save for mission files
 * (task T4.9; spec plan/04 §4.3, plan/07 §7.6). These are the thin adapters the
 * Plan assembly wires to its open/save actions; all format logic lives in the
 * sibling modules.
 */
import type { FileIo, Mission } from '../../contracts';
import { importGpx, importKml } from './importers';
import { buildPlan, parsePlan, serializePlan } from './plan';
import type { ImportOptions, LoadedMission, MissionFileFormat, MissionSaveFormat } from './types';
import { parseWpl, serializeWpl } from './wpl';

/** File-picker accept hints for mission files (read). */
export const MISSION_FILE_ACCEPT: readonly string[] = [
  '.waypoints',
  '.txt',
  '.mission',
  '.plan',
  '.kml',
  '.gpx',
];

/** MIME type used when saving `QGC WPL 110` text. */
export const WPL_MIME = 'text/plain';
/** MIME type used when saving `.plan` JSON. */
export const PLAN_MIME = 'application/json';

/** Default suggested file names per writable format. */
export const DEFAULT_WPL_NAME = 'mission.waypoints';
/** Default suggested file name for a saved `.plan`. */
export const DEFAULT_PLAN_NAME = 'mission.plan';

/** Lower-cased file extension (without the dot), or `''` when none. */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Best-effort content sniff when the extension is ambiguous/unknown. */
function sniff(content: string): MissionFileFormat | undefined {
  const head = content.trimStart();
  if (/^QGC\s+WPL/i.test(head)) {
    return 'wpl';
  }
  if (head.startsWith('{') && /"fileType"\s*:\s*"Plan"/.test(content)) {
    return 'plan';
  }
  if (/<kml[\s>]/i.test(content)) {
    return 'kml';
  }
  if (/<gpx[\s>]/i.test(content)) {
    return 'gpx';
  }
  return undefined;
}

/**
 * Detect a mission file format from its name and content. The extension is
 * authoritative for the unambiguous formats (`.waypoints`/`.mission`/`.plan`/
 * `.kml`/`.gpx`); `.txt` and unknown extensions fall back to a content sniff.
 *
 * @param name - File name (used for its extension).
 * @param content - File text (used for sniffing).
 * @returns The detected format, or `undefined` when unrecognised.
 */
export function detectFormat(name: string, content: string): MissionFileFormat | undefined {
  switch (extOf(name)) {
    case 'waypoints':
    case 'mission':
      return 'wpl';
    case 'plan':
      return 'plan';
    case 'kml':
      return 'kml';
    case 'gpx':
      return 'gpx';
    case 'txt':
      return sniff(content) ?? 'wpl';
    default:
      return sniff(content);
  }
}

/**
 * Parse already-loaded mission file text into a {@link LoadedMission}, detecting
 * the format from `name`/`content`.
 *
 * @param name - File name (for format detection + the result `name`).
 * @param content - File text.
 * @param opts - KML/GPX import options.
 * @returns The parsed result.
 * @throws If the format cannot be recognised.
 */
export function parseMissionContent(
  name: string,
  content: string,
  opts?: ImportOptions,
): LoadedMission {
  const format = detectFormat(name, content);
  if (!format) {
    throw new Error(`unrecognized mission file: ${name}`);
  }
  switch (format) {
    case 'wpl':
      return { name, format, mission: parseWpl(content) };
    case 'plan': {
      const plan = parsePlan(content);
      return { name, format, mission: plan.mission, plan };
    }
    case 'kml':
      return { name, format, mission: importKml(content, opts) };
    case 'gpx':
      return { name, format, mission: importGpx(content, opts) };
  }
}

/**
 * Prompt for a mission file and parse it (auto-detecting the format).
 *
 * @param fileIo - The storage {@link FileIo} (or a mock in tests).
 * @param opts - KML/GPX import options.
 * @returns The parsed {@link LoadedMission}, or `undefined` if cancelled.
 * @throws If the format cannot be recognised or the content is malformed.
 */
export async function loadMissionFile(
  fileIo: FileIo,
  opts?: ImportOptions,
): Promise<LoadedMission | undefined> {
  const picked = await fileIo.openForRead([...MISSION_FILE_ACCEPT]);
  if (!picked) {
    return undefined;
  }
  const text = await picked.blob.text();
  return parseMissionContent(picked.name, text, opts);
}

/** Serialize a mission to text for the given writable format. */
function serializeMission(mission: Mission, format: MissionSaveFormat): string {
  return format === 'plan' ? serializePlan(buildPlan(mission)) : serializeWpl(mission);
}

/**
 * Serialize a mission and save it to disk via the picker.
 *
 * For `'plan'` the mission is wrapped in a default {@link import('./types').PlanFile}
 * (empty fence/rally); use {@link savePlanFile} to write a full plan.
 *
 * @param fileIo - The storage {@link FileIo} (or a mock in tests).
 * @param mission - The mission to write.
 * @param format - `'wpl'` or `'plan'`.
 * @param suggestedName - Suggested file name (defaults per format).
 */
export async function saveMission(
  fileIo: FileIo,
  mission: Mission,
  format: MissionSaveFormat,
  suggestedName?: string,
): Promise<void> {
  const text = serializeMission(mission, format);
  const mime = format === 'plan' ? PLAN_MIME : WPL_MIME;
  const name = suggestedName ?? (format === 'plan' ? DEFAULT_PLAN_NAME : DEFAULT_WPL_NAME);
  await fileIo.saveAs(new Blob([text], { type: mime }), name);
}

/**
 * Serialize a full {@link import('./types').PlanFile} (mission + fence + rally +
 * metadata) and save it as `.plan`.
 *
 * @param fileIo - The storage {@link FileIo} (or a mock in tests).
 * @param plan - The plan to write.
 * @param suggestedName - Suggested file name (default {@link DEFAULT_PLAN_NAME}).
 */
export async function savePlanFile(
  fileIo: FileIo,
  plan: Parameters<typeof serializePlan>[0],
  suggestedName: string = DEFAULT_PLAN_NAME,
): Promise<void> {
  const blob = new Blob([serializePlan(plan)], { type: PLAN_MIME });
  await fileIo.saveAs(blob, suggestedName);
}
