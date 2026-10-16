// Pure logic for /games (current-games.ts): the payload types, the Live /
// Correspondence split, clock urgency, the correspondence time-left bar and
// the tile kinds. DOM-free so it is unit-tested directly
// (current-games-model.test.ts).

import { CRAZYHOUSE_XIANGQI_SPEC_ID, maybeGameSpecForId } from '@mistboard/game';
import { clockEmergencyMs } from './clock-emphasis.js';

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

// Whether a live board card (this page and the correspondence inbox) keeps a
// drop variant's hands, drawn as a band above and below the board the way the
// game embed draws them (current-games.css). Crazyhouse Xiangqi starts with
// both sides' advisors and elephants in hand and drops are most of its play,
// so a bare board misstates the position. Every other variant keeps the card's
// bare board (the renderer's hideReserve).
export function liveCardShowsHands(gameSpecId: string): boolean {
  return gameSpecId === CRAZYHOUSE_XIANGQI_SPEC_ID;
}

// Hidden-identity variants whose finished board /watch already shows publicly,
// drawn here through the same compact showcase renderer and its default view:
// jieqi's as-played board (a piece nobody moved stays face-down), and banqi's
// and Flip Jungle's boards (unflipped pieces stay face-down). All three are
// 'open' to spectators in the server's liveObservePolicy and have a /watch
// channel.
const FINISHED_PUBLIC_VIEW_SPECS: ReadonlySet<string> = new Set(['jieqi', 'banqi', 'jungle-flip']);

// Whether a finished game's tile draws its final position or the misty tile.
// Open-information variants and the public-view list above draw a board, and so
// do the fog variants (Fog Chess, Fog Xiangqi): the server opens every finished
// room in full to spectators (roomViewPolicy, 2026-09-06), and the showcase
// renderer reveals the board at the end (revealOnFinish). Concealed hands and
// unknown ids keep the mist, so this page never decides on its own what a
// hidden game may reveal.
export function finishedTileKind(variant: string): 'board' | 'fog' {
  const spec = maybeGameSpecForId(variant === 'fog' ? 'dark-chess' : variant);
  if (!spec) return 'fog';
  if (spec.visibility === 'open' || spec.visibility === 'dark') return 'board';
  if (spec.visibility === 'hidden-identity' && FINISHED_PUBLIC_VIEW_SPECS.has(spec.id)) {
    return 'board';
  }
  return 'fog';
}

// How every "Just finished" thumbnail mounts (current-games.ts
// mountFinishedBoard): the chess renderer turned to White, a fog game drawn
// with the fog off (Fog Chess reveals through revealOnFinish instead), and any
// other tenant left to its compact pick (the truth or as-played masked board,
// turned to Red).
export const FINISHED_BOARD_POV = 'white' as const;

export function finishedBoardTenantPov(variant: string): 'truth' | null {
  const spec = maybeGameSpecForId(variant === 'fog' ? 'dark-chess' : variant);
  return spec?.visibility === 'dark' ? 'truth' : null;
}

// A seat in move order: 'first' is Red / White, 'second' Black.
export type BoardSeat = 'first' | 'second';

// The seat those settings put at the bottom of the thumbnail on every renderer:
// the first mover (White on the chess path, Red on every tenant). The card's
// names follow it until the board mounts, then follow the mounted board's own
// bottomSeat() (current-games-finished-seats.test.ts pins the two together).
export const FINISHED_BOARD_BOTTOM_SEAT: BoardSeat = 'first';

// The two name rows of a finished card, top then bottom: the seat at the bottom
// of the thumbnail goes below it, the other above.
export function seatsTopToBottom<T>(seats: readonly [T, T], bottomSeat: BoardSeat): [T, T] {
  const [first, second] = seats;
  return bottomSeat === 'first' ? [second, first] : [first, second];
}

// "Just finished" reads the cross-variant feed without the Featured channel's
// 20-ply bar: a game that leaves the wall must land here however short it was.
export const FINISHED_POOL_URL = '/api/watch?channel=top&curated=0';

// Whether the finished pool is due a re-read. Normally once per `ttlMs`; while a
// game that left the wall is awaited, on every poll (the half-poll floor keeps
// the re-render a fetch triggers from fetching again at once).
export function finishedPoolDue(
  ageMs: number,
  awaitingCount: number,
  pollMs: number,
  ttlMs: number,
): boolean {
  return ageMs > (awaitingCount > 0 ? pollMs / 2 : ttlMs);
}

// Drop the awaited games that reached the pool, and the ones whose wait ran out
// (a private game, or an abort with no moves, never will).
export function settleAwaitingFinish(
  awaiting: Map<string, number>,
  pool: readonly { roomId: string }[],
  now: number,
): void {
  const arrived = new Set(pool.map((game) => game.roomId));
  for (const [roomId, giveUpAt] of awaiting) {
    if (arrived.has(roomId) || now > giveUpAt) awaiting.delete(roomId);
  }
}
