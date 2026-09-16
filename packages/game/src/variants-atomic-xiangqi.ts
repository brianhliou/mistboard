// Atomic Xiangqi — standard xiangqi, and a capture is an explosion.
//
// Atomic Chess (1995, the German Chess Server) removes the capturer, the
// captured piece and every non-pawn on the eight neighbouring squares. This is
// that rule on the xiangqi board, with the answers xiangqi forced out of it.
// The rules are three lines a xiangqi player accepts in one read:
//
//   1. A capture removes the capturing piece, the captured piece, and every
//      piece on the four orthogonally adjacent points. Soldiers survive a
//      blast. A general does not.
//   2. A CANNON's capture removes only the cannon and its target. The shot is
//      at range; the explosion is on contact.
//   3. Everything else is xiangqi: the generals may not face, you may not
//      leave your general where it can be taken, stalemate loses, sixty plies
//      without a capture is a draw, and perpetual check loses. For the
//      perpetual-check law, "check" is any move after which the mover could
//      remove your general with its next move, blast included.
//
// Why those three and not the plain port: docs-private/variant-lab/atomic-
// xiangqi/decisions.md. The short version, because the kernel is where it is
// actually true. The plain port (rule 1 alone, every capture blasting) has a
// forced draw on the advisor files: a chariot on the enemy's d or f file
// threatens to take the advisor and blow up the general beside it, the only
// parry is a cannon block, the block's own shot back over the chariot forces
// the chariot to hop, and the cannon follows. Every alternative for the
// blocker was mate in one; the attacker's alternatives cost a chariot. A
// stronger player forced to repeat with no better option is not a game, so
// that design was killed on 2026-09-14.
//
//   D13. THE CANNON SHOT DOES NOT BLAST. The block still parries (a cannon in
//        front of the chariot on its file stops the chariot short), but the
//        block no longer threatens anything back, so the chariot is never
//        compelled to hop. The compulsion is gone. Measured 2026-09-15: the
//        stronger side wins 19-0-1 at 10x nodes where the plain port drew.
//
//   D14. A BLAST THREAT IS CHECK, for the repetition law only. Xiangqi's
//        perpetual-check law read on what actually kills: a chariot bearing
//        on your advisor is bearing on your general. With D13 alone the
//        chariot could still shuffle on the file and force a repetition draw;
//        with D14 a one-sided shuffle is perpetual check and loses. Legality
//        is unchanged (the general is not "in check" for the purpose of what
//        you may play), but the board shows it as check, because the first
//        repetition loss would otherwise feel like a cheat.
//
//   Not taken: a palace shelter (no blast on a palace point) and unloaded
//   cannons killed the draw and the decisiveness with it; superko works by
//   fiat; armageddon is a format, not a fix.
//
// The geometry, the blast, the check law and the clock all live in
// xiangqi-rule-kernel.ts, configured rather than re-rolled. This module is the
// production shape over it: a status that can be aborted, the end reasons the
// persistence map expects, a player view with a blast-aware check flag and the
// points the last move cleared, so the board can show what the explosion took.
//
// The engine that plays it is Fairy-Stockfish with the patch under
// scripts/variant-lab/patches/, which the lab's perft gate ties to this kernel
// at every rule point.

import type { AbortReason } from './types.js';
import type {
  XiangqiBoard,
  XiangqiColor,
  XiangqiMove,
  XiangqiPiece,
  XiangqiSquare,
} from './variants-xiangqi.js';
import {
  boardAfter,
  canRemoveGeneral,
  createXiangqiRuleKernel,
  generalAttacked,
  type XiangqiRuleConfig,
  type XiangqiRuleState,
  type XiangqiRuleStatus,
} from './xiangqi-rule-kernel.js';

export type AtomicXiangqiColor = XiangqiColor;
export type AtomicXiangqiMove = XiangqiMove;
export type AtomicXiangqiBoard = XiangqiBoard;
export type AtomicXiangqiSquare = XiangqiSquare;

/** The cannon-shot rules (lab fingerprint 045a5cf08c06), and nothing else. */
export const ATOMIC_XIANGQI_RULES = {
  facing: 'file',
  check: 'standard',
  stalemate: 'loss',
  progressClock: 60,
  repetition: 'perpetualCheckLoses',
  repetitionCheck: 'lethal',
  blast: {
    shape: 'orthogonal',
    immune: ['soldier'],
    palaceContained: false,
    shelter: 'none',
    cannonShotBlasts: false,
  },
} as const satisfies XiangqiRuleConfig;

/**
 * The rule kernel behind every function here. Exported for the pieces of the
 * site that speak FEN or UCI to it (the engine bridge, the editor, the replay
 * importer); play goes through the functions below.
 */
export const atomicXiangqiKernel = createXiangqiRuleKernel(ATOMIC_XIANGQI_RULES);

export const ATOMIC_XIANGQI_START_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

export type AtomicXiangqiGameEndReason =
  // The general was blown up or taken. A royal general is never left where it
  // can be captured directly, so in practice this is a blast.
  | 'general-captured'
  | 'checkmate'
  // Xiangqi: the side with no legal move loses.
  | 'stalemate'
  | 'repetition'
  // Three-fold repetition where one side gave (lethal) check on every move of
  // the cycle. Its own reason, not a 'repetition' with a winner: the postgame
  // has to say WHY a repetition was a loss, and persistence maps it to the
  // 'chasing' termination fortress already uses.
  | 'perpetual-check'
  // Sixty plies without a capture. Named as persistence names it, so the
  // tenant's termination map has nothing to translate.
  | 'progress-clock'
  | 'timeout'
  | 'resignation'
  | 'abandonment';

export type AtomicXiangqiGameStatus =
  | { type: 'playing'; turn: AtomicXiangqiColor }
  | { type: 'finished'; winner: AtomicXiangqiColor | null; reason: AtomicXiangqiGameEndReason }
  | { type: 'aborted'; reason: AbortReason };

/** A piece the last move's explosion removed, with where it stood. */
export type AtomicXiangqiBlastVictim = { square: AtomicXiangqiSquare; piece: XiangqiPiece };

export type AtomicXiangqiGameState = Omit<XiangqiRuleState, 'status'> & {
  status: AtomicXiangqiGameStatus;
  /**
   * What the last move's explosion removed: the captured piece and the
   * neighbours that went with it, each where it stood. The capturer is gone
   * too, from `lastMove.from`, and is not listed. Empty after a quiet move.
   * Carried so the board can draw the aftermath rather than have pieces
   * vanish.
   */
  lastBlast: readonly AtomicXiangqiBlastVictim[];
};

/**
 * What a client is shown. Perfect information, so this is the whole truth; it
 * exists to shape the payload, not to hide anything.
 */
export type AtomicXiangqiPlayerView = {
  id: string;
  perspective: AtomicXiangqiColor;
  board: AtomicXiangqiBoard;
  /** For the side to move, whoever is asking. */
  legalMoves: AtomicXiangqiMove[];
  /**
   * The perspective's general can be removed by the opponent's next move:
   * attacked outright, or standing beside a piece the opponent can take. The
   * second half is the blast-aware part, and it is what the board must show,
   * because under the repetition law it is what "check" means.
   */
  inCheck: boolean;
  status: AtomicXiangqiGameStatus;
  moveNumber: number;
  lastMove?: AtomicXiangqiMove;
  lastBlast: readonly AtomicXiangqiBlastVictim[];
};

export function oppositeAtomicXiangqiColor(color: AtomicXiangqiColor): AtomicXiangqiColor {
  return color === 'red' ? 'black' : 'red';
}

// ── State ──────────────────────────────────────────────────────────────────

function fromRuleState(
  state: XiangqiRuleState,
  lastBlast: readonly AtomicXiangqiBlastVictim[],
): AtomicXiangqiGameState {
  const status = state.status;
  if (status.type === 'playing') return { ...state, status, lastBlast };
  return {
    ...state,
    status: { type: 'finished', winner: status.winner, reason: endReasonFor(status) },
    lastBlast,
  };
}

/**
 * The kernel's end reasons, narrowed to the ones this configuration can
 * produce. Anything else is a rule this adapter does not know it enabled, and
 * the alternative to throwing is a termination the persistence map rejects
 * and a finished game with no row (migration 114 is the scar).
 */
function endReasonFor(
  status: Extract<XiangqiRuleStatus, { type: 'finished' }>,
): AtomicXiangqiGameEndReason {
  switch (status.reason) {
    case 'general-captured':
    case 'checkmate':
    case 'stalemate':
      return status.reason;
    case 'repetition':
      return status.winner === null ? 'repetition' : 'perpetual-check';
    case 'progress-clock':
      return 'progress-clock';
    default:
      throw new Error(`atomic-xiangqi: the kernel ended a game by "${status.reason}"`);
  }
}

export function createInitialAtomicXiangqiState(gameId: string): AtomicXiangqiGameState {
  return fromRuleState(atomicXiangqiKernel.initial(gameId), []);
}

/** A playing state from a FEN (kernel field order), or null if it does not parse. */
export function atomicXiangqiStateFromFen(
  fen: string,
  gameId: string,
): AtomicXiangqiGameState | null {
  const state = atomicXiangqiKernel.parseFen(fen, gameId);
  return state ? fromRuleState(state, []) : null;
}

export function atomicXiangqiFen(state: AtomicXiangqiGameState): string {
  return atomicXiangqiKernel.fen(ruleStateOf(state));
}

/**
 * The kernel state under an adapter state. Only a playing state has one: a
 * finished or aborted game is never handed back to the kernel.
 */
function ruleStateOf(state: AtomicXiangqiGameState): XiangqiRuleState {
  const { lastBlast: _lastBlast, ...rest } = state;
  if (state.status.type === 'aborted') {
    throw new Error('atomic-xiangqi: an aborted game has no rule state');
  }
  if (state.status.type === 'finished') {
    // The kernel's reason vocabulary, for the fen/ply helpers only.
    const reason = state.status.reason;
    if (reason === 'timeout' || reason === 'resignation' || reason === 'abandonment') {
      throw new Error(`atomic-xiangqi: a game ended by ${reason} has no rule state`);
    }
    return {
      ...rest,
      status: {
        type: 'finished',
        winner: state.status.winner,
        reason: reason === 'perpetual-check' ? 'repetition' : reason,
      },
    };
  }
  return { ...rest, status: state.status };
}

// ── Moves ──────────────────────────────────────────────────────────────────

export function getAtomicXiangqiLegalMoves(state: AtomicXiangqiGameState): AtomicXiangqiMove[] {
  if (state.status.type !== 'playing') return [];
  return atomicXiangqiKernel.legalMoves(ruleStateOf(state));
}

export function getAtomicXiangqiLegalMovesFrom(
  state: AtomicXiangqiGameState,
  from: AtomicXiangqiSquare,
): AtomicXiangqiMove[] {
  return getAtomicXiangqiLegalMoves(state).filter((move) => move.from === from);
}

export function isAtomicXiangqiLegalMove(
  state: AtomicXiangqiGameState,
  move: AtomicXiangqiMove,
): boolean {
  if (state.status.type !== 'playing') return false;
  return atomicXiangqiKernel.isLegal(ruleStateOf(state), move);
}

/**
 * The board after a move, blast included, and what the blast removed. Does
 * not check legality; the client uses it to preview a capture before sending.
 */
export function atomicXiangqiBoardAfterMove(
  board: AtomicXiangqiBoard,
  move: AtomicXiangqiMove,
): { board: AtomicXiangqiBoard; blast: AtomicXiangqiBlastVictim[] } {
  const after = boardAfter(board, move, atomicXiangqiKernel.rules).board;
  const blast: AtomicXiangqiBlastVictim[] = [];
  if (after[move.to] === undefined) {
    // A capture: the mover is gone from `to`, so every point emptied by this
    // move other than the origin was cleared by the explosion.
    for (const [square, piece] of Object.entries(board) as [AtomicXiangqiSquare, XiangqiPiece][]) {
      if (square === move.from || after[square] !== undefined) continue;
      blast.push({ square, piece });
    }
  }
  return { board: after, blast };
}

export function applyAtomicXiangqiMove(
  state: AtomicXiangqiGameState,
  move: AtomicXiangqiMove,
): AtomicXiangqiGameState {
  if (state.status.type !== 'playing') {
    throw new Error('game is not in progress');
  }
  const rule = ruleStateOf(state);
  if (!atomicXiangqiKernel.isLegal(rule, move)) {
    throw new Error(`illegal move: ${move.from}${move.to}`);
  }
  const { blast } = atomicXiangqiBoardAfterMove(state.board, move);
  return fromRuleState(atomicXiangqiKernel.apply(rule, move), blast);
}

export function finishAtomicXiangqiGame(
  state: AtomicXiangqiGameState,
  winner: AtomicXiangqiColor | null,
  reason: AtomicXiangqiGameEndReason,
): AtomicXiangqiGameState {
  return { ...state, status: { type: 'finished', winner, reason } };
}

export function abortAtomicXiangqiGame(
  state: AtomicXiangqiGameState,
  reason: AbortReason,
): AtomicXiangqiGameState {
  return { ...state, status: { type: 'aborted', reason } };
}

// ── Check ──────────────────────────────────────────────────────────────────

/**
 * Can `color`'s general be removed by the enemy's next move? Attacked
 * directly, or beside a piece the enemy can take. Independent of whose turn
 * it is: after your own move this says the position you left is lost to a
 * blast, which is the state the repetition law calls check.
 */
export function isAtomicXiangqiGeneralInCheck(
  board: AtomicXiangqiBoard,
  color: AtomicXiangqiColor,
): boolean {
  const rules = atomicXiangqiKernel.rules;
  const enemy = oppositeAtomicXiangqiColor(color);
  return generalAttacked(board, color, rules) || canRemoveGeneral(board, enemy, color, rules);
}

// ── View ───────────────────────────────────────────────────────────────────

export function getAtomicXiangqiPlayerView(
  state: AtomicXiangqiGameState,
  perspective: AtomicXiangqiColor,
): AtomicXiangqiPlayerView {
  return {
    id: state.id,
    perspective,
    board: state.board,
    legalMoves: getAtomicXiangqiLegalMoves(state),
    inCheck:
      state.status.type === 'playing' && isAtomicXiangqiGeneralInCheck(state.board, perspective),
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
    lastBlast: state.lastBlast,
  };
}
