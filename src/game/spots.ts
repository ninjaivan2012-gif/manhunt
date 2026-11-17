import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { distanceM, nearestOnEdge, pointInPolygon } from './geo';
import type { LatLng, NoGoZone } from './types';

/**
 * Finds safe places for challenges, from map data:
 *  - YES: parks, playgrounds, grass, footpaths, sidewalks, the edges of quiet neighborhood
 *    streets, around ponds (not in them), and the gaps between houses.
 *  - NO: inside water (ponds, pools, canals), inside or right up against buildings,
 *    on or next to busy roads, or inside the host's no-go zones.
 *
 * Map data comes from the same vector tiles that draw the in-app map (fast, cached CDN).
 * The public OpenStreetMap "Overpass" server is only a backup, because it's often busy.
 */

const MIN_FROM_BUILDING = 5;   // meters from a building wall
const MIN_FROM_WATER = 6;      // meters from a water edge (around the pond is fine, not in it)
const MIN_FROM_BUSY_ROAD = 18; // meters from the center of a busy road
const SPACING = 30;            // minimum distance between two spots

const BUSY = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/;
const QUIET_STREET = /^(residential|unclassified|living_street|service|road)$/;
const PATH = /^(footway|path|pedestrian|cycleway|track|bridleway|steps|corridor|sidewalk)$/;
const LINEAR_WATER = /^(river|stream|canal|ditch|drain)$/;
const OPEN_LEISURE = /^(park|playground|pitch|recreation_ground|common|garden|dog_park|nature_reserve)$/;
const OPEN_LAND = /^(grass|grassland|recreation_ground|village_green|meadow|scrub|heath)$/;

/** Everything the spot finder needs, already sorted into kinds. */
export type MapFeatures = {
  buildings: LatLng[][];
  water: LatLng[][];       // closed water areas: ponds, lakes, pools
  waterLines: LatLng[][];  // streams, canals, ditches
  busyRoads: LatLng[][];
  paths: LatLng[][];       // footpaths, sidewalks
  streets: LatLng[][];     // quiet neighborhood streets
  open: LatLng[][];        // parks, grass, playgrounds
};

const emptyFeatures = (): MapFeatures => ({ buildings: [], water: [], waterLines: [], busyRoads: [], paths: [], streets: [], open: [] });

const closed = (p: LatLng[]) => p.length >= 4 && distanceM(p[0], p[p.length - 1]) < 1;

function bbox(points: LatLng[], padDeg = 0.0004) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of points) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lng); e = Math.max(e, p.lng); }
  return { s: s - padDeg, w: w - padDeg, n: n + padDeg, e: e + padDeg };
}

// ---------------------------------------------------------------------------
// Source 1: the map's own vector tiles (Protomaps schema, served by CARTO).
// ---------------------------------------------------------------------------

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
const TILE_ZOOM = 15; // full detail: every building, path and pool

const tileX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** Downloads a binary file. Uses fetch, or XMLHttpRequest on phones where fetch can't return raw bytes. */
async function getBytes(url: string, timeoutMs: number): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Map tile error ${res.status}`);
    try {
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return await xhrBytes(url, timeoutMs);
    }
  } finally {
    clearTimeout(timer);
  }
}

function xhrBytes(url: string, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = timeoutMs;
    xhr.onload = () => (xhr.status === 200 ? resolve(new Uint8Array(xhr.response as ArrayBuffer)) : reject(new Error(`Map tile error ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('Map tile download failed'));
    xhr.ontimeout = () => reject(new Error('Map tile download timed out'));
    xhr.send();
  });
}

async function tileTemplate(): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const style = (await (await fetch(STYLE_URL, { signal: ctrl.signal })).json()) as { sources: Record<string, { type: string; tiles?: string[] }> };
    const src = Object.values(style.sources).find((s) => s.type === 'vector' && s.tiles?.length);
    if (!src?.tiles) throw new Error('No map tiles listed');
    return src.tiles[0];
  } finally {
    clearTimeout(timer);
  }
}

type Geo = { type: string; coordinates: unknown };

/** Outer rings / lines of a GeoJSON geometry, as LatLng arrays. */
function shapesOf(g: Geo): { kind: 'poly' | 'line'; pts: LatLng[] }[] {
  const ll = (c: number[][]) => c.map(([lng, lat]) => ({ lat, lng }));
  switch (g.type) {
    case 'Polygon': return [{ kind: 'poly', pts: ll((g.coordinates as number[][][])[0]) }];
    case 'MultiPolygon': return (g.coordinates as number[][][][]).map((p) => ({ kind: 'poly' as const, pts: ll(p[0]) }));
    case 'LineString': return [{ kind: 'line', pts: ll(g.coordinates as number[][]) }];
    case 'MultiLineString': return (g.coordinates as number[][][]).map((l) => ({ kind: 'line' as const, pts: ll(l) }));
    default: return [];
  }
}

/** Sorts one decoded tile into the kinds of features the spot finder needs. */
export function tileToFeatures(bytes: Uint8Array, x: number, y: number, z: number, into = emptyFeatures()): MapFeatures {
  const vt = new VectorTile(new PbfReader(bytes));
  const each = (layer: string, fn: (props: Record<string, unknown>, shapes: ReturnType<typeof shapesOf>) => void) => {
    const l = vt.layers[layer];
    if (!l) return;
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i);
      if (f.type === 1) continue; // points (labels) aren't useful here
      fn(f.properties, shapesOf(f.toGeoJSON(x, y, z).geometry as Geo));
    }
  };
  each('buildings', (p, shapes) => {
    if (p.kind !== 'building' && p.kind !== 'building_part') return;
    for (const s of shapes) if (s.kind === 'poly') into.buildings.push(s.pts);
  });
  each('water', (_p, shapes) => {
    // Areas: lakes, ponds, pools, fountains, basins. Lines: streams, canals, ditches.
    for (const s of shapes) (s.kind === 'poly' ? into.water : into.waterLines).push(s.pts);
  });
  each('roads', (p, shapes) => {
    const detail = String(p.kind_detail ?? '');
    for (const s of shapes) {
      if (s.kind !== 'line') continue;
      if (p.kind === 'highway' || p.kind === 'major_road' || BUSY.test(detail)) into.busyRoads.push(s.pts);
      else if (p.kind === 'path' && detail !== 'crossing') into.paths.push(s.pts);
      else if (p.kind === 'minor_road' && QUIET_STREET.test(detail)) into.streets.push(s.pts);
    }
  });
  each('landuse', (p, shapes) => {
    const kind = String(p.kind ?? '');
    if (!OPEN_LEISURE.test(kind) && !OPEN_LAND.test(kind)) return;
    for (const s of shapes) if (s.kind === 'poly') into.open.push(s.pts);
  });
  return into;
}

/** Downloads and decodes the map tiles covering an area. Usually takes a second or two. */
export async function fetchTileFeatures(area: LatLng[]): Promise<MapFeatures> {
  const b = bbox(area);
  const x0 = tileX(b.w, TILE_ZOOM), x1 = tileX(b.e, TILE_ZOOM);
  const y0 = tileY(b.n, TILE_ZOOM), y1 = tileY(b.s, TILE_ZOOM);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 30) throw new Error('Area too big for one search');
  const tmpl = await tileTemplate();
  const jobs: Promise<void>[] = [];
  const features = emptyFeatures();
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const url = tmpl.replace('{z}', String(TILE_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y));
      jobs.push((async () => {
        let bytes: Uint8Array | null = null;
        for (let attempt = 0; attempt < 3 && !bytes; attempt++) {
          try { bytes = await getBytes(url, 20_000); } catch (e) { if (attempt === 2) throw e; }
        }
        tileToFeatures(bytes!, x, y, TILE_ZOOM, features);
      })());
    }
  }
  await Promise.all(jobs);
  return features;
}

// ---------------------------------------------------------------------------
// Source 2 (backup): OpenStreetMap's Overpass servers.
// ---------------------------------------------------------------------------

type OsmNode = { lat: number; lon: number };
type OsmMember = { type: string; role: string; geometry?: OsmNode[] };
export type OsmElement = {
  type: 'way' | 'relation' | 'node';
  tags?: Record<string, string>;
  geometry?: OsmNode[];
  members?: OsmMember[];
};

const toPts = (g: OsmNode[] = []) => g.map((n) => ({ lat: n.lat, lng: n.lon }));

/** Sorts raw OpenStreetMap elements into the kinds of features the spot finder needs. */
export function osmToFeatures(elements: OsmElement[]): MapFeatures {
  const f = emptyFeatures();
  for (const el of elements) {
    const t = el.tags ?? {};
    const isWater = t.natural === 'water' || !!t.water || t.leisure === 'swimming_pool'
      || /^(reservoir|basin)$/.test(t.landuse ?? '') || t.waterway === 'riverbank' || t.natural === 'wetland';
    const shapes: LatLng[][] = el.type === 'relation'
      ? (el.members ?? []).filter((m) => m.role !== 'inner').map((m) => toPts(m.geometry))
      : [toPts(el.geometry)];
    for (const pts of shapes) {
      if (pts.length < 2) continue;
      if (t.building || t['building:part']) { if (closed(pts)) f.buildings.push(pts); continue; }
      if (isWater) { (closed(pts) ? f.water : f.waterLines).push(pts); continue; }
      if (LINEAR_WATER.test(t.waterway ?? '')) { f.waterLines.push(pts); continue; }
      const hw = t.highway ?? '';
      if (BUSY.test(hw)) { f.busyRoads.push(pts); continue; }
      if (PATH.test(hw) && t.access !== 'private') { f.paths.push(pts); continue; }
      if (QUIET_STREET.test(hw) && t.access !== 'private' && t.service !== 'driveway') { f.streets.push(pts); continue; }
      const open = OPEN_LEISURE.test(t.leisure ?? '') || OPEN_LAND.test(t.landuse ?? '') || OPEN_LAND.test(t.natural ?? '');
      if (open && closed(pts) && t.access !== 'private') f.open.push(pts);
    }
  }
  return f;
}

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Downloads buildings, water, paths, roads and parks for an area from Overpass. */
export async function fetchOsm(area: LatLng[]): Promise<OsmElement[]> {
  const b = bbox(area);
  const box = `${b.s},${b.w},${b.n},${b.e}`;
  const q = `[out:json][timeout:60];(
    way["building"](${box});
    way["natural"~"water|wetland"](${box}); relation["natural"="water"](${box});
    way["water"](${box}); way["waterway"](${box});
    way["landuse"~"reservoir|basin|grass|recreation_ground|village_green|meadow"](${box});
    way["leisure"~"swimming_pool|park|playground|pitch|recreation_ground|common|garden|dog_park"](${box});
    relation["leisure"="park"](${box});
    way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|road|footway|path|pedestrian|cycleway|track|steps)(_link)?$"](${box});
  );out geom;`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const server = OVERPASS_SERVERS[attempt % OVERPASS_SERVERS.length];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 70_000);
    try {
      const res = await fetch(server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Manhunt-game/0.2 (github.com/ninjaivan2012-gif/manhunt)' },
        body: `data=${encodeURIComponent(q)}`,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Map server error ${res.status}`);
      const json = (await res.json()) as { elements?: OsmElement[] };
      if (!Array.isArray(json.elements)) throw new Error('Bad map data');
      return json.elements;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('Map data unavailable');
}

// ---------------------------------------------------------------------------
// Picking spots.
// ---------------------------------------------------------------------------

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
  const b = bbox(poly, 0);
  const dLat = step / 111_320, dLng = step / (111_320 * Math.cos((b.s * Math.PI) / 180));
  const out: LatLng[] = [];
  for (let lat = b.s + dLat / 2; lat <= b.n; lat += dLat) {
    for (let lng = b.w + dLng / 2; lng <= b.e; lng += dLng) {
      const p = { lat, lng };
      if (pointInPolygon(p, poly)) out.push(p);
    }
  }
  return out;
}

/**
 * A simple grid index so each candidate spot is only checked against the houses, ponds
 * and roads right next to it, instead of every one in the neighborhood. This is what
 * keeps the search fast on a phone.
 */
class GridIndex {
  private cells = new Map<string, number[]>();
  constructor(private items: LatLng[][], private cellDeg = 0.0005) {
    items.forEach((shape, i) => {
      const b = bbox(shape, 0);
      for (let x = Math.floor(b.w / cellDeg); x <= Math.floor(b.e / cellDeg); x++) {
        for (let y = Math.floor(b.s / cellDeg); y <= Math.floor(b.n / cellDeg); y++) {
          const k = `${x},${y}`;
          const list = this.cells.get(k);
          if (list) list.push(i); else this.cells.set(k, [i]);
        }
      }
    });
  }
  /** Shapes whose bounding box touches the cells around a point (covers ~50 m). */
  near(p: LatLng): LatLng[][] {
    const cx = Math.floor(p.lng / this.cellDeg), cy = Math.floor(p.lat / this.cellDeg);
    const seen = new Set<number>();
    const out: LatLng[][] = [];
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const i of this.cells.get(`${x},${y}`) ?? []) {
          if (!seen.has(i)) { seen.add(i); out.push(this.items[i]); }
        }
      }
    }
    return out;
  }
}

/** Split long lines/edges into short pieces so the grid index stays precise. */
function segments(lines: LatLng[][]): LatLng[][] {
  const out: LatLng[][] = [];
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) out.push([l[i], l[i + 1]]);
  return out;
}

const segDist = (p: LatLng, seg: LatLng[]) => nearestOnEdge(p, seg).distance;

/**
 * Picks safe, spread-out spots inside `area` from sorted map features. Pure function, so it
 * can be tested without a phone or network.
 */
export function spotsFromFeatures(f: MapFeatures, area: LatLng[], noGo: NoGoZone[], maxSpots = 150): LatLng[] {
  const candidates: { p: LatLng; score: number }[] = [];
  for (const poly of f.open) if (closed(poly)) grid(poly, 22).forEach((p) => candidates.push({ p, score: 4 }));
  for (const line of f.paths) along(line, 20).forEach((p) => candidates.push({ p, score: 3 }));
  // The edge of the street (sidewalk / verge), never the middle of it.
  for (const line of f.streets) along(line, 30, 7).forEach((p) => candidates.push({ p, score: 1 }));

  const buildings = new GridIndex(f.buildings.filter((b) => b.length >= 3));
  const waterAreas = new GridIndex(f.water.filter((w) => w.length >= 3));
  const waterEdges = new GridIndex(segments([...f.water, ...f.waterLines]));
  const roads = new GridIndex(segments(f.busyRoads));
  const noGoShapes = noGo.filter((z) => z.points.length >= 3).map((z) => z.points);

  const safe = (p: LatLng) => {
    if (!pointInPolygon(p, area)) return false;
    if (nearestOnEdge(p, area).distance < 12) return false; // not right on the border line
    if (noGoShapes.some((z) => pointInPolygon(p, z) || nearestOnEdge(p, z).distance < 8)) return false;
    for (const s of roads.near(p)) if (segDist(p, s) < MIN_FROM_BUSY_ROAD) return false;
    for (const s of waterEdges.near(p)) if (segDist(p, s) < MIN_FROM_WATER) return false;
    for (const b of buildings.near(p)) if (pointInPolygon(p, b) || nearestOnEdge(p, b).distance < MIN_FROM_BUILDING) return false;
    return true;
  };
  // Water areas bigger than the index window (a big lake) need a full inside check too.
  const inWater = (p: LatLng) => waterAreas.near(p).some((w) => pointInPolygon(p, w))
    || f.water.some((w) => w.length > 200 && pointInPolygon(p, w));

  // Best places first (parks, then paths, then street edges), spread out evenly.
  candidates.sort((a, b) => b.score - a.score);
  const spots: LatLng[] = [];
  const pickedCells = new Map<string, LatLng[]>();
  const cellKey = (p: LatLng, dx = 0, dy = 0) => `${Math.floor(p.lng / 0.0005) + dx},${Math.floor(p.lat / 0.0005) + dy}`;
  const tooClose = (p: LatLng) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const s of pickedCells.get(cellKey(p, dx, dy)) ?? []) if (distanceM(s, p) < SPACING) return true;
    }
    return false;
  };
  for (const c of candidates) {
    if (spots.length >= maxSpots) break;
    if (tooClose(c.p)) continue;
    if (!safe(c.p) || inWater(c.p)) continue;
    const s = { lat: Math.round(c.p.lat * 1e6) / 1e6, lng: Math.round(c.p.lng * 1e6) / 1e6 };
    spots.push(s);
    const k = cellKey(s);
    const list = pickedCells.get(k);
    if (list) list.push(s); else pickedCells.set(k, [s]);
  }
  return spots;
}

/** Kept for tests: OpenStreetMap elements straight to spots. */
export const buildSpots = (elements: OsmElement[], area: LatLng[], noGo: NoGoZone[], maxSpots = 150) =>
  spotsFromFeatures(osmToFeatures(elements), area, noGo, maxSpots);

/** Map features for an area: map tiles first (fast), Overpass as a backup. */
export async function fetchFeatures(area: LatLng[]): Promise<{ features: MapFeatures; source: 'tiles' | 'osm' }> {
  try {
    return { features: await fetchTileFeatures(area), source: 'tiles' };
  } catch {
    return { features: osmToFeatures(await fetchOsm(area)), source: 'osm' };
  }
}
