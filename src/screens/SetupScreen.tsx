import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Route } from '../../App';
import { useGame } from '../GameContext';
import { setBorder, setNoGo, setSpots } from '../game/api';
import { refreshSpots } from '../game/spotsJob';
import { approxRadius, centroid, circlePolygon, distanceM, pointInPolygon } from '../game/geo';
import type { LatLng, NoGoZone } from '../game/types';
import { GameMap, type GameMapHandle } from '../ui/GameMap';
import { Btn, Stepper } from '../ui/kit';
import { C, themed } from '../ui/theme';

type Mode = 'circle' | 'custom' | 'nogo' | 'spots';

export function SetupScreen({ go }: { go: (r: Route) => void }) {
  const { game } = useGame();
  const insets = useSafeAreaInsets();
  const map = useRef<GameMapHandle>(null);
  const existing = game?.border;

  const [start, setStart] = useState<LatLng | null>(existing ? centroid(existing.points) : null);
  const [mode, setMode] = useState<Mode>(existing?.shape === 'custom' ? 'custom' : 'circle');
  const [center, setCenter] = useState<LatLng | null>(existing?.shape === 'circle' ? centroid(existing.points) : null);
  const [radius, setRadius] = useState(existing?.shape === 'circle' ? Math.round(approxRadius(existing.points) / 50) * 50 : 400);
  const [customPts, setCustomPts] = useState<LatLng[]>(existing?.shape === 'custom' ? existing.points : []);
  const [zones, setZones] = useState<NoGoZone[]>(game?.noGo ?? []);
  const [draftZone, setDraftZone] = useState<LatLng[]>([]);
  const [shape, setShape] = useState<'circle' | 'custom'>(existing?.shape ?? 'circle');
  const [saving, setSaving] = useState(false);
  const [spots, setSpotList] = useState<LatLng[]>(game?.spots ?? []);
  const [spotsEdited, setSpotsEdited] = useState(false);

  // Keep the list in sync while the host's phone is still finding spots.
  useEffect(() => { if (!spotsEdited) setSpotList(game?.spots ?? []); }, [game?.spots]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        if (!start) setStart({ lat: 40.7128, lng: -74.006 });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!start) setStart(me);
      if (!center && !existing) setCenter(me);
    })().catch(() => { if (!start) setStart({ lat: 40.7128, lng: -74.006 }); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const borderPts = useMemo(
    () => (shape === 'circle' ? (center ? circlePolygon(center, radius) : []) : customPts.length >= 3 ? customPts : []),
    [shape, center, radius, customPts],
  );

  const areaChanged = JSON.stringify(borderPts) !== JSON.stringify(existing?.points ?? [])
    || JSON.stringify(zones) !== JSON.stringify(game?.noGo ?? []);

  function onMapPress(p: LatLng) {
    if (mode === 'spots') {
      if (areaChanged) return;
      const near = spots.findIndex((x) => distanceM(x, p) < 20);
      if (near >= 0) setSpotList((l) => l.filter((_, i) => i !== near));
      else if (borderPts.length >= 3 && pointInPolygon(p, borderPts)) setSpotList((l) => [...l, p]);
      setSpotsEdited(true);
      return;
    }
    if (mode === 'circle') { setShape('circle'); setCenter(p); }
    else if (mode === 'custom') { setShape('custom'); setCustomPts((pts) => [...pts, p]); }
    else setDraftZone((pts) => [...pts, p]);
  }

  function pickMode(m: Mode) {
    setMode(m);
    if (m === 'circle') setShape('circle');
    if (m === 'custom' && customPts.length >= 3) setShape('custom');
  }

  async function save() {
    if (borderPts.length < 3) return Alert.alert('No border yet', mode === 'custom' ? 'Tap at least 3 corners.' : 'Tap the map to place the circle.');
    if (draftZone.length) return Alert.alert('Unfinished no-go zone', 'Finish or undo the zone you are drawing first.');
    setSaving(true);
    try {
      await setBorder(game!.code, { shape, points: borderPts });
      await setNoGo(game!.code, zones);
      if (areaChanged || !game!.spots?.length) {
        // New area: find safe challenge spots again (runs in the background).
        refreshSpots({ ...game!, noGo: zones }, borderPts, zones);
      } else if (spotsEdited) {
        await setSpots(game!.code, spots, spots.length >= 12 ? 'ready' : 'few');
      }
      go('lobby');
    } catch {
      Alert.alert('Could not save', 'Check your internet and try again.');
    }
    setSaving(false);
  }

  if (!game || !start) {
    return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.red} /></View>;
  }

  const hint =
    mode === 'circle' ? 'Tap the map to move the center of the circle.'
    : mode === 'custom' ? `Tap the map to add corners (${customPts.length} so far).`
    : mode === 'nogo' ? `Tap around an area players can't enter, like a pond (${draftZone.length} points).`
    : areaChanged ? 'Save the border first. Safe spots are found for the new area automatically.'
    : game.spotsStatus === 'loading' ? 'Finding safe spots from the map…'
    : `${spots.length} challenge spots. Tap a dot to remove it (for example, if it's in a pool), or tap empty ground to add one.`;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <GameMap
        ref={map}
        initialCenter={start}
        border={borderPts}
        noGo={zones}
        dots={mode === 'spots' && !areaChanged ? spots : undefined}
        draft={mode === 'custom' && shape === 'custom' && customPts.length < 3 ? customPts : mode === 'nogo' ? draftZone : []}
        onPress={onMapPress}
      />

      <View style={[st.topBar, { top: insets.top + 10 }]}>
        <Pressable accessibilityLabel="Back" onPress={() => go('lobby')} style={st.square}><Text style={{ color: C.redSoft, fontSize: 20 }}>‹</Text></Pressable>
        <View style={st.segment}>
          {(['circle', 'custom', 'nogo', 'spots'] as Mode[]).map((m) => (
            <Pressable key={m} onPress={() => pickMode(m)} style={[st.segBtn, mode === m && { backgroundColor: C.selected }]} accessibilityRole="button">
              <Text style={{ color: mode === m ? C.red : C.redDim, fontSize: 13, fontWeight: mode === m ? '600' : '400' }}>
                {m === 'circle' ? 'Circle' : m === 'custom' ? 'Custom' : m === 'nogo' ? '+ No-go' : 'Spots'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[st.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={{ color: C.redSoft, fontSize: 13, lineHeight: 19 }}>{hint}</Text>

        {mode === 'circle' && (
          <Stepper label="Radius" value={`${radius} m`} onMinus={() => setRadius((r) => Math.max(50, r - 50))} onPlus={() => setRadius((r) => Math.min(5000, r + 50))} />
        )}
        {mode === 'custom' && (
          <View style={st.row}>
            <Btn label="UNDO" kind="secondary" style={st.flexBtn} onPress={() => setCustomPts((p) => p.slice(0, -1))} disabled={!customPts.length} />
            <Btn label="CLEAR" kind="secondary" style={st.flexBtn} onPress={() => setCustomPts([])} disabled={!customPts.length} />
          </View>
        )}
        {mode === 'nogo' && (
          <>
            <View style={st.row}>
              <Btn label="UNDO" kind="secondary" style={st.flexBtn} onPress={() => setDraftZone((p) => p.slice(0, -1))} disabled={!draftZone.length} />
              <Btn label="FINISH ZONE" kind="secondary" style={st.flexBtn} disabled={draftZone.length < 3}
                onPress={() => { setZones((z) => [...z, { id: String(Date.now()), points: draftZone }]); setDraftZone([]); }} />
            </View>
            {zones.length > 0 && (
              <Btn label={`DELETE LAST ZONE (${zones.length} total)`} kind="ghost" onPress={() => setZones((z) => z.slice(0, -1))} />
            )}
          </>
        )}
        <View style={st.row}>
          <Btn label="ME" kind="secondary" style={{ width: 72 }} onPress={async () => {
            const p = await Location.getLastKnownPositionAsync();
            if (p) map.current?.centerOn({ lat: p.coords.latitude, lng: p.coords.longitude });
          }} />
          <Btn label="SAVE BORDER" style={{ flex: 1 }} onPress={save} loading={saving} />
        </View>
      </View>
    </View>
  );
}

const st = themed(() => StyleSheet.create({
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', gap: 10 },
  square: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  segment: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg, flexDirection: 'row', padding: 3, gap: 3 },
  segBtn: { flex: 1, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  flexBtn: { flex: 1, height: 48 },
}));
