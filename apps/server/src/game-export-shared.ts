// Constants and helpers shared by every game exporter (the chess builders in
// game-export.ts and the tenant builders in game-export-tenant.ts). Nothing here
// knows a variant's colors or moves: it is
// the summary-row vocabulary (result, termination, time control, mode) mapped
// onto the publication schema and the PGN tag set.

import type { RecentEveGameRecord } from './persistence.js';

export const SCHEMA_VERSION = '1.0';
export const LICENSE = 'CC BY 4.0';
export const DEFAULT_SITE_HOST = 'https://mistboard.com';
export const SITE_NAME = 'Mistboard';

export const PGN_CONTENT_TYPE = 'application/x-chess-pgn; charset=utf-8';
export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export type PublicationTimeControl = {
  initial_ms: number | null;
  increment_ms: number | null;
  label: string;
};

export function timeControlFromSummary(summary: RecentEveGameRecord): PublicationTimeControl {
  // PvP/PvE games store time control in games.initial_ms / games.increment_ms.
  // EvE games carry an additional eve_games.time_control JSON. Prefer the
  // games-table values when present, fall back to the EvE JSON otherwise.
  let initial = summary.initialMs ?? null;
  let increment = summary.incrementMs ?? null;
  if (initial == null) {
    const raw = summary.timeControl ?? {};
    const initialMsValue = (raw as Record<string, unknown>).initialMs;
    const incrementMsValue = (raw as Record<string, unknown>).incrementMs;
    if (typeof initialMsValue === 'number') initial = initialMsValue;
    if (typeof incrementMsValue === 'number') increment = incrementMsValue;
  }
  return {
    initial_ms: initial,
    increment_ms: increment,
    label: timeControlLabel(initial, increment),
  };
}

export function timeControlLabel(initialMs: number | null, incrementMs: number | null): string {
  if (initialMs == null) return 'untimed';
  const initialS = Math.round(initialMs / 1000);
  const incS = Math.round((incrementMs ?? 0) / 1000);
  return `${initialS}+${incS}`;
}

export type PgnResultToken = '1-0' | '0-1' | '1/2-1/2' | '*';

// PGN scores the FIRST player's result: "1-0" is a white win in chess and a red
// win in xiangqi, so the two first-mover spellings map onto the same token.
export function pgnResult(result: string): PgnResultToken {
  if (result === 'white-wins' || result === 'red-wins') return '1-0';
  if (result === 'black-wins') return '0-1';
  if (result === 'draw') return '1/2-1/2';
  return '*';
}

// The winner's color word, or 'draw'; anything else passes through untouched.
export function normalizeJsonResult(result: string): string {
  if (result === 'white-wins') return 'white';
  if (result === 'red-wins') return 'red';
  if (result === 'black-wins') return 'black';
  if (result === 'draw') return 'draw';
  return result;
}

// Map Mistboard's internal termination vocabulary onto the PGN standard set
// (the original value is preserved in [MistboardTermination "..."]).
// Standard PGN values: normal, abandoned, time forfeit, adjudication, death,
// emergency, rules infraction, unterminated.
export function pgnStandardTermination(termination: string): string {
  switch (termination) {
    case 'king-captured':
    case 'general-captured':
    case 'checkmate':
    case 'resignation':
    case 'draw':
    case 'no-legal-moves':
    case 'stalemate':
    case 'repetition':
    case 'progress-clock':
    case 'race':
    case 'chasing':
    case 'dead-position':
      return 'normal';
    case 'timeout':
      return 'time forfeit';
    case 'engine-failure':
      return 'adjudication';
    case 'worker-aborted':
    case 'server-restarted':
    case 'abandoned':
    case 'abandonment':
      return 'abandoned';
    case 'truncated':
      return 'unterminated';
    default:
      return 'normal';
  }
}

export function pgnEventName(mode: string): string {
  if (mode === 'pvp') return 'Mistboard Casual';
  if (mode === 'pve') return 'Mistboard PvE';
  if (mode === 'eve') return 'Mistboard EvE';
  return `Mistboard ${mode}`;
}

// PGN spells dates with dots: 2026.05.22.
export function pgnDate(summary: RecentEveGameRecord): string {
  return summary.startedAt.toISOString().slice(0, 10).replace(/-/g, '.');
}

export function escapePgnHeader(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
