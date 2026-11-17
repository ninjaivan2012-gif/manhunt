// Checks the challenge spot finder against real map data (run in CI).
// Usage: npx tsx scripts/spots-check.ts <lat> <lng> <radiusMeters>
import { fetchTileFeatures, spotsFromFeatures } from '../src/game/spots';
import { circlePolygon, nearestOnEdge, pointInPolygon } from '../src/game/geo';

const [lat, lng, r] = process.argv.slice(2).map(Number);
const area = circlePolygon({ lat, lng }, r, 64);

(async () => {
  const t0 = Date.now();
  const f = await fetchTileFeatures(area);
  const tDownload = Date.now() - t0;
  const t1 = Date.now();
  const spots = spotsFromFeatures(f, area, [], 2500);
  const tPick = Date.now() - t1;
  let inWater = 0, inBldg = 0, nearBusy = 0;
  for (const s of spots) {
    if (f.water.some((w) => w.length > 3 && pointInPolygon(s, w))) inWater++;
    if (f.buildings.some((b) => b.length > 3 && pointInPolygon(s, b))) inBldg++;
    if (f.busyRoads.some((l) => l.some((_, i) => i < l.length - 1 && nearestOnEdge(s, [l[i], l[i + 1]]).distance < 17))) nearBusy++;
  }
  console.log(`SPOTCHECK buildings=${f.buildings.length} water=${f.water.length} paths=${f.paths.length} streets=${f.streets.length} parks=${f.open.length} busyRoads=${f.busyRoads.length}`);
  console.log(`SPOTCHECK spots=${spots.length} inWater=${inWater} inBuildings=${inBldg} nearBusyRoad=${nearBusy} download=${tDownload}ms pick=${tPick}ms`);
  if (inWater || inBldg || nearBusy || spots.length < 20) process.exit(1);
})();
