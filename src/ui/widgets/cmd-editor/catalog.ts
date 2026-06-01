/**
 * Curated mission command set + slot resolution for the editor (task T4.2; spec
 * plan/04 §4.3). Pure, DOM-free.
 *
 * The picker offers a curated, ordered set of mission-relevant `MAV_CMD`s drawn
 * from the dialect catalog; any id missing from the active dialect is silently
 * skipped. The editor renders one field per command slot, labelled from the
 * dialect metadata with a generic fallback.
 */
import {
  PARAM_INDEX_X,
  PARAM_INDEX_Y,
  PARAM_INDEX_Z,
  defaultCommandCatalog,
  type MavCmdCategory,
  type MavCmdMeta,
  type MissionItemModel,
} from '../../../geo/mission';
import type { EditorSlot, TFn } from './types';

/**
 * Curated, ordered mission command ids (spec plan/04 §4.3 palette). Resolved
 * against the dialect catalog; unknown ids are dropped so a minimal dialect
 * still yields a sensible list.
 */
export const CURATED_COMMANDS: readonly number[] = [
  16, // NAV_WAYPOINT
  22, // NAV_TAKEOFF
  21, // NAV_LAND
  20, // NAV_RETURN_TO_LAUNCH
  17, // NAV_LOITER_UNLIM
  18, // NAV_LOITER_TURNS
  19, // NAV_LOITER_TIME
  177, // DO_JUMP
  178, // DO_CHANGE_SPEED
  183, // DO_SET_SERVO
  181, // DO_SET_RELAY
  201, // DO_SET_ROI
  195, // DO_SET_ROI_LOCATION
  203, // DO_DIGICAM_CONTROL
  2000, // IMAGE_START_CAPTURE
  112, // CONDITION_DELAY
  113, // CONDITION_CHANGE_ALT
  114, // CONDITION_DISTANCE
];

/** Display order for category groups in the picker. */
export const CATEGORY_ORDER: readonly MavCmdCategory[] = ['NAV', 'DO', 'CONDITION', 'OTHER'];

/** i18n key for a category group heading. */
export function categoryKey(category: MavCmdCategory): string {
  switch (category) {
    case 'NAV':
      return 'cmd.group.nav';
    case 'DO':
      return 'cmd.group.do';
    case 'CONDITION':
      return 'cmd.group.condition';
    default:
      return 'cmd.group.other';
  }
}

/**
 * Resolve the curated command list against the bundled dialect catalog, in
 * curated order. Unknown ids are dropped.
 */
export function curatedCommandMetas(): readonly MavCmdMeta[] {
  const catalog = defaultCommandCatalog();
  const out: MavCmdMeta[] = [];
  for (const value of CURATED_COMMANDS) {
    const meta = catalog.get(value);
    if (meta) out.push(meta);
  }
  return out;
}

/** A category group with its members (in input order). */
export interface CommandGroup {
  category: MavCmdCategory;
  commands: readonly MavCmdMeta[];
}

/** Group `commands` by category in {@link CATEGORY_ORDER}; empty groups dropped. */
export function groupCommands(commands: readonly MavCmdMeta[]): readonly CommandGroup[] {
  const byCategory = new Map<MavCmdCategory, MavCmdMeta[]>();
  for (const meta of commands) {
    const bucket = byCategory.get(meta.category) ?? [];
    bucket.push(meta);
    byCategory.set(meta.category, bucket);
  }
  const out: CommandGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const bucket = byCategory.get(category);
    if (bucket && bucket.length > 0) out.push({ category, commands: bucket });
  }
  return out;
}

function genericLabel(index: number, t: TFn): string {
  switch (index) {
    case PARAM_INDEX_X:
      return t('cmd.slot.lat');
    case PARAM_INDEX_Y:
      return t('cmd.slot.lon');
    case PARAM_INDEX_Z:
      return t('cmd.slot.alt');
    default:
      return t('cmd.param', { n: index + 1 });
  }
}

function slotKind(index: number): EditorSlot['kind'] {
  switch (index) {
    case PARAM_INDEX_X:
      return 'lat';
    case PARAM_INDEX_Y:
      return 'lon';
    case PARAM_INDEX_Z:
      return 'alt';
    default:
      return 'param';
  }
}

function slotValue(item: MissionItemModel, index: number): number {
  switch (index) {
    case PARAM_INDEX_X:
      return item.lat;
    case PARAM_INDEX_Y:
      return item.lon;
    case PARAM_INDEX_Z:
      return item.alt;
    default:
      return item.params[index] ?? 0;
  }
}

/**
 * Resolve the seven editor slots for `item`, labelling each from `meta` (when
 * supplied) with a generic fallback. Slots the dialect leaves unlabelled are
 * marked `unused` (the widget renders them muted) but stay editable.
 */
export function resolveSlots(
  item: MissionItemModel,
  meta: MavCmdMeta | undefined,
  t: TFn,
): readonly EditorSlot[] {
  const slots: EditorSlot[] = [];
  for (let index = 0; index < 7; index++) {
    const raw = meta?.params[index] ?? '';
    const unused = raw.trim() === '';
    slots.push({
      index,
      label: unused ? genericLabel(index, t) : raw,
      value: slotValue(item, index),
      unused,
      kind: slotKind(index),
    });
  }
  return slots;
}

/** Apply a slot edit to `item`, returning a new {@link MissionItemModel}. */
export function applySlot(
  item: MissionItemModel,
  slot: EditorSlot,
  value: number,
): MissionItemModel {
  switch (slot.kind) {
    case 'lat':
      return { ...item, lat: value };
    case 'lon':
      return { ...item, lon: value };
    case 'alt':
      return { ...item, alt: value };
    case 'param': {
      const params: [number, number, number, number] = [
        item.params[0],
        item.params[1],
        item.params[2],
        item.params[3],
      ];
      if (slot.index >= 0 && slot.index < 4) params[slot.index] = value;
      return { ...item, params };
    }
    default: {
      const _exhaustive: never = slot.kind;
      return _exhaustive;
    }
  }
}
