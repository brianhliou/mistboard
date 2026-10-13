/**
 * Xiangqi mahjong wrapped in the shape a live room needs.
 *
 * The engine (xiangqi-mahjong.ts) knows the rules and nothing else. A room also
 * needs seat names on the wire, a move count, who acted and when (a claim comes
 * from the seat whose turn it is not), a claim-window deadline, and a pause
 * between hands so both players can read the score before the next deal. This
 * module adds exactly that and no rules of its own.
 *
 * The shape is copied in concept from the Hong Kong tenant state
 * (packages/mahjong/src/tenant-state.ts), not imported: this variant must keep
 * working if that package is deleted.
 */

import {
  isXmjTile,
  XMJ_MATCH_HANDS,
  type XmjClaim,
  type XmjClaimKind,
  type XmjHandResult,
  type XmjMatchState,
  type XmjMeld,
  type XmjScore,
  type XmjSeatIndex,
  type XmjTile,
  xmjAdvance,
  xmjCanDiscard,
  xmjCanSelfDraw,
  xmjClaim,
  xmjClaimsOpen,
  xmjDiscard,
  xmjHandOver,
  xmjMatchWinner,
  xmjNewMatch,
  xmjNextDealer,
  xmjNextHand,
  xmjOrderedTiles,
  xmjOtherSeat,
  xmjPass,
  xmjSelfDraw,
  xmjShuffle,
  xmjSortTiles,
} from './xiangqi-mahjong.js';

/** Seat names on the wire; index matches the engine's 0 and 1. */
export const XMJ_SEATS = ['east', 'west'] as const;
export type XmjSeat = (typeof XMJ_SEATS)[number];

export function xmjSeatIndex(seat: XmjSeat): XmjSeatIndex {
  return seat === 'east' ? 0 : 1;
}
export function xmjSeatName(index: XmjSeatIndex): XmjSeat {
  return index === 0 ? 'east' : 'west';
}
export function isXmjSeat(value: unknown): value is XmjSeat {
  return value === 'east' || value === 'west';
}

/**
 * How long the claimant has to claim or pass a discard. Provisional: longer than
 * Hong Kong's six seconds because the tiles are unfamiliar glyphs, and one of
 * the numbers to ask a player about after a real session.
 */
export const XMJ_CLAIM_WINDOW_MS = 10_000;
/** How long the score sits on screen before the next hand deals itself. */
export const XMJ_BETWEEN_HANDS_MS = 30_000;

export const XMJ_CLAIM_KINDS: readonly XmjClaimKind[] = ['win', 'pung', 'chow'];

/** What a client asks to do. Carries no identity and no time. */
export type XmjAction =
  | { readonly action: 'discard'; readonly tile: XmjTile }
  | { readonly action: 'self-draw' }
  | { readonly action: 'claim'; readonly kind: XmjClaimKind; readonly fromHand: readonly XmjTile[] }
  | { readonly action: 'pass' }
  /** This seat has read the score and is ready for the next deal. */
  | { readonly action: 'next-hand' }
  /** A deadline passed (claim window or between hands). The runtime's move only. */
  | { readonly action: 'timeout' };

/** A move as applied and persisted: `by` and `at` are stamped by the server. */
export type XmjMove = XmjAction & { readonly by: XmjSeat; readonly at: number };

/** Persisted in room-created and never sent to a client: every wall in order. */
export interface XmjRoomSetup {
  readonly walls: readonly (readonly XmjTile[])[];
  readonly firstDealer: XmjSeat;
}

/** Mirrors @mistboard/game's AbortReason (the server tenant checks they agree). */
export type XmjAbortReason = 'pregame-timeout' | 'user-abort' | 'engine-unavailable';

export type XmjRoomStatus =
  | { readonly type: 'playing'; readonly turn: XmjSeat }
  | { readonly type: 'finished'; readonly winner: XmjSeat | null; readonly reason: string }
  | { readonly type: 'aborted'; readonly reason: XmjAbortReason };

export interface XmjRoomState {
  readonly id: string;
  readonly status: XmjRoomStatus;
  readonly moveNumber: number;
  readonly lastMove?: XmjMove;
  readonly match: XmjMatchState;
  /** When the open claim window settles itself. Null outside a window. */
  readonly windowClosesAt: number | null;
  /** When the next hand deals itself. Null unless between hands. */
  readonly nextHandAt: number | null;
  /** Seats that have asked for the next deal. Empty unless between hands. */
  readonly ready: readonly XmjSeat[];
}

/** A fresh match setup: one shuffled wall per hand and a random first dealer. */
export function createXmjSetup(random: () => number): XmjRoomSetup {
  const walls: XmjTile[][] = [];
  for (let i = 0; i < XMJ_MATCH_HANDS; i += 1) walls.push(xmjShuffle(random));
  return { walls, firstDealer: random() < 0.5 ? 'east' : 'west' };
}

const FULL_SET = xmjOrderedTiles().join(',');

/** A persisted setup that is really a set of full walls. */
export function isXmjRoomSetup(value: unknown): value is XmjRoomSetup {
  if (typeof value !== 'object' || value === null) return false;
  const setup = value as Record<string, unknown>;
  if (!isXmjSeat(setup.firstDealer) || !Array.isArray(setup.walls)) return false;
  if (setup.walls.length < 1 || setup.walls.length > XMJ_MATCH_HANDS) return false;
  return setup.walls.every(
    (wall) =>
      Array.isArray(wall) &&
      wall.every(isXmjTile) &&
      xmjSortTiles(wall as XmjTile[]).join(',') === FULL_SET,
  );
}

export function createXmjRoomState(setup: XmjRoomSetup, id = ''): XmjRoomState {
  const match = xmjNewMatch(setup.walls, xmjSeatIndex(setup.firstDealer));
  return {
    id,
    status: { type: 'playing', turn: xmjSeatName(match.hand.turn) },
    moveNumber: 0,
    match,
    windowClosesAt: null,
    nextHandAt: null,
    ready: [],
  };
}

/** The seat that may claim the open discard, or null outside a window. */
export function xmjClaimant(state: XmjRoomState): XmjSeat | null {
  const phase = state.match.hand.phase;
  if (state.match.between || phase.type !== 'claim') return null;
  return xmjSeatName(xmjOtherSeat(phase.discarder));
}

/**
 * May this seat act now?
 *
 * In a hand: the seat to move, or in a claim window the claimant (and the
 * discarder, for the runtime's timeout). Between hands: either seat.
 */
export function xmjSeatMayAct(state: XmjRoomState, seat: XmjSeat): boolean {
  if (state.status.type !== 'playing') return false;
  if (state.match.between) return true;
  const phase = state.match.hand.phase;
  if (phase.type === 'claim') return true;
  return xmjSeatName(state.match.hand.turn) === seat;
}

function sameTiles(a: readonly XmjTile[], b: readonly XmjTile[]): boolean {
  return xmjSortTiles(a).join() === xmjSortTiles(b).join();
}

export function xmjIsLegalMove(state: XmjRoomState, move: XmjMove): boolean {
  if (state.status.type !== 'playing') return false;
  const { match } = state;
  if (match.between) {
    if (move.action === 'next-hand') return !state.ready.includes(move.by);
    return move.action === 'timeout';
  }
  const hand = match.hand;
  const phase = hand.phase;
  const seat = xmjSeatIndex(move.by);
  switch (move.action) {
    case 'discard':
      return hand.turn === seat && xmjCanDiscard(hand, move.tile);
    case 'self-draw':
      return hand.turn === seat && xmjCanSelfDraw(hand);
    case 'pass':
      return phase.type === 'claim' && xmjOtherSeat(phase.discarder) === seat;
    case 'claim':
      return (
        phase.type === 'claim' &&
        xmjOtherSeat(phase.discarder) === seat &&
        xmjClaimsOpen(hand).some(
          (claim) => claim.kind === move.kind && sameTiles(claim.fromHand, move.fromHand),
        )
      );
    case 'timeout':
      return phase.type === 'claim' && phase.discarder === seat;
    default:
      return false;
  }
}

/**
 * Apply a move. Illegal moves return the state unchanged, so replay and the
 * live path cannot diverge on a move the live path refused.
 */
export function applyXmjMove(state: XmjRoomState, move: XmjMove): XmjRoomState {
  if (!xmjIsLegalMove(state, move)) return state;
  const base = { ...state, moveNumber: state.moveNumber + 1, lastMove: move };
  const { match } = state;

  if (match.between) {
    const ready = move.action === 'next-hand' ? [...state.ready, move.by] : [...XMJ_SEATS];
    if (ready.length < XMJ_SEATS.length) return { ...base, ready };
    const next = xmjNextHand(match);
    return withHand({ ...base, match: next, ready: [], nextHandAt: null }, move.at);
  }

  const hand = match.hand;
  let after = hand;
  switch (move.action) {
    case 'discard':
      after = xmjDiscard(hand, move.tile);
      break;
    case 'self-draw':
      after = xmjSelfDraw(hand);
      break;
    case 'claim':
      after = xmjClaim(hand, { kind: move.kind, fromHand: move.fromHand });
      break;
    case 'pass':
    case 'timeout':
      after = xmjPass(hand);
      break;
    default:
      return state;
  }
  return withHand({ ...base, match: xmjAdvance(match, after) }, move.at);
}

/** Set the deadlines and status that follow from the match as it now stands. */
function withHand(state: XmjRoomState, at: number): XmjRoomState {
  const { match } = state;
  if (match.over) {
    const winner = xmjMatchWinner(match);
    return {
      ...state,
      status: {
        type: 'finished',
        winner: winner === null ? null : xmjSeatName(winner),
        reason: winner === null ? 'tie' : 'points',
      },
      windowClosesAt: null,
      nextHandAt: null,
      ready: [],
    };
  }
  const turn = xmjSeatName(match.hand.turn);
  if (match.between) {
    return {
      ...state,
      status: { type: 'playing', turn },
      windowClosesAt: null,
      nextHandAt: state.nextHandAt ?? at + XMJ_BETWEEN_HANDS_MS,
    };
  }
  const inWindow = match.hand.phase.type === 'claim';
  return {
    ...state,
    status: { type: 'playing', turn },
    windowClosesAt: inWindow ? (state.windowClosesAt ?? at + XMJ_CLAIM_WINDOW_MS) : null,
  };
}

/** The runtime's deadline move, if a deadline is pending. */
export function xmjPendingAction(
  state: XmjRoomState,
): { at: number; color: XmjSeat; move: XmjMove } | null {
  if (state.status.type !== 'playing') return null;
  if (state.match.between && state.nextHandAt !== null) {
    const by = xmjSeatName(xmjNextDealer(lastResult(state.match)));
    return {
      at: state.nextHandAt,
      color: by,
      move: { by, at: state.nextHandAt, action: 'timeout' },
    };
  }
  const phase = state.match.hand.phase;
  if (phase.type === 'claim' && state.windowClosesAt !== null) {
    const by = xmjSeatName(phase.discarder);
    return {
      at: state.windowClosesAt,
      color: by,
      move: { by, at: state.windowClosesAt, action: 'timeout' },
    };
  }
  return null;
}

function lastResult(match: XmjMatchState): XmjHandResult {
  return match.results[match.results.length - 1] as XmjHandResult;
}

/** The seat whose clock runs: the seat to discard. Nobody during a window or between hands. */
export function xmjClockOwner(state: XmjRoomState): XmjSeat | null {
  if (state.status.type !== 'playing' || state.match.between) return null;
  return state.match.hand.phase.type === 'discard' ? xmjSeatName(state.match.hand.turn) : null;
}

/** A move off the wire. `by` and `at` are placeholders the server overwrites. */
export function xmjMoveFromMessage(message: { action?: string; tiles?: string[] }): XmjMove | null {
  const placeholder = { by: 'east' as XmjSeat, at: 0 };
  const tiles = message.tiles ?? [];
  if (!Array.isArray(tiles) || !tiles.every(isXmjTile)) return null;
  switch (message.action) {
    case 'discard': {
      const [tile] = tiles;
      return tile === undefined || tiles.length !== 1
        ? null
        : { ...placeholder, action: 'discard', tile };
    }
    case 'self-draw':
      return { ...placeholder, action: 'self-draw' };
    case 'pass':
      return { ...placeholder, action: 'pass' };
    case 'next-hand':
      return { ...placeholder, action: 'next-hand' };
    case 'win':
    case 'pung':
    case 'chow':
      return { ...placeholder, action: 'claim', kind: message.action, fromHand: tiles };
    default:
      // 'timeout' is absent on purpose: only the runtime may end a window.
      return null;
  }
}

/** Structural check for a persisted move (replay validates every event). */
export function isXmjMove(value: unknown): value is XmjMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  if (!isXmjSeat(move.by) || typeof move.at !== 'number') return false;
  switch (move.action) {
    case 'self-draw':
    case 'pass':
    case 'next-hand':
    case 'timeout':
      return true;
    case 'discard':
      return isXmjTile(move.tile);
    case 'claim':
      return (
        XMJ_CLAIM_KINDS.includes(move.kind as XmjClaimKind) &&
        Array.isArray(move.fromHand) &&
        move.fromHand.every(isXmjTile)
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------- views

export type XmjViewPhase =
  | { readonly type: 'discard'; readonly mayWin: boolean; readonly drawn: XmjTile | null }
  | { readonly type: 'claim'; readonly discard: XmjTile; readonly discarder: XmjSeat }
  | {
      readonly type: 'won';
      readonly winner: XmjSeat;
      readonly selfDrawn: boolean;
      readonly winningTile: XmjTile;
      readonly score: XmjScore;
    }
  | { readonly type: 'exhausted' };

export interface XmjViewResult {
  readonly dealer: XmjSeat;
  readonly winner: XmjSeat | null;
  readonly selfDrawn: boolean;
  readonly score: XmjScore | null;
}

/** What this seat may do right now, so a client renders buttons and decides nothing. */
export interface XmjLegalActions {
  readonly discard: readonly XmjTile[];
  readonly selfDraw: boolean;
  readonly claims: readonly XmjClaim[];
  readonly pass: boolean;
  readonly nextHand: boolean;
}

const NO_ACTIONS: XmjLegalActions = {
  discard: [],
  selfDraw: false,
  claims: [],
  pass: false,
  nextHand: false,
};

export interface XmjPlayerView {
  readonly id: string;
  readonly perspective: XmjSeat | 'spectator';
  readonly status: XmjRoomStatus;
  readonly moveNumber: number;
  readonly handNumber: number;
  readonly handsInMatch: number;
  readonly scores: Readonly<Record<XmjSeat, number>>;
  readonly dealer: XmjSeat;
  readonly turn: XmjSeat;
  readonly wallCount: number;
  /** A seat's concealed tiles, or null where this viewer may not see them. */
  readonly hands: Readonly<Record<XmjSeat, readonly XmjTile[] | null>>;
  readonly handCounts: Readonly<Record<XmjSeat, number>>;
  readonly melds: Readonly<Record<XmjSeat, readonly XmjMeld[]>>;
  readonly discards: Readonly<Record<XmjSeat, readonly XmjTile[]>>;
  readonly phase: XmjViewPhase;
  readonly between: boolean;
  readonly ready: readonly XmjSeat[];
  readonly windowClosesAt: number | null;
  readonly nextHandAt: number | null;
  readonly results: readonly XmjViewResult[];
  readonly legal: XmjLegalActions;
}

function bySeat<T>(pick: (index: XmjSeatIndex) => T): Record<XmjSeat, T> {
  return { east: pick(0), west: pick(1) };
}

function legalFor(state: XmjRoomState, seat: XmjSeat): XmjLegalActions {
  if (state.status.type !== 'playing') return NO_ACTIONS;
  if (state.match.between) {
    return { ...NO_ACTIONS, nextHand: !state.ready.includes(seat) };
  }
  const hand = state.match.hand;
  const index = xmjSeatIndex(seat);
  if (hand.phase.type === 'claim') {
    if (xmjOtherSeat(hand.phase.discarder) !== index) return NO_ACTIONS;
    return { ...NO_ACTIONS, claims: xmjClaimsOpen(hand), pass: true };
  }
  if (hand.phase.type !== 'discard' || hand.turn !== index) return NO_ACTIONS;
  return {
    ...NO_ACTIONS,
    discard: [...new Set(hand.hands[index])],
    selfDraw: xmjCanSelfDraw(hand),
  };
}

function viewPhase(state: XmjRoomState, perspective: XmjSeat | 'spectator'): XmjViewPhase {
  const hand = state.match.hand;
  const phase = hand.phase;
  switch (phase.type) {
    case 'discard': {
      // Which tile was just drawn is the drawer's secret.
      const own = perspective !== 'spectator' && xmjSeatIndex(perspective) === hand.turn;
      return { type: 'discard', mayWin: phase.mayWin, drawn: own ? phase.drawn : null };
    }
    case 'claim':
      return { type: 'claim', discard: phase.discard, discarder: xmjSeatName(phase.discarder) };
    case 'won':
      return {
        type: 'won',
        winner: xmjSeatName(phase.winner),
        selfDrawn: phase.selfDrawn,
        winningTile: phase.winningTile,
        score: phase.score,
      };
    case 'exhausted':
      return { type: 'exhausted' };
  }
}

/**
 * The view one seat (or a spectator) may see. The opponent's concealed tiles and
 * the wall stay hidden while a hand is live; once a hand ends both hands turn
 * face up, the way they do at a table.
 */
export function xmjViewFor(state: XmjRoomState, perspective: XmjSeat | 'spectator'): XmjPlayerView {
  const { match } = state;
  const hand = match.hand;
  const revealed = xmjHandOver(hand) || state.status.type !== 'playing';
  return {
    id: state.id,
    perspective,
    status: state.status,
    moveNumber: state.moveNumber,
    handNumber: match.handIndex + 1,
    handsInMatch: Math.min(XMJ_MATCH_HANDS, match.walls.length),
    scores: bySeat((i) => match.scores[i]),
    dealer: xmjSeatName(hand.dealer),
    turn: xmjSeatName(hand.turn),
    wallCount: hand.wall.length,
    hands: bySeat((i) => (revealed || perspective === xmjSeatName(i) ? [...hand.hands[i]] : null)),
    handCounts: bySeat((i) => hand.hands[i].length),
    melds: bySeat((i) => hand.melds[i]),
    discards: bySeat((i) => hand.discards[i]),
    phase: viewPhase(state, perspective),
    between: match.between,
    ready: state.ready,
    windowClosesAt: state.windowClosesAt,
    nextHandAt: state.nextHandAt,
    results: match.results.map((result) => ({
      dealer: xmjSeatName(result.dealer),
      winner: result.winner === null ? null : xmjSeatName(result.winner),
      selfDrawn: result.selfDrawn,
      score: result.score,
    })),
    legal: perspective === 'spectator' ? NO_ACTIONS : legalFor(state, perspective),
  };
}
