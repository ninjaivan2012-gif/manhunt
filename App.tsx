import { ChakraPetch_600SemiBold, ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch';
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameProvider, useGame } from './src/GameContext';
import { GameScreen } from './src/screens/GameScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LobbyScreen } from './src/screens/LobbyScreen';
import { MyTagScreen } from './src/screens/MyTagScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { TagScreen } from './src/screens/TagScreen';
import { applyTheme, C, ThemeCtx, type ThemeMode } from './src/ui/theme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true,
  }),
});

export type Route = 'lobby' | 'setup' | 'game' | 'tag' | 'mytag';

function Router() {
  const { session, game } = useGame();
  const [route, setRoute] = useState<Route>('lobby');

  // Jump everyone into the game when the host starts it, and back to the lobby after.
  useEffect(() => {
    if (!game) return;
    if (game.status === 'running' && (route === 'lobby' || route === 'setup')) setRoute('game');
    if (game.status === 'lobby' && (route === 'game' || route === 'tag' || route === 'mytag')) setRoute('lobby');
  }, [game?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return <HomeScreen />;
  switch (route) {
    case 'setup': return <SetupScreen go={setRoute} />;
    case 'game': return <GameScreen go={setRoute} />;
    case 'tag': return <TagScreen go={setRoute} />;
    case 'mytag': return <MyTagScreen go={setRoute} />;
    default: return <LobbyScreen go={setRoute} />;
  }
}

const THEME_KEY = 'mh.theme';

export default function App() {
  const [fontsLoaded] = useFonts({ ChakraPetch_600SemiBold, ChakraPetch_700Bold, JetBrainsMono_500Medium, JetBrainsMono_700Bold });
  const [mode, setModeState] = useState<ThemeMode | null>(null);

  // Load the saved day/night choice before the first screen draws, so there's no flash.
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((v) => { const m: ThemeMode = v === 'day' ? 'day' : 'night'; applyTheme(m); setModeState(m); })
      .catch(() => { applyTheme('night'); setModeState('night'); });
  }, []);

  const setMode = (m: ThemeMode) => {
    applyTheme(m);
    setModeState(m); // re-renders the whole app with the new colors
    AsyncStorage.setItem(THEME_KEY, m).catch(() => {});
  };

  const ready = fontsLoaded && mode !== null;
  return (
    <SafeAreaProvider>
      <StatusBar style={mode === 'day' ? 'dark' : 'light'} />
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {ready ? (
          <ThemeCtx.Provider value={{ mode: mode ?? 'night', setMode }}>
            <GameProvider>
              <Router />
            </GameProvider>
          </ThemeCtx.Provider>
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}
