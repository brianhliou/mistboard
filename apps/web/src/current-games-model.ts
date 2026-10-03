// Pure logic for /games (current-games.ts): the payload types, the variant chip
// list, the Everyone / People only / Bots filter, the Live / Correspondence
// split, the empty-state headline, clock urgency and the correspondence
// time-left bar. DOM-free so it is unit-tested directly
// (current-games-model.test.ts).

import { maybeGameSpecForId } from '@mistboard/game';
import { clockEmergencyMs } from './clock-emphasis.js';

export const CHANNEL_ALL = 'all';

export type CurrentGamePlayer = {
  color: string;
  name: string | null;
  // Linkable seat identity, at most one set: `handle` for a signed-in account,
  // `botId` for a first-party bot. Both null for guests and for raw engine
  // versions, neither of which has a public page.
  handle: string | null;
  botId?: string | null;
  isEngine: boolean;
};

export type CurrentGameClock = {
  activeColor: string | null;
  remainingMs: Record<string, number>;
  asOf: number;
  running: boolean;
};

export type CurrentGame = {
  roomId: string;
  gameSpecId: string;
  channelId: string | null;
  // The server's human-vs-engine flag: 'pve' when any seat is an engine.
  composition: 'pvp' | 'pve';
  observe: 'open' | 'masked' | 'sealed';
  players: CurrentGamePlayer[];
  ply: number;
  rated: boolean;
  startedAt: number | null;
  lastActivityAt: number | null;
  timeControl: { initialMs: number; incrementMs: number; daysPerMove?: number } | null;
  timeClass: 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence' | null;
  clock: CurrentGameClock | null;
  deadline: { seat: string; dueAt: string } | null;
  url: string;
  payload?: Record<string, unknown>;
};

export type CurrentGamesChannel = {
  id: string;
  label: string;
  family: string;
  gameSpecIds: string[];
  count: number;
};

export type CurrentGamesResponse = {
  channel: string;
  channels: CurrentGamesChannel[];
  games: CurrentGame[];
  now: string;
  total: number;
};

// ---- Variant chips ----------------------------------------------------------

export type VariantChip = { id: string; count: number; selected: boolean };

// "All N" first, then only the channels that have a game right now, in the
// server's rail order. A channel selected through the URL stays on the row even
// at zero, so the reader can see what is filtered and step back out of it.
export function variantChips(
  channels: readonly Pick<CurrentGamesChannel, 'id' | 'count'>[],
  total: number,
  active: string,
): VariantChip[] {
  const chips: VariantChip[] = [
    { id: CHANNEL_ALL, count: total, selected: active === CHANNEL_ALL },
  ];
  for (const channel of channels) {
    const selected = channel.id === active;
    if (channel.count > 0 || selected) {
      chips.push({ id: channel.id, count: channel.count, selected });
    }
  }
  return chips;
}

// ---- Everyone / People only / Bots ------------------------------------------

export type PlayerFilter = 'everyone' | 'people' | 'bots';

export const PLAYER_FILTERS: readonly PlayerFilter[] = ['everyone', 'people', 'bots'];

export const PLAYER_FILTER_PARAM = 'players';

// Unknown values read as the default, so a hand-edited URL never empties the page.
export function parsePlayerFilter(value: string | null): PlayerFilter {
  return value === 'people' || value === 'bots' ? value : 'everyone';
}

export function filterByPlayers<T extends Pick<CurrentGame, 'composition'>>(
  games: readonly T[],
  filter: PlayerFilter,
): T[] {
  if (filter === 'people') return games.filter((game) => game.composition === 'pvp');
  if (filter === 'bots') return games.filter((game) => game.composition === 'pve');
  return [...games];
}

// The finished-game feed carries `mode` instead of `composition`: a pvp row is
// people only; anything with an engine seat (pve, eve) is a bot game.
export function finishedMatchesFilter(mode: string | undefined, filter: PlayerFilter): boolean {
  if (filter === 'people') return mode === 'pvp';
  if (filter === 'bots') return mode === 'pve' || mode === 'eve';
  return true;
}

// ---- Sections ---------------------------------------------------------------

export type CurrentGameSections<T> = { live: T[]; correspondence: T[] };

// Live games keep the server's order (people first, then bots, most recently
// active first); correspondence keeps soonest deadline first.
export function splitSections<T extends Pick<CurrentGame, 'timeClass'>>(
  games: readonly T[],
): CurrentGameSections<T> {
  const live: T[] = [];
  const correspondence: T[] = [];
  for (const game of games) {
    if (game.timeClass === 'correspondence') correspondence.push(game);
    else live.push(game);
  }
  return { live, correspondence };
}

// ---- Empty state --------------------------------------------------------------

export type EmptyHeadline =
  | { kind: 'none' }
  | { kind: 'channel'; channelId: string }
  | { kind: 'people' }
  | { kind: 'bots' };

// null while there is something to show. Otherwise which quiet line to print:
// the narrowest filter in force names what is empty.
export function emptyHeadline(
  shownCount: number,
  channel: string,
  filter: PlayerFilter,
): EmptyHeadline | null {
  if (shownCount > 0) return null;
  if (channel !== CHANNEL_ALL) return { kind: 'channel', channelId: channel };
  if (filter === 'people') return { kind: 'people' };
  if (filter === 'bots') return { kind: 'bots' };
  return { kind: 'none' };
}

// ---- Clocks -------------------------------------------------------------------

// Same band the room's own clock turns red in (clock-emphasis.ts).
export function isLowClock(remainingMs: number, initialMs: number | null | undefined): boolean {
  if (!initialMs || initialMs <= 0) return false;
  return remainingMs < clockEmergencyMs(initialMs);
}

// Share of the move's allowance left, 0..1, for the correspondence bar. Null when
// the game carries no deadline or no days-per-move allowance.
export function deadlineFractionLeft(
  game: Pick<CurrentGame, 'deadline' | 'timeControl'>,
  now: number,
): number | null {
  const days = game.timeControl?.daysPerMove;
  if (!game.deadline || !days || days <= 0) return null;
  const due = Date.parse(game.deadline.dueAt);
  if (!Number.isFinite(due)) return null;
  return Math.max(0, Math.min(1, (due - now) / (days * 86_400_000)));
}

// ---- Finished boards ----------------------------------------------------------

// ---- In-progress tiles ----------------------------------------------------------

// What an in-progress card draws where the board goes: the server's live board
// when it sent one; the mist for any game it does not call open (live or
// correspondence alike); otherwise the variant placeholder until a board arrives.
export function liveTileKind(
  game: Pick<CurrentGame, 'observe' | 'payload'>,
): 'board' | 'fog' | 'placeholder' {
  if (game.observe !== 'open') return 'fog';
  return game.payload ? 'board' : 'placeholder';
}

// Hidden-identity variants whose finished board /watch already shows publicly,
// drawn here through the same compact showcase renderer and its default view:
// jieqi's as-played board (a piece nobody moved stays face-down) and banqi's
// board (unflipped pieces stay face-down). Both are 'open' to spectators in the
// server's liveObservePolicy. Any other hidden variant fails closed to the mist.
const FINISHED_PUBLIC_VIEW_SPECS: ReadonlySet<string> = new Set(['jieqi', 'banqi']);

// Whether a finished game's tile draws its final position or the misty tile.
// Open-information variants and the public-view list above draw a board; fog
// (dark), other hidden-identity specs, concealed hands and unknown ids keep the
// mist, so this page never decides on its own what a hidden game may reveal.
export function finishedTileKind(variant: string): 'board' | 'fog' {
  const spec = maybeGameSpecForId(variant === 'fog' ? 'dark-chess' : variant);
  if (!spec) return 'fog';
  if (spec.visibility === 'open') return 'board';
  if (spec.visibility === 'hidden-identity' && FINISHED_PUBLIC_VIEW_SPECS.has(spec.id)) {
    return 'board';
  }
  return 'fog';
}
