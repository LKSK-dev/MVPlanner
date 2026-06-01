import { describe, it, expect, vi } from 'vitest';
import {
  buildPlan,
  detectFormat,
  importGpx,
  importKml,
  loadMissionFile,
  parseMissionContent,
  parsePlan,
  parseWpl,
  saveMission,
  savePlanFile,
  serializePlan,
  serializeWpl,
  type PlanFile,
} from '../../src/data/missionfile';
import type { FileIo, Mission, MissionItem } from '../../src/contracts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Canonical WPL text exactly as {@link serializeWpl} produces it. */
const WPL_TEXT =
  'QGC WPL 110\n' +
  '0\t1\t0\t16\t0\t0\t0\t0\t-35.363261\t149.165237\t584\t1\n' +
  '1\t0\t3\t16\t0\t0\t0\t0\t-35.361988\t149.163753\t100\t1\n' +
  '2\t0\t3\t22\t5\t0\t0\t0\t-35.359972\t149.163651\t50.5\t1\n';

function wplMission(): Mission {
  return {
    type: 'mission',
    items: [
      {
        seq: 0,
        current: 1,
        frame: 0,
        command: 16,
        params: [0, 0, 0, 0],
        x: -353632610,
        y: 1491652370,
        z: 584,
        autocontinue: 1,
      },
      {
        seq: 1,
        current: 0,
        frame: 3,
        command: 16,
        params: [0, 0, 0, 0],
        x: -353619880,
        y: 1491637530,
        z: 100,
        autocontinue: 1,
      },
      {
        seq: 2,
        current: 0,
        frame: 3,
        command: 22,
        params: [5, 0, 0, 0],
        x: -353599720,
        y: 1491636510,
        z: 50.5,
        autocontinue: 1,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// WPL 110
// ---------------------------------------------------------------------------

describe('parseWpl', () => {
  it('parses rows and converts degrees → 1e7 ints', () => {
    const m = parseWpl(WPL_TEXT);
    expect(m.type).toBe('mission');
    expect(m.items).toEqual(wplMission().items);
    // explicit 1e7 conversion check
    expect(m.items[0]?.x).toBe(-353632610);
    expect(m.items[0]?.y).toBe(1491652370);
  });

  it('throws without the QGC WPL 110 header', () => {
    expect(() => parseWpl('0\t1\t0\t16\t0\t0\t0\t0\t1\t2\t3\t1\n')).toThrow(/QGC WPL 110/);
  });

  it('throws on a short row', () => {
    expect(() => parseWpl('QGC WPL 110\n0\t1\t0\t16\n')).toThrow(/columns/);
  });
});

describe('serializeWpl', () => {
  it('produces the canonical text', () => {
    expect(serializeWpl(wplMission())).toBe(WPL_TEXT);
  });
});

describe('WPL round-trip', () => {
  it('serialize(parse(text)) === text (exact)', () => {
    expect(serializeWpl(parseWpl(WPL_TEXT))).toBe(WPL_TEXT);
  });

  it('parse(serialize(mission)) deep-equals mission', () => {
    const m = wplMission();
    expect(parseWpl(serializeWpl(m))).toEqual(m);
  });

  it('round-trips negative and high-precision coordinates exactly', () => {
    const m: Mission = {
      type: 'mission',
      items: [
        {
          seq: 0,
          current: 0,
          frame: 3,
          command: 16,
          params: [1.5, -2.25, 0, 0],
          x: -1234567,
          y: 1799999999,
          z: -10.25,
          autocontinue: 0,
        },
      ],
    };
    expect(parseWpl(serializeWpl(m))).toEqual(m);
  });
});

// ---------------------------------------------------------------------------
// .plan
// ---------------------------------------------------------------------------

function planFixture(): PlanFile {
  return {
    groundStation: 'MVPlanner',
    firmwareType: 12,
    vehicleType: 2,
    cruiseSpeed: 15,
    hoverSpeed: 5,
    plannedHomePosition: [-35.3632, 149.1652, 584],
    mission: {
      type: 'mission',
      items: [
        {
          seq: 0,
          current: 0,
          frame: 3,
          command: 22,
          params: [0, 0, 0, 0],
          x: -353632610,
          y: 1491652370,
          z: 30,
          autocontinue: 1,
        },
        {
          seq: 1,
          current: 0,
          frame: 3,
          command: 16,
          params: [0, 0, 0, 0],
          x: -353619880,
          y: 1491637530,
          z: 50,
          autocontinue: 1,
        },
      ],
    },
    fence: {
      circles: [{ inclusion: true, center: [-35.36, 149.16], radius: 100 }],
      polygons: [
        {
          inclusion: false,
          polygon: [
            [-35.361, 149.161],
            [-35.362, 149.162],
            [-35.363, 149.163],
          ],
        },
      ],
    },
    rally: { points: [[-35.3635, 149.1655, 40]] },
  };
}

describe('serializePlan / parsePlan', () => {
  it('serializes a QGC-shaped document', () => {
    const obj = JSON.parse(serializePlan(planFixture())) as Record<string, unknown>;
    expect(obj.fileType).toBe('Plan');
    expect(obj.version).toBe(1);
    const mission = obj.mission as Record<string, unknown>;
    expect((mission.items as unknown[]).length).toBe(2);
    const first = (mission.items as Record<string, unknown>[])[0];
    expect(first?.type).toBe('SimpleItem');
    expect(first?.doJumpId).toBe(1);
    // params: [p1..p4, lat, lon, alt] in degrees
    expect((first?.params as number[])[4]).toBeCloseTo(-35.363261, 6);
    expect((first?.params as number[])[5]).toBeCloseTo(149.165237, 6);
  });

  it('round-trips parse → serialize → parse exactly', () => {
    const plan = planFixture();
    const again = parsePlan(serializePlan(plan));
    expect(again).toEqual(plan);
  });

  it('parses degrees → 1e7 ints in mission items', () => {
    const plan = parsePlan(serializePlan(planFixture()));
    expect(plan.mission.items[0]?.x).toBe(-353632610);
    expect(plan.mission.items[0]?.y).toBe(1491652370);
  });

  it('defaults missing sections (no fence/rally/groundStation)', () => {
    const minimal = JSON.stringify({
      fileType: 'Plan',
      version: 1,
      mission: {
        version: 2,
        plannedHomePosition: [1, 2, 3],
        items: [
          {
            type: 'SimpleItem',
            command: 16,
            frame: 3,
            params: [0, 0, 0, 0, 1, 2, 30],
            autoContinue: true,
          },
        ],
      },
    });
    const plan = parsePlan(minimal);
    expect(plan.groundStation).toBe('MVPlanner');
    expect(plan.fence).toEqual({ circles: [], polygons: [] });
    expect(plan.rally).toEqual({ points: [] });
    expect(plan.mission.items[0]?.autocontinue).toBe(1);
  });

  it('rejects invalid JSON and bad structure', () => {
    expect(() => parsePlan('{ not json')).toThrow(/invalid JSON/);
    expect(() => parsePlan('{}')).toThrow(/mission/);
    expect(() => parsePlan(JSON.stringify({ fileType: 'NotAPlan', mission: {} }))).toThrow(
      /fileType/,
    );
  });

  it('rejects unsupported item types', () => {
    const doc = JSON.stringify({
      fileType: 'Plan',
      mission: {
        plannedHomePosition: [0, 0, 0],
        items: [{ type: 'ComplexItem', command: 0, frame: 0, params: [] }],
      },
    });
    expect(() => parsePlan(doc)).toThrow(/SimpleItem/);
  });
});

describe('buildPlan', () => {
  it('wraps a bare mission with defaults + home from first item', () => {
    const m = wplMission();
    const plan = buildPlan(m);
    expect(plan.groundStation).toBe('MVPlanner');
    expect(plan.fence).toEqual({ circles: [], polygons: [] });
    expect(plan.rally).toEqual({ points: [] });
    expect(plan.plannedHomePosition[0]).toBeCloseTo(-35.363261, 6);
    expect(plan.mission.items).toBe(m.items);
  });

  it('uses the origin when the mission is empty', () => {
    const plan = buildPlan({ type: 'mission', items: [] });
    expect(plan.plannedHomePosition).toEqual([0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// KML / GPX import
// ---------------------------------------------------------------------------

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <LineString>
        <coordinates>
          149.165237,-35.363261,584
          149.163753,-35.361988,100
          149.163651,-35.359972
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="-35.363261" lon="149.165237"><ele>584</ele></trkpt>
    <trkpt lat="-35.361988" lon="149.163753"><ele>100</ele></trkpt>
    <trkpt lat="-35.359972" lon="149.163651"></trkpt>
  </trkseg></trk>
</gpx>`;

describe('importKml', () => {
  it('extracts coordinates (lon,lat,alt) into NAV_WAYPOINT items', () => {
    const m = importKml(KML);
    expect(m.items.length).toBe(3);
    const first = m.items[0] as MissionItem;
    expect(first.command).toBe(16);
    expect(first.frame).toBe(3);
    expect(first.current).toBe(1);
    expect(first.x).toBe(-353632610);
    expect(first.y).toBe(1491652370);
    expect(first.z).toBe(584);
    // missing alt → defaultAlt (0)
    expect(m.items[2]?.z).toBe(0);
    expect(m.items[1]?.current).toBe(0);
  });

  it('honours defaultAlt', () => {
    const m = importKml(KML, { defaultAlt: 25 });
    expect(m.items[2]?.z).toBe(25);
  });

  it('throws when there are no coordinates', () => {
    expect(() => importKml('<kml><Document/></kml>')).toThrow(/no coordinates/);
  });
});

describe('importGpx', () => {
  it('extracts track points with ele into NAV_WAYPOINT items', () => {
    const m = importGpx(GPX);
    expect(m.items.length).toBe(3);
    expect(m.items[0]?.command).toBe(16);
    expect(m.items[0]?.x).toBe(-353632610);
    expect(m.items[0]?.y).toBe(1491652370);
    expect(m.items[0]?.z).toBe(584);
    // no <ele> → defaultAlt
    expect(m.items[2]?.z).toBe(0);
  });

  it('falls back to wpt when there is no track', () => {
    const wpts = `<gpx xmlns="http://www.topografix.com/GPX/1/1">
      <wpt lat="1.5" lon="2.5"><ele>10</ele></wpt>
      <wpt lat="3.5" lon="4.5"/>
    </gpx>`;
    const m = importGpx(wpts);
    expect(m.items.length).toBe(2);
    expect(m.items[0]?.x).toBe(15000000);
    expect(m.items[1]?.z).toBe(0);
  });

  it('throws when there are no points', () => {
    expect(() => importGpx('<gpx></gpx>')).toThrow(/no track/);
  });
});

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

describe('detectFormat', () => {
  it('detects by extension', () => {
    expect(detectFormat('a.waypoints', '')).toBe('wpl');
    expect(detectFormat('a.mission', '')).toBe('wpl');
    expect(detectFormat('a.plan', '')).toBe('plan');
    expect(detectFormat('a.kml', '')).toBe('kml');
    expect(detectFormat('a.gpx', '')).toBe('gpx');
  });

  it('sniffs .txt and unknown extensions by content', () => {
    expect(detectFormat('a.txt', WPL_TEXT)).toBe('wpl');
    expect(detectFormat('a.txt', '')).toBe('wpl');
    expect(detectFormat('noext', WPL_TEXT)).toBe('wpl');
    expect(detectFormat('noext', '{ "fileType": "Plan" }')).toBe('plan');
    expect(detectFormat('noext', KML)).toBe('kml');
    expect(detectFormat('noext', GPX)).toBe('gpx');
    expect(detectFormat('noext', 'random')).toBeUndefined();
  });
});

describe('parseMissionContent', () => {
  it('routes each format and exposes plan for .plan', () => {
    expect(parseMissionContent('m.waypoints', WPL_TEXT).format).toBe('wpl');
    const loadedPlan = parseMissionContent('m.plan', serializePlan(planFixture()));
    expect(loadedPlan.format).toBe('plan');
    expect(loadedPlan.plan?.fence.circles.length).toBe(1);
    expect(loadedPlan.mission.items.length).toBe(2);
    expect(parseMissionContent('m.kml', KML).mission.items.length).toBe(3);
    expect(parseMissionContent('m.gpx', GPX).mission.items.length).toBe(3);
  });

  it('throws on an unrecognised file', () => {
    expect(() => parseMissionContent('mystery.dat', 'nope')).toThrow(/unrecognized/);
  });
});

// ---------------------------------------------------------------------------
// FileIo load/save
// ---------------------------------------------------------------------------

describe('loadMissionFile', () => {
  it('loads + parses a picked WPL file', async () => {
    const fileIo: FileIo = {
      openForRead: vi.fn(async () => ({
        name: 'demo.waypoints',
        blob: new Blob([WPL_TEXT], { type: 'text/plain' }),
      })),
      saveAs: vi.fn(async () => undefined),
    };
    const loaded = await loadMissionFile(fileIo);
    expect(fileIo.openForRead).toHaveBeenCalledWith([
      '.waypoints',
      '.txt',
      '.mission',
      '.plan',
      '.kml',
      '.gpx',
    ]);
    expect(loaded?.format).toBe('wpl');
    expect(loaded?.mission.items).toEqual(wplMission().items);
  });

  it('loads + parses a picked .plan file (with plan structure)', async () => {
    const text = serializePlan(planFixture());
    const fileIo: FileIo = {
      openForRead: vi.fn(async () => ({ name: 'survey.plan', blob: new Blob([text]) })),
      saveAs: vi.fn(async () => undefined),
    };
    const loaded = await loadMissionFile(fileIo);
    expect(loaded?.format).toBe('plan');
    expect(loaded?.plan?.rally.points.length).toBe(1);
  });

  it('returns undefined when the picker is cancelled', async () => {
    const fileIo: FileIo = {
      openForRead: vi.fn(async () => undefined),
      saveAs: vi.fn(async () => undefined),
    };
    expect(await loadMissionFile(fileIo)).toBeUndefined();
  });
});

describe('saveMission / savePlanFile', () => {
  function captureFileIo(): { fileIo: FileIo; saved: () => { text: string; name: string } } {
    let captured: { text: string; name: string } | undefined;
    const fileIo: FileIo = {
      openForRead: vi.fn(async () => undefined),
      saveAs: vi.fn(async (data: Blob, name: string) => {
        captured = { text: await data.text(), name };
      }),
    };
    return {
      fileIo,
      saved: () => {
        if (!captured) {
          throw new Error('saveAs not called');
        }
        return captured;
      },
    };
  }

  it('saves WPL with the default name and re-parses identically', async () => {
    const { fileIo, saved } = captureFileIo();
    await saveMission(fileIo, wplMission(), 'wpl');
    expect(saved().name).toBe('mission.waypoints');
    expect(saved().text).toBe(WPL_TEXT);
    expect(parseWpl(saved().text)).toEqual(wplMission());
  });

  it('saves a .plan built from a bare mission', async () => {
    const { fileIo, saved } = captureFileIo();
    await saveMission(fileIo, wplMission(), 'plan', 'out.plan');
    expect(saved().name).toBe('out.plan');
    const plan = parsePlan(saved().text);
    expect(plan.mission.items.length).toBe(3);
    expect(plan.fence).toEqual({ circles: [], polygons: [] });
  });

  it('savePlanFile writes the full plan (fence + rally preserved)', async () => {
    const { fileIo, saved } = captureFileIo();
    await savePlanFile(fileIo, planFixture(), 'full.plan');
    expect(saved().name).toBe('full.plan');
    expect(parsePlan(saved().text)).toEqual(planFixture());
  });
});
