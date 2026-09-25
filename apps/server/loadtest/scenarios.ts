import {
  DARK_CHESS_SPEC_ID,
  isAllowedEngineTimeControl,
  type Move,
  type RoomTimeControl,
  TIME_CONTROLS,
  type VariantId,
} from '@mistboard/game';

export type Mode = 'pve' | 'pvp';

export interface Scenario {
  name: string;
  mode: Mode;
  variant: VariantId;
  timeControl: RoomTimeControl;
  /** Max moves to play before the game is considered "long enough" (caps EvE/PvP-random infinite games). */
  maxMoves: number;
  /** Max wall time per game in ms (a hard ceiling, regardless of moves). */
  maxGameMs: number;
  /** Per-move wait timeout in ms — how long we tolerate before declaring "engine/opponent stuck". */
  moveTimeoutMs: number;
  /** Engine id for PvE. Ignored for PvP. Default = server's builtin random-legal. */
  engineId?: string;
}

// 3+2 is the PvE allowlist (see isPveAllowedTimeControl in http-api.ts).
// Other PvE scenarios will get rejected at /api/rooms; bullet/casual PvE
// scenarios only work locally against an unrestricted server or against
// PvP, not against PvE-on-prod.
const BLITZ = TIME_CONTROLS.find((tc) => tc.id === '3m2')!;
// NB: the loadtest-only BULLET and CASUAL paces are gone with the PvE rows that
// were their only callers. Fog PvE can no longer be stressed at varying paces
// (see FOG_PVE below); reintroduce them with a PvP row if pace pressure, rather
// than engine pressure, is what a future scenario needs to measure.
// Fog PvE is engine-floored (#283): the fog engines cannot honor a 1s or 2s
// increment, and the create route refuses those paces, so a PvE scenario at
// BULLET/BLITZ/CASUAL would 400 before a single game started. The PvE rows
// below therefore share one pace, the fastest the floor admits, and vary what a load test actually varies:
// concurrency, move count, and duration. The pace dimension lives on the PvP
// rows, where humans still set their own clock.
const FOG_PVE: RoomTimeControl = (() => {
  const pace = TIME_CONTROLS.find((tc) => isAllowedEngineTimeControl(DARK_CHESS_SPEC_ID, tc));
  if (!pace) throw new Error('fog PvE scenarios expect a pace the engine floor admits');
  return { initialMs: pace.initialMs, incrementMs: pace.incrementMs };
})();

export const scenarios: Record<string, Scenario> = {
  'pve-bullet': {
    name: 'pve-bullet',
    mode: 'pve',
    variant: 'dark-chess',
    timeControl: FOG_PVE,
    maxMoves: 250,
    maxGameMs: 90_000,
    moveTimeoutMs: 30_000,
  },
  'pve-blitz': {
    name: 'pve-blitz',
    mode: 'pve',
    variant: 'dark-chess',
    timeControl: FOG_PVE,
    maxMoves: 250,
    maxGameMs: 240_000,
    moveTimeoutMs: 30_000,
  },
  'pve-casual': {
    name: 'pve-casual',
    mode: 'pve',
    variant: 'dark-chess',
    timeControl: FOG_PVE,
    maxMoves: 200,
    maxGameMs: 300_000,
    moveTimeoutMs: 30_000,
  },
  'pvp-blitz': {
    name: 'pvp-blitz',
    mode: 'pvp',
    variant: 'dark-chess',
    timeControl: BLITZ,
    maxMoves: 250,
    maxGameMs: 240_000,
    moveTimeoutMs: 10_000,
  },
};

export function pickRandomMove(legal: Move[], rng: () => number): Move | null {
  if (legal.length === 0) return null;
  return legal[Math.floor(rng() * legal.length)]!;
}

// Deterministic PRNG so a given gameIdx + seed produces repeatable move sequences.
export function makeRng(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
