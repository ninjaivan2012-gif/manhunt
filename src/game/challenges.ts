import { distanceM, pointInPolygon } from './geo';
import { borderAtScale, scaleAt } from './logic';
import type { Game, LatLng } from './types';

/**
 * Runner challenges: small objectives that pull runners out of hiding spots.
 * Finishing one earns points, which buy perks. Each runner gets their own challenge
 * at their own spots, and spots are always safe places found from map data.
 */

export type ChallengeKind = 'reach' | 'hold' | 'checkpoints' | 'move';

export type Challenge = {
  id: string;
  kind: ChallengeKind;
  spots: LatLng[];       // goal spots, in order (empty for 'move')
  start: LatLng;         // where the runner was when it started
  step: number;          // checkpoints: which spot is next
  holdMs: number;        // hold: time spent inside so far
  lastAt: number;        // last progress update
  lastInside: boolean;
  createdAt: number;
  deadline: number;
  reward: number;
};

export const REACH_RADIUS = 15;  // meters: counts as "at the spot"
export const HOLD_RADIUS = 20;   // meters: the zone you must stay in
export const HOLD_MS = 120_000;  // 2 minutes inside the zone
export const MOVE_DIST = 150;    // meters away from where you started
const WALK = 1.1;                // m/s: a careful walking pace, so time limits are fair

export const PERKS = {
  blur: { cost: 2, name: 'Blurred ping', desc: 'Your next ping shows a 60 m circle instead of your exact spot.' },
  jam: { cost: 4, name: 'Jam a ping', desc: 'Your next ping is skipped. Hunters only see your old position.' },
  life: { cost: 7, name: 'Extra life', desc: 'The next tag doesn\'t knock you out, and you get 60 s to escape. Hold 1 at a time.' },
} as const;
export type PerkId = keyof typeof PERKS;

export const BLUR_RADIUS = 60;
export const SHIELD_MS = 60_000;
export const COOLDOWN_MS = 45_000;      // breather between challenges
export const SKIP_COOLDOWN_MS = 90_000; // skipping costs a longer wait

export function describe(c: Challenge): { title: string; detail: string } {
  switch (c.kind) {
    case 'reach': return { title: 'Reach the spot', detail: 'Get to the marked spot before time runs out.' };
    case 'hold': return { title: 'Hold the zone', detail: `Stay inside the circle for ${HOLD_MS / 60_000} minutes total.` };
    case 'checkpoints': return { title: 'Checkpoint run', detail: 'Touch both spots, in order.' };
    case 'move': return { title: 'Keep moving', detail: `Get ${MOVE_DIST} m away from where you are now.` };
  }
}

/** The goal currently shown on the map, if any. */
export const currentGoal = (c: Challenge): LatLng | null =>
  c.kind === 'move' ? null : c.spots[Math.min(c.step, c.spots.length - 1)] ?? null;

/** Picks a new challenge for one runner. `avoid` = teammates' current challenge spots. */
export function newChallenge(
  game: Game, pos: LatLng, now: number, avoid: LatLng[], rand: () => number = Math.random,
): Challenge {
  const spots = game.spots ?? [];
  const base = { id: `${now}`, start: pos, step: 0, holdMs: 0, lastAt: now, lastInside: false, createdAt: now };

  // A spot is usable if it's not too close to a teammate's spot and will still be
  // inside the border when the time limit runs out (the border may shrink meanwhile).
  const usable = (p: LatLng, until: number) => {
    if (avoid.some((a) => distanceM(a, p) < 50)) return false;
    const border = borderAtScale(game, scaleAt(game, until + 30_000));
    return border.length < 3 || pointInPolygon(p, border);
  };
  const pick = (from: LatLng, min: number, max: number, until: number, exclude: LatLng[] = []) => {
    const options = spots.filter((s) => {
      const d = distanceM(from, s);
      return d >= min && d <= max && usable(s, until) && !exclude.some((e) => distanceM(e, s) < 80);
    });
    return options.length ? options[Math.floor(rand() * options.length)] : null;
  };
  const travel = (d: number) => (d / WALK) * 1000;

  const roll = rand();
  const order: ChallengeKind[] = roll < 0.35 ? ['reach', 'hold', 'move']
    : roll < 0.65 ? ['hold', 'reach', 'move']
    : roll < 0.82 ? ['checkpoints', 'reach', 'move']
    : ['move'];

  for (const kind of order) {
    if (kind === 'reach') {
      const s = pick(pos, 80, 300, now + 360_000);
      if (!s) continue;
      const d = distanceM(pos, s);
      return { ...base, kind, spots: [s], deadline: now + Math.max(150_000, travel(d) * 1.6 + 60_000), reward: d > 170 ? 2 : 1 };
    }
    if (kind === 'hold') {
      const s = pick(pos, 60, 250, now + 480_000);
      if (!s) continue;
      const d = distanceM(pos, s);
      return { ...base, kind, spots: [s], deadline: now + travel(d) * 1.5 + HOLD_MS + 120_000, reward: 2 };
    }
    if (kind === 'checkpoints') {
      const a = pick(pos, 80, 220, now + 480_000);
      if (!a) continue;
      const b = pick(a, 100, 220, now + 480_000, [pos]);
      if (!b) continue;
      const d = distanceM(pos, a) + distanceM(a, b);
      return { ...base, kind, spots: [a, b], deadline: now + travel(d) * 1.5 + 90_000, reward: 3 };
    }
    // 'move' always works: it doesn't need map spots.
    return { ...base, kind: 'move', spots: [], deadline: now + 240_000, reward: 1 };
  }
  return { ...base, kind: 'move', spots: [], deadline: now + 240_000, reward: 1 };
}

export type Progress = { challenge: Challenge; done: boolean; failed: boolean; label: string; fraction: number };

/** Updates a challenge with a new GPS position. */
export function advance(c: Challenge, pos: LatLng, now: number): Progress {
  const next = { ...c };
  const goal = currentGoal(next);
  const gap = Math.min(now - next.lastAt, 10_000); // ignore long gaps (phone asleep, no GPS)
  let done = false;
  let label = '';
  let fraction = 0;

  if (next.kind === 'move') {
    const d = distanceM(next.start, pos);
    done = d >= MOVE_DIST;
    fraction = Math.min(1, d / MOVE_DIST);
    label = `${Math.round(d)} / ${MOVE_DIST} m`;
  } else if (next.kind === 'hold' && goal) {
    const inside = distanceM(pos, goal) <= HOLD_RADIUS;
    if (inside && next.lastInside) next.holdMs += gap;
    next.lastInside = inside;
    done = next.holdMs >= HOLD_MS;
    fraction = Math.min(1, next.holdMs / HOLD_MS);
    const left = Math.max(0, Math.ceil((HOLD_MS - next.holdMs) / 1000));
    label = inside ? `In the zone · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} to go` : `${Math.round(distanceM(pos, goal))} m to the zone`;
  } else if (goal) {
    const d = distanceM(pos, goal);
    if (d <= REACH_RADIUS) {
      if (next.kind === 'checkpoints' && next.step < next.spots.length - 1) next.step += 1;
      else done = true;
    }
    const g2 = currentGoal(next)!;
    fraction = next.kind === 'checkpoints' ? next.step / next.spots.length : 0;
    label = done ? 'Done' : `${Math.round(distanceM(pos, g2))} m away${next.kind === 'checkpoints' ? ` · spot ${next.step + 1} of ${next.spots.length}` : ''}`;
  }

  next.lastAt = now;
  const failed = !done && now > next.deadline;
  return { challenge: next, done, failed, label, fraction };
}

/** Moves a ping randomly so the runner is somewhere inside the blur circle, not at its center. */
export function blurPing(pos: LatLng, rand: () => number = Math.random): LatLng {
  const r = BLUR_RADIUS * 0.75 * Math.sqrt(rand());
  const a = rand() * Math.PI * 2;
  return {
    lat: pos.lat + (r * Math.sin(a)) / 111_320,
    lng: pos.lng + (r * Math.cos(a)) / (111_320 * Math.cos((pos.lat * Math.PI) / 180)),
  };
}
