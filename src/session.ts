import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Game, PlayerStatus, Team } from './game/types';

// Small pieces of state shared between the screens and the background location task.
export type Session = { code: string; uid: string; name: string; team: Team; status: PlayerStatus };

const K = {
  session: 'mh.session',
  game: 'mh.game',
  name: 'mh.name',
  outsideSince: 'mh.outsideSince',
  lastPing: 'mh.lastPing',
  warnedPing: 'mh.warnedPing',
  lastLive: 'mh.lastLive',
};

async function getJSON<T>(key: string): Promise<T | null> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
const setJSON = (key: string, v: unknown) => AsyncStorage.setItem(key, JSON.stringify(v));

export const getSession = () => getJSON<Session>(K.session);
export const setSession = (s: Session) => setJSON(K.session, s);
export const getCachedGame = () => getJSON<Game>(K.game);
export const cacheGame = (g: Game) => setJSON(K.game, g);

export const getSavedName = () => AsyncStorage.getItem(K.name);
export const saveName = (n: string) => AsyncStorage.setItem(K.name, n);

export async function getNumber(key: keyof typeof K): Promise<number | null> {
  const v = await AsyncStorage.getItem(K[key]);
  return v == null ? null : Number(v);
}
export const setNumber = (key: keyof typeof K, n: number | null) =>
  n == null ? AsyncStorage.removeItem(K[key]) : AsyncStorage.setItem(K[key], String(n));

export async function clearGameState() {
  await AsyncStorage.multiRemove([K.session, K.game, K.outsideSince, K.lastPing, K.warnedPing, K.lastLive, 'mh.challenge']);
}
