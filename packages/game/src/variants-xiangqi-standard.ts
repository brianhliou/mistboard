// Standard (open-information) Xiangqi — the 9x10 rules engine for ordinary
// Chinese chess. This is the open-info sibling of the Fog-of-War kernel in
// variants-xiangqi.ts and shares its types, coordinate system, initial state,
// and repetition digest.
//
// The critical difference from the FoW kernel: standard play is CHECK-AWARE.
// A move that leaves your own general in check is illegal, generals may not
// face each other across an empty file (flying-general), and the game ends on
// checkmate/stalemate rather than on a literal general capture. We therefore
// drive move generation through elephantops's CHECKED API (`Xiangqi.fromSetup`
// + `position.dests`), NOT the FoW kernel's `setupUnchecked` + `pseudoDests`
// path (which deliberately ignores check — see variants-xiangqi.ts L269-276).
//
// Terminal semantics (xiangqi, not chess):
//   - checkmate  → the side that delivered mate WINS.
//   - stalemate  → the side with NO legal move LOSES (opposite of chess). This
//     is exactly how elephantops's outcome()/isStalemate() score it: both
//     checkmate and stalemate return { winner: opposite(sideToMove) }.
//   - 3-fold repetition / no-progress clock → draw, EXCEPT when the repetition
//     was manufactured by one side's perpetual check: see
//     xiangqiPerpetualCheckLoser below. The tenant reclassifies those as a loss
//     for the checking side ('chasing'), which is what every real xiangqi
//     ruleset (AXF/WXF/CXA) does. This kernel keeps returning 'repetition' so it
//     stays a pure sync function; the override lives in the tenant.

import type { Square as EoSquare } from 'elephantops';
import { makeSquare as eoMakeSquare, parseSquare as eoParseSquare } from 'elephantops/util';
import { Xiangqi as EoXiangqi } from 'elephantops/xiangqi';
import { checkSubjectColor } from './check-subject.js';
import {
  boardToEoBoard,
  createInitialXiangqiState,
  eoToRole,
  positionRepetitionKey,
  type XiangqiBoard,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiGameStatus,
  type XiangqiMove,
  type XiangqiSquare,
} from './variants-xiangqi.js';

// Standard xiangqi shares the whole kernel type surface, including the initial
// state: reuse `createInitialXiangqiState` from variants-xiangqi.ts directly
// (the opening position is identical to the FoW kernel's).

// Plies since the last capture. Matches the FoW kernel's convention.
const DEFAULT_STANDARD_PROGRESS_CLOCK_LIMIT = 60;

export type StandardXiangqiApplyMoveOptions = {
  progressClockLimit?: number;
};

// Open-information player view. Both players see the full truth board; the
// legal-move list is populated only for the side to move.
export type StandardXiangqiPlayerView = {
  id: string;
  perspective: XiangqiColor;
  board: XiangqiBoard;
  legalMoves: XiangqiMove[];
  status: XiangqiGameStatus;
  moveNumber: number;
  lastMove?: XiangqiMove;
};

// ── elephantops boundary (CHECKED path) ─────────────────────────────────────

// Lift a playing state into a validated elephantops Xiangqi position. Unlike
// the FoW kernel we go through `fromSetup`, which enforces the flying-general
// rule and rejects self-check setups. An invalid setup here is a programming
// error (the server only ever holds legal positions), so we throw.
function positionFromStandardState(state: XiangqiGameState): EoXiangqi {
  if (state.status.type !== 'playing') {
    throw new Error('positionFromStandardState requires a playing state');
  }
  const setup = {
    board: boardToEoBoard(state.board),
    turn: state.status.turn,
    halfmoves: state.progressClock,
    fullmoves: state.moveNumber,
  };
  // Result.unwrap() returns the position or throws the PositionError.
  return EoXiangqi.fromSetup(setup).unwrap();
}

// ── Legal move generation (check-filtered) ──────────────────────────────────

export function getStandardXiangqiLegalMoves(state: XiangqiGameState): XiangqiMove[] {
  if (state.status.type !== 'playing') return [];
  const position = positionFromStandardState(state);
  const ctx = position.ctx();
  const moves: XiangqiMove[] = [];
  for (const [sqEo, piece] of position.board) {
    if (piece.color !== position.turn) continue;
    const from = eoMakeSquare(sqEo as EoSquare);
    for (const toEo of position.dests(sqEo as EoSquare, ctx)) {
      moves.push({ from, to: eoMakeSquare(toEo) });
    }
  }
  return moves;
}

export function getStandardXiangqiLegalMovesFrom(
  state: XiangqiGameState,
  from: XiangqiSquare,
): XiangqiMove[] {
  if (state.status.type !== 'playing') return [];
  const position = positionFromStandardState(state);
  const fromEo = eoParseSquare(from);
  if (fromEo === undefined) return [];
  const piece = position.board.get(fromEo);
  if (!piece || piece.color !== state.status.turn) return [];
  const moves: XiangqiMove[] = [];
  for (const toEo of position.dests(fromEo)) {
    moves.push({ from, to: eoMakeSquare(toEo) });
  }
  return moves;
}

export function isStandardXiangqiLegalMove(state: XiangqiGameState, move: XiangqiMove): boolean {
  if (state.status.type !== 'playing') return false;
  const position = positionFromStandardState(state);
  const fromEo = eoParseSquare(move.from);
  const toEo = eoParseSquare(move.to);
  if (fromEo === undefined || toEo === undefined) return false;
  const piece = position.board.get(fromEo);
  if (!piece || piece.color !== state.status.turn) return false;
  return position.dests(fromEo).has(toEo);
}

// ── Apply move + terminal detection ─────────────────────────────────────────
// Order: checkmate > stalemate > 3-fold repetition > progress-clock. A literal
// general capture cannot arise under check-filtered legal play (the mover can
// never leave its own general capturable, and the opponent must always resolve
// a check), so there is no 'general-captured' branch here.

export function applyStandardXiangqiMove(
  state: XiangqiGameState,
  move: XiangqiMove,
  opts: StandardXiangqiApplyMoveOptions = {},
): XiangqiGameState {
  if (state.status.type !== 'playing') return state;
  const mover = state.status.turn;

  const position = positionFromStandardState(state);
  const fromEo = eoParseSquare(move.from);
  const toEo = eoParseSquare(move.to);
  if (fromEo === undefined || toEo === undefined) return state;
  const movingPiece = position.board.get(fromEo);
  if (!movingPiece || movingPiece.color !== mover) return state;
  // Reject illegal moves — return state unchanged (kernel convention).
  if (!position.dests(fromEo).has(toEo)) return state;

  // Read capture BEFORE play() mutates the board (drives the progress clock).
  const wasCapture = state.board[move.to] !== undefined;

  position.play({ from: fromEo, to: toEo });

  const newBoard: XiangqiBoard = {};
  for (const [sqEo, piece] of position.board) {
    newBoard[eoMakeSquare(sqEo as EoSquare)] = {
      color: piece.color,
      role: eoToRole(piece.role),
    };
  }
  const nextTurn = position.turn;
  const newMoveNumber = position.fullmoves;
  const newProgressClock = wasCapture ? 0 : state.progressClock + 1;

  // Position-count bookkeeping (3-fold repetition) reuses the kernel digest.
  const nextStateForKey: XiangqiGameState = {
    ...state,
    board: newBoard,
    status: { type: 'playing', turn: nextTurn },
    moveNumber: newMoveNumber,
    progressClock: newProgressClock,
    lastMove: move,
  };
  const repKey = positionRepetitionKey(nextStateForKey);
  const newPositionCounts = { ...state.positionCounts };
  newPositionCounts[repKey] = (newPositionCounts[repKey] ?? 0) + 1;

  const limit = opts.progressClockLimit ?? DEFAULT_STANDARD_PROGRESS_CLOCK_LIMIT;
  const ctx = position.ctx();
  let nextStatus: XiangqiGameStatus = { type: 'playing', turn: nextTurn };
  if (position.isCheckmate(ctx)) {
    // Side to move (nextTurn) is mated → the mover wins.
    nextStatus = { type: 'finished', winner: mover, reason: 'checkmate' };
  } else if (position.isStalemate(ctx)) {
    // Xiangqi: the side with no legal move LOSES → the mover wins.
    nextStatus = { type: 'finished', winner: mover, reason: 'stalemate' };
  } else if ((newPositionCounts[repKey] ?? 0) >= 3) {
    nextStatus = { type: 'finished', winner: null, reason: 'repetition' };
  } else if (newProgressClock >= limit) {
    nextStatus = { type: 'finished', winner: null, reason: 'progress-clock' };
  }

  return {
    ...state,
    board: newBoard,
    status: nextStatus,
    moveNumber: newMoveNumber,
    progressClock: newProgressClock,
    lastMove: move,
    positionCounts: newPositionCounts,
    moveLog: [...(state.moveLog ?? []), move],
  };
}

// ── Check detection ─────────────────────────────────────────────────────────

// Is `color`'s general currently attacked? Reads through elephantops's checked
// position, so the flying-general rule counts as an attack exactly as it does
// for legality.
export function isStandardXiangqiGeneralInCheck(
  state: XiangqiGameState,
  color: XiangqiColor,
): boolean {
  return isStandardXiangqiGeneralInCheckOnBoard(state.board, color, state);
}

// ── Perpetual-check adjudication ────────────────────────────────────────────

// The headline chasing case: "you cannot perpetual-check your way out of a lost
// game." Every real xiangqi ruleset (AXF/WXF/CXA) scores perpetual check as a
// LOSS for the checking side, where plain chess would allow a repetition draw.
//
// Replays the move list; if the three-fold repetition that ended the game was
// reached by ONE side giving check on every one of its moves in the repeating
// cycle (and the other side not), that side is the perpetual checker and loses.
// Mutual perpetual check and check-free repetitions stay draws, matching the
// published rules. Returns the losing colour, or null to keep the draw.
//
// Deliberate scope limit, mirroring the Fortress kernel
// (fortressXiangqiPerpetualCheckLoser): this is the deterministic, pure-kernel
// subset. Perpetual material *chase* (non-check harassment, which needs "is this
// piece genuinely chased, net of protection and trades") is NOT covered, and
// neither is the checker-versus-chaser tiebreak that depends on it. Those need a
// chase classifier; until one exists a perpetual chase still draws.
export function xiangqiPerpetualCheckLoser(
  moves: readonly XiangqiMove[],
  initialState: XiangqiGameState = createInitialXiangqiState('adjudicate'),
): XiangqiColor | null {
  let state = initialState;
  const plies: { mover: XiangqiColor; gaveCheck: boolean; key: string }[] = [];
  for (const move of moves) {
    if (state.status.type !== 'playing') break;
    const mover = state.status.turn;
    if (!isStandardXiangqiLegalMove(state, move)) return null; // desync — do not adjudicate
    state = applyStandardXiangqiMove(state, move);
    const opponent: XiangqiColor = mover === 'red' ? 'black' : 'red';
    const gaveCheck = isStandardXiangqiGeneralInCheckOnBoard(state.board, opponent, state);
    // Key with the opponent to move, so it is comparable regardless of whether
    // this ply finished the game.
    const key = positionRepetitionKey({
      ...state,
      status: { type: 'playing', turn: opponent },
    });
    plies.push({ mover, gaveCheck, key });
  }
  if (plies.length === 0) return null;
  const repeatedKey = plies[plies.length - 1]!.key;
  const occurrences = plies.flatMap((ply, i) => (ply.key === repeatedKey ? [i] : []));
  if (occurrences.length < 2) return null;
  // The cycle that closed the repetition: the moves after the 2nd-to-last
  // occurrence of the repeated position, through the last occurrence.
  const cycle = plies.slice(occurrences[occurrences.length - 2]! + 1, occurrences.at(-1)! + 1);
  const perpetualBy = (color: XiangqiColor): boolean => {
    const own = cycle.filter((ply) => ply.mover === color);
    return own.length > 0 && own.every((ply) => ply.gaveCheck);
  };
  const redPerpetual = perpetualBy('red');
  const blackPerpetual = perpetualBy('black');
  if (redPerpetual && !blackPerpetual) return 'red';
  if (blackPerpetual && !redPerpetual) return 'black';
  return null;
}

// Check detection against a board that may already belong to a finished state
// (the classifier inspects positions after the game-ending ply).
function isStandardXiangqiGeneralInCheckOnBoard(
  board: XiangqiBoard,
  color: XiangqiColor,
  reference: Pick<XiangqiGameState, 'progressClock' | 'moveNumber'> = {
    progressClock: 0,
    moveNumber: 1,
  },
): boolean {
  const position = EoXiangqi.fromSetup({
    board: boardToEoBoard(board),
    turn: color,
    halfmoves: reference.progressClock,
    fullmoves: reference.moveNumber,
  });
  return position.isOk ? position.unwrap().isCheck() : false;
}

/**
 * The point of the general the board should show in check, or null: the side
 * facing the move (checkSubjectColor) when the standard rules say its general
 * is attacked. Reads only the board, so a client view is enough.
 */
export function standardXiangqiCheckedGeneral(
  board: XiangqiBoard,
  status: XiangqiGameStatus,
): XiangqiSquare | null {
  const color = checkSubjectColor(status);
  if (!color) return null;
  const general = generalSquareOf(board, color);
  if (!general) return null;
  return isStandardXiangqiGeneralInCheckOnBoard(board, color) ? general : null;
}

function generalSquareOf(board: XiangqiBoard, color: XiangqiColor): XiangqiSquare | null {
  for (const [square, piece] of Object.entries(board)) {
    if (piece?.color === color && piece.role === 'general') return square as XiangqiSquare;
  }
  return null;
}

// ── Open-information player view ─────────────────────────────────────────────

export function getStandardXiangqiPlayerView(
  state: XiangqiGameState,
  color: XiangqiColor,
): StandardXiangqiPlayerView {
  const legalMoves =
    state.status.type === 'playing' && state.status.turn === color
      ? getStandardXiangqiLegalMoves(state)
      : [];
  return {
    id: state.id,
    perspective: color,
    // Open info: the whole truth board is shared with both players.
    board: { ...state.board },
    legalMoves,
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
  };
}
