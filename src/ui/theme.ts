import { createContext, useContext } from 'react';

export type ThemeMode = 'night' | 'day';

type Palette = {
  bg: string;
  surface: string;    // cards, inputs
  surface2: string;   // raised chips
  selected: string;   // selected chip / button background
  sheet: string;      // see-through panels over the map
  line: string;       // quiet borders
  lineStrong: string; // emphasized borders
  red: string;        // main accent text
  redSoft: string;    // body text
  redDim: string;     // labels
  placeholder: string;
  fill: string;       // primary buttons
  fillText: string;
  white: string;      // player names
  danger: string;
  halo: string;       // outline behind text drawn on the map
  shadeOpacity: number; // how dark the area outside the border looks
};

// Night ops: true black (saves battery on OLED, keeps your phone from glowing)
// with dim reds that stay readable without ruining night vision.
const NIGHT: Palette = {
  bg: '#000000',
  surface: '#0A0505',
  surface2: '#120707',
  selected: '#1A0708',
  sheet: 'rgba(7,4,4,0.94)',
  line: '#2A1416',
  lineStrong: '#5A1E20',
  red: '#FF5A52',
  redSoft: '#D9544D',
  redDim: '#B0645E',
  placeholder: '#5A2A2A',
  fill: '#8E0F16',
  fillText: '#FFE3E0',
  white: '#EDE6E4',
  danger: '#B3131B',
  halo: '#000000',
  shadeOpacity: 0.55,
};

// Day: built for direct sunlight. White background, near-black text and a deep red
// that still reads clearly at full brightness (all text is 7:1 contrast or better).
const DAY: Palette = {
  bg: '#FFFFFF',
  surface: '#F4F1F0',
  surface2: '#FFFFFF',
  selected: '#FBE4E2',
  sheet: 'rgba(255,255,255,0.97)',
  line: '#C9C2C0',
  lineStrong: '#8A1C1C',
  red: '#A80D17',
  redSoft: '#111111',
  redDim: '#3D3838',
  placeholder: '#B5ADAB',
  fill: '#B3101B',
  fillText: '#FFFFFF',
  white: '#000000',
  danger: '#B3101B',
  halo: '#FFFFFF',
  shadeOpacity: 0.3,
};

/**
 * The current colors. Screens read C.something while rendering, and the app re-renders
 * everything when the mode changes, so switching day/night is instant.
 */
export const C: Palette = { ...NIGHT };

let version = 0;
let currentMode: ThemeMode = 'night';

export function applyTheme(mode: ThemeMode) {
  currentMode = mode;
  Object.assign(C, mode === 'day' ? DAY : NIGHT);
  version++;
}

export const themeMode = () => currentMode;

/** Style sheets that rebuild themselves after a theme change. Use like StyleSheet.create. */
export function themed<T extends object>(make: () => T): T {
  let cache = make();
  let builtFor = version;
  return new Proxy({} as T, {
    get(_t, key) {
      if (builtFor !== version) { cache = make(); builtFor = version; }
      return (cache as Record<string | symbol, unknown>)[key];
    },
  });
}

export const ThemeCtx = createContext<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>({
  mode: 'night',
  setMode: () => {},
});
export const useTheme = () => useContext(ThemeCtx);

export const F = {
  display: 'ChakraPetch_700Bold',
  displaySemi: 'ChakraPetch_600SemiBold',
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
};

// Free maps, no API key needed (© CARTO, © OpenStreetMap contributors).
// Day uses the more colorful "Voyager" style, which stays readable in sunlight.
export const mapStyle = (mode: ThemeMode) =>
  mode === 'day'
    ? 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
    : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
