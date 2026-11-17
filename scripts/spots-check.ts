// Checks the challenge spot finder against real OpenStreetMap data (run in CI).
// Usage: npx tsx scripts/spots-check.ts <lat> <lng> <radiusMeters>
import { buildSpots, type OsmElement } from '../src/game/spots';
import { circlePolygon, nearestOnEdge, pointInPolygon } from '../src/game/geo';

const [lat, lng, r] = process.argv.slice(2).map(Number);
const border = circlePolygon({ lat, lng }, r, 64);
const lats = border.map((p) => p.lat), lngs = border.map((p) => p.lng);
const box = `${Math.min(...lats) - 0.0004},${Math.min(...lngs) - 0.0004},${Math.max(...lats) + 0.0004},${Math.max(...lngs) + 0.0004}`;
const q = `[out:json][timeout:25];(way["building"](${box});way["natural"~"water|wetland"](${box});relation["natural"="water"](${box});way["water"](${box});way["waterway"](${box});way["landuse"~"reservoir|basin|grass|recreation_ground|village_green|meadow"](${box});way["leisure"~"swimming_pool|park|playground|pitch|recreation_ground|common|garden|dog_park"](${box});relation["leisure"="park"](${box});way["highway"](${box}););out geom;`;

(async () => {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'manhunt-ci-check' },
    body: `data=${encodeURIComponent(q)}`,
  });
  const json = (await res.json()) as { elements: OsmElement[] };
  const els = json.elements;
  const t = Date.now();
  const spots = buildSpots(els, border, []);
  const ms = Date.now() - t;
  const poly = (e: OsmElement) => (e.geometry ?? []).map((n) => ({ lat: n.lat, lng: n.lon }));
  const water = els.filter((e) => e.tags?.natural === 'water' || e.tags?.leisure === 'swimming_pool').map(poly).filter((p) => p.length > 3);
  const bldg = els.filter((e) => e.tags?.building).map(poly).filter((p) => p.length > 3);
  let inWater = 0, inBldg = 0;
  for (const s of spots) {
    if (water.some((w) => pointInPolygon(s, w) || nearestOnEdge(s, w).distance < 5.5)) inWater++;
    if (bldg.some((b) => pointInPolygon(s, b) || nearestOnEdge(s, b).distance < 4.5)) inBldg++;
  }
  console.log(`SPOTCHECK elements=${els.length} buildings=${bldg.length} water=${water.length} spots=${spots.length} inWater=${inWater} inBuildings=${inBldg} ms=${ms}`);
  if (inWater || inBldg) process.exit(1);
})();
