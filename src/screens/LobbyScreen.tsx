import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Route } from '../../App';
import { useGame } from '../GameContext';
import { kickPlayer, setTeam, shuffleTeams, startGame, updateSettings } from '../game/api';
import { refreshSpots, STALE_SEARCH_MS } from '../game/spotsJob';
import { PERKS } from '../game/challenges';
import { approxRadius } from '../game/geo';
import type { Player, Settings, Team, VoiceMode } from '../game/types';
import { Btn, Chip, Label, Stepper, ThemeToggle } from '../ui/kit';
import { C, F, themed } from '../ui/theme';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mins = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function LobbyScreen({ go }: { go: (r: Route) => void }) {
  const { game, players, isHost, session, leave } = useGame();
  const insets = useSafeAreaInsets();
  const [starting, setStarting] = useState(false);
  if (!game || !session) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  const s = game.settings;
  // A search that never finished (for example, the host closed the app) counts as failed.
  const spotsStatus = game.spotsStatus === 'loading' && Date.now() - (game.spotsAt ?? 0) > STALE_SEARCH_MS ? 'failed' : game.spotsStatus;
  const set = (patch: Partial<Settings>) => updateSettings(game.code, { ...s, ...patch }).catch(() => {});
  const hunters = players.filter((p) => p.team === 'hunter');
  const runners = players.filter((p) => p.team === 'runner');
  const prettyCode = `${game.code.slice(0, 3)}·${game.code.slice(3)}`;

  const canStart = !!game.border && hunters.length >= 1 && runners.length >= 1;
  const startHint = !game.border ? 'Set the border first.' : !hunters.length || !runners.length ? 'Each team needs at least one player.' : null;

  function playerMenu(p: Player) {
    if (!isHost) return;
    const other: Team = p.team === 'hunter' ? 'runner' : 'hunter';
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: `Move to ${other}s`, onPress: () => { setTeam(game!.code, p.id, other); } },
    ];
    if (p.id !== session!.uid) buttons.push({ text: 'Remove from game', style: 'destructive', onPress: () => { kickPlayer(game!.code, p.id); } });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(p.name, undefined, buttons);
  }

  async function start() {
    setStarting(true);
    try { await startGame(game!.code, players); } catch { Alert.alert('Could not start', 'Check your internet and try again.'); }
    setStarting(false);
  }

  const teamCol = (team: Team, list: Player[]) => (
    <View style={[st.teamBox, team === 'hunter' && { borderColor: C.lineStrong, backgroundColor: C.surface }]}>
      <Text style={[st.teamTitle, team === 'runner' && { color: C.redSoft }]}>{team === 'hunter' ? 'HUNTERS' : 'RUNNERS'} · {list.length}</Text>
      {list.map((p) => (
        <Pressable key={p.id} onPress={() => playerMenu(p)} accessibilityRole={isHost ? 'button' : undefined} style={st.playerRow}>
          <View style={[st.avatar, team === 'runner' && { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.lineStrong }]}>
            <Text style={{ color: C.red, fontSize: 11, fontWeight: '600' }}>{p.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <Text style={{ color: C.white, fontSize: 14, flex: 1 }} numberOfLines={1}>{p.name}</Text>
          {p.id === game.hostId && <Text style={{ color: C.redDim, fontFamily: F.mono, fontSize: 9 }}>HOST</Text>}
        </Pressable>
      ))}
    </View>
  );

  const voiceOpts: { v: VoiceMode; label: string }[] = [
    { v: 'both', label: 'Both' }, { v: 'hunters', label: 'Hunters' }, { v: 'runners', label: 'Runners' }, { v: 'off', label: 'Off' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 24, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Btn label="LEAVE" kind="secondary" style={{ height: 40 }} onPress={() =>
            Alert.alert('Leave game?', undefined, [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: leave }])} />
          <Label style={{ flex: 1, textAlign: 'center' }}>{isHost ? "LOBBY · YOU'RE HOST" : 'LOBBY'}</Label>
          <ThemeToggle />
        </View>

        <View style={st.codeBox}>
          <View>
            <Text style={{ color: C.redDim, fontSize: 12 }}>Game code</Text>
            <Text style={st.code} accessibilityLabel={`Game code ${game.code.split('').join(' ')}`}>{prettyCode}</Text>
          </View>
          <Btn label="SHARE" kind="secondary" style={{ height: 48 }} onPress={() => Share.share({ message: `Join my Manhunt game! Code: ${game.code}` })} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: F.displaySemi, color: C.red, letterSpacing: 1.5, fontSize: 15 }}>{players.length} PLAYERS</Text>
          {isHost && <Btn label="SHUFFLE" kind="secondary" style={{ height: 40 }} onPress={() => shuffleTeams(game.code, players)} />}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {teamCol('hunter', hunters)}
          {teamCol('runner', runners)}
        </View>
        {isHost && <Text style={{ color: C.redDim, fontSize: 12, marginTop: -6 }}>Tap a player to switch their team or remove them.</Text>}

        <View style={st.section}>
          <Label>BORDER</Label>
          <Text style={{ color: C.redSoft, fontSize: 14 }}>
            {game.border
              ? `${game.border.shape === 'circle' ? 'Circle' : 'Custom shape'} · about ${Math.round(approxRadius(game.border.points))} m across from center · ${game.noGo.length} no-go zone${game.noGo.length === 1 ? '' : 's'}`
              : 'Not set yet.'}
          </Text>
          {isHost && <Btn label={game.border ? 'EDIT BORDER & ZONES' : 'SET BORDER'} kind="secondary" onPress={() => go('setup')} />}
        </View>

        <View style={st.section}>
          <Label>RULES</Label>
          <Stepper disabled={!isHost} label="Runner head start" value={mins(s.headStartSec)}
            onMinus={() => set({ headStartSec: clamp(s.headStartSec - 60, 60, 900) })} onPlus={() => set({ headStartSec: clamp(s.headStartSec + 60, 60, 900) })} />
          <Stepper disabled={!isHost} label="Ping runners every" value={mins(s.pingIntervalSec)}
            onMinus={() => set({ pingIntervalSec: clamp(s.pingIntervalSec - 60, 60, 900) })} onPlus={() => set({ pingIntervalSec: clamp(s.pingIntervalSec + 60, 60, 900) })} />
          <Stepper disabled={!isHost} label="Game length" value={`${s.durationMin} min`}
            onMinus={() => set({ durationMin: clamp(s.durationMin - 5, 10, 180) })} onPlus={() => set({ durationMin: clamp(s.durationMin + 5, 10, 180) })} />
          <Stepper disabled={!isHost} label="Border shrinks" value={`${s.shrinkSteps}×`}
            onMinus={() => set({ shrinkSteps: clamp(s.shrinkSteps - 1, 0, 10) })} onPlus={() => set({ shrinkSteps: clamp(s.shrinkSteps + 1, 0, 10) })} />
          <Stepper disabled={!isHost} label="Final border size" value={`${Math.round(s.finalScale * 100)}%`}
            onMinus={() => set({ finalScale: clamp(Math.round((s.finalScale - 0.05) * 100) / 100, 0.05, 0.9) })} onPlus={() => set({ finalScale: clamp(Math.round((s.finalScale + 0.05) * 100) / 100, 0.05, 0.9) })} />
          <Stepper disabled={!isHost} label="Out-of-bounds grace" value={`${s.graceSec}s`}
            onMinus={() => set({ graceSec: clamp(s.graceSec - 10, 10, 180) })} onPlus={() => set({ graceSec: clamp(s.graceSec + 10, 10, 180) })} />
          {s.shrinkSteps > 0 && (
            <Text style={{ color: C.redSoft, fontSize: 13, lineHeight: 19 }}>
              The border shrinks {s.shrinkSteps} time{s.shrinkSteps === 1 ? '' : 's'}, about every {Math.round(s.durationMin / (s.shrinkSteps + 1))} min, ending at {Math.round(s.finalScale * 100)}% of its size.
            </Text>
          )}
          <Text style={{ color: C.redDim, fontSize: 14, marginTop: 6 }}>Walkie-talkie &amp; chat</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {voiceOpts.map((o) => <Chip key={o.v} label={o.label} active={s.voice === o.v} onPress={isHost ? () => set({ voice: o.v }) : undefined} />)}
          </View>
        </View>

        <View style={st.section}>
          <Label>CHALLENGES</Label>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="On" active={!!s.challenges} onPress={isHost ? () => set({ challenges: true }) : undefined} />
            <Chip label="Off" active={!s.challenges} onPress={isHost ? () => set({ challenges: false }) : undefined} />
          </View>
          <Text style={{ color: C.redSoft, fontSize: 13, lineHeight: 19 }}>
            Runners get their own challenges (reach a spot, hold a zone, checkpoint runs, keep moving) to earn points for perks:
            {' '}{PERKS.blur.name.toLowerCase()} ({PERKS.blur.cost}), {PERKS.jam.name.toLowerCase()} ({PERKS.jam.cost}), {PERKS.life.name.toLowerCase()} ({PERKS.life.cost}).
          </Text>
          {!!s.challenges && game.border && (
            <Text style={{ color: spotsStatus === 'failed' || spotsStatus === 'few' ? C.red : C.redDim, fontSize: 13, lineHeight: 19 }}>
              {spotsStatus === 'loading' ? 'Finding safe challenge spots from the map (usually a few seconds). You can start the game anyway.'
                : spotsStatus === 'failed' ? "Couldn't load map data, so only \"keep moving\" challenges will show up. Try again on Wi-Fi."
                : spotsStatus === 'few' ? `Only ${game.spots?.length ?? 0} safe spots found, so challenges will repeat. Add more in Edit border → Spots.`
                : game.spots?.length ? `${game.spots.length} safe challenge spots (no water, no houses). Saved for your area, so next time is instant.`
                : 'No challenge spots yet.'}
            </Text>
          )}
          {isHost && !!s.challenges && game.border && spotsStatus !== 'ready' && spotsStatus !== 'loading' && (
            <Btn label="FIND SPOTS AGAIN" kind="secondary" style={{ height: 48 }} onPress={() => refreshSpots(game)} />
          )}
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line, gap: 6 }}>
        {isHost ? (
          <>
            {startHint && <Text style={{ color: C.redDim, fontSize: 13, textAlign: 'center' }}>{startHint}</Text>}
            <Btn label="START GAME" onPress={start} disabled={!canStart} loading={starting} />
          </>
        ) : (
          <Text style={{ color: C.redSoft, textAlign: 'center', fontSize: 14, paddingVertical: 16 }}>Waiting for the host to start…</Text>
        )}
      </View>
    </View>
  );
}

const st = themed(() => StyleSheet.create({
  codeBox: { borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { fontFamily: F.monoBold, fontSize: 32, letterSpacing: 5, color: C.red },
  teamBox: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12, gap: 6, backgroundColor: C.surface },
  teamTitle: { fontFamily: F.display, fontSize: 13, letterSpacing: 2, color: C.red, marginBottom: 4 },
  playerRow: { minHeight: 44, borderRadius: 8, backgroundColor: C.surface2, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  avatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.selected, alignItems: 'center', justifyContent: 'center' },
  section: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 14, gap: 8 },
}));
