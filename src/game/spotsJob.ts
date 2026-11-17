import { setSpots } from './api';
import { findSpots } from './spots';
import type { Game, LatLng, NoGoZone } from './types';

const ENOUGH = 12;

/**
 * Re-finds challenge spots for the game area and saves them to the game.
 * Runs in the background on the host's phone; the lobby shows the progress.
 */
export async function refreshSpots(game: Game, border?: LatLng[], noGo?: NoGoZone[]) {
  const b = border ?? game.border?.points ?? [];
  if (b.length < 3) return;
  await setSpots(game.code, game.spots ?? [], 'loading').catch(() => {});
  try {
    const spots = await findSpots(b, noGo ?? game.noGo);
    await setSpots(game.code, spots, spots.length >= ENOUGH ? 'ready' : 'few');
  } catch {
    await setSpots(game.code, [], 'failed').catch(() => {});
  }
}
