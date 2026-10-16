// FoW Xiangqi — parallel module, no shared types with chess.
// Wraps the `elephantops` library for rules (chessops-port for xiangqi).
// See docs-private/fog-of-war/library/variants/fow-xiangqi.md for the full design.
//
// Public types use xiangqi vocabulary (general / soldier / etc.) for readability
// in content, UI, and playtest. Translation to elephantops's chess vocabulary
// (king / pawn) happens at the boundary in `eo*` helpers below.
//
// Coordinate system matches elephantops:
//   - 9 files (a..i) × 10 ranks (1..10) — standard xiangqi/WXF notation
//   - Internal numeric square: file + 9 * (rank - 1), range 0..89
//   - Rank 1 = red back rank, rank 10 = black back rank
//   - River sits between ranks 5 and 6

import type {
  Color as EoColor,
  Role as EoRole,
  Square as EoSquare,
  SquareName as EoSquareName,
} from 'elephantops';
import { Board as EoBoard } from 'elephantops/board';
import { makeSquare as eoMakeSquare, parseSquare as eoParseSquare } from 'elephantops/util';
import { Xiangqi as EoXiangqi } from 'elephantops/xiangqi';
import type { AbortReason } from './types.js';
import {
  cannonVisionInto,
  emptyVision,
  horseVisionInto,
  type VisionAccum as KernelVisionAccum,
  ORTHOGONAL_STEPS,
  slideVisionInto,
  type VisionProbe,
} from './xiangqi-vision-kernel.js';

export type XiangqiColor = EoColor; // 'red' | 'black'

export type XiangqiPieceRole =
  | 'general'
  | 'advisor'
  | 'elephant'
  | 'horse'
  | 'chariot'
  | 'cannon'
  | 'soldier';

export type XiangqiPiece = {
  color: XiangqiColor;
  role: XiangqiPieceRole;
};

// File 0..8, rank 1..10. Stored as plain numbers; constrain via helpers.
export type XiangqiCoord = { file: number; rank: number };

// Algebraic square names, matches elephantops `SquareName`.
export type XiangqiSquare = EoSquareName;

export type XiangqiBoard = Partial<Record<XiangqiSquare, XiangqiPiece>>;

export type XiangqiMove = {
  from: XiangqiSquare;
  to: XiangqiSquare;
};

// Cannon-vision toggle (see docs-private/fog-of-war/library/variants/fow-xiangqi.md §1)
//   A — screen + target both fully revealed
//   B — screen + target both shrouded (occupancy only)
//   C — screen revealed with type, target shrouded
//   D — screen shrouded with ? marker, target revealed (inverse of C —
//       "you see what you can land on, not what enables the line")
//   E — screen is FOGGED (dropped from visibleSquares, no ? marker); target
//       revealed. Empty gap squares between screen and target stay fogged in
//       every mode because the cannon cannot legally land there.
export type XiangqiCannonVisionMode = 'A' | 'B' | 'C' | 'D' | 'E';

export type XiangqiVisibleBoardEntry = {
  piece: XiangqiPiece;
  // true => only "enemy occupancy" should be shown to the perspective player;
  // false => render with full piece type
  shrouded: boolean;
};

export type XiangqiPlayerBoard = Partial<Record<XiangqiSquare, XiangqiVisibleBoardEntry>>;

export type XiangqiPlayerView = {
  id: string;
  perspective: XiangqiColor;
  board: XiangqiPlayerBoard;
  visibleSquares: XiangqiSquare[];
  legalMoves: XiangqiMove[];
  status: XiangqiGameStatus;
  moveNumber: number;
  lastMove?: XiangqiMove;
};

export type XiangqiGameEndReason =
  | 'general-captured'
  | 'checkmate'
  | 'stalemate'
  | 'timeout'
  | 'resignation'
  | 'abandonment'
  | 'repetition'
  // Perpetual check: a repetition one side manufactured by checking on every
  // move of the cycle. Xiangqi scores it as a LOSS for the checker, not a draw.
  // Standard play only — the FoW kernel does not adjudicate it.
  | 'chasing'
  | 'progress-clock';

/**
 * End reasons this kernel decides on its own but a human arbiter decides in real
 * play. Xiangqi's perpetual-check/chase (长打) rules mean a repetition is not
 * automatically a draw, and a long endgame outlasts the progress clock without
 * the game being over, so tournament RECORDS run straight past both.
 *
 * Anything replaying a finished record -- broadcast ingestion, notation, export
 * -- must continue past these. Anything adjudicating LIVE play must not.
 * Checkmate and stalemate are deliberately absent: no ruleset lets play go on.
 */
export const ARBITER_ADJUDICATED_DRAWS: ReadonlySet<XiangqiGameEndReason> =
  new Set<XiangqiGameEndReason>(['repetition', 'progress-clock']);

export type XiangqiGameStatus =
  | { type: 'playing'; turn: XiangqiColor }
  | { type: 'finished'; winner: XiangqiColor | null; reason: XiangqiGameEndReason }
  | { type: 'aborted'; reason: AbortReason };

export type XiangqiGameState = {
  id: string;
  board: XiangqiBoard;
  status: XiangqiGameStatus;
  moveNumber: number;
  // Plies since last capture. Powers the progress-clock draw.
  progressClock: number;
  lastMove?: XiangqiMove;
  // True-position repetition counts. Keyed by a canonical position digest.
  positionCounts: Record<string, number>;
  // Move history, appended by the STANDARD kernel only (variants-xiangqi-standard.ts).
  // It exists so perpetual-check adjudication can replay the game at the moment a
  // repetition fires, with no shared-runtime change and identical results on event
  // replay. The FoW kernel never populates it, so it stays undefined for dark
  // xiangqi. No PlayerView builder spreads state, so it cannot reach a client.
  moveLog?: readonly XiangqiMove[];
};

// ── Role translation ───────────────────────────────────────────────────────
// elephantops uses chess vocabulary; we keep xiangqi names in our types.

const ROLE_TO_EO: Record<XiangqiPieceRole, EoRole> = {
  general: 'king',
  advisor: 'advisor',
  elephant: 'elephant',
  horse: 'horse',
  chariot: 'chariot',
  cannon: 'cannon',
  soldier: 'pawn',
};

const EO_TO_ROLE: Record<EoRole, XiangqiPieceRole> = {
  king: 'general',
  advisor: 'advisor',
  elephant: 'elephant',
  horse: 'horse',
  chariot: 'chariot',
  cannon: 'cannon',
  pawn: 'soldier',
};

export function roleToEo(role: XiangqiPieceRole): EoRole {
  return ROLE_TO_EO[role];
}

export function eoToRole(role: EoRole): XiangqiPieceRole {
  return EO_TO_ROLE[role];
}

// ── Coordinate helpers ─────────────────────────────────────────────────────

const FILE_CHARS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;

export function squareOf(file: number, rank: number): XiangqiSquare {
  if (file < 0 || file > 8 || rank < 1 || rank > 10) {
    throw new RangeError(`xiangqi coord out of range: file=${file} rank=${rank}`);
  }
  return `${FILE_CHARS[file]}${rank}` as XiangqiSquare;
}

export function coordOf(square: XiangqiSquare): XiangqiCoord {
  const file = FILE_CHARS.indexOf(square[0] as (typeof FILE_CHARS)[number]);
  const rank = Number(square.slice(1));
  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > 10) {
    throw new RangeError(`invalid xiangqi square: ${square}`);
  }
  return { file, rank };
}

export function inBounds(file: number, rank: number): boolean {
  return file >= 0 && file <= 8 && rank >= 1 && rank <= 10;
}

// Palace = 3×3 box at the back of each side.
//   Red palace: files d..f (3..5), ranks 1..3
//   Black palace: files d..f (3..5), ranks 8..10
export function inPalace(color: XiangqiColor, file: number, rank: number): boolean {
  if (file < 3 || file > 5) return false;
  return color === 'red' ? rank <= 3 : rank >= 8;
}

// "Own half" = side of the river belonging to `color`.
//   Red: ranks 1..5
//   Black: ranks 6..10
export function inOwnHalf(color: XiangqiColor, rank: number): boolean {
  return color === 'red' ? rank <= 5 : rank >= 6;
}

export function hasCrossedRiver(color: XiangqiColor, rank: number): boolean {
  return !inOwnHalf(color, rank);
}

// ── Initial state ──────────────────────────────────────────────────────────

export function createInitialXiangqiBoard(): XiangqiBoard {
  const board: XiangqiBoard = {};
  const backRank: XiangqiPieceRole[] = [
    'chariot',
    'horse',
    'elephant',
    'advisor',
    'general',
    'advisor',
    'elephant',
    'horse',
    'chariot',
  ];
  for (let f = 0; f < 9; f++) {
    board[squareOf(f, 1)] = { color: 'red', role: backRank[f] };
    board[squareOf(f, 10)] = { color: 'black', role: backRank[f] };
  }
  // Cannons
  board[squareOf(1, 3)] = { color: 'red', role: 'cannon' };
  board[squareOf(7, 3)] = { color: 'red', role: 'cannon' };
  board[squareOf(1, 8)] = { color: 'black', role: 'cannon' };
  board[squareOf(7, 8)] = { color: 'black', role: 'cannon' };
  // Soldiers (a, c, e, g, i files)
  for (const f of [0, 2, 4, 6, 8]) {
    board[squareOf(f, 4)] = { color: 'red', role: 'soldier' };
    board[squareOf(f, 7)] = { color: 'black', role: 'soldier' };
  }
  return board;
}

export function createInitialXiangqiState(gameId: string): XiangqiGameState {
  const base: XiangqiGameState = {
    id: gameId,
    board: createInitialXiangqiBoard(),
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
  // Seed the position-count for the starting position so 3-fold detection
  // includes the initial state.
  return {
    ...base,
    positionCounts: { [positionRepetitionKey(base)]: 1 },
  };
}

// ── elephantops boundary ───────────────────────────────────────────────────
// These translate our XiangqiBoard <-> elephantops Board and lift our state
// into an elephantops Xiangqi position so we can reuse its move generator.

export function boardToEoBoard(board: XiangqiBoard): EoBoard {
  const eo = EoBoard.empty();
  for (const [sq, piece] of Object.entries(board)) {
    if (!piece) continue;
    const eoSq = eoParseSquare(sq);
    if (eoSq === undefined) throw new Error(`bad square: ${sq}`);
    eo.set(eoSq, { color: piece.color, role: roleToEo(piece.role) });
  }
  return eo;
}

function positionFromState(state: XiangqiGameState): EoXiangqi {
  if (state.status.type !== 'playing') {
    throw new Error('positionFromState requires a playing state');
  }
  const setup = {
    board: boardToEoBoard(state.board),
    turn: state.status.turn,
    halfmoves: state.progressClock,
    fullmoves: state.moveNumber,
  };
  // FoW xiangqi ignores check: side-to-move may sit in check, kings may
  // face each other across an empty file, and the previous mover may have
  // exposed their own general. Standard `Xiangqi.fromSetup` rejects those
  // as IllegalSetup, so we bypass it via the unchecked path.
  const pos = EoXiangqi.default();
  (pos as unknown as { setupUnchecked: (s: typeof setup) => void }).setupUnchecked(setup);
  return pos;
}

function oppositeXiangqiColor(color: XiangqiColor): XiangqiColor {
  return color === 'red' ? 'black' : 'red';
}

function facingGeneralCaptureTarget(
  board: XiangqiBoard,
  from: XiangqiSquare,
  piece: XiangqiPiece,
): XiangqiSquare | null {
  if (piece.role !== 'general') return null;
  const origin = coordOf(from);
  for (const [sq, target] of Object.entries(board)) {
    if (target?.role !== 'general' || target.color === piece.color) continue;
    const enemy = coordOf(sq as XiangqiSquare);
    if (enemy.file !== origin.file) continue;
    const minR = Math.min(origin.rank, enemy.rank);
    const maxR = Math.max(origin.rank, enemy.rank);
    let clear = true;
    for (let rank = minR + 1; rank < maxR; rank += 1) {
      if (isOccupied(board, origin.file, rank)) {
        clear = false;
        break;
      }
    }
    if (clear) return sq as XiangqiSquare;
  }
  return null;
}

function isFacingGeneralCapture(state: XiangqiGameState, move: XiangqiMove): boolean {
  const piece = state.board[move.from];
  return (
    piece !== undefined && facingGeneralCaptureTarget(state.board, move.from, piece) === move.to
  );
}

// ── Move generation ────────────────────────────────────────────────────────

// FoW xiangqi uses pseudo-legal moves (geometry only — no check / flying-
// general / self-pin filtering). Real move legality under fog is "you can
// move there geometrically"; the consequence of moving into check is that
// the opponent can capture your general next turn. The game ends on actual
// general capture, not on standard checkmate detection.

export function getLegalMoves(state: XiangqiGameState): XiangqiMove[] {
  if (state.status.type !== 'playing') return [];
  const position = positionFromState(state);
  const moves: XiangqiMove[] = [];
  for (const [sqEo, piece] of position.board) {
    if (piece.color !== position.turn) continue;
    const dests = position.pseudoDests(piece, sqEo as EoSquare);
    const from = eoMakeSquare(sqEo as EoSquare);
    for (const toEo of dests) {
      moves.push({ from, to: eoMakeSquare(toEo) });
    }
    const ownPiece = state.board[from];
    const facingGeneral = ownPiece ? facingGeneralCaptureTarget(state.board, from, ownPiece) : null;
    if (facingGeneral && !dests.has(eoParseSquare(facingGeneral)!)) {
      moves.push({ from, to: facingGeneral });
    }
  }
  return moves;
}

export function getLegalMovesFrom(state: XiangqiGameState, from: XiangqiSquare): XiangqiMove[] {
  if (state.status.type !== 'playing') return [];
  const position = positionFromState(state);
  const fromEo = eoParseSquare(from);
  if (fromEo === undefined) return [];
  const piece = position.board.get(fromEo);
  if (!piece || piece.color !== state.status.turn) return [];
  const dests = position.pseudoDests(piece, fromEo);
  const moves: XiangqiMove[] = [];
  for (const toEo of dests) {
    moves.push({ from, to: eoMakeSquare(toEo) });
  }
  const ownPiece = state.board[from];
  const facingGeneral = ownPiece ? facingGeneralCaptureTarget(state.board, from, ownPiece) : null;
  if (facingGeneral && !dests.has(eoParseSquare(facingGeneral)!)) {
    moves.push({ from, to: facingGeneral });
  }
  return moves;
}

export function isLegalMove(state: XiangqiGameState, move: XiangqiMove): boolean {
  if (state.status.type !== 'playing') return false;
  const position = positionFromState(state);
  const fromEo = eoParseSquare(move.from);
  const toEo = eoParseSquare(move.to);
  if (fromEo === undefined || toEo === undefined) return false;
  const piece = position.board.get(fromEo);
  if (!piece || piece.color !== state.status.turn) return false;
  return position.pseudoDests(piece, fromEo).has(toEo) || isFacingGeneralCapture(state, move);
}

function hasPseudoLegalMove(position: EoXiangqi): boolean {
  for (const [sqEo, piece] of position.board) {
    if (piece.color !== position.turn) continue;
    if (position.pseudoDests(piece, sqEo as EoSquare).nonEmpty()) return true;
  }
  return false;
}

// ── Apply move + end-condition detection ───────────────────────────────────
// progressClock = plies since last capture. This follows the common xiangqi
// no-capture move limit rather than the western-chess pawn-move reset.
//
// 3-fold true-position repetition is silent and server-adjudicated (see doc
// §4). No indicator is surfaced to players.

const DEFAULT_PROGRESS_CLOCK_LIMIT = 60;

export type XiangqiApplyMoveOptions = {
  progressClockLimit?: number;
};

// Spell the whole role: its first letter is not unique (chariot and cannon are
// both `c`), and a shared letter makes a chariot/cannon swap read as a repeat.
export function positionRepetitionKey(state: XiangqiGameState): string {
  const turn = state.status.type === 'playing' ? state.status.turn : '-';
  const board = Object.entries(state.board)
    .filter(([, piece]) => piece)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sq, p]) => `${sq}:${p!.color[0]}.${p!.role}`)
    .join(',');
  return `${turn}|${board}`;
}

/**
 * A key in the spelling used before 2026-10 (role's first letter, so chariot
 * and cannon were both `c`). Accepts either spelling. Only for matching keys
 * already stored that way, such as mined-puzzle position keys; never for
 * adjudicating a game.
 */
export function legacyPositionRepetitionKey(key: string): string {
  return key.replace(/:([rb])\.([a-z])[a-z]*/g, '$1$2');
}

export function applyMove(
  state: XiangqiGameState,
  move: XiangqiMove,
  opts: XiangqiApplyMoveOptions = {},
): XiangqiGameState {
  if (state.status.type !== 'playing') return state;

  const position = positionFromState(state);
  const fromEo = eoParseSquare(move.from);
  const toEo = eoParseSquare(move.to);
  if (fromEo === undefined || toEo === undefined) return state;

  // FoW: pseudo-legality only — geometry, no check / flying-general filter.
  const movingPieceEo = position.board.get(fromEo);
  if (!movingPieceEo || movingPieceEo.color !== position.turn) return state;
  const flyingGeneralCapture = isFacingGeneralCapture(state, move);
  if (!position.pseudoDests(movingPieceEo, fromEo).has(toEo) && !flyingGeneralCapture) return state;

  // Capture detection — needed for the progress clock, and
  // must be read BEFORE position.play() mutates the board. (elephantops's
  // own `halfmoves` is just a plain ply counter, not a clock.)
  const movingPiece = state.board[move.from];
  const capturedPiece = state.board[move.to];
  const wasCapture = capturedPiece !== undefined;
  const capturedGeneral = capturedPiece?.role === 'general';

  let newBoard: XiangqiBoard;
  let nextTurn: XiangqiColor;
  let newMoveNumber: number;

  if (flyingGeneralCapture) {
    newBoard = { ...state.board };
    delete newBoard[move.from];
    newBoard[move.to] = movingPiece;
    nextTurn = oppositeXiangqiColor(state.status.turn);
    newMoveNumber = state.status.turn === 'black' ? state.moveNumber + 1 : state.moveNumber;
  } else {
    position.play({ from: fromEo, to: toEo });

    // Translate new board back to our types.
    newBoard = {};
    for (const [sqEo, piece] of position.board) {
      newBoard[eoMakeSquare(sqEo as EoSquare)] = {
        color: piece.color,
        role: eoToRole(piece.role),
      };
    }
    nextTurn = position.turn;
    newMoveNumber = position.fullmoves;
  }

  const newProgressClock = wasCapture ? 0 : state.progressClock + 1;

  // Bookkeep position counts (use intermediate playing state for the digest).
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

  // End-condition detection under FoW (check rules ignored).
  // Order: literal general capture > side-to-move has no pseudo-legal moves
  // (stalemated side loses by xiangqi convention) > 3-fold repetition >
  // progress-clock.
  const limit = opts.progressClockLimit ?? DEFAULT_PROGRESS_CLOCK_LIMIT;
  let nextStatus: XiangqiGameStatus = { type: 'playing', turn: nextTurn };
  if (capturedGeneral) {
    nextStatus = {
      type: 'finished',
      winner: movingPiece!.color,
      reason: 'general-captured',
    };
  } else if (!hasPseudoLegalMove(position)) {
    nextStatus = {
      type: 'finished',
      winner: movingPiece!.color,
      reason: 'stalemate',
    };
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
  };
}

// ── Capture ledger ─────────────────────────────────────────────────────────
// A pure replay that records who captured what, in ply order. Used by the
// dark-xiangqi tenant to derive per-seat "observed captures" without leaking
// hidden info: under fog you can only move where you can see, so a capture's
// victim is always visible to the capturer at the moment of capture, and a
// piece's owner always knows its own losses.
//
// The victim of ply N is read off the PRE-move board at `state.board[move.to]`
// — exactly the read applyMove itself performs (see the capture-detection
// block above). We drive the kernel's own applyMove per move rather than
// reimplementing move semantics, so the ledger's board sequence is identical
// to a normal replay.

export type XiangqiCapture = {
  victim: XiangqiPiece;
  capturedBy: XiangqiColor;
  plyIndex: number;
};

export function xiangqiCaptureLedger(
  initialState: XiangqiGameState,
  moves: readonly XiangqiMove[],
  opts: XiangqiApplyMoveOptions = {},
): XiangqiCapture[] {
  const ledger: XiangqiCapture[] = [];
  let state = initialState;
  for (let plyIndex = 0; plyIndex < moves.length; plyIndex += 1) {
    const move = moves[plyIndex]!;
    if (state.status.type !== 'playing') break;
    const capturedBy = state.status.turn;
    const victim = state.board[move.to];
    const next = applyMove(state, move, opts);
    // applyMove returns the same reference on a rejected (illegal) move; only
    // count captures for moves that actually applied.
    if (next !== state && victim) {
      ledger.push({
        victim: { color: victim.color, role: victim.role },
        capturedBy,
        plyIndex,
      });
    }
    state = next;
  }
  return ledger;
}

// ── Fog-of-war visibility kernel ───────────────────────────────────────────
// Vision is computed geometrically per the design doc, NOT via elephantops's
// attack functions. For pieces with blockers (horse legs, elephant eyes,
// cannon screens), the player sees blocked occupancy as a shrouded "?" rather
// than learning the piece identity.

// The cannon/horse/slide walks, emptyVision, and the VisionAccum shape live in
// the shared xiangqi-vision-kernel; this alias binds the square type.
type VisionAccum = KernelVisionAccum<XiangqiSquare>;

function addIfOnBoard(set: Set<XiangqiSquare>, file: number, rank: number): void {
  if (inBounds(file, rank)) set.add(squareOf(file, rank));
}

function isOccupied(board: XiangqiBoard, file: number, rank: number): boolean {
  if (!inBounds(file, rank)) return false;
  return board[squareOf(file, rank)] !== undefined;
}

function generalVisionInto(
  set: Set<XiangqiSquare>,
  color: XiangqiColor,
  board: XiangqiBoard,
  file: number,
  rank: number,
): void {
  // Legal one-step orthogonal palace destinations. The own square is added by
  // computeVision before piece-specific vision runs.
  for (const [df, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const f = file + df;
    const r = rank + dr;
    if (inPalace(color, f, r)) addIfOnBoard(set, f, r);
  }
  // The enemy general is also a legal capture target when the file is clear.
  for (const [sq, piece] of Object.entries(board)) {
    if (piece?.role !== 'general' || piece.color === color) continue;
    const enemy = coordOf(sq as XiangqiSquare);
    if (enemy.file !== file) continue;
    const minR = Math.min(rank, enemy.rank);
    const maxR = Math.max(rank, enemy.rank);
    let clear = true;
    for (let r = minR + 1; r < maxR; r++) {
      if (isOccupied(board, file, r)) {
        clear = false;
        break;
      }
    }
    if (clear) set.add(sq as XiangqiSquare);
  }
}

function advisorVisionInto(
  set: Set<XiangqiSquare>,
  color: XiangqiColor,
  file: number,
  rank: number,
): void {
  // 4 diagonal palace squares.
  for (const [df, dr] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    const f = file + df,
      r = rank + dr;
    if (inPalace(color, f, r)) addIfOnBoard(set, f, r);
  }
}

function elephantVisionInto(
  accum: VisionAccum,
  color: XiangqiColor,
  board: XiangqiBoard,
  file: number,
  rank: number,
): void {
  // Legal diagonal-2 destinations in own half. A blocked eye hides the
  // destination and reveals the eye as occupied-but-unknown.
  for (const [df, dr] of [
    [-2, -2],
    [-2, 2],
    [2, -2],
    [2, 2],
  ] as const) {
    const eyeF = file + df / 2,
      eyeR = rank + dr / 2;
    const destF = file + df,
      destR = rank + dr;
    if (!inBounds(destF, destR) || !inOwnHalf(color, destR) || !inBounds(eyeF, eyeR)) {
      continue;
    }
    if (isOccupied(board, eyeF, eyeR)) {
      accum.shroudedBlockers.add(squareOf(eyeF, eyeR));
    } else {
      accum.directlyVisible.add(squareOf(destF, destR));
    }
  }
}

function soldierVisionInto(
  set: Set<XiangqiSquare>,
  color: XiangqiColor,
  file: number,
  rank: number,
): void {
  // 1 fwd in own half, +2 sideways after crossing the river.
  const forward = color === 'red' ? 1 : -1;
  addIfOnBoard(set, file, rank + forward);
  if (hasCrossedRiver(color, rank)) {
    addIfOnBoard(set, file - 1, rank);
    addIfOnBoard(set, file + 1, rank);
  }
}

export function computeVision(state: XiangqiGameState, color: XiangqiColor): VisionAccum {
  const accum = emptyVision<XiangqiSquare>();
  const probe: VisionProbe<XiangqiSquare> = {
    inBounds,
    squareOf,
    isOccupied: (file, rank) => isOccupied(state.board, file, rank),
    isEnemyAt: (file, rank) => {
      const target = state.board[squareOf(file, rank)];
      return target !== undefined && target.color !== color;
    },
  };
  for (const [sq, piece] of Object.entries(state.board)) {
    if (!piece || piece.color !== color) continue;
    // The own square is always directly visible.
    accum.directlyVisible.add(sq as XiangqiSquare);
    const { file, rank } = coordOf(sq as XiangqiSquare);
    switch (piece.role) {
      case 'general':
        generalVisionInto(accum.directlyVisible, color, state.board, file, rank);
        break;
      case 'advisor':
        advisorVisionInto(accum.directlyVisible, color, file, rank);
        break;
      case 'elephant':
        elephantVisionInto(accum, color, state.board, file, rank);
        break;
      case 'horse':
        horseVisionInto(accum, probe, file, rank);
        break;
      case 'chariot':
        slideVisionInto(accum.directlyVisible, probe, ORTHOGONAL_STEPS, file, rank);
        break;
      case 'cannon':
        cannonVisionInto(accum, probe, file, rank);
        break;
      case 'soldier':
        soldierVisionInto(accum.directlyVisible, color, file, rank);
        break;
    }
  }
  return accum;
}

export function getVisibleSquares(state: XiangqiGameState, color: XiangqiColor): XiangqiSquare[] {
  const v = computeVision(state, color);
  const all = new Set<XiangqiSquare>([
    ...v.directlyVisible,
    ...v.shroudedBlockers,
    ...v.cannonScreens,
    ...v.cannonTargets,
  ]);
  return [...all].sort();
}

function mergePlayerBoardEntry(
  board: XiangqiPlayerBoard,
  square: XiangqiSquare,
  piece: XiangqiPiece,
  shrouded: boolean,
): void {
  const existing = board[square];
  if (!existing || (existing.shrouded && !shrouded)) {
    board[square] = { piece, shrouded };
  }
}

export function getPlayerView(
  state: XiangqiGameState,
  color: XiangqiColor,
  mode: XiangqiCannonVisionMode = 'D',
): XiangqiPlayerView {
  const vision = computeVision(state, color);
  const playerBoard: XiangqiPlayerBoard = {};

  // Mode rendering rules for cannon-only-visible squares.
  // If multiple pieces reveal the same square, the most informative view wins:
  // a fully identified piece overrides a shrouded "?" marker.
  //
  // The shrouded `?` rendering is provided by renderXiangqiPiece — when a screen
  // is shrouded the player sees "something is here, identity unknown," which
  // also serves as the Mode-D "screen has a ? marker" hint that the capture
  // line exists.
  // The gap between screen and target is always fogged: those empty squares
  // are not legal cannon destinations. Mode E additionally fogs the screen.
  const fogScreen = mode === 'E';
  const screenShrouded = mode === 'B' || mode === 'D';
  const targetShrouded = mode === 'B' || mode === 'C';

  for (const sq of vision.directlyVisible) {
    const piece = state.board[sq];
    if (piece) mergePlayerBoardEntry(playerBoard, sq, piece, false);
  }
  for (const sq of vision.shroudedBlockers) {
    const piece = state.board[sq];
    if (piece) mergePlayerBoardEntry(playerBoard, sq, piece, true);
  }
  if (!fogScreen) {
    for (const sq of vision.cannonScreens) {
      const piece = state.board[sq];
      if (piece) mergePlayerBoardEntry(playerBoard, sq, piece, screenShrouded);
    }
  }
  for (const sq of vision.cannonTargets) {
    const piece = state.board[sq];
    if (piece) mergePlayerBoardEntry(playerBoard, sq, piece, targetShrouded);
  }

  // Build the visible set from the accum so mode E can exclude the screen.
  // The target is always visible because it can be captured; a screen square
  // that another piece genuinely sees stays visible via directlyVisible.
  const visibleSet = new Set<XiangqiSquare>(vision.directlyVisible);
  for (const sq of vision.shroudedBlockers) visibleSet.add(sq);
  for (const sq of vision.cannonTargets) visibleSet.add(sq);
  if (!fogScreen) {
    for (const sq of vision.cannonScreens) visibleSet.add(sq);
  }
  const visibleSquares = [...visibleSet].sort();

  const legalMoves =
    state.status.type === 'playing'
      ? getLegalMoves({ ...state, status: { type: 'playing', turn: color } })
      : [];

  return {
    id: state.id,
    perspective: color,
    board: playerBoard,
    visibleSquares,
    legalMoves,
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
  };
}
