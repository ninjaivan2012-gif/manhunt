import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Route } from '../../App';
import { useGame } from '../GameContext';
import { parseTag, tagRunner } from '../game/api';
import { Btn, Label } from '../ui/kit';
import { C, F } from '../ui/theme';

type Found = { runnerId: string; secret: string; name: string };

/** Hunter scans the runner's tag code. The code only exists on the runner's phone, so you have to be right next to them. */
export function TagScreen({ go }: { go: (r: Route) => void }) {
  const { game, players, session } = useGame();
  const insets = useSafeAreaInsets();
  const [perm, requestPerm] = useCameraPermissions();
  const [found, setFound] = useState<Found | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastScan = useRef('');

  function onScan(data: string) {
    if (found || data === lastScan.current) return;
    lastScan.current = data;
    const t = parseTag(data);
    if (!t || t.code !== game?.code) return setMsg("That's not a tag code from this game.");
    const p = players.find((x) => x.id === t.runnerId);
    if (!p || p.team !== 'runner') return setMsg("That code doesn't belong to a runner.");
    if (p.status !== 'alive') return setMsg(`${p.name} is already out.`);
    Vibration.vibrate(60);
    setMsg(null);
    setFound({ runnerId: t.runnerId, secret: t.secret, name: p.name });
  }

  async function confirm() {
    if (!found || !game || !session) return;
    setBusy(true);
    try {
      await tagRunner(game.code, session.uid, found.runnerId, found.secret);
      Vibration.vibrate([0, 80, 60, 80]);
      go('game');
    } catch {
      setMsg('Tag failed. Scan again, or ask the host to eliminate them.');
      setFound(null);
      lastScan.current = '';
    }
    setBusy(false);
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: insets.bottom + 20, gap: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable accessibilityLabel="Close scanner" onPress={() => go('game')} style={st.square}><Text style={{ color: C.redSoft, fontSize: 18 }}>✕</Text></Pressable>
        <Text style={{ fontFamily: F.display, fontSize: 15, letterSpacing: 3, color: C.red }}>TAG A RUNNER</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={st.viewfinder}>
        {perm?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={found ? undefined : (r) => onScan(r.data)}
          />
        ) : (
          <View style={{ alignItems: 'center', gap: 12, padding: 20 }}>
            <Text style={{ color: C.redSoft, textAlign: 'center' }}>The camera is needed to scan tag codes.</Text>
            <Btn label="ALLOW CAMERA" kind="secondary" onPress={requestPerm} />
          </View>
        )}
        <View pointerEvents="none" style={st.frame}>
          <View style={[st.corner, { left: 0, top: 0, borderLeftWidth: 3, borderTopWidth: 3 }]} />
          <View style={[st.corner, { right: 0, top: 0, borderRightWidth: 3, borderTopWidth: 3 }]} />
          <View style={[st.corner, { left: 0, bottom: 0, borderLeftWidth: 3, borderBottomWidth: 3 }]} />
          <View style={[st.corner, { right: 0, bottom: 0, borderRightWidth: 3, borderBottomWidth: 3 }]} />
        </View>
      </View>
      <Text style={{ color: C.redDim, fontSize: 13, textAlign: 'center' }}>Ask the runner to open "My tag code", then point your camera at it.</Text>

      {found && (
        <View style={st.foundBox}>
          <Label>CODE SCANNED</Label>
          <Text style={{ color: C.white, fontSize: 20, fontWeight: '600' }}>{found.name}</Text>
        </View>
      )}
      {msg && <Text style={{ color: C.red, fontSize: 14, textAlign: 'center' }}>{msg}</Text>}

      <View style={{ flex: 1 }} />
      <Btn label={found ? `CONFIRM TAG · ${found.name.toUpperCase()}` : 'WAITING FOR A CODE…'} disabled={!found} loading={busy} onPress={confirm} />
      <Text style={{ color: C.redDim, fontSize: 12, textAlign: 'center' }}>Not working? Ask the host to eliminate them from Host tools.</Text>
    </View>
  );
}

const st = StyleSheet.create({
  square: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  viewfinder: { height: 340, borderRadius: 20, overflow: 'hidden', backgroundColor: '#080606', borderWidth: 1, borderColor: '#1F0D0E', alignItems: 'center', justifyContent: 'center' },
  frame: { position: 'absolute', width: 210, height: 210 },
  corner: { position: 'absolute', width: 36, height: 36, borderColor: C.red },
  foundBox: { borderWidth: 1, borderColor: C.red, borderRadius: 14, backgroundColor: '#120607', padding: 14, gap: 4 },
});
