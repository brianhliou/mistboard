/**
 * The mahjong kernel wrapped in the shape a live room needs.
 *
 * `MahjongGame` knows the rules and nothing else: it has no notion of a game
 * being won and recorded, of a move count, or of who is still owed an answer to
 * an open claim window. A live room needs all three. This module adds exactly
 * that and no rules of its own, so the kernel stays the only thing that decides
 * what is legal.
 *
 * Two things live here rather than in the kernel on purpose:
 *
 *   - Per-seat answers to a claim window. The kernel's window is all-or-nothing
 *     (`applyPass` closes it for everybody), because at a physical table the
 *     three other players speak at once and a human decides. Over a socket they
 *     arrive one at a time and the room has to remember who has spoken.
 *   - The window's deadline, carried as an absolute server timestamp stamped
 *     onto the discard. State transitions have no clock, and asking for one at
 *     read time would restart the window on every answer.
 */

import {
  type Claim,
  type ClaimKind,
  legalClaims,
  resolveClaims,
  SEATS,
  type Seat,
} from './claims.js';
import {
  applyClaim,
  applyDiscard,
  applyDraw,
  applyPass,
  applySelfDraw,
  dealGame,
  type MahjongGame,
  type WallTile,
} from './game.js';
import type { TileIndex } from './tiles.js';

/** Seat names on the wire. Index matches the kernel's 0-3. */
export const MAHJONG_SEATS = ['east', 'south', 'west', 'north'] as const;
export type MahjongSeat = (typeof MAHJONG_SEATS)[number];

export function seatIndex(seat: MahjongSeat): Seat {
  return MAHJONG_SEATS.indexOf(seat) as Seat;
}
export function seatName(seat: Seat): MahjongSeat {
  return MAHJONG_SEATS[seat] as MahjongSeat;
}

/**
 * How long the table waits for claims on a discard.
 *
 * Long enough to read three unfamiliar tiles and decide, short enough that a
 * hand does not feel like it stalls after every discard. Provisional: this is
 * one of the numbers a player watching real hands should be asked about, since
 * nobody here has sat at a table with a clock on it.
 */
export const CLAIM_WINDOW_MS = 6_000;

/** What a client asks to do. Carries no identity and no time. */
export type MahjongAction =
  | { readonly action: 'draw' }
  | { readonly action: 'discard'; readonly tile: TileIndex }
  | { readonly action: 'claim'; readonly kind: ClaimKind; readonly fromHand: readonly TileIndex[] }
  | { readonly action: 'pass' }
  | { readonly action: 'self-draw' }
  /** The window's deadline passed. Played by the discarder, settles the window. */
  | { readonly action: 'timeout' };

/**
 * A move as it is applied and persisted.
 *
 * `by` and `at` are stamped by the server, never read off the wire. They exist
 * because mahjong is the one variant here where the mover is not implied by the
 * state: a claim arrives from a seat whose turn it is not, so who acted has to
 * travel with the move into the event log to survive replay. `at` is the same
 * story for time - a claim window counts from the discard, and a state
 * transition has no clock.
 */
export type MahjongMove = MahjongAction & {
  readonly by: MahjongSeat;
  readonly at: number;
};

/**
 * Mirrors @mistboard/game's AbortReason, spelled out rather than imported.
 *
 * This package deliberately does not depend on the chess/xiangqi kernel: it is
 * a standalone mahjong implementation and that one import would pull the whole
 * thing in. The server tenant asserts the two agree at compile time, so a new
 * abort reason over there fails the build here rather than drifting.
 */
export type MahjongAbortReason = 'pregame-timeout' | 'user-abort' | 'engine-unavailable';

export type MahjongStatus =
  | { readonly type: 'playing'; readonly turn: MahjongSeat }
  | { readonly type: 'finished'; readonly winner: MahjongSeat | null; readonly reason: string }
  | { readonly type: 'aborted'; readonly reason: MahjongAbortReason };

export interface MahjongTenantState {
  /** Room id. Carried so a per-seat view can identify itself on the wire. */
  readonly id: string;
  readonly status: MahjongStatus;
  readonly moveNumber: number;
  readonly lastMove?: MahjongMove;
  readonly game: MahjongGame;
  /**
   * Answers to the open claim window. A seat absent from the map has not
   * spoken; a seat mapped to null has declined. Empty outside a window.
   */
  readonly answers: Partial<Record<MahjongSeat, Claim | null>>;
  /** Absolute time the open window settles itself. Null outside a window. */
  readonly windowClosesAt: number | null;
}

export function createMahjongState(wall: readonly WallTile[], id = ''): MahjongTenantState {
  const game = dealGame(wall);
  return {
    id,
    status: { type: 'playing', turn: seatName(game.turn) },
    moveNumber: 0,
    game,
    answers: {},
    windowClosesAt: null,
  };
}

/** Seats a claim window is still waiting on: they can claim, and have not spoken. */
export function pendingClaimants(state: MahjongTenantState): MahjongSeat[] {
  const phase = state.game.phase;
  if (phase.type !== 'claim-window') return [];
  return SEATS.filter((seat) => {
    const name = seatName(seat);
    if (name in state.answers) return false;
    return claimsFor(state, seat).length > 0;
  }).map(seatName);
}

/** Every claim this seat could legally make on the open discard. */
export function claimsFor(state: MahjongTenantState, seat: Seat): Claim[] {
  const phase = state.game.phase;
  if (phase.type !== 'claim-window') return [];
  return legalClaims(
    state.game.hands[seat] as readonly number[],
    state.game.melds[seat] as readonly HandSetLike[],
    phase.discard,
    seat,
    phase.discarder,
  );
}
// The kernel's meld type, referenced structurally so this module does not
// re-export it just to name a parameter.
type HandSetLike = Parameters<typeof legalClaims>[1][number];

/**
 * May this seat act now?
 *
 * Outside a claim window this is ordinary alternation. Inside one the window
 * owner (the discarder) may settle it on timeout, and every seat that could
 * legally claim may answer until it has.
 */
export function mahjongSeatMayAct(state: MahjongTenantState, seat: MahjongSeat): boolean {
  if (state.status.type !== 'playing') return false;
  const phase = state.game.phase;
  if (phase.type !== 'claim-window') return state.status.turn === seat;
  if (seat === seatName(phase.discarder)) return true;
  return pendingClaimants(state).includes(seat);
}

export function mahjongIsLegalMove(state: MahjongTenantState, move: MahjongMove): boolean {
  if (state.status.type !== 'playing') return false;
  const phase = state.game.phase;
  switch (move.action) {
    case 'draw':
      return phase.type === 'draw' && state.game.wall.length > 0;
    case 'discard':
      return phase.type === 'discard' && (state.game.hands[state.game.turn]?.[move.tile] ?? 0) > 0;
    case 'self-draw':
      return phase.type === 'discard';
    case 'pass':
      return phase.type === 'claim-window';
    case 'timeout':
      return phase.type === 'claim-window';
    case 'claim':
      return phase.type === 'claim-window';
    default:
      return false;
  }
}

/**
 * Apply a move for `seat`.
 *
 * Claims and passes accumulate: each one records that seat's answer and the
 * window only resolves once nobody is still owed. That is what makes a claim a
 * normal event in the log rather than a special case in the runtime.
 */
export function applyMahjongMove(state: MahjongTenantState, move: MahjongMove): MahjongTenantState {
  const seat = move.by;
  const advanced = (game: MahjongGame, patch: Partial<MahjongTenantState> = {}) =>
    finalize({ ...state, ...patch, game, moveNumber: state.moveNumber + 1, lastMove: move });

  // Window answers are meaningless outside a window. isLegalMove refuses them
  // on the live path, but this module must not depend on its caller for that:
  // applied to a state with no window open, 'pass' would otherwise fall through
  // to settle() and advance the game by a move nobody made.
  const windowOpen = state.game.phase.type === 'claim-window';
  if (
    !windowOpen &&
    (move.action === 'claim' || move.action === 'pass' || move.action === 'timeout')
  ) {
    return state;
  }

  switch (move.action) {
    case 'draw':
      return advanced(applyDraw(state.game));
    case 'discard':
      return advanced(applyDiscard(state.game, move.tile), {
        answers: {},
        windowClosesAt: move.at + CLAIM_WINDOW_MS,
      });
    case 'self-draw':
      return advanced(applySelfDraw(state.game));
    case 'claim': {
      // A seat answers once. seatMayAct already refuses a second answer on both
      // the live path and replay, so this is belt and braces - but without it
      // the module would let a client pung, watch the window stay open because
      // somebody else is slow, and upgrade to a win.
      if (seat in state.answers) return state;
      const claim = matchingClaim(state, seat, move);
      // An unmatched claim is recorded as a decline rather than dropped: the
      // window must still stop waiting on this seat, or a client sending
      // nonsense would hang the table until the timeout.
      return settle({ ...state, answers: { ...state.answers, [seat]: claim } }, move);
    }
    case 'pass':
      if (seat in state.answers) return state;
      return settle({ ...state, answers: { ...state.answers, [seat]: null } }, move);
    case 'timeout': {
      // Everyone still owed an answer is treated as having declined.
      const answers = { ...state.answers };
      for (const name of pendingClaimants(state)) answers[name] = null;
      return settle({ ...state, answers }, move);
    }
    default:
      return state;
  }
}

/** A claim the seat can actually make, matching what they asked for. */
function matchingClaim(
  state: MahjongTenantState,
  seat: MahjongSeat,
  move: Extract<MahjongMove, { action: 'claim' }>,
): Claim | null {
  const wanted = [...move.fromHand].sort((a, b) => a - b).join(',');
  return (
    claimsFor(state, seatIndex(seat)).find(
      (candidate) =>
        candidate.kind === move.kind &&
        [...candidate.fromHand].sort((a, b) => a - b).join(',') === wanted,
    ) ?? null
  );
}

/** Close the window if nobody is still owed an answer; otherwise keep waiting. */
function settle(state: MahjongTenantState, move: MahjongMove): MahjongTenantState {
  const next = { ...state, moveNumber: state.moveNumber + 1, lastMove: move };
  if (next.game.phase.type !== 'claim-window') return finalize(next);
  if (pendingClaimants(next).length > 0) return finalize(next);

  const phase = next.game.phase;
  const claims = Object.values(next.answers).filter((claim): claim is Claim => claim != null);
  const { winners } = resolveClaims(claims, phase.discarder);
  const won = winners[0];
  const game = won ? applyClaim(next.game, won) : applyPass(next.game);
  return finalize({ ...next, game, answers: {}, windowClosesAt: null });
}

/** Project the kernel's phase back onto the room's status. */
function finalize(state: MahjongTenantState): MahjongTenantState {
  const phase = state.game.phase;
  // Narrow on the phase itself rather than isFinished(), which is a boolean and
  // tells the compiler nothing about which terminal phase this is.
  if (phase.type === 'exhausted') {
    return {
      ...state,
      status: { type: 'finished', winner: null, reason: 'exhausted' },
      answers: {},
      windowClosesAt: null,
    };
  }
  if (phase.type === 'won') {
    const winner = phase.winners[0];
    return {
      ...state,
      status: {
        type: 'finished',
        winner: winner === undefined ? null : seatName(winner),
        reason: phase.selfDrawn ? 'self-draw' : 'discard',
      },
      answers: {},
      windowClosesAt: null,
    };
  }
  return { ...state, status: { type: 'playing', turn: seatName(state.game.turn) } };
}
