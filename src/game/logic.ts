import { centroid, nearestOnEdge, pointInPolygon, scalePolygon } from './geo';
import type { Game, LatLng, NoGoZone } from './types';

const SHRINK_ANIM_MS = 30_000; // each shrink happens smoothly over 30 seconds

export type Phase = 'lobby' | 'headstart' | 'hunt' | 'over';

export function releaseAt(g: Game): number {
  return (g.startedAt ?? 0) + g.settings.headStartSec * 1000;
}
export function endAt(g: Game): number {
  return releaseAt(g) + g.settings.durationMin * 60_000;
}

export function phase(g: Game, now: number): Phase {
  if (g.status === 'lobby' || !g.startedAt) return 'lobby';
  if (g.status === 'ended' || now >= endAt(g)) return 'over';
  if (now < releaseAt(g)) return 'headstart';
  return 'hunt';
}

/** Times (ms) and target sizes of each border shrink. */
export function shrinkSchedule(g: Game): { at: number; scale: number }[] {
  const n = Math.max(0, g.settings.shrinkSteps);
  const start = releaseAt(g);
  const dur = g.settings.durationMin * 60_000;
  const out: { at: number; scale: number }[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({ at: start + (dur * i) / (n + 1), scale: 1 - (1 - g.settings.finalScale) * (i / n) });
  }
  return out;
}

export function scaleAt(g: Game, now: number): number {
  let scale = 1;
  for (const s of shrinkSchedule(g)) {
    if (now >= s.at + SHRINK_ANIM_MS) scale = s.scale;
    else if (now >= s.at) {
      const t = (now - s.at) / SHRINK_ANIM_MS;
      return scale + (s.scale - scale) * t;
    } else break;
  }
  return scale;
}

export function nextShrink(g: Game, now: number): { at: number; scale: number } | null {
  return shrinkSchedule(g).find((s) => s.at > now) ?? null;
}

function borderCenter(g: Game): LatLng {
  return centroid(g.border?.points ?? []);
}

export function borderAtScale(g: Game, scale: number): LatLng[] {
  if (!g.border) return [];
  return scalePolygon(g.border.points, scale, borderCenter(g));
}

export function currentBorder(g: Game, now: number): LatLng[] {
  return borderAtScale(g, phase(g, now) === 'lobby' ? 1 : scaleAt(g, now));
}

/** Pings happen at the moment hunters are released, then every interval. */
export function pingIndex(g: Game, now: number): number {
  if (now < releaseAt(g)) return -1;
  return Math.floor((now - releaseAt(g)) / (g.settings.pingIntervalSec * 1000));
}
export function nextPingAt(g: Game, now: number): number {
  return releaseAt(g) + (pingIndex(g, now) + 1) * g.settings.pingIntervalSec * 1000;
}

export type BoundsCheck = { outside: boolean; reason: 'border' | 'nogo' | null; backDistance: number; backPoint: LatLng | null };

export function checkBounds(g: Game, pos: LatLng, now: number): BoundsCheck {
  const border = currentBorder(g, now);
  if (border.length >= 3 && !pointInPolygon(pos, border)) {
    const n = nearestOnEdge(pos, border);
    return { outside: true, reason: 'border', backDistance: n.distance, backPoint: n.point };
  }
  const zone = g.noGo.find((z: NoGoZone) => z.points.length >= 3 && pointInPolygon(pos, z.points));
  if (zone) {
    const n = nearestOnEdge(pos, zone.points);
    return { outside: true, reason: 'nogo', backDistance: n.distance, backPoint: n.point };
  }
  return { outside: false, reason: null, backDistance: 0, backPoint: null };
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
