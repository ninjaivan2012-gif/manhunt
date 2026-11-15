import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createAudioPlayer, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Vibration } from 'react-native';
import { sendMsg, watchMsgs } from '../game/api';
import type { Msg, MsgTarget, Team } from '../game/types';

const MAX_CLIP_MS = 15_000;
const MUTE_KEY = 'mh.muted';

/**
 * Walkie-talkie and chat. Hold to record a voice message (up to 15 s), or type a text.
 * Messages go to your team, to everyone, or to one player on either team.
 * Incoming voice messages play automatically unless you've muted the walkie-talkie.
 */
export function useComms(opts: { code: string; uid: string; name: string; team: Team; enabled: boolean }) {
  const { code, uid, name, team, enabled } = opts;
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [unread, setUnread] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [recording, setRecording] = useState(false);
  const [talking, setTalking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = useRef<MsgTarget>({ kind: 'team' });
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Msg[]>([]);
  const playing = useRef(false);
  const mutedRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(MUTE_KEY).then((v) => { mutedRef.current = v === '1'; setMutedState(v === '1'); }).catch(() => {});
  }, []);

  const setMuted = useCallback((m: boolean) => {
    mutedRef.current = m;
    setMutedState(m);
    if (m) queue.current = [];
    AsyncStorage.setItem(MUTE_KEY, m ? '1' : '0').catch(() => {});
  }, []);

  const playNext = useCallback(async () => {
    if (playing.current) return;
    const msg = queue.current.shift();
    if (!msg || !msg.audio) { setTalking(null); return; }
    playing.current = true;
    setTalking(msg.fromName);
    const done = () => { playing.current = false; playNext(); };
    try {
      const file = new File(Paths.cache, `msg-${msg.id}.m4a`);
      await file.write(msg.audio, { encoding: 'base64' });
      const player = createAudioPlayer(file.uri);
      const sub = player.addListener('playbackStatusUpdate', (s) => {
        if (s.didJustFinish) {
          sub.remove();
          player.remove();
          try { file.delete(); } catch {}
          done();
        }
      });
      player.play();
    } catch {
      done();
    }
  }, []);

  /** Play one voice message on demand (from the chat list), even while muted. */
  const replay = useCallback((m: Msg) => {
    if (!m.audio) return;
    queue.current.unshift(m);
    playNext();
  }, [playNext]);

  const add = useCallback((m: Msg, mine: boolean) => {
    setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m].sort((a, b) => a.at - b.at).slice(-100)));
    if (mine) return;
    setUnread((n) => n + 1);
    Vibration.vibrate(m.kind === 'text' ? 25 : 40);
    if (m.kind === 'voice' && !mutedRef.current) {
      queue.current.push(m);
      playNext();
    }
  }, [playNext]);

  useEffect(() => {
    if (!enabled || !code || !uid) return;
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
    return watchMsgs(code, team, uid, Date.now(), (m) => add(m, m.from === uid));
  }, [code, team, uid, enabled, add]);

  const send = useCallback(async (content: { kind: 'voice'; audio: string } | { kind: 'text'; text: string }, to: MsgTarget) => {
    const m = await sendMsg(code, { uid, name, team }, to, content);
    add(m, true);
  }, [code, uid, name, team, add]);

  const stopTalking = useCallback(async () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    if (!recorder.isRecording) { setRecording(false); return; }
    try {
      await recorder.stop();
      setRecording(false);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: true });
      if (!recorder.uri) return;
      const audio = await new File(recorder.uri).base64();
      await send({ kind: 'voice', audio }, target.current);
    } catch {
      setRecording(false);
      setError('Could not send that message.');
    }
  }, [recorder, send]);

  const startTalking = useCallback(async (to: MsgTarget) => {
    setError(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) { setError('Microphone permission is off.'); return; }
    target.current = to;
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      Vibration.vibrate(30);
      stopTimer.current = setTimeout(() => { stopTalking(); }, MAX_CLIP_MS);
    } catch {
      setError('Could not start the microphone.');
    }
  }, [recorder, stopTalking]);

  const sendText = useCallback(async (text: string, to: MsgTarget) => {
    const t = text.trim().slice(0, 300);
    if (!t) return;
    try { await send({ kind: 'text', text: t }, to); } catch { setError('Could not send that message.'); }
  }, [send]);

  return {
    messages, unread, clearUnread: () => setUnread(0),
    muted, setMuted, replay,
    startTalking, stopTalking, sendText,
    recording, talking, error,
  };
}
