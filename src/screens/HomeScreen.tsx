import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { isConfigured } from '../firebase';
import { useGame } from '../GameContext';
import { createGame, joinGame } from '../game/api';
import { getSavedName, saveName } from '../session';
import { Btn, Label, ThemeToggle } from '../ui/kit';
import { C, F, themed } from '../ui/theme';

export function HomeScreen() {
  const { enter } = useGame();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'join' | 'host' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getSavedName().then((n) => n && setName(n)); }, []);

  async function go(kind: 'join' | 'host') {
    setError(null);
    const n = name.trim();
    if (!n) return setError('Enter your name first.');
    if (kind === 'join' && code.replace(/[^A-Za-z0-9]/g, '').length < 6) return setError('Enter the 6-character game code.');
    setBusy(kind);
    try {
      await saveName(n);
      const r = kind === 'host' ? await createGame(n) : await joinGame(code, n);
      await enter(r.code, r.uid, n);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Check your internet.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[st.wrap, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth={1.6}>
            <Circle cx={12} cy={12} r={8} /><Circle cx={12} cy={12} r={2} /><Path d="M12 1v5M12 18v5M1 12h5M18 12h5" />
          </Svg>
          <Label style={{ flex: 1 }}>NIGHT OPS · v0.1</Label>
          <ThemeToggle />
        </View>
        <Text style={st.title}>MAN{'\n'}HUNT</Text>
        <Text style={st.tag}>Run. Hide. Get pinged. A real-world game of tag on a live map.</Text>

        {!isConfigured && (
          <Text style={st.error}>Firebase isn't set up yet. Paste your settings into src/firebaseConfig.ts (see the setup guide).</Text>
        )}

        <View style={{ flex: 1, minHeight: 32 }} />

        <Label>YOUR NAME</Label>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={C.redDim}
          maxLength={16}
          style={st.input}
          accessibilityLabel="Your name"
        />

        <Label style={{ marginTop: 18 }}>GAME CODE</Label>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="K7R2QX"
          placeholderTextColor={C.placeholder}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          style={[st.input, st.codeInput]}
          accessibilityLabel="Game code"
        />
        <Btn label="JOIN GAME" onPress={() => go('join')} loading={busy === 'join'} disabled={!!busy && busy !== 'join'} style={{ marginTop: 12 }} />

        <View style={st.orRow}>
          <View style={st.orLine} /><Text style={{ color: C.redDim, fontSize: 12 }}>or</Text><View style={st.orLine} />
        </View>
        <Btn label="+  HOST A GAME" kind="secondary" onPress={() => go('host')} loading={busy === 'host'} disabled={!!busy && busy !== 'host'} />
        {error && <Text style={[st.error, { marginTop: 14 }]}>{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = themed(() => StyleSheet.create({
  wrap: { flexGrow: 1, paddingHorizontal: 24 },
  title: { marginTop: 24, fontFamily: F.display, fontSize: 64, lineHeight: 60, letterSpacing: 2, color: C.red },
  tag: { marginTop: 14, fontSize: 15, lineHeight: 22, color: C.redDim, maxWidth: 270 },
  input: {
    marginTop: 8, height: 54, borderRadius: 10, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface,
    paddingHorizontal: 14, color: C.white, fontSize: 17,
  },
  codeInput: { fontFamily: F.monoBold, fontSize: 24, letterSpacing: 8, color: C.red, textAlign: 'center' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 14 },
  orLine: { flex: 1, height: 1, backgroundColor: C.line },
  error: { color: C.red, fontSize: 14, lineHeight: 20 },
}));
