import { distanceM, nearestOnEdge, pointInPolygon } from './geo';
import type { LatLng, NoGoZone } from './types';

/**
 * Finds safe places for challenges inside the game border, using OpenStreetMap data:
 *  - YES: parks, playgrounds, grass, footpaths, the edges of quiet neighborhood streets,
 *    and the area around ponds (not in them), including the gaps between houses.
 *  - NO: inside water (ponds, pools, canals), inside or right up against buildings,
 *    on or next to busy roads, or inside the host's no-go zones.
 */

const OVERPASS = 'https://overpass-api.de/api/interpreter';

const MIN_FROM_BUILDING = 5;   // meters from a building wall
const MIN_FROM_WATER = 6;      // meters from a water edge (around the pond is fine, not in it)
const MIN_FROM_BUSY_ROAD = 18; // meters from the center of a busy road
const SPACING = 30;            // minimum distance between two spots
const MAX_SPOTS = 150;

const BUSY = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/;
const QUIET_STREET = /^(residential|unclassified|living_street|service|road)$/;
const PATH = /^(footway|path|pedestrian|cycleway|track|bridleway|steps|corridor)$/;
const LINEAR_WATER = /^(river|stream|canal|ditch|drain)$/;

type OsmNode = { lat: number; lon: number };
type OsmMember = { type: string; role: string; geometry?: OsmNode[] };
export type OsmElement = {
  type: 'way' | 'relation' | 'node';
  tags?: Record<string, string>;
  geometry?: OsmNode[];
  members?: OsmMember[];
};

const toPts = (g: OsmNode[] = []) => g.map((n) => ({ lat: n.lat, lng: n.lon }));
const closed = (p: LatLng[]) => p.length >= 4 && distanceM(p[0], p[p.length - 1]) < 1;

function bbox(points: LatLng[]) {
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
  const pad = 0.0004; // ~40 m
  return { s: Math.min(...lats) - pad, w: Math.min(...lngs) - pad, n: Math.max(...lats) + pad, e: Math.max(...lngs) + pad };
}

/** Points every `step` meters along a line, optionally pushed sideways by `offset` meters. */
function along(line: LatLng[], step: number, offset = 0): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const len = distanceM(a, b);
    if (len < 1) continue;
    const mPerLat = 111_320, mPerLng = 111_320 * Math.cos((a.lat * Math.PI) / 180);
    const dx = (b.lng - a.lng) * mPerLng, dy = (b.lat - a.lat) * mPerLat;
    const nx = -dy / len, ny = dx / len; // unit normal
    for (let d = step / 2; d < len; d += step) {
      const t = d / len;
      for (const side of offset ? [1, -1] : [0]) {
        out.push({
          lat: a.lat + (b.lat - a.lat) * t + (ny * offset * side) / mPerLat,
          lng: a.lng + (b.lng - a.lng) * t + (nx * offset * side) / mPerLng,
        });
      }
    }
  }
  return out;
}

/** Grid of points every `step` meters inside a polygon. */
function grid(poly: LatLng[], step: number): LatLng[] {
  const b = bbox(poly);
  const dLat = step / 111_320, dLng = step / (111_320 * Math.cos((b.s * Math.PI) / 180));
  const out: LatLng[] = [];
  for (let lat = b.s; lat <= b.n; lat += dLat) {
    for (let lng = b.w; lng <= b.e; lng += dLng) {
      const p = { lat, lng };
      if (pointInPolygon(p, poly)) out.push(p);
    }
  }
  return out;
}

const edgeDist = (p: LatLng, poly: LatLng[]) => nearestOnEdge(p, poly).distance;

function lineDist(p: LatLng, line: LatLng[]) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    // Treat a 2-point segment as a thin polygon edge.
    best = Math.min(best, nearestOnEdge(p, [line[i], line[i + 1]]).distance);
  }
  return best;
}

/** Turns OpenStreetMap elements into a list of safe challenge spots. Pure function, so it can be tested. */
export function buildSpots(elements: OsmElement[], border: LatLng[], noGo: NoGoZone[]): LatLng[] {
  const buildings: LatLng[][] = [];
  const water: LatLng[][] = [];
  const waterLines: LatLng[][] = [];
  const busyRoads: LatLng[][] = [];
  const candidates: { p: LatLng; score: number }[] = [];

  for (const el of elements) {
    const t = el.tags ?? {};
    const isWater = t.natural === 'water' || !!t.water || t.leisure === 'swimming_pool'
      || /^(reservoir|basin)$/.test(t.landuse ?? '') || t.waterway === 'riverbank' || t.natural === 'wetland';
    const shapes: LatLng[][] = el.type === 'relation'
      ? (el.members ?? []).filter((m) => m.role !== 'inner').map((m) => toPts(m.geometry))
      : [toPts(el.geometry)];

    for (const pts of shapes) {
      if (pts.length < 2) continue;
      if (t.building || t['building:part']) { if (closed(pts)) buildings.push(pts); continue; }
      if (isWater) { (closed(pts) ? water : waterLines).push(pts); continue; }
      if (LINEAR_WATER.test(t.waterway ?? '')) { waterLines.push(pts); continue; }
      const hw = t.highway ?? '';
      if (BUSY.test(hw)) { busyRoads.push(pts); continue; }
      if (PATH.test(hw) && t.access !== 'private') { along(pts, 20).forEach((p) => candidates.push({ p, score: 3 })); continue; }
      if (QUIET_STREET.test(hw) && t.access !== 'private' && t.service !== 'driveway') {
        // The edge of the street (sidewalk / verge), never the middle of it.
        along(pts, 30, 7).forEach((p) => candidates.push({ p, score: 1 }));
        continue;
      }
      const open = /^(park|playground|pitch|recreation_ground|common|garden|dog_park|nature_reserve)$/.test(t.leisure ?? '')
        || /^(grass|recreation_ground|village_green|meadow)$/.test(t.landuse ?? '')
        || /^(grassland|scrub|heath)$/.test(t.natural ?? '');
      if (open && closed(pts) && t.access !== 'private') grid(pts, 22).forEach((p) => candidates.push({ p, score: 4 }));
    }
  }

  const safe = (p: LatLng) => {
    if (!pointInPolygon(p, border)) return false;
    if (edgeDist(p, border) < 12) return false; // not right on the border line
    if (noGo.some((z) => z.points.length >= 3 && (pointInPolygon(p, z.points) || edgeDist(p, z.points) < 8))) return false;
    for (const w of water) if (pointInPolygon(p, w) || edgeDist(p, w) < MIN_FROM_WATER) return false;
    for (const w of waterLines) if (lineDist(p, w) < MIN_FROM_WATER + 2) return false;
    for (const r of busyRoads) if (lineDist(p, r) < MIN_FROM_BUSY_ROAD) return false;
    for (const b of buildings) {
      if (distanceM(p, b[0]) > 120) continue; // quick skip for far-away houses
      if (pointInPolygon(p, b) || edgeDist(p, b) < MIN_FROM_BUILDING) return false;
    }
    return true;
  };

  // Best places first (parks and paths), then thin them out so spots aren't bunched up.
  candidates.sort((a, b) => b.score - a.score);
  const spots: LatLng[] = [];
  for (const c of candidates) {
    if (spots.length >= MAX_SPOTS) break;
    if (spots.some((s) => distanceM(s, c.p) < SPACING)) continue;
    if (!safe(c.p)) continue;
    spots.push({ lat: Math.round(c.p.lat * 1e6) / 1e6, lng: Math.round(c.p.lng * 1e6) / 1e6 });
  }
  return spots;
}

/** Overpass mirrors (free OpenStreetMap servers). If one is busy, the next one is tried. */
const SERVERS = [
  OVERPASS,
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Downloads buildings, water, paths, roads and parks for the game area. */
export async function fetchOsm(border: LatLng[]): Promise<OsmElement[]> {
  const b = bbox(border);
  const box = `${b.s},${b.w},${b.n},${b.e}`;
  const q = `[out:json][timeout:25];(
    way["building"](${box});
    way["natural"~"water|wetland"](${box}); relation["natural"="water"](${box});
    way["water"](${box}); way["waterway"](${box});
    way["landuse"~"reservoir|basin|grass|recreation_ground|village_green|meadow"](${box});
    way["leisure"~"swimming_pool|park|playground|pitch|recreation_ground|common|garden|dog_park"](${box});
    relation["leisure"="park"](${box});
    way["highway"](${box});
  );out geom;`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < SERVERS.length * 2; attempt++) {
    const server = SERVERS[attempt % SERVERS.length];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 35_000);
    try {
      const res = await fetch(server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Map server error ${res.status}`);
      const json = (await res.json()) as { elements?: OsmElement[] };
      if (!Array.isArray(json.elements)) throw new Error('Bad map data');
      return json.elements;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('Map data unavailable');
}

/** Downloads map data for the game area and returns safe challenge spots. */
export async function findSpots(border: LatLng[], noGo: NoGoZone[]): Promise<LatLng[]> {
  return buildSpots(await fetchOsm(border), border, noGo);
}
