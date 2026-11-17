import { listSpotAreas, patchSpotArea, saveSpotArea, setSpots } from './api';
import { centroid, circlePolygon, distanceM, nearestOnEdge, pointInPolygon } from './geo';
import { fetchFeatures, spotsFromFeatures } from './spots';
import type { Game, LatLng, NoGoZone, SpotArea } from './types';

const ENOUGH = 12;
const MAX_PER_GAME = 400;
export const STALE_SEARCH_MS = 3 * 60_000; // a search that never finished (app closed) counts as failed

/** The circle that contains a border: its center and the farthest corner. */
function enclosing(border: LatLng[]) {
  const center = centroid(border);
  const radius = Math.max(...border.map((p) => distanceM(center, p)));
  return { center, radius };
}

/** Spots from a saved area that fit this game's border and no-go zones. */
function spotsForGame(area: SpotArea, border: LatLng[], noGo: NoGoZone[]): LatLng[] {
  const zones = noGo.filter((z) => z.points.length >= 3).map((z) => z.points);
  const fit = area.spots.filter((s) =>
    pointInPolygon(s, border)
    && nearestOnEdge(s, border).distance >= 12
    && !zones.some((z) => pointInPolygon(s, z) || nearestOnEdge(s, z).distance < 8));
  if (fit.length <= MAX_PER_GAME) return fit;
  // Too many to store in the game: keep an even sample.
  const step = fit.length / MAX_PER_GAME;
  return Array.from({ length: MAX_PER_GAME }, (_, i) => fit[Math.floor(i * step)]);
}

/**
 * Gets challenge spots for the game's border and saves them to the game.
 * 1. If a saved neighborhood already covers this border, use it (instant).
 * 2. Otherwise search a wider area once from map data, save it, and use it.
 */
export async function refreshSpots(game: Game, border?: LatLng[], noGo?: NoGoZone[], opts: { force?: boolean } = {}) {
  const b = border ?? game.border?.points ?? [];
  const zones = noGo ?? game.noGo;
  if (b.length < 3) return;
  await setSpots(game.code, game.spots ?? [], 'loading').catch(() => {});
  try {
    const { center, radius } = enclosing(b);

    if (!opts.force) {
      const saved = await listSpotAreas().catch(() => [] as SpotArea[]);
      const covering = saved
        .filter((a) => distanceM(a.center, center) + radius <= a.radius - 10)
        .sort((x, y) => y.createdAt - x.createdAt)[0];
      if (covering) {
        const spots = spotsForGame(covering, b, zones);
        await setSpots(game.code, spots, spots.length >= ENOUGH ? 'ready' : 'few', covering.id);
        return;
      }
    }

    // Search a wider area than the border, so later games with a different border can reuse it.
    const areaRadius = Math.min(1400, Math.max(700, radius + 500));
    const areaShape = circlePolygon(center, areaRadius, 64);
    const { features, source } = await fetchFeatures(areaShape);
    const areaSpots = spotsFromFeatures(features, areaShape, [], 2500);
    const area: Omit<SpotArea, 'id'> = { center, radius: areaRadius, spots: areaSpots, createdAt: Date.now(), source };
    let areaId = '';
    try { areaId = await saveSpotArea(area); } catch { /* still usable for this game */ }
    const spots = spotsForGame({ id: areaId, ...area }, b, zones);
    await setSpots(game.code, spots, spots.length >= ENOUGH ? 'ready' : 'few', areaId);
  } catch {
    await setSpots(game.code, game.spots ?? [], 'failed').catch(() => {});
  }
}

/** Saves the host's manual spot edits to the game and to the saved neighborhood, so they stick. */
export async function saveSpotEdits(game: Game, edited: LatLng[]) {
  const before = game.spots ?? [];
  const same = (a: LatLng, b: LatLng) => distanceM(a, b) < 3;
  const removed = before.filter((s) => !edited.some((e) => same(e, s)));
  const added = edited.filter((e) => !before.some((s) => same(e, s)));
  await setSpots(game.code, edited, edited.length >= ENOUGH ? 'ready' : 'few');
  if (game.spotsArea && (removed.length || added.length)) {
    await patchSpotArea(game.spotsArea, removed, added, same).catch(() => {});
  }
}
