// Pure logic for /correspondence (correspondence.ts), the correspondence inbox:
// the payload types, the Your move / Waiting split, deadline urgency and the
// time-left bar, which tile a game draws, the open-seek board minus your own
// seeks, and the Start a game request body. DOM-free so it is unit-tested
// directly (correspondence-model.test.ts).

import { maybeGameSpecForId } from '@mistboard/game';
import type { CurrentGame } from './current-games-model.js';

// One in-flight correspondence game, as served by GET /api/correspondence/games.
export type CorrespondenceGame = {
  roomId: string;
  url: string;
  gameSpecId: string;
  mySeat: string;
  isYourMove: boolean;
  opponentName: string | null;
  dueAt: string;
  // The board THIS player's seat sees, exactly the state of that seat's own
  // room snapshot (server: correspondenceSeatBoard). Present only for tenants
  // that opt in (Fog Chess today); read through seatBoardView, never trusted.
  seatBoard?: unknown;
};

export type CorrespondenceGamesResponse = {
  games: CorrespondenceGame[];
  yourMoveCount: number;
};

// Move order, not color (server migration 106): seeks are variant-neutral, and
// the label is resolved per variant at render time.
export type SeekPreferredColor = 'first' | 'second' | 'random';

// One public-board seek, as served by GET /api/correspondence/seeks.
export type OpenSeek = {
  id: string;
  gameSpecId: string;
  daysPerMove: number;
  preferredColor: SeekPreferredColor;
  creatorName: string | null;
  createdAt: string;
  isMine: boolean;
};

// One invitation THIS player sent, as served by GET /api/correspondence/seeks/mine.
// Unlike the public board this includes link and directed challenges, which is
// the point: before #353 a link challenge appeared nowhere its creator could see
// it and could not be cancelled.
export type OutgoingSeek = {
  id: string;
  gameSpecId: string;
  daysPerMove: number;
  preferredColor: SeekPreferredColor;
  visibility: 'public' | 'private';
  targetName: string | null;
  challengeUrl: string | null;
  expiresAt: string | null;
  createdAt: string;
};

// ---- Your move / Waiting ------------------------------------------------------

export type InboxSections<T> = { yourMove: T[]; waiting: T[] };

// Soonest deadline first in both groups; a row with an unreadable deadline sinks.
export function splitInbox<T extends Pick<CorrespondenceGame, 'isYourMove' | 'dueAt'>>(
  games: readonly T[],
): InboxSections<T> {
  const due = (game: T): number => {
    const at = Date.parse(game.dueAt);
    return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
  };
  const sorted = [...games].sort((a, b) => due(a) - due(b));
  return {
    yourMove: sorted.filter((game) => game.isYourMove),
    waiting: sorted.filter((game) => !game.isYourMove),
  };
}

// ---- Deadlines ------------------------------------------------------------------

// Under a day left on the move turns the countdown amber.
export const URGENT_DEADLINE_MS = 24 * 60 * 60 * 1000;

export type DeadlineUrgency = 'due' | 'urgent' | 'calm';

// Milliseconds until the per-move deadline, clamped at 0; null when unreadable.
export function deadlineRemainingMs(dueAt: string, now: number): number | null {
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return null;
  return Math.max(0, due - now);
}

// 'due' once the deadline has passed (the sweeper flags the room within its
// interval), 'urgent' inside the last day, otherwise 'calm'. An unreadable
// deadline reads calm rather than alarming.
export function deadlineUrgency(dueAt: string, now: number): DeadlineUrgency {
  const remaining = deadlineRemainingMs(dueAt, now);
  if (remaining === null) return 'calm';
  if (remaining <= 0) return 'due';
  if (remaining < URGENT_DEADLINE_MS) return 'urgent';
  return 'calm';
}

// Share of the move's allowance left, 0..1, for the deadline bar. Null without a
// days-per-move allowance (the card then shows no bar rather than a guess).
export function deadlineFraction(
  dueAt: string,
  daysPerMove: number | null | undefined,
  now: number,
): number | null {
  const remaining = deadlineRemainingMs(dueAt, now);
  if (remaining === null || !daysPerMove || daysPerMove <= 0) return null;
  return Math.min(1, remaining / (daysPerMove * 86_400_000));
}

// ---- Boards ---------------------------------------------------------------------

// The public current-games feed carries every correspondence game in play, with
// a board payload only for games it calls 'open'. Keyed by room id so the inbox
// can find its own games in it.
export function indexByRoom<T extends Pick<CurrentGame, 'roomId'>>(
  games: readonly T[],
): Map<string, T> {
  return new Map(games.map((game) => [game.roomId, game]));
}

// The specs whose per-seat board the inbox knows how to draw, and with what:
// the fog games, whose public feed carries no board. Fog Chess draws on the
// dark-chess SVG board, Fog Xiangqi on the fog xiangqi board, each fed the
// seat's own PlayerView. A seatBoard on any other spec is ignored.
export const SEAT_BOARD_SPECS: ReadonlySet<string> = new Set(['dark-chess', 'dark-xiangqi']);

type SeatBoardSquare = Record<string, unknown> | undefined;

export type DarkChessSeatBoardView = {
  board: Record<string, { color: string; role: string } | undefined>;
  visibleSquares: string[];
  perspective: 'white' | 'black';
  lastMove?: { from: string; to: string };
};

export type DarkXiangqiSeatBoardView = {
  id: string;
  board: Record<string, SeatBoardSquare>;
  visibleSquares: string[];
  perspective: 'red' | 'black';
  legalMoves: unknown[];
  status: { type: string };
  moveNumber: number;
  lastMove?: { from: string; to: string };
  captures: { red: string[]; black: string[] };
};

export type SeatBoardView =
  | { kind: 'dark-chess'; view: DarkChessSeatBoardView }
  | { kind: 'dark-xiangqi'; view: DarkXiangqiSeatBoardView };

// The seat's own board when it is one the inbox can draw, else null. Shape
// checked so a malformed payload falls back to the mist instead of throwing.
export function seatBoardView(
  game: Pick<CorrespondenceGame, 'gameSpecId' | 'seatBoard'> & { roomId?: string },
): SeatBoardView | null {
  if (!SEAT_BOARD_SPECS.has(game.gameSpecId)) return null;
  const view = game.seatBoard as Record<string, unknown> | null | undefined;
  if (!view || typeof view !== 'object') return null;
  if (!view.board || typeof view.board !== 'object') return null;
  if (!Array.isArray(view.visibleSquares)) return null;
  if (game.gameSpecId === 'dark-chess') {
    if (view.perspective !== 'white' && view.perspective !== 'black') return null;
    return { kind: 'dark-chess', view: view as unknown as DarkChessSeatBoardView };
  }
  // Fog Xiangqi: the renderer also reads status, the capture ledger and an id
  // for its fog mask; anything missing gets a harmless default, never a throw.
  if (view.perspective !== 'red' && view.perspective !== 'black') return null;
  const status =
    view.status && typeof view.status === 'object' ? (view.status as { type: string }) : null;
  if (!status || typeof status.type !== 'string') return null;
  const captures = view.captures as { red?: unknown; black?: unknown } | undefined;
  return {
    kind: 'dark-xiangqi',
    view: {
      ...(view as unknown as DarkXiangqiSeatBoardView),
      id: typeof view.id === 'string' && view.id ? view.id : (game.roomId ?? 'seat-board'),
      legalMoves: [],
      moveNumber: typeof view.moveNumber === 'number' ? view.moveNumber : 1,
      captures: {
        red: Array.isArray(captures?.red) ? (captures.red as string[]) : [],
        black: Array.isArray(captures?.black) ? (captures.black as string[]) : [],
      },
    },
  };
}

// The visibility classes whose public board the inbox may draw. 'open' hides
// nothing. 'hidden-identity' (jieqi, banqi, Flip Jungle) hides which piece a
// face-down tile is, from both players; the server's watch policy serves those
// live through a public view (the shared mask, never a seat's private
// knowledge), the same board /games and TV already show. Fog ('dark') and
// concealed hands are never drawn from the feed.
const FEED_BOARD_VISIBILITIES: ReadonlySet<string> = new Set(['open', 'hidden-identity']);

// What a card draws where the board goes. A board only when the public feed
// sent one for a game it calls 'open' (the same position anyone watching sees).
// Fail-closed twice: the spec's visibility class must be one the feed may draw
// (fog never is, whatever the feed says), and a hidden-identity game needs the
// feed's own 'open' verdict before it gets a board, so an unclassified one stays
// misty. An unknown spec id gets the mist. A drawable game with no payload yet
// gets the variant placeholder.
export function inboxTileKind(
  gameSpecId: string,
  current: Pick<CurrentGame, 'observe' | 'payload'> | null | undefined,
): 'board' | 'fog' | 'placeholder' {
  const spec = maybeGameSpecForId(gameSpecId);
  if (!spec || !FEED_BOARD_VISIBILITIES.has(spec.visibility)) return 'fog';
  if (current && current.observe !== 'open') return 'fog';
  if (spec.visibility !== 'open' && current?.observe !== 'open') return 'fog';
  return current?.payload ? 'board' : 'placeholder';
}

// The hero's variant fact: every eligible variant by name while the list is
// short, otherwise the first two and a count, so the chip never wraps into a
// paragraph. Derived from the list, never written out.
export function variantFact(
  labels: readonly string[],
): { kind: 'all'; text: string } | { kind: 'more'; shown: string; more: number } {
  if (labels.length <= 3) return { kind: 'all', text: labels.join(' · ') };
  return { kind: 'more', shown: labels.slice(0, 2).join(', '), more: labels.length - 2 };
}

// ---- Open seeks -------------------------------------------------------------------

// Other players' public seeks: your own are in "Your challenges" with a Cancel
// button, so the board never offers you an Accept you cannot use.
export function othersSeeks<T extends Pick<OpenSeek, 'isMine'>>(seeks: readonly T[]): T[] {
  return seeks.filter((seek) => !seek.isMine);
}

// ---- Start a game ---------------------------------------------------------------

// Who the new game is for, matching the server's three seek kinds: the public
// board (anyone), a private share link, or a directed challenge to one player.
export type SeekKind = 'public' | 'link' | 'direct';

export const SEEK_KINDS: readonly SeekKind[] = ['public', 'link', 'direct'];

export type StartGameInput = {
  gameSpecId: string;
  daysPerMove: number;
  preferredColor: SeekPreferredColor;
  kind: SeekKind;
  handle?: string;
};

// The POST /api/correspondence/seeks body for the Start a game form, or an error
// the form shows before sending. A handle may be typed with its leading @.
export function seekRequestBody(
  input: StartGameInput,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: 'handle_required' } {
  const base = {
    gameSpecId: input.gameSpecId,
    daysPerMove: input.daysPerMove,
    preferredColor: input.preferredColor,
  };
  if (input.kind === 'link') return { ok: true, body: { ...base, visibility: 'private' } };
  if (input.kind === 'direct') {
    const handle = (input.handle ?? '').trim().replace(/^@+/, '');
    if (!handle) return { ok: false, error: 'handle_required' };
    return { ok: true, body: { ...base, targetHandle: handle } };
  }
  return { ok: true, body: base };
}

// ---- Signed-out showcase ------------------------------------------------------

// Every correspondence game in progress, from the public current-games feed, in
// the feed's order (soonest deadline first).
export function correspondenceInProgress<T extends Pick<CurrentGame, 'timeClass'>>(
  games: readonly T[],
): T[] {
  return games.filter((game) => game.timeClass === 'correspondence');
}

// The game the hero draws: the first one the public feed sent an open board
// for. Null means the hero shows a starting position instead.
export function heroBoardGame<T extends Pick<CurrentGame, 'observe' | 'payload' | 'gameSpecId'>>(
  games: readonly T[],
): T | null {
  return (
    games.find((game) => inboxTileKind(game.gameSpecId, game) === 'board' && !!game.payload) ?? null
  );
}
