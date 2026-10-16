/**
 * Xiangqi mahjong wrapped in the shape a live room needs.
 *
 * The engine (xiangqi-mahjong.ts) knows the rules and nothing else. A room also
 * needs seat names on the wire, a move count, who acted and when (a claim comes
 * from the seat whose turn it is not), a pause after each discard, and a pause
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
 * The pause after EVERY discard, claim or not. The window is opened
 * unconditionally because one that opened only when the claimant held a claim
 * told the discarder so. A claimant with nothing to claim passes when the pause
 * ends. One with a claim decides on its own clock, which has run since the
 * discard either way (xmjClockOwner), the way a correspondence claimant decides
 * inside its move: there is no separate claim timer. Its client and the bot
 * hold any earlier answer until the pause ends, so an answer made at once
 * lands at the same moment whether a claim was there or not.
 */
export const XMJ_CLAIM_PAUSE_MS = 1_500;
/** How long the score sits on screen before the next hand deals itself. */
export const XMJ_BETWEEN_HANDS_MS = 30_000;

export const XMJ_CLAIM_KINDS: readonly XmjClaimKind[] = ['win', 'pung', 'chow'];

/** What a client asks to do. Carries no identity and no time. */
export type XmjAction =
  | {
      readonly action: 'discard';
      readonly tile: XmjTile;
      /** The drawn tile has a twin in the hand, and the twin was thrown. */
      readonly handCopy?: true;
    }
  | { readonly action: 'self-draw' }
  | { readonly action: 'claim'; readonly kind: XmjClaimKind; readonly fromHand: readonly XmjTile[] }
  | { readonly action: 'pass' }
  /** This seat has read the score and is ready for the next deal. */
  | { readonly action: 'next-hand' }
  /** A deadline passed (between hands; claim timeouts in older logs). The runtime's move only. */
  | { readonly action: 'timeout' };

/** A move as applied and persisted: `by` and `at` are stamped by the server. */
export type XmjMove = XmjAction & { readonly by: XmjSeat; readonly at: number };

/** Persisted in room-created and never sent to a client: every wall in order. */
export interface XmjRoomSetup {
  readonly walls: readonly (readonly XmjTile[])[];
  readonly firstDealer: XmjSeat;
  /**
   * A days-per-move game. The move deadline is the only clock: the claimant's
   * turn opens with the claim decision (claim or pass, then draw and discard on
   * a pass), with no claim window and no pause, and the next hand deals at
   * once. Absent on a live room's setup.
   */
  readonly correspondence?: boolean;
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
  /**
   * The end of the pause every discard gets (`XMJ_CLAIM_PAUSE_MS`). A window with
   * no claim in it settles here. Null outside a window. Optional so a state
   * built before the field existed still reads.
   */
  readonly claimPauseEndsAt?: number | null;
  /** When the next hand deals itself. Null unless between hands. */
  readonly nextHandAt: number | null;
  /** Seats that have asked for the next deal. Empty unless between hands. */
  readonly ready: readonly XmjSeat[];
  /** A days-per-move game (XmjRoomSetup.correspondence). Optional so older states read. */
  readonly correspondence?: boolean;
}

/**
 * A fresh match setup: one shuffled wall per hand and a random first dealer.
 *
 * A correspondence match always opens with east dealing. The seek seats its
 * first mover in east, and the days-per-move pregame deadline (who owes the
 * first move, then the reply) is read from seat order, so the dealer must be
 * the first seat. The deal still alternates hand by hand.
 */
export function createXmjSetup(
  random: () => number,
  options: { correspondence?: boolean } = {},
): XmjRoomSetup {
  const walls: XmjTile[][] = [];
  for (let i = 0; i < XMJ_MATCH_HANDS; i += 1) walls.push(xmjShuffle(random));
  if (options.correspondence) return { walls, firstDealer: 'east', correspondence: true };
  return { walls, firstDealer: random() < 0.5 ? 'east' : 'west' };
}

const FULL_SET = xmjOrderedTiles().join(',');

/** A persisted setup that is really a set of full walls. */
export function isXmjRoomSetup(value: unknown): value is XmjRoomSetup {
  if (typeof value !== 'object' || value === null) return false;
  const setup = value as Record<string, unknown>;
  if (!isXmjSeat(setup.firstDealer) || !Array.isArray(setup.walls)) return false;
  if (setup.correspondence !== undefined && typeof setup.correspondence !== 'boolean') return false;
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
    claimPauseEndsAt: null,
    nextHandAt: null,
    ready: [],
    ...(setup.correspondence ? { correspondence: true } : {}),
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
 * In a hand: the seat to move, or after a discard the claimant (and the
 * discarder, so older logs with its timeout replay). Between hands: either seat.
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
    // Correspondence deals by itself; nobody presses Next hand (legalFor agrees).
    if (move.action === 'next-hand') return !state.correspondence && !state.ready.includes(move.by);
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
      // A claim with nothing to take settles as the claimant's pass when the
      // pause ends (xmjPendingAction); the discarder's timeout stays legal so
      // older logs, from when a claim had its own deadline, replay.
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
      after = xmjDiscard(hand, move.tile, move.handCopy === true);
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
      claimPauseEndsAt: null,
      nextHandAt: null,
      ready: [],
    };
  }
  const turn = xmjSeatName(match.hand.turn);
  if (match.between) {
    return {
      ...state,
      status: { type: 'playing', turn },
      claimPauseEndsAt: null,
      // Correspondence deals the next hand at once: nobody waits days on a
      // score screen, and nobody has to come back to press Next hand.
      nextHandAt: state.nextHandAt ?? (state.correspondence ? at : at + XMJ_BETWEEN_HANDS_MS),
    };
  }
  // Correspondence has no pause: the claim decision is the claimant's turn,
  // under the move deadline like any other.
  const paused = match.hand.phase.type === 'claim' && !state.correspondence;
  return {
    ...state,
    status: { type: 'playing', turn },
    claimPauseEndsAt: paused ? (state.claimPauseEndsAt ?? at + XMJ_CLAIM_PAUSE_MS) : null,
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
  const pauseEnd = state.claimPauseEndsAt ?? null;
  if (phase.type === 'claim' && pauseEnd !== null) {
    // A claimant with a claim to weigh has no deadline but its own clock.
    if (xmjClaimsOpen(state.match.hand).length > 0) return null;
    // One with nothing to claim passes when the pause ends: the same move, at
    // the same moment, as a claimant who declined at once.
    const by = xmjSeatName(xmjOtherSeat(phase.discarder));
    return { at: pauseEnd, color: by, move: { by, at: pauseEnd, action: 'pass' } };
  }
  return null;
}

/**
 * When a claimant's answer may go out. Every answer to a discard, a human's
 * Pass or a bot's claim, waits for the pause to end: an answer sooner than a
 * claimant with nothing to claim could give would tell the discarder there was
 * something to decide. Null outside a claim window.
 */
export function xmjClaimAnswerEarliestAt(state: XmjRoomState): number | null {
  if (xmjClaimant(state) === null) return null;
  return state.claimPauseEndsAt ?? null;
}

/** How long after the pause an answer still counts as made at once. */
export const XMJ_ANSWER_SNAP_MS = 1_000;

/**
 * The time to stamp on a move made at `now`. An answer to a discard made at
 * once (by the pause end, or within a second of it, which covers a human's
 * deferred pass and the trip to the server) is dated to the pause end, the
 * time the runtime's pass for an empty hand carries. Everything else keeps
 * `now`.
 */
export function xmjAnswerAt(state: XmjRoomState, now: number): number {
  const earliest = xmjClaimAnswerEarliestAt(state);
  if (earliest === null) return now;
  return now >= earliest && now - earliest <= XMJ_ANSWER_SNAP_MS ? earliest : now;
}

function lastResult(match: XmjMatchState): XmjHandResult {
  return match.results[match.results.length - 1] as XmjHandResult;
}

/**
 * The seat whose clock runs: the seat to discard, or after a discard the
 * claimant, who owns the claim decision. Nobody between hands. So the clock
 * passes to the other seat on every discard whether a claim was there or not,
 * and the claimant's claim or pass, draw and discard are one turn on one clock,
 * live and correspondence alike (in correspondence, one move deadline).
 */
export function xmjClockOwner(state: XmjRoomState): XmjSeat | null {
  if (state.status.type !== 'playing' || state.match.between) return null;
  const phase = state.match.hand.phase;
  if (phase.type === 'claim') return xmjSeatName(xmjOtherSeat(phase.discarder));
  return phase.type === 'discard' ? xmjSeatName(state.match.hand.turn) : null;
}

/** A move off the wire. `by` and `at` are placeholders the server overwrites. */
export function xmjMoveFromMessage(message: { action?: string; tiles?: string[] }): XmjMove | null {
  const placeholder = { by: 'east' as XmjSeat, at: 0 };
  const tiles = message.tiles ?? [];
  if (!Array.isArray(tiles) || !tiles.every(isXmjTile)) return null;
  switch (message.action) {
    case 'discard':
    case 'discard-hand': {
      const [tile] = tiles;
      if (tile === undefined || tiles.length !== 1) return null;
      return message.action === 'discard-hand'
        ? { ...placeholder, action: 'discard', tile, handCopy: true }
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
      return isXmjTile(move.tile) && (move.handCopy === undefined || move.handCopy === true);
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
  /**
   * Beside each discard: true when it was the tile just drawn, thrown straight
   * back. Public for both seats, as at a table; it never says where in a
   * concealed hand any other discard sat.
   */
  readonly drawnDiscards: Readonly<Record<XmjSeat, readonly boolean[]>>;
  readonly phase: XmjViewPhase;
  readonly between: boolean;
  readonly ready: readonly XmjSeat[];
  /** End of the pause every discard gets; the claimant's answer waits for it. */
  readonly claimPauseEndsAt: number | null;
  readonly nextHandAt: number | null;
  readonly results: readonly XmjViewResult[];
  readonly legal: XmjLegalActions;
  /** A days-per-move game: no claim window, Pass is always offered to the claimant. */
  readonly correspondence: boolean;
}

function bySeat<T>(pick: (index: XmjSeatIndex) => T): Record<XmjSeat, T> {
  return { east: pick(0), west: pick(1) };
}

function legalFor(state: XmjRoomState, seat: XmjSeat): XmjLegalActions {
  if (state.status.type !== 'playing') return NO_ACTIONS;
  if (state.match.between) {
    // Correspondence deals the next hand itself (xmjPendingAction).
    if (state.correspondence) return NO_ACTIONS;
    return { ...NO_ACTIONS, nextHand: !state.ready.includes(seat) };
  }
  const hand = state.match.hand;
  const index = xmjSeatIndex(seat);
  if (hand.phase.type === 'claim') {
    if (xmjOtherSeat(hand.phase.discarder) !== index) return NO_ACTIONS;
    // Live: nothing to claim, nothing to press; the pause ends in a pass by
    // itself. Correspondence: Pass is always the claimant's to press, so every
    // discard asks for the same answer and the discarder learns nothing.
    const claims = xmjClaimsOpen(hand);
    return { ...NO_ACTIONS, claims, pass: claims.length > 0 || state.correspondence === true };
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
    drawnDiscards: bySeat((i) => hand.drawnDiscards[i]),
    phase: viewPhase(state, perspective),
    between: match.between,
    ready: state.ready,
    claimPauseEndsAt: state.claimPauseEndsAt ?? null,
    nextHandAt: state.nextHandAt,
    results: match.results.map((result) => ({
      dealer: xmjSeatName(result.dealer),
      winner: result.winner === null ? null : xmjSeatName(result.winner),
      selfDrawn: result.selfDrawn,
      score: result.score,
    })),
    legal: perspective === 'spectator' ? NO_ACTIONS : legalFor(state, perspective),
    correspondence: state.correspondence === true,
  };
}

/**
 * The review view: every tile face up at any point of the match, including both
 * concealed hands and the tile just drawn, with no actions and no deadlines.
 * It holds what xmjViewFor withholds while a hand is live, so the server builds
 * it only for a FINISHED match (the postgame route, apps/server
 * routes/xiangqi-mahjong-games.ts), never for a live or between-hands room.
 * The wall stays a count: its order is not shown even here.
 */
export function xmjReviewViewFor(state: XmjRoomState): XmjPlayerView {
  const view = xmjViewFor(state, 'spectator');
  const hand = state.match.hand;
  const phase = hand.phase;
  return {
    ...view,
    hands: bySeat((i) => [...hand.hands[i]]),
    phase:
      phase.type === 'discard'
        ? { type: 'discard', mayWin: phase.mayWin, drawn: phase.drawn }
        : view.phase,
    ready: [],
    claimPauseEndsAt: null,
    nextHandAt: null,
  };
}
