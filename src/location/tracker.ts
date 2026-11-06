import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { setMyStatus, writeLive, writePing } from '../game/api';
import { checkBounds, nextPingAt, phase, pingIndex } from '../game/logic';
import { ensureSignedIn } from '../firebase';
import { getCachedGame, getNumber, getSession, setNumber, setSession } from '../session';

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
    writeLive(game.code, session.team, session.uid, session.name, pos.lat, pos.lng).catch(() => {});
  }

  if (session.team === 'runner' && ph === 'hunt') {
    // 2. Ping: reveal where you are right now, once per interval.
    const idx = pingIndex(game, now);
    const lastPing = (await getNumber('lastPing')) ?? -1;
    if (idx > lastPing) {
      await setNumber('lastPing', idx);
      writePing(game.code, session.uid, session.name, pos.lat, pos.lng).catch(() => {});
    }
    // 3. Warning ten seconds before the next ping.
    const untilPing = nextPingAt(game, now) - now;
    const warned = (await getNumber('warnedPing')) ?? -1;
    if (untilPing <= PING_WARNING_MS && warned < idx + 1) {
      await setNumber('warnedPing', idx + 1);
      notify('Ping incoming', `Hunters see your location in ${Math.ceil(untilPing / 1000)} seconds.`);
    }
  }

  // 4. Border and no-go zones (both teams). Ignore the head start for hunters, who should stay put anyway.
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
