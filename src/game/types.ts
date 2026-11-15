export type LatLng = { lat: number; lng: number };

export type Team = 'hunter' | 'runner';
export type PlayerStatus = 'alive' | 'caught' | 'out';
export type GameStatus = 'lobby' | 'running' | 'ended';
export type VoiceMode = 'both' | 'hunters' | 'runners' | 'off';

export type Settings = {
  headStartSec: number;   // runners' head start
  pingIntervalSec: number; // how often runners' positions are revealed to hunters
  durationMin: number;    // game length after the head start
  shrinkSteps: number;    // how many times the border shrinks
  finalScale: number;     // final border size as a fraction of the starting size (0.15 = 15%)
  graceSec: number;       // seconds you may stay outside the border before you're out
  voice: VoiceMode;
};

export type Border = {
  // Always stored as a polygon; a circle is just a 64-point polygon.
  shape: 'circle' | 'custom';
  points: LatLng[];
};

export type NoGoZone = { id: string; points: LatLng[] };

export type Game = {
  code: string;
  hostId: string;
  status: GameStatus;
  createdAt: number;
  settings: Settings;
  border: Border | null;
  noGo: NoGoZone[];
  startedAt: number | null; // ms timestamp when the host pressed Start
  endedAt: number | null;
  winner: Team | null;
};

export type Player = {
  id: string;
  name: string;
  team: Team;
  status: PlayerStatus;
  joinedAt: number;
};

export type LivePos = { id: string; name: string; team: Team; lat: number; lng: number; at: number };
export type Ping = { id: string; name: string; lat: number; lng: number; at: number };

/** Who a message goes to: your own team, every player, or one player (any team). */
export type MsgTarget = { kind: 'team' } | { kind: 'all' } | { kind: 'player'; id: string; name: string };

export type Msg = {
  id: string;
  from: string;
  fromName: string;
  fromTeam: Team;
  scope: 'team' | 'all' | 'direct';
  toName: string; // shown in the chat, e.g. "Hunters", "Everyone", "Maya"
  kind: 'voice' | 'text';
  text?: string;
  audio?: string; // base64 audio for voice messages
  at: number;
};

export const DEFAULT_SETTINGS: Settings = {
  headStartSec: 300,
  pingIntervalSec: 300,
  durationMin: 45,
  shrinkSteps: 4,
  finalScale: 0.15,
  graceSec: 30,
  voice: 'both',
};
