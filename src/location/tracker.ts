import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { loadChallenge, updateChallenge } from '../challengeStore';
import { getTeamGoals, setMyStatus, writeJammedPing, writeLive, writePing } from '../game/api';
import { advance, BLUR_RADIUS, blurPing, COOLDOWN_MS, currentGoal, describe, newChallenge } from '../game/challenges';
import { checkBounds, nextPingAt, phase, pingIndex } from '../game/logic';
import { ensureSignedIn } from '../firebase';
import { getCachedGame, getNumber, getSession, setNumber, setSession } from '../session';
import type { Game, LatLng } from '../game/types';

/**
 * Runs whenever the phone gets a new GPS fix during a game — including with the screen
 * locked, thanks to Android's foreground service (the "Manhunt is tracking" notification).
 * It shares your position with your team, sends runner pings on schedule,
 * warns before a ping, and eliminates you if you stay outside the border too long.
 */
export const LOCATION_TASK = 'manhunt-location';

const LIVE_EVERY_MS = 5000; // teammates see you move every 5 s (keeps Firebase inside its free limits)
const PING_WARNING_MS = 10_000;

function notify(title: string, body: string) {
  return Notifications.scheduleNotificationAsync({ content: { title, body, sound: true }, trigger: null }).catch(() => {});
}

export async function handleLocation(loc: Location.LocationObject) {
  const [session, game] = await Promise.all([getSession(), getCachedGame()]);
  if (!session || !game || session.code !== game.code) return;
  const now = Date.now();
  const ph = phase(game, now);
  if (ph === 'lobby' || ph === 'over') return;
  if (session.status !== 'alive') return;

  await ensureSignedIn();
  const pos = { lat: loc.coords.latitude, lng: loc.coords.longitude };

  // 1. Live position for teammates.
  const lastLive = (await getNumber('lastLive')) ?? 0;
  if (now - lastLive >= LIVE_EVERY_MS) {
    await setNumber('lastLive', now);
    // Runners also share their current challenge spot, so teammates get different ones.
    const goal = session.team === 'runner' && game.settings.challenges
      ? (await loadChallenge(game.startedAt ?? 0)).active : null;
    writeLive(game.code, session.team, session.uid, session.name, pos.lat, pos.lng, goal ? currentGoal(goal) : null).catch(() => {});
  }

  if (session.team === 'runner' && ph === 'hunt') {
    // 2. Ping: reveal where you are right now, once per interval.
    const idx = pingIndex(game, now);
    const lastPing = (await getNumber('lastPing')) ?? -1;
    if (idx > lastPing) {
      await setNumber('lastPing', idx);
      await sendPing(game, session.uid, session.name, pos);
    }
    // 3. Warning ten seconds before the next ping.
    const untilPing = nextPingAt(game, now) - now;
    const warned = (await getNumber('warnedPing')) ?? -1;
    if (untilPing <= PING_WARNING_MS && warned < idx + 1) {
      await setNumber('warnedPing', idx + 1);
      notify('Ping incoming', `Hunters see your location in ${Math.ceil(untilPing / 1000)} seconds.`);
    }
  }

  // 4. Challenges (runners only, if the host turned them on).
  if (session.team === 'runner' && ph === 'hunt' && game.settings.challenges) {
    await runChallenge(game, session.uid, pos, now);
  }

  // 5. Border and no-go zones (both teams). Ignore the head start for hunters, who should stay put anyway.
  const check = checkBounds(game, pos, now);
  const since = await getNumber('outsideSince');
  if (check.outside) {
    if (since == null) {
      await setNumber('outsideSince', now);
      notify('Out of bounds', `Get back inside within ${game.settings.graceSec} seconds or you're out.`);
    } else if (now - since >= game.settings.graceSec * 1000) {
      await setNumber('outsideSince', null);
      await setSession({ ...session, status: 'out' });
      await setMyStatus(game.code, session.uid, 'out').catch(() => {});
      notify('Eliminated', 'You stayed outside the border too long.');
    }
  } else if (since != null) {
    await setNumber('outsideSince', null);
  }
}

/** Sends this runner's ping, using a blur or jam perk if one is waiting. */
async function sendPing(game: Game, uid: string, name: string, pos: LatLng) {
  let perk: 'blur' | 'jam' | null = null;
  await updateChallenge(game.startedAt ?? 0, (s) => {
    if (s.jamNext) { perk = 'jam'; s.jamNext = false; }
    else if (s.blurNext) { perk = 'blur'; s.blurNext = false; }
  });
  if (perk === 'jam') {
    await writeJammedPing(game.code, uid, name).catch(() => {});
    notify('Ping jammed', 'Hunters didn\'t get your location this time.');
  } else if (perk === 'blur') {
    const p = blurPing(pos);
    await writePing(game.code, uid, name, p.lat, p.lng, BLUR_RADIUS).catch(() => {});
    notify('Ping blurred', `Hunters only see a ${BLUR_RADIUS} m circle around you.`);
  } else {
    await writePing(game.code, uid, name, pos.lat, pos.lng).catch(() => {});
  }
}

/** Starts, advances, finishes, or fails this runner's challenge. */
async function runChallenge(game: Game, uid: string, pos: LatLng, now: number) {
  // Only ask the database for teammates' spots when a new challenge is about to start.
  const before = await loadChallenge(game.startedAt ?? 0);
  const avoid = !before.active && now >= before.cooldownUntil
    ? await getTeamGoals(game.code, 'runner', uid).catch(() => [] as LatLng[]) : [];
  let message: [string, string] | null = null;
  await updateChallenge(game.startedAt ?? 0, (s) => {
    if (!s.active) {
      if (now < s.cooldownUntil) return;
      s.active = newChallenge(game, pos, now, avoid);
      const d = describe(s.active);
      const goal = currentGoal(s.active);
      s.label = goal ? '' : `0 / 150 m`;
      s.fraction = 0;
      message = ['New challenge', `${d.title}: ${d.detail} Worth ${s.active.reward} point${s.active.reward > 1 ? 's' : ''}.`];
      return;
    }
    const p = advance(s.active, pos, now);
    s.active = p.challenge;
    s.label = p.label;
    s.fraction = p.fraction;
    if (p.done) {
      s.points += s.active.reward;
      s.completed += 1;
      s.lastResult = { text: `Challenge complete! +${s.active.reward} point${s.active.reward > 1 ? 's' : ''}`, at: now };
      message = ['Challenge complete', `+${s.active.reward}. You have ${s.points} point${s.points === 1 ? '' : 's'} to spend on perks.`];
      s.active = null;
      s.cooldownUntil = now + COOLDOWN_MS;
    } else if (p.failed) {
      s.lastResult = { text: 'Challenge failed. Time ran out.', at: now };
      message = ['Challenge failed', 'Time ran out. A new one is coming soon.'];
      s.active = null;
      s.cooldownUntil = now + COOLDOWN_MS;
    }
  });
  if (message) notify(message[0], message[1]);
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  try {
    await handleLocation(data.locations[data.locations.length - 1]);
  } catch {
    // Never let one bad update stop the tracker.
  }
});

/** Asks for "Allow all the time" location and starts tracking in the background. Returns false if not allowed. */
export async function startTracking(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  await Notifications.requestPermissionsAsync().catch(() => {});
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (already) return true;
  const options: Location.LocationTaskOptions = {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 2000,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Manhunt is running',
      notificationBody: 'Tracking your position for the game.',
      notificationColor: '#B3131B',
      killServiceOnDestroy: false,
    },
  };
  await Location.startLocationUpdatesAsync(LOCATION_TASK, options);
  return bg.status === 'granted';
}

export async function stopTracking() {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
}
