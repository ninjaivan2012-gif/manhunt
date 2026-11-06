import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Route } from '../../App';
import { useGame } from '../GameContext';
import { getMySecret, tagPayload } from '../game/api';
import { Btn } from '../ui/kit';
import { C, F } from '../ui/theme';

/** The runner's tag code. A hunter scans this when they catch you. */
export function MyTagScreen({ go }: { go: (r: Route) => void }) {
  const { session, me } = useGame();
  const insets = useSafeAreaInsets();
  const [payload, setPayload] = useState<string | null>(null);

  useEffect(() => {
    if (session) getMySecret(session.code, session.uid).then((s) => setPayload(tagPayload(session.code, session.uid, s))).catch(() => {});
  }, [session]);

  // Once you've been tagged, go back to the map.
  useEffect(() => { if (me && me.status !== 'alive') go('game'); }, [me?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: insets.bottom + 20, alignItems: 'center', gap: 18 }}>
      <View style={{ alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable accessibilityLabel="Back to map" onPress={() => go('game')}
          style={{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.redSoft, fontSize: 20 }}>‹</Text>
        </Pressable>
        <Text style={{ fontFamily: F.display, fontSize: 15, letterSpacing: 3, color: C.red }}>MY TAG CODE</Text>
        <View style={{ width: 44 }} />
      </View>
      <View style={{ flex: 1 }} />
      <Text style={{ color: C.redSoft, fontSize: 15, textAlign: 'center', lineHeight: 22 }}>Caught? Show this to the hunter who tagged you.</Text>
      <View style={{ padding: 18, borderRadius: 16, backgroundColor: '#F2E6E4' }}>
        {payload ? <QRCode value={payload} size={230} color="#000000" backgroundColor="#F2E6E4" /> : <View style={{ width: 230, height: 230, justifyContent: 'center' }}><ActivityIndicator color={C.fill} /></View>}
      </View>
      <Text style={{ color: C.white, fontSize: 18, fontWeight: '600' }}>{session?.name}</Text>
      <View style={{ flex: 1 }} />
      <Btn label="BACK TO MAP" kind="secondary" style={{ alignSelf: 'stretch' }} onPress={() => go('game')} />
    </View>
  );
}
