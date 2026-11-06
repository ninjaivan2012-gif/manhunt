import type { LatLng } from './types';

const R = 6371000; // Earth radius in meters
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Flat x/y in meters around an origin. Accurate enough for game areas a few km wide. */
function toXY(p: LatLng, o: LatLng) {
  return { x: rad(p.lng - o.lng) * R * Math.cos(rad(o.lat)), y: rad(p.lat - o.lat) * R };
}
function fromXY(x: number, y: number, o: LatLng): LatLng {
  return { lat: o.lat + deg(y / R), lng: o.lng + deg(x / (R * Math.cos(rad(o.lat)))) };
}

export function circlePolygon(center: LatLng, radiusM: number, n = 64): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push(fromXY(Math.cos(a) * radiusM, Math.sin(a) * radiusM, center));
  }
  return pts;
}

export function centroid(points: LatLng[]): LatLng {
  if (points.length === 0) return { lat: 0, lng: 0 };
  const o = points[0];
  let a = 0, cx = 0, cy = 0;
  const xy = points.map((p) => toXY(p, o));
  for (let i = 0; i < xy.length; i++) {
    const p = xy[i], q = xy[(i + 1) % xy.length];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const avg = xy.reduce((s, p) => ({ x: s.x + p.x / xy.length, y: s.y + p.y / xy.length }), { x: 0, y: 0 });
    return fromXY(avg.x, avg.y, o);
  }
  return fromXY(cx / (3 * a), cy / (3 * a), o);
}

/** Shrinks (scale < 1) or grows a polygon around a center point. */
export function scalePolygon(points: LatLng[], scale: number, around: LatLng): LatLng[] {
  return points.map((p) => {
    const { x, y } = toXY(p, around);
    return fromXY(x * scale, y * scale, around);
  });
}

export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) {
      inside = !inside;
    }
  }
  return inside;
}

/** Nearest point on a polygon's outline, and how far away it is. */
export function nearestOnEdge(p: LatLng, poly: LatLng[]): { point: LatLng; distance: number } {
  let best = { point: poly[0] ?? p, distance: Infinity };
  for (let i = 0; i < poly.length; i++) {
    const a = toXY(poly[i], p), b = toXY(poly[(i + 1) % poly.length], p);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    const x = a.x + t * dx, y = a.y + t * dy;
    const d = Math.hypot(x, y);
    if (d < best.distance) best = { point: fromXY(x, y, p), distance: d };
  }
  return best;
}

/** Compass bearing in degrees (0 = north) from a to b. */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function compassWord(bearingDeg: number): string {
  const words = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return words[Math.round(bearingDeg / 45) % 8];
}

/** Rough radius of a polygon: average distance from its center to its points. */
export function approxRadius(points: LatLng[]): number {
  if (!points.length) return 0;
  const c = centroid(points);
  return points.reduce((s, p) => s + distanceM(c, p), 0) / points.length;
}

/** GeoJSON ring (closed, [lng, lat]) for the map. */
export function ring(points: LatLng[]): [number, number][] {
  const r = points.map((p) => [p.lng, p.lat] as [number, number]);
  if (r.length) r.push(r[0]);
  return r;
}
