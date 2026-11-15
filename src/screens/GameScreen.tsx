import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { Route } from '../../App';
import { useGame, useNow } from '../GameContext';
import { backToLobby, endGame, hostEliminate, watchPings, watchTeamLive } from '../game/api';
import { bearing, compassWord } from '../game/geo';
import { borderAtScale, checkBounds, currentBorder, fmtClock, nextPingAt, nextShrink, phase, releaseAt } from '../game/logic';
import type { LatLng, LivePos, MsgTarget, Ping, Player, Team } from '../game/types';
import { getNumber } from '../session';
import { GameMap, type GameMapHandle, type MapMarker } from '../ui/GameMap';
import { Btn, Chip, Label, Stat, ThemeToggle } from '../ui/kit';
import { C, F, themed } from '../ui/theme';
import { useComms } from '../voice/useComms';

const ago = (ms: number) => (ms < 60_000 ? `${Math.floor(ms / 1000)}s ago` : `${fmtClock(ms)} ago`);

export function GameScreen({ go }: { go: (r: Route) => void }) {
  const { game, players, me, session, isHost, trackingOk, leave } = useGame();
  const insets = useSafeAreaInsets();
  const now = useNow(1000);
  const map = useRef<GameMapHandle>(null);
  const [mates, setMates] = useState<LivePos[]>([]);
  const [pings, setPings] = useState<Ping[]>([]);
  const [myPos, setMyPos] = useState<LatLng | null>(null);
  const [outsideSince, setOutsideSince] = useState<number | null>(null);
  const [target, setTarget] = useState<MsgTarget>({ kind: 'team' });
  const [chatOpen, setChatOpen] = useState(false);
  const [hostPanel, setHostPanel] = useState(false);

  const code = session?.code ?? '';
  const team = me?.team ?? 'runner';
  const alive = me?.status === 'alive';

  useEffect(() => {
    if (!code || !me) return;
    const a = watchTeamLive(code, team, setMates);
    const b = team === 'hunter' || !alive ? watchPings(code, setPings) : () => {};
    return () => { a(); b(); };
  }, [code, team, alive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 1 }, (l) =>
      setMyPos({ lat: l.coords.latitude, lng: l.coords.longitude }),
    ).then((s) => { sub = s; }).catch(() => {});
    return () => sub?.remove();
  }, []);

  // The background tracker owns the out-of-bounds timer; mirror it here for the warning screen.
  useEffect(() => { getNumber('outsideSince').then(setOutsideSince); }, [now]);

  const voiceOn = !!game && (game.settings.voice === 'both' || game.settings.voice === `${team}s`);
  const comms = useComms({ code, uid: session?.uid ?? '', name: session?.name ?? '', team, enabled: voiceOn });

  const border = useMemo(() => (game ? currentBorder(game, now) : []), [game, Math.floor(now / 1000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const shrink = game ? nextShrink(game, now) : null;
  const nextBorder = useMemo(() => (game && shrink ? borderAtScale(game, shrink.scale) : []), [game, shrink?.scale]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!game || !session || !me) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  const ph = phase(game, now);
  const runners = players.filter((p) => p.team === 'runner');
  const runnersAlive = runners.filter((p) => p.status === 'alive');
  const others = players.filter((p) => p.id !== me.id);
  const untilPing = nextPingAt(game, now) - now;
  const center = border.length ? border[0] : myPos ?? { lat: 0, lng: 0 };

  const markers: MapMarker[] = [];
  mates.forEach((m) => {
    if (m.id === me.id) return;
    const p = players.find((x) => x.id === m.id);
    if (p && p.status !== 'alive') return;
    markers.push({ id: `l-${m.id}`, pos: m, label: m.name, sub: now - m.at > 30_000 ? ago(now - m.at) : undefined, kind: 'teammate' });
  });
  if (team === 'hunter' || !alive) {
    pings.forEach((p) => {
      if (players.find((x) => x.id === p.id)?.status !== 'alive') return;
      markers.push({ id: `p-${p.id}`, pos: p, label: p.name, sub: ago(now - p.at), kind: 'ping' });
    });
  }

  const outside = alive && outsideSince != null && (ph === 'hunt' || ph === 'headstart');
  const bounds = myPos ? checkBounds(game, myPos, now) : null;

  const headIcon = team === 'hunter'
    ? <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth={2}><Circle cx={12} cy={12} r={7} /><Path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></Svg>
    : <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.redSoft} strokeWidth={2}><Circle cx={12} cy={12} r={6} /></Svg>;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <GameMap ref={map} initialCenter={myPos ?? center} border={border} nextBorder={nextBorder} noGo={game.noGo} markers={markers} />

      {/* Top HUD */}
      <View style={[st.top, { top: insets.top + 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={[st.roleChip, team === 'runner' && { borderColor: C.line, backgroundColor: C.bg }]}>
            {headIcon}
            <Text style={[st.roleText, team === 'runner' && { color: C.redSoft }]}>{team === 'hunter' ? 'HUNTER' : 'RUNNER'}{!alive ? ' · OUT' : ''}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {isHost && <Btn label="HOST" kind="secondary" style={st.smallBtn} onPress={() => setHostPanel(true)} />}
            <ThemeToggle />
            <Btn label="◎" kind="secondary" style={[st.smallBtn, { width: 44, paddingHorizontal: 0 }]} onPress={() => myPos && map.current?.centerOn(myPos)} />
          </View>
        </View>

        {ph === 'headstart' ? (
          <View style={st.banner}>
            <View style={{ flex: 1 }}>
              <Text style={st.bannerTitle}>{team === 'hunter' ? 'STAY PUT' : 'RUN!'}</Text>
              <Text style={{ color: C.redSoft, fontSize: 12 }}>{team === 'hunter' ? 'The hunt starts when the head start ends.' : 'Hunters are released in'}</Text>
            </View>
            <Text style={st.bannerClock}>{fmtClock(releaseAt(game) - now)}</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Stat label="Next ping" value={fmtClock(untilPing)} strong={team === 'hunter'} />
            <Stat label="Runners left" value={`${runnersAlive.length}/${runners.length}`} />
            <Stat label="Zone shrinks" value={shrink ? fmtClock(shrink.at - now) : '—'} />
          </View>
        )}

        {team === 'runner' && alive && ph === 'hunt' && untilPing <= 10_000 && (
          <View style={[st.banner, { borderColor: C.red, backgroundColor: C.selected }]}>
            <View style={{ flex: 1 }}>
              <Text style={st.bannerTitle}>PING INCOMING</Text>
              <Text style={{ color: C.redSoft, fontSize: 12 }}>Hunters will see where you're standing.</Text>
            </View>
            <Text style={st.bannerClock}>{fmtClock(untilPing)}</Text>
          </View>
        )}
        {trackingOk === false && (
          <Text style={st.warn}>Location isn't set to "Allow all the time", so tracking stops when your screen locks. Change it in Settings → Apps → Manhunt → Location.</Text>
        )}
        {!alive && <Text style={st.warn}>You're out. You can still watch the map{team === 'runner' ? ' and see the pings' : ''}.</Text>}
      </View>

      {/* Bottom controls */}
      <View style={[st.bottom, { paddingBottom: insets.bottom + 16 }]}>
        {voiceOn && (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Label style={{ flex: 1 }}>WALKIE-TALKIE</Label>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: comms.muted }}
                accessibilityLabel="Mute walkie-talkie"
                onPress={() => comms.setMuted(!comms.muted)}
                style={[st.iconBtn, comms.muted && { borderColor: C.red, backgroundColor: C.selected }]}
              >
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={comms.muted ? C.red : C.redSoft} strokeWidth={1.8}>
                  <Path d="M4 9v6h4l5 4V5L8 9H4z" />
                  {comms.muted ? <Path d="M17 9l5 6M22 9l-5 6" /> : <Path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12" />}
                </Svg>
              </Pressable>
              <Pressable accessibilityLabel={`Open chat${comms.unread ? `, ${comms.unread} new` : ''}`} onPress={() => { setChatOpen(true); comms.clearUnread(); }} style={st.iconBtn}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.redSoft} strokeWidth={1.8}>
                  <Path d="M4 5h16v11H9l-5 4V5z" />
                </Svg>
                {comms.unread > 0 && <View style={st.badge}><Text style={st.badgeText}>{comms.unread > 9 ? '9+' : comms.unread}</Text></View>}
              </Pressable>
            </View>
            <Text style={{ color: C.redDim, fontSize: 12 }} numberOfLines={1}>
              {comms.recording ? `Recording to ${targetName(target, team)}… release to send`
                : comms.talking ? `${comms.talking} is talking…`
                : comms.error ?? (comms.muted ? 'Muted. New voice messages wait in the chat.' : `Talking to ${targetName(target, team)}`)}
            </Text>
            <TargetChips target={target} setTarget={setTarget} team={team} others={others} />
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {voiceOn && (
            <Pressable
              accessibilityLabel="Hold to talk"
              onPressIn={() => comms.startTalking(target)}
              onPressOut={() => comms.stopTalking()}
              style={[st.talk, comms.recording && { backgroundColor: C.fill, borderColor: C.red }]}
            >
              <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={comms.recording ? C.fillText : C.red} strokeWidth={1.8}>
                <Rect x={9} y={3} width={6} height={11} rx={3} /><Path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </Svg>
              <Text style={{ color: comms.recording ? C.fillText : C.red, fontFamily: F.display, fontSize: 10, letterSpacing: 1.5 }}>HOLD</Text>
            </Pressable>
          )}
          {alive && team === 'hunter' && ph === 'hunt' && <Btn label="SCAN TO TAG" style={st.bigAction} onPress={() => go('tag')} />}
          {alive && team === 'runner' && <Btn label="MY TAG CODE" kind="secondary" style={st.bigAction} onPress={() => go('mytag')} />}
          {(!alive || (team === 'hunter' && ph === 'headstart')) && (
            <View style={[st.bigAction, { justifyContent: 'center' }]}>
              <Text style={{ color: C.redDim, fontSize: 13, textAlign: 'center' }}>{!alive ? 'Spectating' : 'Tagging unlocks when the hunt starts'}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Out of bounds */}
      {outside && outsideSince != null && (
        <View style={st.oob}>
          <Text style={st.oobTitle}>OUT OF BOUNDS</Text>
          <Text style={{ color: C.redSoft, fontSize: 15, textAlign: 'center', lineHeight: 22, maxWidth: 290 }}>
            {bounds?.reason === 'nogo' ? 'You are in a no-go zone.' : 'You left the border.'} Get back before the timer runs out, or you're eliminated.
          </Text>
          <Text style={st.oobClock}>{fmtClock(game.settings.graceSec * 1000 - (now - outsideSince))}</Text>
          <Label>UNTIL ELIMINATED</Label>
          {bounds?.outside && bounds.backPoint && myPos && (
            <View style={st.oobDir}>
              <Text style={{ color: C.redDim, fontSize: 13 }}>{bounds.reason === 'nogo' ? 'Nearest way out' : 'Border is'}</Text>
              <Text style={{ color: C.red, fontFamily: F.display, fontSize: 26 }}>
                {Math.round(bounds.backDistance)} m <Text style={{ color: C.redSoft, fontSize: 16 }}>{compassWord(bearing(myPos, bounds.backPoint))}</Text>
              </Text>
            </View>
          )}
          <Text style={{ color: C.redDim, fontSize: 12, textAlign: 'center', marginTop: 20, maxWidth: 290 }}>GPS can drift a few meters. A quick step out and back won't count.</Text>
        </View>
      )}

      {/* Game over */}
      {ph === 'over' && (
        <View style={st.oob}>
          <Label>GAME OVER</Label>
          <Text style={[st.oobTitle, { fontSize: 40 }]}>{game.winner === 'hunter' ? 'HUNTERS WIN' : 'RUNNERS WIN'}</Text>
          <View style={{ alignSelf: 'stretch', gap: 6, marginTop: 12 }}>
            {runners.map((p) => (
              <View key={p.id} style={st.resultRow}>
                <Text style={{ color: C.white, flex: 1, fontSize: 15 }}>{p.name}</Text>
                <Text style={{ color: p.status === 'alive' ? C.red : C.redDim, fontFamily: F.mono, fontSize: 12 }}>
                  {p.status === 'alive' ? 'SURVIVED' : p.status === 'caught' ? 'CAUGHT' : 'OUT OF BOUNDS'}
                </Text>
              </View>
            ))}
          </View>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 24 }}>
            {isHost
              ? <Btn label="BACK TO LOBBY" onPress={() => backToLobby(game.code)} />
              : <Text style={{ color: C.redSoft, textAlign: 'center' }}>The host can start another round.</Text>}
            <Btn label="LEAVE GAME" kind="ghost" onPress={leave} />
          </View>
        </View>
      )}

      {/* Chat */}
      <Modal visible={chatOpen} animationType="slide" onRequestClose={() => setChatOpen(false)}>
        <ChatPanel
          onClose={() => { setChatOpen(false); comms.clearUnread(); }}
          comms={comms}
          myId={me.id}
          team={team}
          others={others}
          target={target}
          setTarget={setTarget}
        />
      </Modal>

      {/* Host tools */}
      <Modal visible={hostPanel} transparent animationType="slide" onRequestClose={() => setHostPanel(false)}>
        <View style={st.modalBg}>
          <View style={[st.modal, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={st.bannerTitle}>HOST TOOLS</Text>
            <Text style={{ color: C.redDim, fontSize: 13 }}>If a tag doesn't go through, eliminate the runner here.</Text>
            {runners.map((p) => (
              <View key={p.id} style={st.resultRow}>
                <Text style={{ color: C.white, flex: 1, fontSize: 15 }}>{p.name}</Text>
                {p.status === 'alive'
                  ? <Btn label="ELIMINATE" kind="secondary" style={{ height: 40 }} onPress={() =>
                      Alert.alert(`Eliminate ${p.name}?`, undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Eliminate', style: 'destructive', onPress: () => { hostEliminate(game.code, p.id); } }])} />
                  : <Text style={{ color: C.redDim, fontFamily: F.mono, fontSize: 12 }}>{p.status.toUpperCase()}</Text>}
              </View>
            ))}
            <Btn label="END GAME NOW" kind="secondary" onPress={() =>
              Alert.alert('End the game now?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'End game', style: 'destructive', onPress: () => { endGame(game.code, runnersAlive.length ? 'runner' : 'hunter'); setHostPanel(false); } }])} />
            <Btn label="CLOSE" onPress={() => setHostPanel(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function targetName(t: MsgTarget, team: Team) {
  return t.kind === 'all' ? 'everyone' : t.kind === 'player' ? t.name : team === 'hunter' ? 'all hunters' : 'all runners';
}

function TargetChips({ target, setTarget, team, others }: {
  target: MsgTarget; setTarget: (t: MsgTarget) => void; team: Team; others: Player[];
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
      <Chip label="My team" active={target.kind === 'team'} onPress={() => setTarget({ kind: 'team' })} />
      <Chip label="Everyone" active={target.kind === 'all'} onPress={() => setTarget({ kind: 'all' })} />
      {others.map((p) => (
        <Chip
          key={p.id}
          label={`${p.name} · ${p.team === 'hunter' ? 'H' : 'R'}`}
          active={target.kind === 'player' && target.id === p.id}
          onPress={() => setTarget({ kind: 'player', id: p.id, name: p.name })}
        />
      ))}
    </ScrollView>
  );
}

function ChatPanel(props: {
  onClose: () => void;
  comms: ReturnType<typeof useComms>;
  myId: string;
  team: Team;
  others: Player[];
  target: MsgTarget;
  setTarget: (t: MsgTarget) => void;
}) {
  const { comms, myId, team } = props;
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const list = useRef<FlatList>(null);
  // Keep the typed text if sending fails, so it isn't lost.
  const send = () => {
    const text = draft;
    setDraft('');
    comms.sendText(text, props.target).catch(() => setDraft(text));
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Text style={[st.bannerTitle, { flex: 1 }]}>CHAT</Text>
        <Btn label="CLOSE" kind="secondary" style={{ height: 40 }} onPress={props.onClose} />
      </View>
      <FlatList
        ref={list}
        data={comms.messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<Text style={{ color: C.redDim, textAlign: 'center', marginTop: 40 }}>No messages yet.</Text>}
        renderItem={({ item: m }) => {
          const mine = m.from === myId;
          const enemy = m.fromTeam !== team;
          return (
            <View style={[st.bubble, mine ? st.bubbleMine : null, enemy && { borderColor: C.lineStrong, backgroundColor: C.surface }]}>
              <Text style={{ color: C.redDim, fontSize: 11, fontFamily: F.mono }}>
                {mine ? 'You' : m.fromName} {m.fromTeam === 'hunter' ? '(hunter)' : '(runner)'} → {m.scope === 'direct' && !mine ? 'you' : m.toName}
              </Text>
              {m.kind === 'text'
                ? <Text style={{ color: C.white, fontSize: 15, lineHeight: 21 }}>{m.text}</Text>
                : (
                  <Pressable accessibilityRole="button" accessibilityLabel="Play voice message" onPress={() => comms.replay(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}>
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill={C.red}><Path d="M7 5l12 7-12 7V5z" /></Svg>
                    <Text style={{ color: C.red, fontSize: 14 }}>Voice message</Text>
                  </Pressable>
                )}
            </View>
          );
        }}
      />
      <View style={{ borderTopWidth: 1, borderTopColor: C.line, padding: 12, paddingBottom: insets.bottom + 12, gap: 10, backgroundColor: C.surface }}>
        {comms.error && <Text style={{ color: C.red, fontSize: 13, lineHeight: 18 }}>{comms.error}</Text>}
        <TargetChips target={props.target} setTarget={props.setTarget} team={team} others={props.others} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${targetName(props.target, team)}`}
            placeholderTextColor={C.redDim}
            maxLength={300}
            onSubmitEditing={send}
            returnKeyType="send"
            accessibilityLabel="Message"
            style={st.chatInput}
          />
          <Btn label="SEND" style={{ height: 48, width: 84 }} onPress={send} disabled={!draft.trim()} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const st = themed(() => StyleSheet.create({
  top: { position: 'absolute', left: 16, right: 16, gap: 10 },
  roleChip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.lineStrong },
  roleText: { fontFamily: F.display, fontSize: 12, letterSpacing: 2, color: C.red },
  smallBtn: { height: 40, paddingHorizontal: 12, backgroundColor: C.bg },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 14, backgroundColor: C.surface, padding: 12 },
  bannerTitle: { fontFamily: F.display, fontSize: 16, letterSpacing: 1.5, color: C.red },
  bannerClock: { fontFamily: F.monoBold, fontSize: 28, color: C.red },
  warn: { color: C.redSoft, fontSize: 12, lineHeight: 17, backgroundColor: C.sheet, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: C.line },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, gap: 12, backgroundColor: C.sheet, borderTopWidth: 1, borderTopColor: C.line, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  iconBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: C.fillText, fontSize: 10, fontWeight: '700' },
  bubble: { alignSelf: 'flex-start', maxWidth: '85%', borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, gap: 4, backgroundColor: C.surface },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: C.selected, borderColor: C.lineStrong },
  chatInput: { flex: 1, height: 48, borderRadius: 10, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface, paddingHorizontal: 12, color: C.white, fontSize: 15 },
  talk: { width: 72, height: 64, borderRadius: 16, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', gap: 2 },
  bigAction: { flex: 1, height: 64, borderRadius: 16 },
  oob: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.bg, borderWidth: 3, borderColor: C.danger, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  oobTitle: { fontFamily: F.display, fontSize: 34, letterSpacing: 3, color: C.red, textAlign: 'center' },
  oobClock: { fontFamily: F.monoBold, fontSize: 72, color: C.red, marginTop: 16 },
  oobDir: { alignSelf: 'stretch', marginTop: 20, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 16, backgroundColor: C.surface, padding: 16, gap: 4 },
  resultRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderBottomWidth: 1, borderBottomColor: C.line, gap: 10 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: C.line, padding: 20, gap: 12 },
}));
