import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { endGame, leaveGame, watchGame, watchPlayers } from './game/api';
import { endAt, phase } from './game/logic';
import type { Game, Player } from './game/types';
import { startTracking, stopTracking } from './location/tracker';
import { cacheGame, clearGameState, getSession, setNumber, setSession } from './session';

type Ctx = {
  session: { code: string; uid: string; name: string } | null;
  game: Game | null;
  players: Player[];
  me: Player | null;
  isHost: boolean;
  trackingOk: boolean | null; // false = "Allow all the time" wasn't granted
  enter: (code: string, uid: string, name: string) => Promise<void>;
  leave: () => Promise<void>;
};

const GameCtx = createContext<Ctx | null>(null);
export const useGame = () => {
  const v = useContext(GameCtx);
  if (!v) throw new Error('useGame outside provider');
  return v;
};

/** Re-renders every `ms` so countdowns tick. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [session, setS] = useState<Ctx['session']>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [trackingOk, setTrackingOk] = useState<boolean | null>(null);
  const now = useNow(2000);

  // Rejoin the last game after the app restarts.
  useEffect(() => {
    getSession().then((s) => s && setS({ code: s.code, uid: s.uid, name: s.name }));
  }, []);

  useEffect(() => {
    if (!session) return;
    const a = watchGame(session.code, (g) => {
      setGame(g);
      if (g) cacheGame(g);
    });
    const b = watchPlayers(session.code, setPlayers);
    return () => { a(); b(); };
  }, [session]);

  const me = useMemo(() => players.find((p) => p.id === session?.uid) ?? null, [players, session]);
  const isHost = !!game && !!session && game.hostId === session.uid;

  // Keep the background task's copy of who I am up to date.
  useEffect(() => {
    if (session && me) setSession({ ...session, team: me.team, status: me.status });
  }, [session, me?.team, me?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start background tracking while a game is running; stop it otherwise.
  const ph = game ? phase(game, now) : 'lobby';
  useEffect(() => {
    if (ph === 'headstart' || ph === 'hunt') {
      startTracking().then(setTrackingOk).catch(() => setTrackingOk(false));
    } else {
      stopTracking();
      if (ph === 'lobby') {
        setNumber('lastPing', null);
        setNumber('warnedPing', null);
        setNumber('outsideSince', null);
      }
    }
  }, [ph]);

  // End the game when time runs out or every runner is caught (any phone can do this).
  useEffect(() => {
    if (!game || game.status !== 'running' || !game.startedAt) return;
    const runners = players.filter((p) => p.team === 'runner');
    const alive = runners.filter((p) => p.status === 'alive');
    if (runners.length > 0 && alive.length === 0) endGame(game.code, 'hunter').catch(() => {});
    else if (now >= endAt(game)) endGame(game.code, alive.length ? 'runner' : 'hunter').catch(() => {});
  }, [game, players, now]);

  // If the host removes me from the lobby, go home.
  useEffect(() => {
    if (session && game && players.length > 0 && !me && game.status === 'lobby') {
      clearGameState();
      setS(null);
    }
  }, [players, me, session, game]);

  const enter = useCallback(async (code: string, uid: string, name: string) => {
    await setSession({ code, uid, name, team: 'runner', status: 'alive' });
    setS({ code, uid, name });
  }, []);

  const leave = useCallback(async () => {
    if (session) await leaveGame(session.code, session.uid).catch(() => {});
    await stopTracking();
    await clearGameState();
    setGame(null);
    setPlayers([]);
    setS(null);
  }, [session]);

  return (
    <GameCtx.Provider value={{ session, game, players, me, isHost, trackingOk, enter, leave }}>
      {children}
    </GameCtx.Provider>
  );
}
