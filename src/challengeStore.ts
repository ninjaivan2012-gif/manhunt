import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Challenge } from './game/challenges';

/**
 * A runner's challenge state, kept on their own phone so the background tracker can
 * update it with the screen locked. Hunters never see it.
 */
export type ChallengeState = {
  gameStart: number;           // which round this belongs to (game.startedAt)
  active: Challenge | null;
  label: string;               // progress text, e.g. "84 m away"
  fraction: number;            // 0–1 progress bar
  points: number;
  cooldownUntil: number;
  blurNext: boolean;
  jamNext: boolean;
  completed: number;
  lastResult: { text: string; at: number } | null;
};

const KEY = 'mh.challenge';

export const emptyState = (gameStart: number): ChallengeState => ({
  gameStart, active: null, label: '', fraction: 0, points: 0, cooldownUntil: 0,
  blurNext: false, jamNext: false, completed: 0, lastResult: null,
});

/** Loads the state for this round (a new round starts fresh). */
export async function loadChallenge(gameStart: number): Promise<ChallengeState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as ChallengeState) : null;
    return s && s.gameStart === gameStart ? s : emptyState(gameStart);
  } catch {
    return emptyState(gameStart);
  }
}

export const saveChallenge = (s: ChallengeState) => AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
export const clearChallenge = () => AsyncStorage.removeItem(KEY).catch(() => {});

/**
 * The background tracker and the screen both change this state. To avoid one overwriting
 * the other, every change goes through here: re-read, change, save.
 */
let chain: Promise<unknown> = Promise.resolve();
export function updateChallenge(gameStart: number, fn: (s: ChallengeState) => ChallengeState | void): Promise<ChallengeState> {
  const run = chain.then(async () => {
    const s = await loadChallenge(gameStart);
    const next = fn(s) ?? s;
    await saveChallenge(next);
    return next;
  });
  chain = run.catch(() => {});
  return run;
}
