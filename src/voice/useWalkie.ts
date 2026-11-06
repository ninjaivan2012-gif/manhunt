import {
  createAudioPlayer, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Vibration } from 'react-native';
import { sendVoice, watchVoice } from '../game/api';
import type { Team, VoiceClip } from '../game/types';

const MAX_CLIP_MS = 15_000;

/**
 * Walkie-talkie: hold to record a short clip, release to send it to your team (or one teammate).
 * Clips from teammates play automatically, one after another.
 */
export function useWalkie(opts: { code: string; uid: string; name: string; team: Team; enabled: boolean }) {
  const { code, uid, name, team, enabled } = opts;
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const [recording, setRecording] = useState(false);
  const [talking, setTalking] = useState<string | null>(null); // name of the teammate currently playing
  const [error, setError] = useState<string | null>(null);
  const target = useRef<string>('team');
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<VoiceClip[]>([]);
  const playing = useRef(false);

  const playNext = useCallback(async () => {
    if (playing.current) return;
    const clip = queue.current.shift();
    if (!clip) { setTalking(null); return; }
    playing.current = true;
    setTalking(clip.fromName);
    try {
      const file = new File(Paths.cache, `clip-${clip.id}.m4a`);
      await file.write(clip.audio, { encoding: 'base64' });
      const player = createAudioPlayer(file.uri);
      const sub = player.addListener('playbackStatusUpdate', (s) => {
        if (s.didJustFinish) {
          sub.remove();
          player.remove();
          try { file.delete(); } catch {}
          playing.current = false;
          playNext();
        }
      });
      Vibration.vibrate(40);
      player.play();
    } catch {
      playing.current = false;
      playNext();
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
    const unsub = watchVoice(code, team, Date.now(), (clip) => {
      if (clip.from === uid) return;
      if (clip.to !== 'team' && clip.to !== uid) return;
      queue.current.push(clip);
      playNext();
    });
    return unsub;
  }, [code, team, uid, enabled, playNext]);

  const stop = useCallback(async () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    if (!recorder.isRecording) { setRecording(false); return; }
    try {
      await recorder.stop();
      setRecording(false);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: true });
      if (!recorder.uri) return;
      const audio = await new File(recorder.uri).base64();
      await sendVoice(code, team, uid, name, target.current, audio);
    } catch {
      setRecording(false);
      setError('Could not send that message.');
    }
  }, [recorder, code, team, uid, name]);

  const start = useCallback(async (to: string) => {
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
      stopTimer.current = setTimeout(() => { stop(); }, MAX_CLIP_MS);
    } catch {
      setError('Could not start the microphone.');
    }
  }, [recorder, stop]);

  return { start, stop, recording, talking, error };
}
