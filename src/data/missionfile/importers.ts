/**
 * KML / GPX import → simple waypoint mission (task T4.9 SHOULD; spec plan/04
 * §4.3, plan/07 §7.6).
 *
 * These importers extract a track/route/placemark's coordinates and turn each
 * one into a `MAV_CMD_NAV_WAYPOINT` item in a `mission`-type
 * {@link import('../../contracts').Mission}. They are read-only: the geometry's
 * intent (areas, overlays, styling) is not preserved — only the ordered
 * coordinates. XML is parsed with the platform `DOMParser` (available in the
 * browser and the happy-dom test environment); elements are matched by their
 * (unprefixed) tag name, which covers the default-namespaced KML/GPX that tools
 * emit.
 */
import type { Mission, MissionItem } from '../../contracts';
import { MAV_CMD_NAV_WAYPOINT, MAV_FRAME_GLOBAL_RELATIVE_ALT, degToE7 } from './coords';
import type { ImportOptions } from './types';

/** Minimal structural view of the global `DOMParser` constructor. */
interface DomParserCtor {
  new (): {
    parseFromString(text: string, mimeType: string): Document;
  };
}

/** Resolve the platform `DOMParser`, or throw a helpful error if absent. */
function getDomParser(): DomParserCtor {
  const ctor = (globalThis as { DOMParser?: DomParserCtor }).DOMParser;
  if (typeof ctor !== 'function') {
    throw new Error('XML import requires a DOMParser (browser/happy-dom) environment');
  }
  return ctor;
}

/** Parse XML text into a document, surfacing parser errors. */
function parseXml(text: string): Document {
  const Ctor = getDomParser();
  const doc = new Ctor().parseFromString(text, 'application/xml');
  const errors = doc.getElementsByTagName('parsererror');
  const firstError = errors.item(0);
  if (firstError) {
    throw new Error(`XML parse error: ${firstError.textContent?.trim() ?? 'invalid XML'}`);
  }
  return doc;
}

/** All elements with the given (unprefixed) tag name, in document order. */
function byLocalName(doc: Document | Element, name: string): Element[] {
  const list = doc.getElementsByTagName(name);
  const out: Element[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const el = list.item(i);
    if (el) {
      out.push(el);
    }
  }
  return out;
}

/** Build a `NAV_WAYPOINT` {@link MissionItem} from a coordinate. */
function waypoint(seq: number, latDeg: number, lonDeg: number, altM: number): MissionItem {
  return {
    seq,
    current: seq === 0 ? 1 : 0,
    frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
    command: MAV_CMD_NAV_WAYPOINT,
    params: [0, 0, 0, 0],
    x: degToE7(latDeg),
    y: degToE7(lonDeg),
    z: altM,
    autocontinue: 1,
  };
}

/**
 * Import a KML document as a simple waypoint mission.
 *
 * Every `<coordinates>` element (point, line, ring) is read in document order;
 * each `lon,lat[,alt]` tuple becomes a waypoint. (KML stores coordinates as
 * **longitude,latitude,altitude**.)
 *
 * @param text - KML source.
 * @param opts - Import options ({@link ImportOptions.defaultAlt}).
 * @returns A `mission`-type {@link Mission}.
 * @throws If no coordinates are found.
 */
export function importKml(text: string, opts?: ImportOptions): Mission {
  const defaultAlt = opts?.defaultAlt ?? 0;
  const doc = parseXml(text);
  const items: MissionItem[] = [];
  for (const el of byLocalName(doc, 'coordinates')) {
    const raw = el.textContent ?? '';
    for (const tuple of raw.trim().split(/\s+/)) {
      if (tuple === '') {
        continue;
      }
      const parts = tuple.split(',');
      const lonTok = parts[0];
      const latTok = parts[1];
      const altTok = parts[2];
      if (lonTok === undefined || latTok === undefined) {
        continue;
      }
      const lon = Number(lonTok);
      const lat = Number(latTok);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        continue;
      }
      const alt = altTok !== undefined ? Number(altTok) : defaultAlt;
      items.push(waypoint(items.length, lat, lon, Number.isFinite(alt) ? alt : defaultAlt));
    }
  }
  if (items.length === 0) {
    throw new Error('KML import: no coordinates found');
  }
  return { type: 'mission', items };
}

/** Read the `<ele>` child of a GPX point, or the supplied default. */
function readEle(point: Element, defaultAlt: number): number {
  const ele = byLocalName(point, 'ele')[0];
  if (!ele) {
    return defaultAlt;
  }
  const n = Number(ele.textContent?.trim() ?? '');
  return Number.isFinite(n) ? n : defaultAlt;
}

/**
 * Import a GPX document as a simple waypoint mission.
 *
 * Track points (`<trkpt>`) are preferred; if none exist, route points
 * (`<rtept>`) are used; failing that, standalone waypoints (`<wpt>`). Each
 * point's `lat`/`lon` attributes (decimal degrees) and optional `<ele>` (metres)
 * become a waypoint.
 *
 * @param text - GPX source.
 * @param opts - Import options ({@link ImportOptions.defaultAlt}).
 * @returns A `mission`-type {@link Mission}.
 * @throws If no usable points are found.
 */
export function importGpx(text: string, opts?: ImportOptions): Mission {
  const defaultAlt = opts?.defaultAlt ?? 0;
  const doc = parseXml(text);
  const points =
    pickFirstNonEmpty(byLocalName(doc, 'trkpt'), byLocalName(doc, 'rtept')) ??
    byLocalName(doc, 'wpt');
  const items: MissionItem[] = [];
  for (const pt of points) {
    const latAttr = pt.getAttribute('lat');
    const lonAttr = pt.getAttribute('lon');
    if (latAttr === null || lonAttr === null) {
      continue;
    }
    const lat = Number(latAttr);
    const lon = Number(lonAttr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    items.push(waypoint(items.length, lat, lon, readEle(pt, defaultAlt)));
  }
  if (items.length === 0) {
    throw new Error('GPX import: no track/route/waypoint points found');
  }
  return { type: 'mission', items };
}

/** Return the first list if it is non-empty, else the second if non-empty, else `undefined`. */
function pickFirstNonEmpty(a: Element[], b: Element[]): Element[] | undefined {
  if (a.length > 0) {
    return a;
  }
  if (b.length > 0) {
    return b;
  }
  return undefined;
}
