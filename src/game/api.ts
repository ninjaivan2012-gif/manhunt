import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { db, ensureSignedIn } from '../firebase';
import type { Border, Game, LatLng, LivePos, SpotArea, NoGoZone, Perks, Ping, Player, PlayerStatus, Settings, Team, Msg, MsgTarget } from './types';
import { DEFAULT_SETTINGS } from './types';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L, so codes are easy to read out loud
const randomCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const randomSecret = () => Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');

const gameRef = (code: string) => doc(db, 'games', code);
const playersCol = (code: string) => collection(db, 'games', code, 'players');
const liveCol = (code: string, team: Team) => collection(db, 'games', code, 'teams', team, 'live');
const teamMsgs = (code: string, team: Team) => collection(db, 'games', code, 'teams', team, 'msgs');
const allMsgs = (code: string) => collection(db, 'games', code, 'msgs');
const inbox = (code: string, uid: string) => collection(db, 'games', code, 'inbox', uid, 'msgs');
const pingsCol = (code: string) => collection(db, 'games', code, 'pings');
const perksRef = (code: string, uid: string) => doc(db, 'games', code, 'perks', uid);

/** Makes a new tag code secret. Also used after an extra life is spent, so an old scan can't be reused. */
export async function makeSecret(code: string, uid: string): Promise<string> {
  const secret = randomSecret();
  await setDoc(doc(db, 'games', code, 'secrets', uid), { secret });
  return secret;
}

export async function getMySecret(code: string, uid: string): Promise<string> {
  const snap = await getDoc(doc(db, 'games', code, 'secrets', uid));
  return snap.exists() ? (snap.data().secret as string) : makeSecret(code, uid);
}

export async function createGame(name: string): Promise<{ code: string; uid: string }> {
  const uid = await ensureSignedIn();
  let code = randomCode();
  for (let i = 0; i < 5 && (await getDoc(gameRef(code))).exists(); i++) code = randomCode();
  const game: Omit<Game, 'code'> = {
    hostId: uid, status: 'lobby', createdAt: Date.now(), settings: DEFAULT_SETTINGS,
    border: null, noGo: [], startedAt: null, endedAt: null, winner: null,
  };
  await setDoc(gameRef(code), game);
  await setDoc(doc(playersCol(code), uid), { name, team: 'hunter', status: 'alive', joinedAt: Date.now() });
  await makeSecret(code, uid);
  return { code, uid };
}

export async function joinGame(rawCode: string, name: string): Promise<{ code: string; uid: string }> {
  const uid = await ensureSignedIn();
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const snap = await getDoc(gameRef(code));
  if (!snap.exists()) throw new Error('No game with that code.');
  const existing = await getDoc(doc(playersCol(code), uid));
  if (existing.exists()) return { code, uid }; // rejoining
  if ((snap.data() as Game).status !== 'lobby') throw new Error('That game already started.');
  // Keep teams even, with the extra player going to the runners.
  const players = (await getDocs(playersCol(code))).docs.map((d) => d.data() as Player);
  const hunters = players.filter((p) => p.team === 'hunter').length;
  const team: Team = hunters < Math.floor((players.length + 1) / 2) ? 'hunter' : 'runner';
  await setDoc(doc(playersCol(code), uid), { name, team, status: 'alive', joinedAt: Date.now() });
  await makeSecret(code, uid);
  return { code, uid };
}

export function watchGame(code: string, cb: (g: Game | null) => void) {
  return onSnapshot(gameRef(code), (s) => cb(s.exists() ? ({ code, ...(s.data() as Omit<Game, 'code'>) }) : null));
}

export function watchPlayers(code: string, cb: (p: Player[]) => void) {
  return onSnapshot(playersCol(code), (s) =>
    cb(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Player, 'id'>) })).sort((a, b) => a.joinedAt - b.joinedAt)),
  );
}

export function watchTeamLive(code: string, team: Team, cb: (p: LivePos[]) => void) {
  return onSnapshot(liveCol(code, team), (s) => cb(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LivePos, 'id'>) }))));
}

export function watchPings(code: string, cb: (p: Ping[]) => void) {
  return onSnapshot(pingsCol(code), (s) => cb(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Ping, 'id'>) }))));
}

/** Every message I can see: my team's channel, the everyone channel, and my private inbox. */
export function watchMsgs(code: string, team: Team, uid: string, since: number, cb: (m: Msg) => void) {
  const sources = [teamMsgs(code, team), allMsgs(code), inbox(code, uid)];
  const unsubs = sources.map((col) =>
    onSnapshot(query(col, where('at', '>', since)), (s) => {
      s.docChanges().forEach((c) => {
        if (c.type === 'added') cb({ id: c.doc.id, ...(c.doc.data() as Omit<Msg, 'id'>) });
      });
    }, () => {}),
  );
  return () => unsubs.forEach((u) => u());
}

// ---- Host controls ----
export const updateSettings = (code: string, settings: Settings) => updateDoc(gameRef(code), { settings });
export const setBorder = (code: string, border: Border | null) => updateDoc(gameRef(code), { border });
export const setNoGo = (code: string, noGo: NoGoZone[]) => updateDoc(gameRef(code), { noGo });
export const setSpots = (code: string, spots: LatLng[], spotsStatus: NonNullable<Game['spotsStatus']>, spotsArea?: string) =>
  updateDoc(gameRef(code), spotsArea !== undefined
    ? { spots, spotsStatus, spotsArea, spotsAt: Date.now() }
    : { spots, spotsStatus, spotsAt: Date.now() });

// ---- Saved neighborhood spots (shared by every game in that area) ----
const areasCol = () => collection(db, 'spotAreas');
export async function listSpotAreas(): Promise<SpotArea[]> {
  const s = await getDocs(areasCol());
  return s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SpotArea, 'id'>) }));
}
export async function saveSpotArea(area: Omit<SpotArea, 'id'>): Promise<string> {
  const ref = await addDoc(areasCol(), area);
  return ref.id;
}
/** Applies the host's manual changes (removed or added spots) to a saved area. */
export async function patchSpotArea(id: string, removed: LatLng[], added: LatLng[], near: (a: LatLng, b: LatLng) => boolean) {
  const ref = doc(db, 'spotAreas', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const cur = (snap.data() as SpotArea).spots ?? [];
  const kept = cur.filter((s) => !removed.some((r) => near(r, s)));
  await updateDoc(ref, { spots: [...kept, ...added].slice(0, 2500) });
}
export const setTeam = (code: string, playerId: string, team: Team) => updateDoc(doc(playersCol(code), playerId), { team });
export const kickPlayer = (code: string, playerId: string) => deleteDoc(doc(playersCol(code), playerId));
export const hostEliminate = (code: string, playerId: string) => updateDoc(doc(playersCol(code), playerId), { status: 'caught' });

export async function shuffleTeams(code: string, players: Player[]) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const hunters = Math.floor(shuffled.length / 2); // odd number → one more runner
  const batch = writeBatch(db);
  shuffled.forEach((p, i) => batch.update(doc(playersCol(code), p.id), { team: i < hunters ? 'hunter' : 'runner' }));
  await batch.commit();
}

export async function startGame(code: string, players: Player[]) {
  const batch = writeBatch(db);
  players.forEach((p) => batch.update(doc(playersCol(code), p.id), { status: 'alive' }));
  batch.update(gameRef(code), { status: 'running', startedAt: Date.now(), endedAt: null, winner: null });
  await batch.commit();
}

export const endGame = (code: string, winner: Team) =>
  updateDoc(gameRef(code), { status: 'ended', endedAt: Date.now(), winner });

export async function backToLobby(code: string) {
  await updateDoc(gameRef(code), { status: 'lobby', startedAt: null, endedAt: null, winner: null });
  for (const team of ['hunter', 'runner'] as Team[]) {
    const s = await getDocs(liveCol(code, team));
    await Promise.all(s.docs.map((d) => deleteDoc(d.ref)));
  }
  const pings = await getDocs(pingsCol(code));
  await Promise.all(pings.docs.map((d) => deleteDoc(d.ref)));
  const tags = await getDocs(collection(db, 'games', code, 'tags'));
  await Promise.all(tags.docs.map((d) => deleteDoc(d.ref)));
  const perks = await getDocs(collection(db, 'games', code, 'perks'));
  await Promise.all(perks.docs.map((d) => deleteDoc(d.ref)));
}

// ---- Player actions ----
export const leaveGame = (code: string, uid: string) => deleteDoc(doc(playersCol(code), uid));

export const writeLive = (code: string, team: Team, uid: string, name: string, lat: number, lng: number, goal?: LatLng | null) =>
  setDoc(doc(liveCol(code, team), uid), goal ? { name, team, lat, lng, goal, at: Date.now() } : { name, team, lat, lng, at: Date.now() });

/** Teammates' current challenge spots (runners only see their own team's live data). */
export async function getTeamGoals(code: string, team: Team, myUid: string): Promise<LatLng[]> {
  const snap = await getDocs(liveCol(code, team));
  return snap.docs.filter((d) => d.id !== myUid).map((d) => (d.data() as { goal?: LatLng }).goal).filter((g): g is LatLng => !!g);
}

export const writePing = (code: string, uid: string, name: string, lat: number, lng: number, radius?: number) =>
  setDoc(doc(pingsCol(code), uid), radius ? { name, lat, lng, radius, at: Date.now() } : { name, lat, lng, at: Date.now() });

/** A jammed ping: hunters keep seeing the old position, marked as jammed. */
export const writeJammedPing = (code: string, uid: string, name: string) =>
  setDoc(doc(pingsCol(code), uid), { name, jammed: true, at: Date.now() }, { merge: true });

// ---- Extra lives ----
export function watchPerks(code: string, uid: string, cb: (p: Perks) => void) {
  return onSnapshot(perksRef(code, uid), (s) => cb((s.data() as Perks | undefined) ?? { lives: 0, shieldUntil: 0 }), () => {});
}
export async function addLife(code: string, uid: string) {
  const s = await getDoc(perksRef(code, uid));
  const cur = (s.data() as Perks | undefined) ?? { lives: 0, shieldUntil: 0 };
  if (cur.lives >= 1) throw new Error('You already have an extra life.');
  await setDoc(perksRef(code, uid), { lives: 1, shieldUntil: cur.shieldUntil ?? 0 }, { merge: true });
}

export const setMyStatus = (code: string, uid: string, status: PlayerStatus) =>
  updateDoc(doc(playersCol(code), uid), { status });

/** What a runner's tag QR code contains. */
export const tagPayload = (code: string, uid: string, secret: string) => `manhunt:${code}:${uid}:${secret}`;

export function parseTag(data: string): { code: string; runnerId: string; secret: string } | null {
  const m = /^manhunt:([A-Z0-9]+):([^:]+):([a-z0-9]+)$/.exec(data);
  return m ? { code: m[1], runnerId: m[2], secret: m[3] } : null;
}

export type TagResult = { kind: 'caught' } | { kind: 'life' } | { kind: 'shielded'; secondsLeft: number };

/**
 * Tags a runner. If they have an extra life, it's used up instead and they get a short
 * shield to escape. During that shield they can't be tagged.
 */
export async function tagRunner(code: string, hunterId: string, runnerId: string, secret: string): Promise<TagResult> {
  const ps = await getDoc(perksRef(code, runnerId));
  const perks = ps.data() as Perks | undefined;
  const now = Date.now();
  if (perks && perks.shieldUntil > now) return { kind: 'shielded', secondsLeft: Math.ceil((perks.shieldUntil - now) / 1000) };
  if (perks && perks.lives > 0) {
    await updateDoc(perksRef(code, runnerId), { lives: perks.lives - 1, shieldUntil: now + 60_000, hitSecret: secret });
    return { kind: 'life' };
  }
  const batch = writeBatch(db);
  batch.set(doc(db, 'games', code, 'tags', runnerId), { hunterId, secret, at: Date.now() });
  batch.update(doc(playersCol(code), runnerId), { status: 'caught' });
  await batch.commit();
  return { kind: 'caught' };
}

export function targetLabel(t: MsgTarget, myTeam: Team): string {
  if (t.kind === 'all') return 'Everyone';
  if (t.kind === 'player') return t.name;
  return myTeam === 'hunter' ? 'Hunters' : 'Runners';
}

/** Sends a voice or text message. Returns the message as saved, so the sender can show it too. */
export async function sendMsg(
  code: string, me: { uid: string; name: string; team: Team }, target: MsgTarget,
  content: { kind: 'voice'; audio: string } | { kind: 'text'; text: string },
): Promise<Msg> {
  const col = target.kind === 'team' ? teamMsgs(code, me.team) : target.kind === 'all' ? allMsgs(code) : inbox(code, target.id);
  const data: Omit<Msg, 'id'> = {
    from: me.uid, fromName: me.name, fromTeam: me.team,
    scope: target.kind === 'player' ? 'direct' : target.kind,
    toName: targetLabel(target, me.team),
    at: Date.now(),
    ...content,
  };
  const ref = await addDoc(col, data);
  return { id: ref.id, ...data };
}
