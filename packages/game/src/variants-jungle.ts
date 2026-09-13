// Jungle / Dou Shou Qi (斗兽棋, "Animal Chess") — pure rules kernel.
//
// Perfect-information, deterministic 7×9 board game. This module is the canonical
// rules authority for vanilla Jungle AND the home of the shared ANIMAL-RANK kernel
// (JunglePieceRole, JUNGLE_RANK, jungleRankBeats) that the flip derivative
// (variants-jungle-flip.ts) imports — the two surfaces share the rank order + the
// rat-beats-elephant wrap, nothing else.
//
// Like variants-banqi.ts, this stays a SELF-CONTAINED
// kernel with its own geometry and piece set rather than forcing Jungle through the
// chess Variant interface (different board, different pieces, different mechanics).
//
// The short version this kernel implements (canonical rules; Wikipedia "Jungle
// (board game)" + Leiden/LIACS van Rijn & Vis as references):
//   - Board: 7 files a–g (0–6) × 9 ranks 1–9 = 63 squares. Red home = ranks 1–3,
//     black home = ranks 7–9 (board is 180°-rotationally symmetric).
//   - Pieces (8 per side), rank weak→strong: Rat(1) Cat(2) Dog(3) Wolf(4)
//     Leopard(5) Tiger(6) Lion(7) Elephant(8). A piece captures an enemy of EQUAL
//     OR LOWER rank, with the sole wrap that the Rat captures the Elephant (and the
//     Elephant can NEVER capture the Rat).
//   - Dens: red d1, black d9. Moving any piece into the OPPONENT's den wins. A piece
//     may not enter its OWN den.
//   - Traps: three per den (red c1/e1/d2, black c9/e9/d8). An enemy piece standing
//     on one of YOUR traps is reduced to rank 0 (any of your pieces may capture it),
//     restored when it leaves.
//   - Rivers: two 2×3 water rectangles (files b–c and e–f, ranks 4–6). Only the Rat
//     may enter/leave water. A Rat in water is invulnerable to land pieces and can
//     neither capture onto land nor be captured from land; only a water-Rat captures
//     a water-Rat. The Rat-beats-Elephant wrap works only from a LAND square.
//   - The Lion and Tiger jump a river: in line over the contiguous water to the land
//     square beyond (capturing a takeable enemy there). The TIGER jumps VERTICALLY
//     only; the LION jumps vertically OR horizontally. A Rat of EITHER colour on any
//     intervening water square blocks the jump.
//   - Win = den-entry OR capturing all enemy pieces (subsumed by no-legal-move).
//     Draws (academic/digital convention, not folk canon): the no-progress clock and
//     threefold repetition.

import type { AbortReason } from './types.js';

export type JungleColor = 'red' | 'black';

// Move order: red moves first. Drives tenant seat iteration + clock arming.
export const JUNGLE_COLORS: readonly [JungleColor, JungleColor] = ['red', 'black'];

// Rank weak→strong; the value IS the capture rank (rat=1 … elephant=8).
export type JunglePieceRole =
  | 'rat'
  | 'cat'
  | 'dog'
  | 'wolf'
  | 'leopard'
  | 'tiger'
  | 'lion'
  | 'elephant';

export type JunglePiece = {
  color: JungleColor;
  role: JunglePieceRole;
};

export type JungleCoord = { file: number; rank: number };

export type JungleFile = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
export type JungleRankChar = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type JungleSquare = `${JungleFile}${JungleRankChar}`;

export type JungleBoard = Partial<Record<JungleSquare, JunglePiece>>;

export type JungleMove = {
  from: JungleSquare;
  to: JungleSquare;
};

export type JungleGameEndReason =
  | 'den-entered' // a piece reached the opponent's den
  | 'pieces-captured' // the opponent has no pieces left
  | 'stalemate' // the side to move has no legal move
  | 'no-progress' // progress clock hit the no-capture limit
  | 'repetition' // threefold position repetition
  | 'timeout'
  | 'resignation'
  | 'abandonment';

export type JungleGameStatus =
  | { type: 'playing'; turn: JungleColor }
  | { type: 'finished'; winner: JungleColor | null; reason: JungleGameEndReason }
  | { type: 'aborted'; reason: AbortReason };

export type JungleGameState = {
  id: string;
  board: JungleBoard;
  status: JungleGameStatus;
  moveNumber: number;
  // Plies since the last capture; powers the no-progress draw.
  progressClock: number;
  lastMove?: JungleMove;
  positionCounts: Record<string, number>;
};

// Perfect-information view: the board is a straight passthrough (nothing hidden).
// Kept in the player-view shape so the runtime/renderer pipeline matches the other
// variants; a future Fog Jungle would add shrouding here.
export type JunglePlayerView = {
  id: string;
  perspective: JungleColor;
  board: JungleBoard;
  visibleSquares: JungleSquare[];
  legalMoves: JungleMove[];
  status: JungleGameStatus;
  moveNumber: number;
  lastMove?: JungleMove;
};

// ── Shared animal-rank kernel (imported by the flip derivative) ───────────────

/** Capture rank, weak→strong. The value is the comparison rank. */
export const JUNGLE_RANK: Record<JunglePieceRole, number> = {
  rat: 1,
  cat: 2,
  dog: 3,
  wolf: 4,
  leopard: 5,
  tiger: 6,
  lion: 7,
  elephant: 8,
};

// Distinct single letters for keys/rendering (P=leoPard so L stays Lion).
export const JUNGLE_ROLE_LETTER: Record<JunglePieceRole, string> = {
  rat: 'R',
  cat: 'C',
  dog: 'D',
  wolf: 'W',
  leopard: 'P',
  tiger: 'T',
  lion: 'L',
  elephant: 'E',
};

/**
 * The pure rank rule (NO board context): does `attacker` outrank-or-tie `target`,
 * with the rat↔elephant wrap. This is the shared kernel the flip variant reuses
 * (the flip board has no water/traps). The full board game layers water-isolation
 * and trap rank-0 on top via jungleCanCaptureAt.
 */
export function jungleRankBeats(attacker: JunglePieceRole, target: JunglePieceRole): boolean {
  if (attacker === 'rat' && target === 'elephant') return true;
  if (attacker === 'elephant' && target === 'rat') return false;
  return JUNGLE_RANK[attacker] >= JUNGLE_RANK[target];
}

// ── Geometry (7×9, self-contained) ───────────────────────────────────────────

const FILE_CHARS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
export const JUNGLE_WIDTH = 7;
export const JUNGLE_HEIGHT = 9;

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * River-jump directions by role, as [fileDelta, rankDelta]. The TIGER jumps
 * vertically only; the LION jumps vertically or horizontally; nobody else jumps.
 *
 * Exported because the board's movement cue draws from it. A cue that restated
 * "tiger = vertical" in the art layer would be a second copy of a rule, free to
 * drift into telling the player something the move generator will not honour;
 * reading the same table means the arcs cannot claim a jump that does not exist.
 */
export const JUNGLE_JUMP_DIRS: Readonly<
  Partial<Record<JunglePieceRole, ReadonlyArray<readonly [number, number]>>>
> = {
  tiger: [
    [0, 1],
    [0, -1],
  ],
  lion: ORTHO,
};

/**
 * True when this role may occupy a water square. Only the Rat may -- exported for
 * the same reason as JUNGLE_JUMP_DIRS: the cue and the move generator read one
 * predicate.
 */
export function jungleRoleMayEnterWater(role: JunglePieceRole): boolean {
  return role === 'rat';
}

export function jungleInBounds(file: number, rank: number): boolean {
  return file >= 0 && file < JUNGLE_WIDTH && rank >= 1 && rank <= JUNGLE_HEIGHT;
}

export function jungleSquareOf(file: number, rank: number): JungleSquare {
  if (!jungleInBounds(file, rank)) {
    throw new RangeError(`jungle coord out of range: file=${file} rank=${rank}`);
  }
  return `${FILE_CHARS[file]}${rank}` as JungleSquare;
}

export function jungleCoordOf(square: JungleSquare): JungleCoord {
  const file = FILE_CHARS.indexOf(square[0] as (typeof FILE_CHARS)[number]);
  const rank = Number(square.slice(1));
  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > JUNGLE_HEIGHT) {
    throw new RangeError(`invalid jungle square: ${square}`);
  }
  return { file, rank };
}

export const ALL_JUNGLE_SQUARES: readonly JungleSquare[] = (() => {
  const squares: JungleSquare[] = [];
  for (let rank = 1; rank <= JUNGLE_HEIGHT; rank += 1) {
    for (let file = 0; file < JUNGLE_WIDTH; file += 1) squares.push(jungleSquareOf(file, rank));
  }
  return squares;
})();

// ── Special squares (dens, traps, water) ─────────────────────────────────────

export const JUNGLE_DENS: Record<JungleColor, JungleSquare> = { red: 'd1', black: 'd9' };

const RED_TRAPS: ReadonlySet<JungleSquare> = new Set<JungleSquare>(['c1', 'e1', 'd2']);
const BLACK_TRAPS: ReadonlySet<JungleSquare> = new Set<JungleSquare>(['c9', 'e9', 'd8']);

export const JUNGLE_WATER: ReadonlySet<JungleSquare> = new Set<JungleSquare>([
  'b4',
  'b5',
  'b6',
  'c4',
  'c5',
  'c6', // west lake (files b–c, ranks 4–6)
  'e4',
  'e5',
  'e6',
  'f4',
  'f5',
  'f6', // east lake (files e–f, ranks 4–6)
]);

export function jungleIsWater(square: JungleSquare): boolean {
  return JUNGLE_WATER.has(square);
}

/** The colour whose den this trap guards, or null if `square` is not a trap. */
export function jungleTrapOwner(square: JungleSquare): JungleColor | null {
  if (RED_TRAPS.has(square)) return 'red';
  if (BLACK_TRAPS.has(square)) return 'black';
  return null;
}

export function oppositeJungleColor(color: JungleColor): JungleColor {
  return color === 'red' ? 'black' : 'red';
}

// ── Capture resolution (rank + trap rank-0 + water isolation) ────────────────

/**
 * Can the piece on `fromSq` capture the enemy piece on `toSq`? Layers the board
 * rules onto jungleRankBeats:
 *  - WATER ISOLATION: a water square only ever holds a Rat. A capture is illegal if
 *    exactly one of attacker/target is in water (land can't take a water-Rat; a
 *    water-Rat can't take onto land — including the Rat-beats-Elephant wrap, which
 *    needs the Rat on land). Two water Rats may capture each other.
 *  - TRAP RANK-0: a target standing on one of the ATTACKER's traps is rank 0, so
 *    any attacker takes it regardless of rank.
 * Assumes attacker and target are enemies (caller checks colour).
 */
export function jungleCanCaptureAt(
  attacker: JunglePiece,
  fromSq: JungleSquare,
  target: JunglePiece,
  toSq: JungleSquare,
): boolean {
  const attackerInWater = jungleIsWater(fromSq);
  const targetInWater = jungleIsWater(toSq);
  if (attackerInWater !== targetInWater) return false; // cross-boundary capture forbidden
  if (jungleTrapOwner(toSq) === attacker.color) return true; // target is rank 0 in our trap
  return jungleRankBeats(attacker.role, target.role);
}

// ── Initial position (canonical) ─────────────────────────────────────────────

// Red home (ranks 1–3); black is the 180° rotation. Lion/Tiger in the back-rank
// corners, Rat in front of the Lion and Elephant in front of the Tiger, Leopard/Wolf
// across rank 3, Dog/Cat flanking the den on rank 2.
const RED_SETUP: ReadonlyArray<readonly [JungleSquare, JunglePieceRole]> = [
  ['a1', 'lion'],
  ['g1', 'tiger'],
  ['b2', 'dog'],
  ['f2', 'cat'],
  ['a3', 'rat'],
  ['c3', 'leopard'],
  ['e3', 'wolf'],
  ['g3', 'elephant'],
];

function rotate180(square: JungleSquare): JungleSquare {
  const { file, rank } = jungleCoordOf(square);
  return jungleSquareOf(JUNGLE_WIDTH - 1 - file, JUNGLE_HEIGHT + 1 - rank);
}

export function createInitialJungleBoard(): JungleBoard {
  const board: JungleBoard = {};
  for (const [square, role] of RED_SETUP) {
    board[square] = { color: 'red', role };
    board[rotate180(square)] = { color: 'black', role };
  }
  return board;
}

export function createInitialJungleState(gameId: string): JungleGameState {
  const base: JungleGameState = {
    id: gameId,
    board: createInitialJungleBoard(),
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
  return { ...base, positionCounts: { [junglePositionRepetitionKey(base)]: 1 } };
}

// ── Move generation ──────────────────────────────────────────────────────────

export function getJungleLegalMoves(state: JungleGameState): JungleMove[] {
  if (state.status.type !== 'playing') return [];
  const moves: JungleMove[] = [];
  for (const [sq, piece] of Object.entries(state.board)) {
    if (!piece || piece.color !== state.status.turn) continue;
    moves.push(...getJungleLegalMovesFrom(state, sq as JungleSquare));
  }
  return moves;
}

export function getJungleLegalMovesFrom(state: JungleGameState, from: JungleSquare): JungleMove[] {
  if (state.status.type !== 'playing') return [];
  const piece = state.board[from];
  if (!piece || piece.color !== state.status.turn) return [];
  const { file, rank } = jungleCoordOf(from);
  const moves: JungleMove[] = [];
  const ownDen = JUNGLE_DENS[piece.color];

  // A candidate landing square: legal if empty (and not own den) or a takeable enemy.
  const tryLand = (to: JungleSquare): void => {
    if (to === ownDen) return; // never enter your own den
    const target = state.board[to];
    if (!target) {
      moves.push({ from, to });
    } else if (target.color !== piece.color && jungleCanCaptureAt(piece, from, target, to)) {
      moves.push({ from, to });
    }
    // friendly, or uncapturable enemy → blocked
  };

  // Orthogonal one-step moves. Only the Rat may step onto/along water; every other
  // piece treats a water square as impassable (it crosses only via a jump).
  for (const [df, dr] of ORTHO) {
    const f = file + df;
    const r = rank + dr;
    if (!jungleInBounds(f, r)) continue;
    const to = jungleSquareOf(f, r);
    if (jungleIsWater(to) && !jungleRoleMayEnterWater(piece.role)) continue;
    tryLand(to);
  }

  // Lion/Tiger river jumps. Tiger: vertical only. Lion: vertical or horizontal.
  const jumpDirs = JUNGLE_JUMP_DIRS[piece.role];
  if (jumpDirs) {
    for (const [df, dr] of jumpDirs) {
      let f = file + df;
      let r = rank + dr;
      if (!jungleInBounds(f, r) || !jungleIsWater(jungleSquareOf(f, r))) continue; // must face water
      let blocked = false;
      while (jungleInBounds(f, r) && jungleIsWater(jungleSquareOf(f, r))) {
        if (state.board[jungleSquareOf(f, r)]) {
          blocked = true; // a Rat of either colour in the lake blocks the jump
          break;
        }
        f += df;
        r += dr;
      }
      if (blocked || !jungleInBounds(f, r)) continue;
      tryLand(jungleSquareOf(f, r)); // land on / capture at the far bank
    }
  }

  return moves;
}

export function isJungleLegalMove(state: JungleGameState, move: JungleMove): boolean {
  return getJungleLegalMovesFrom(state, move.from).some((m) => m.to === move.to);
}

// ── Apply move + terminal detection ──────────────────────────────────────────

export type JungleApplyMoveOptions = {
  progressClockLimit?: number;
  repetitionDrawCount?: number;
};

// Plies without a capture that end the game a draw. 200 = 100 moves by each side.
//
// Was 100 (a 50-move rule by analogy with chess). Jungle shuffles far more than chess does:
// pieces cannot trade freely because rank decides every capture, so long manoeuvring stretches
// with nothing taken are normal play rather than a stalled game. Measured over 100 self-play
// games per setting at the engine's full strength:
//
//   limit 100 -> 25% decisive, 14 games ended on this clock
//   limit 200 -> 33% decisive,  1 game  ended on this clock
//   limit 400 -> 33% decisive,  0 games ended on this clock
//
// So the old clock was cutting off games that still had a result in them, and 400 buys nothing
// over 200 for 8% more play. Threefold repetition adjudicates the genuinely stuck positions,
// which is what it is for. Games run ~12% longer.
//
// jungle_rust/src/engine.rs carries the same number as DEFAULT_PROGRESS_LIMIT; the golden-parity
// test compares the two kernels frame for frame, so they move together or not at all.
// Plies without a capture that end the game a draw. 200 = 100 moves by each side.
//
// Raised from 100 on measurement. Jungle shuffles far more than chess does: rank decides every
// capture, so pieces cannot trade freely and long manoeuvring with nothing taken is normal play
// rather than a stalled game. Over 100 self-play games per setting at the shipping engine
// budget, limit 100 gave 25% decisive with 14 games ending on this clock, 200 gave 33% with 1,
// and 400 gave 33% with 0. Threefold repetition adjudicates what is genuinely stuck.
//
// This value MUST match the engine binary, which is fetched from a brianhliou/misty-jungle
// release (v0.0.4 carries 200) rather than built from source. Shipping this kernel at 200 while
// the binary was at 100 left the server playing past ply 100 while the engine scored everything
// beyond it as a draw. The binary reports its value at handshake (`info string progress_limit`),
// so check the engine boot log before changing this.
export const DEFAULT_JUNGLE_PROGRESS_CLOCK_LIMIT = 200;
export const DEFAULT_JUNGLE_REPETITION_DRAW_COUNT = 3;

function hasJungleLegalMove(board: JungleBoard, color: JungleColor): boolean {
  const probe: JungleGameState = {
    id: 'move-check',
    board,
    status: { type: 'playing', turn: color },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
  return getJungleLegalMoves(probe).length > 0;
}

function colorHasPieces(board: JungleBoard, color: JungleColor): boolean {
  return Object.values(board).some((p) => p?.color === color);
}

export function applyJungleMove(
  state: JungleGameState,
  move: JungleMove,
  opts: JungleApplyMoveOptions = {},
): JungleGameState {
  if (state.status.type !== 'playing') return state;
  if (!isJungleLegalMove(state, move)) return state;

  const movingColor = state.status.turn;
  const movingPiece = state.board[move.from];
  if (!movingPiece) return state;
  const capturedPiece = state.board[move.to];
  const nextTurn = oppositeJungleColor(movingColor);

  const board: JungleBoard = { ...state.board };
  delete board[move.from];
  board[move.to] = movingPiece;

  const progressClock = capturedPiece ? 0 : state.progressClock + 1;
  const moveNumber = movingColor === 'black' ? state.moveNumber + 1 : state.moveNumber;

  const nextForKey: JungleGameState = {
    ...state,
    board,
    status: { type: 'playing', turn: nextTurn },
    moveNumber,
    progressClock,
    lastMove: move,
  };
  const repKey = junglePositionRepetitionKey(nextForKey);
  const positionCounts = { ...state.positionCounts };
  positionCounts[repKey] = (positionCounts[repKey] ?? 0) + 1;

  const repLimit = opts.repetitionDrawCount ?? DEFAULT_JUNGLE_REPETITION_DRAW_COUNT;
  const progressLimit = opts.progressClockLimit ?? DEFAULT_JUNGLE_PROGRESS_CLOCK_LIMIT;

  let status: JungleGameStatus;
  if (move.to === JUNGLE_DENS[nextTurn]) {
    // Reached the opponent's den.
    status = { type: 'finished', winner: movingColor, reason: 'den-entered' };
  } else if (!colorHasPieces(board, nextTurn)) {
    status = { type: 'finished', winner: movingColor, reason: 'pieces-captured' };
  } else if (!hasJungleLegalMove(board, nextTurn)) {
    status = { type: 'finished', winner: movingColor, reason: 'stalemate' };
  } else if ((positionCounts[repKey] ?? 0) >= repLimit) {
    status = { type: 'finished', winner: null, reason: 'repetition' };
  } else if (progressClock >= progressLimit) {
    status = { type: 'finished', winner: null, reason: 'no-progress' };
  } else {
    status = { type: 'playing', turn: nextTurn };
  }

  return {
    ...state,
    board,
    status,
    moveNumber,
    progressClock,
    lastMove: move,
    positionCounts,
  };
}

// ── Repetition key + player view ─────────────────────────────────────────────

export function junglePositionRepetitionKey(state: JungleGameState): string {
  const turn = state.status.type === 'playing' ? state.status.turn : '-';
  const board = ALL_JUNGLE_SQUARES.map((sq) => {
    const piece = state.board[sq];
    if (!piece) return '.';
    const letter = JUNGLE_ROLE_LETTER[piece.role];
    return piece.color === 'red' ? letter : letter.toLowerCase();
  }).join('');
  return `${turn}|${board}`;
}

export function getJunglePlayerView(state: JungleGameState, color: JungleColor): JunglePlayerView {
  const legalMoves =
    state.status.type === 'playing'
      ? getJungleLegalMoves({ ...state, status: { type: 'playing', turn: color } })
      : [];
  return {
    id: state.id,
    perspective: color,
    board: { ...state.board },
    visibleSquares: [...ALL_JUNGLE_SQUARES],
    legalMoves,
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
  };
}
