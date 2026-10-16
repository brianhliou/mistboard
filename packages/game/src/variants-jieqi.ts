// Jieqi (揭棋, "reveal chess") — full-board xiangqi with hidden piece identities.
//
// Canonical rules reference: apps/web/src/articles/content/jieqi.ts. The short
// version this kernel implements:
//   - Both generals start face-up on their palace points. The other 15 pieces
//     per side are dealt FACE-DOWN onto the standard non-general starting
//     squares. Neither player knows any hidden identity, including their own.
//   - A face-down ("dark") piece moves by the role of the STARTING POINT it
//     occupies (corner = chariot, etc.), under standard xiangqi confinement
//     (advisor in palace, elephant in own half, horse legs / elephant eyes /
//     cannon screens). A dark piece is always still on its home square, so the
//     starting-point role is well defined.
//   - The moment a dark piece moves it reveals to BOTH players and from then on
//     plays by its true identity. Revealed advisors may leave the palace and
//     revealed elephants may cross the river (the one jieqi freedom vs xiangqi);
//     their move SHAPES are unchanged.
//   - Win by checkmate or by leaving the opponent with no legal move (xiangqi
//     scores both as a loss for the side to move). Facing generals is illegal.
//   - Capturer-only reveal: if a dark piece is captured, only the capturer
//     learns its identity. The owner never knew it, so they learn nothing.
//
// Repetition (since 2026-10): a game created with `repetition: true` counts
// positions, and the third occurrence of one ends it as 'repetition'. The
// server's jieqi tenant then applies the xiangqi chasing rule on top: the side
// that gave check on every one of its moves in the closing cycle loses
// (jieqiPerpetualCheckLoser). Perpetual chase is not adjudicated, as in xiangqi
// on this site. States made without the flag (replays, analysis, games created
// before the rule) never end on repetition, so an old game replays to the end
// it had. Automatic draws otherwise come from the Guangdong/Tencent no-capture
// clock (60 full moves = 120 plies without a capture).
//
// This module owns canonical state (it knows every true identity). Hidden-info
// masking lives entirely in getJieqiPlayerView; the server renders that view and
// never ships the canonical board to a client.

import { checkSubjectColor } from './check-subject.js';
import type { AbortReason } from './types.js';
import {
  coordOf,
  createInitialXiangqiBoard,
  hasCrossedRiver,
  inBounds,
  inOwnHalf,
  inPalace,
  squareOf,
  type XiangqiColor,
  type XiangqiPieceRole,
  type XiangqiSquare,
} from './variants-xiangqi.js';

// Jieqi shares xiangqi's coordinate system, colors, and piece vocabulary.
export type JieqiColor = XiangqiColor; // 'red' | 'black'
export type JieqiPieceRole = XiangqiPieceRole;
export type JieqiSquare = XiangqiSquare;

// `role` is always the TRUE identity, even while face-down. Generals are always
// { role: 'general', faceDown: false }.
export type JieqiPiece = {
  color: JieqiColor;
  role: JieqiPieceRole;
  faceDown: boolean;
  // The identity was never determined: an imported game whose own referee dealt
  // lazily and never revealed this piece (deal.undetermined). `role` is then a
  // placeholder the kernel needs to stay a valid deal, never a fact to show.
  unknown?: true;
};

export type JieqiBoard = Partial<Record<JieqiSquare, JieqiPiece>>;

export type JieqiMove = {
  from: JieqiSquare;
  to: JieqiSquare;
};

// Per-side deal of the 15 hidden roles, in JIEQI home-square order
// (jieqiHomeSquares). Defaults to the standard xiangqi arrangement.
export type JieqiDeal = {
  red: JieqiPieceRole[];
  black: JieqiPieceRole[];
  // Home squares whose identity the game's source never determined (an imported
  // lab game deals at reveal time; a piece still face-down at the end was never
  // dealt). The roles above hold placeholders for them; pieces dealt there carry
  // `unknown`, and every truth view shows them as unknown rather than a role.
  undetermined?: { red: JieqiSquare[]; black: JieqiSquare[] };
};

export type JieqiGameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'no-capture-clock'
  | 'timeout'
  | 'resignation'
  | 'abandonment'
  // Third occurrence of a position (games created with `repetition: true`), or
  // an imported lab game whose own referee declared a threefold draw.
  | 'repetition'
  // Never produced by this kernel: the server tenant's perpetual-check loss, a
  // 'repetition' the checking side manufactured (jieqiPerpetualCheckLoser).
  | 'chasing';

export type JieqiGameStatus =
  | { type: 'playing'; turn: JieqiColor }
  | { type: 'finished'; winner: JieqiColor | null; reason: JieqiGameEndReason }
  | { type: 'aborted'; reason: AbortReason };

// A captured piece, recorded with full truth. getJieqiPlayerView redacts the
// role per viewer: visible to the capturer, or if it was already revealed when
// captured; hidden from the former owner of a still-dark piece.
export type JieqiCapture = {
  owner: JieqiColor;
  role: JieqiPieceRole;
  revealedAtCapture: boolean;
  // Captured while its identity was undetermined (see JieqiPiece.unknown).
  unknown?: true;
};

export type JieqiGameState = {
  id: string;
  board: JieqiBoard;
  status: JieqiGameStatus;
  moveNumber: number;
  // Plies since the last capture. Powers the no-capture-clock draw.
  noCaptureClock: number;
  captures: JieqiCapture[];
  lastMove?: JieqiMove;
  // Threefold-repetition bookkeeping, present only when the game enforces the
  // rule. Both cover the positions since the last capture or reveal: neither can
  // be undone, so no earlier position can recur. Keys spell every TRUE identity,
  // face-down pieces included, so this is server-only state: no view builder
  // reads it, and it must never reach a client.
  positionCounts?: Record<string, number>;
  repetitionLog?: JieqiRepetitionEntry[];
};

// One position in the repetition window, and the ply that produced it (absent
// for the window's first position).
export type JieqiRepetitionEntry = {
  key: string;
  mover?: JieqiColor;
  gaveCheck?: boolean;
};

// ── Player view (hidden-info boundary) ──────────────────────────────────────

export type JieqiVisibleBoardEntry =
  | { color: JieqiColor; role: JieqiPieceRole; faceDown: false }
  // `unknown`: only in a truth view, for a piece whose identity was never
  // determined (JieqiPiece.unknown). Renders as "never revealed", not a role.
  | { color: JieqiColor; faceDown: true; unknown?: true };

export type JieqiPlayerBoard = Partial<Record<JieqiSquare, JieqiVisibleBoardEntry>>;

// A captured piece as seen by one player. `role: null` => identity unknown to
// this viewer (a dark piece they did not capture).
export type JieqiCapturedView = {
  owner: JieqiColor;
  role: JieqiPieceRole | null;
};

export type JieqiPlayerView = {
  id: string;
  perspective: JieqiColor;
  board: JieqiPlayerBoard;
  legalMoves: JieqiMove[];
  captured: JieqiCapturedView[];
  inCheck: boolean;
  status: JieqiGameStatus;
  moveNumber: number;
  lastMove?: JieqiMove;
};

// ── Geometry tables ─────────────────────────────────────────────────────────

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const DIAG: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// [destFile, destRank] for the 2-step diagonal; the "eye" sits at the midpoint.
const ELEPHANT_STEPS: ReadonlyArray<readonly [number, number]> = [
  [2, 2],
  [2, -2],
  [-2, 2],
  [-2, -2],
];

// [destFile, destRank, legFile, legRank] — the leg is the orthogonal square the
// horse must clear.
const HORSE_STEPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 2, 0, 1],
  [1, -2, 0, -1],
  [-1, 2, 0, 1],
  [-1, -2, 0, -1],
  [2, 1, 1, 0],
  [2, -1, 1, 0],
  [-2, 1, -1, 0],
  [-2, -1, -1, 0],
];

export const DEFAULT_NO_CAPTURE_PLY_LIMIT = 120;

// ── Starting layout + deal ──────────────────────────────────────────────────

const STANDARD_BOARD = createInitialXiangqiBoard();

// Role dictated by each starting square — the move-rule a dark piece uses.
const STARTING_ROLE: Partial<Record<JieqiSquare, JieqiPieceRole>> = {};
for (const [sq, piece] of Object.entries(STANDARD_BOARD)) {
  if (piece) STARTING_ROLE[sq as JieqiSquare] = piece.role;
}

function computeHomeSquares(color: JieqiColor): JieqiSquare[] {
  return (Object.keys(STANDARD_BOARD) as JieqiSquare[])
    .filter((sq) => {
      const piece = STANDARD_BOARD[sq];
      return !!piece && piece.color === color && piece.role !== 'general';
    })
    .sort((a, b) => {
      const ca = coordOf(a);
      const cb = coordOf(b);
      return ca.rank - cb.rank || ca.file - cb.file;
    });
}

const RED_HOME = computeHomeSquares('red');
const BLACK_HOME = computeHomeSquares('black');

/** The 15 non-general starting squares for a side, in canonical deal order. */
export function jieqiHomeSquares(color: JieqiColor): JieqiSquare[] {
  return [...(color === 'red' ? RED_HOME : BLACK_HOME)];
}

/** The move-rule role a piece uses while it sits, dark, on `square`. */
export function jieqiStartingRole(square: JieqiSquare): JieqiPieceRole | undefined {
  return STARTING_ROLE[square];
}

/** The standard xiangqi arrangement expressed as a deal (each piece on home). */
export const STANDARD_JIEQI_DEAL: JieqiDeal = {
  red: RED_HOME.map((sq) => STARTING_ROLE[sq]!),
  black: BLACK_HOME.map((sq) => STARTING_ROLE[sq]!),
};

function roleMultiset(roles: JieqiPieceRole[]): string {
  return [...roles].sort().join(',');
}

const STANDARD_RED_MULTISET = roleMultiset(STANDARD_JIEQI_DEAL.red);
const STANDARD_BLACK_MULTISET = roleMultiset(STANDARD_JIEQI_DEAL.black);

/** Throws if `deal` is not a permutation of the standard 15-piece multiset. */
export function assertValidJieqiDeal(deal: JieqiDeal): void {
  if (deal.red.length !== RED_HOME.length || deal.black.length !== BLACK_HOME.length) {
    throw new Error(
      `invalid jieqi deal: expected ${RED_HOME.length} roles per side, ` +
        `got red=${deal.red.length} black=${deal.black.length}`,
    );
  }
  if (roleMultiset(deal.red) !== STANDARD_RED_MULTISET) {
    throw new Error('invalid jieqi deal: red roles are not a permutation of the standard set');
  }
  if (roleMultiset(deal.black) !== STANDARD_BLACK_MULTISET) {
    throw new Error('invalid jieqi deal: black roles are not a permutation of the standard set');
  }
  if (deal.undetermined) {
    for (const color of ['red', 'black'] as const) {
      const home = new Set<JieqiSquare>(color === 'red' ? RED_HOME : BLACK_HOME);
      for (const square of deal.undetermined[color] ?? []) {
        if (!home.has(square)) {
          throw new Error(
            `invalid jieqi deal: undetermined ${square} is not a ${color} home square`,
          );
        }
      }
    }
  }
}

function shuffleRoles(roles: JieqiPieceRole[], rng: () => number): JieqiPieceRole[] {
  const out = [...roles];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build a valid random deal by shuffling the standard 15-piece multiset for each
 * side. `rng` returns a float in [0, 1); the server supplies a crypto-backed one
 * (the deal is a hidden-information secret), tests supply a seeded one. The
 * resulting deal is always valid by construction.
 */
export function createJieqiDeal(rng: () => number): JieqiDeal {
  return {
    red: shuffleRoles(STANDARD_JIEQI_DEAL.red, rng),
    black: shuffleRoles(STANDARD_JIEQI_DEAL.black, rng),
  };
}

function generalSquare(color: JieqiColor): JieqiSquare {
  return color === 'red' ? squareOf(4, 1) : squareOf(4, 10);
}

export function oppositeJieqiColor(color: JieqiColor): JieqiColor {
  return color === 'red' ? 'black' : 'red';
}

export type JieqiInitialStateOptions = {
  // Enforce threefold repetition (the live rule for games created since
  // 2026-10). Off by default so replays and analysis walk any move list.
  repetition?: boolean;
};

export function createInitialJieqiState(
  gameId: string,
  deal: JieqiDeal = STANDARD_JIEQI_DEAL,
  opts: JieqiInitialStateOptions = {},
): JieqiGameState {
  assertValidJieqiDeal(deal);
  const board: JieqiBoard = {};
  board[generalSquare('red')] = { color: 'red', role: 'general', faceDown: false };
  board[generalSquare('black')] = { color: 'black', role: 'general', faceDown: false };
  const unknown = {
    red: new Set<JieqiSquare>(deal.undetermined?.red ?? []),
    black: new Set<JieqiSquare>(deal.undetermined?.black ?? []),
  };
  RED_HOME.forEach((sq, i) => {
    board[sq] = { color: 'red', role: deal.red[i], faceDown: true };
    if (unknown.red.has(sq)) board[sq].unknown = true;
  });
  BLACK_HOME.forEach((sq, i) => {
    board[sq] = { color: 'black', role: deal.black[i], faceDown: true };
    if (unknown.black.has(sq)) board[sq].unknown = true;
  });
  const state: JieqiGameState = {
    id: gameId,
    board,
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    noCaptureClock: 0,
    captures: [],
  };
  if (opts.repetition) {
    const key = jieqiPositionKey(board, 'red');
    state.positionCounts = { [key]: 1 };
    state.repetitionLog = [{ key }];
  }
  return state;
}

/**
 * The repetition key: every piece with its TRUE role and face-down flag, plus
 * the side to move. Server-only (it names hidden identities). A dark piece can
 * only leave its square by revealing, so within one repetition window this
 * distinguishes exactly the positions the masked board does.
 */
export function jieqiPositionKey(board: JieqiBoard, turn: JieqiColor): string {
  const pieces = (Object.entries(board) as [JieqiSquare, JieqiPiece | undefined][])
    .filter(([, piece]) => piece)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([sq, p]) => `${sq}:${p!.color}.${p!.role}${p!.faceDown ? '.d' : ''}`)
    .join(',');
  return `${turn}|${pieces}`;
}

// ── Move generation ─────────────────────────────────────────────────────────

function pieceAt(board: JieqiBoard, file: number, rank: number): JieqiPiece | undefined {
  return inBounds(file, rank) ? board[squareOf(file, rank)] : undefined;
}

function isOccupied(board: JieqiBoard, file: number, rank: number): boolean {
  return pieceAt(board, file, rank) !== undefined;
}

/**
 * The role a piece moves by, plus whether standard xiangqi confinement applies.
 * Dark pieces use their starting-point role under full confinement. Revealed
 * non-generals use their true role and are freed (advisor leaves the palace,
 * elephant crosses the river). Generals are always palace-confined.
 */
function effectiveRole(
  piece: JieqiPiece,
  square: JieqiSquare,
): { role: JieqiPieceRole; confined: boolean } {
  if (piece.faceDown) {
    return { role: STARTING_ROLE[square]!, confined: true };
  }
  return { role: piece.role, confined: piece.role === 'general' };
}

/** Squares a piece could move or capture to (geometry + blocking only). */
function pseudoDests(board: JieqiBoard, from: JieqiSquare): JieqiSquare[] {
  const piece = board[from];
  if (!piece) return [];
  const { file, rank } = coordOf(from);
  const { role, confined } = effectiveRole(piece, from);
  const color = piece.color;
  const dests: JieqiSquare[] = [];

  const tryStep = (f: number, r: number): void => {
    if (!inBounds(f, r)) return;
    const target = board[squareOf(f, r)];
    if (target && target.color === color) return;
    dests.push(squareOf(f, r));
  };

  switch (role) {
    case 'general':
      for (const [df, dr] of ORTHO) {
        const f = file + df;
        const r = rank + dr;
        if (inPalace(color, f, r)) tryStep(f, r);
      }
      break;
    case 'advisor':
      for (const [df, dr] of DIAG) {
        const f = file + df;
        const r = rank + dr;
        if (confined ? inPalace(color, f, r) : inBounds(f, r)) tryStep(f, r);
      }
      break;
    case 'elephant':
      for (const [df, dr] of ELEPHANT_STEPS) {
        const destF = file + df;
        const destR = rank + dr;
        if (!inBounds(destF, destR)) continue;
        if (confined && !inOwnHalf(color, destR)) continue; // dark elephant: own half only
        if (isOccupied(board, file + df / 2, rank + dr / 2)) continue; // eye block
        tryStep(destF, destR);
      }
      break;
    case 'horse':
      for (const [df, dr, legDf, legDr] of HORSE_STEPS) {
        if (isOccupied(board, file + legDf, rank + legDr)) continue; // leg block
        tryStep(file + df, rank + dr);
      }
      break;
    case 'chariot':
      for (const [df, dr] of ORTHO) {
        let f = file + df;
        let r = rank + dr;
        while (inBounds(f, r)) {
          const target = board[squareOf(f, r)];
          if (!target) {
            dests.push(squareOf(f, r));
          } else {
            if (target.color !== color) dests.push(squareOf(f, r));
            break;
          }
          f += df;
          r += dr;
        }
      }
      break;
    case 'cannon':
      for (const [df, dr] of ORTHO) {
        let f = file + df;
        let r = rank + dr;
        // Quiet moves up to the screen.
        while (inBounds(f, r) && !isOccupied(board, f, r)) {
          dests.push(squareOf(f, r));
          f += df;
          r += dr;
        }
        if (!inBounds(f, r)) continue; // screen
        f += df;
        r += dr;
        // Skip the gap past the screen.
        while (inBounds(f, r) && !isOccupied(board, f, r)) {
          f += df;
          r += dr;
        }
        if (!inBounds(f, r)) continue;
        const target = board[squareOf(f, r)];
        if (target && target.color !== color) dests.push(squareOf(f, r)); // capture over screen
      }
      break;
    case 'soldier': {
      const forward = color === 'red' ? 1 : -1;
      tryStep(file, rank + forward);
      if (hasCrossedRiver(color, rank)) {
        tryStep(file - 1, rank);
        tryStep(file + 1, rank);
      }
      break;
    }
  }
  return dests;
}

export function findJieqiGeneral(board: JieqiBoard, color: JieqiColor): JieqiSquare | undefined {
  for (const [sq, piece] of Object.entries(board)) {
    if (piece && piece.color === color && piece.role === 'general') return sq as JieqiSquare;
  }
  return undefined;
}

/**
 * Is `target` attacked by `byColor`? Used only against general squares, so the
 * facing-generals rule is folded in: an enemy general with a clear file to the
 * target attacks it (moving onto that file would be an illegal face-off).
 */
function isAttacked(
  board: JieqiBoard,
  byColor: JieqiColor,
  target: JieqiSquare,
  enemyGeneral: JieqiSquare | undefined = findJieqiGeneral(board, byColor),
): boolean {
  for (const [sq, piece] of Object.entries(board)) {
    if (!piece || piece.color !== byColor) continue;
    if (piece.role === 'general') continue; // handled via the flying-general check below
    if (pseudoDests(board, sq as JieqiSquare).includes(target)) return true;
  }
  if (enemyGeneral) {
    const g = coordOf(enemyGeneral);
    const t = coordOf(target);
    if (g.file === t.file && g.rank !== t.rank) {
      const lo = Math.min(g.rank, t.rank);
      const hi = Math.max(g.rank, t.rank);
      let clear = true;
      for (let r = lo + 1; r < hi; r += 1) {
        if (isOccupied(board, g.file, r)) {
          clear = false;
          break;
        }
      }
      if (clear) return true;
    }
  }
  return false;
}

/** Apply a move to a bare board, revealing a moved dark piece. */
function simulateBoard(board: JieqiBoard, from: JieqiSquare, to: JieqiSquare): JieqiBoard {
  const next: JieqiBoard = { ...board };
  const piece = next[from];
  if (!piece) return next;
  delete next[from];
  next[to] = piece.faceDown ? { ...piece, faceDown: false } : piece;
  return next;
}

// Both generals are located once per generation, not once per candidate: a
// candidate moves our general only when it starts on the general's square, and
// removes the enemy general only by capturing it. Applying a move validates and
// scores it with this, so it runs for every move of every replayed game (#476).
function legalMovesFromSquares(
  board: JieqiBoard,
  color: JieqiColor,
  froms: Iterable<JieqiSquare>,
  firstOnly: boolean,
): JieqiMove[] {
  const moves: JieqiMove[] = [];
  const enemy = oppositeJieqiColor(color);
  const ownGeneral = findJieqiGeneral(board, color);
  const enemyGeneral = findJieqiGeneral(board, enemy);
  for (const from of froms) {
    const piece = board[from];
    if (!piece || piece.color !== color) continue;
    for (const to of pseudoDests(board, from)) {
      const next = simulateBoard(board, from, to);
      const general = from === ownGeneral ? to : ownGeneral;
      // A move that captures the enemy general (pathological after legal play)
      // leaves us with a general and no self-check — it is allowed and wins.
      const enemyGeneralAfter = to === enemyGeneral ? undefined : enemyGeneral;
      if (general && isAttacked(next, enemy, general, enemyGeneralAfter)) continue;
      moves.push({ from, to });
      if (firstOnly) return moves;
    }
  }
  return moves;
}

function legalMovesOnBoard(board: JieqiBoard, color: JieqiColor): JieqiMove[] {
  return legalMovesFromSquares(board, color, Object.keys(board) as JieqiSquare[], false);
}

function hasLegalMove(board: JieqiBoard, color: JieqiColor): boolean {
  return legalMovesFromSquares(board, color, Object.keys(board) as JieqiSquare[], true).length > 0;
}

export function getJieqiLegalMoves(state: JieqiGameState): JieqiMove[] {
  if (state.status.type !== 'playing') return [];
  return legalMovesOnBoard(state.board, state.status.turn);
}

export function getJieqiLegalMovesFrom(state: JieqiGameState, from: JieqiSquare): JieqiMove[] {
  if (state.status.type !== 'playing') return [];
  const piece = state.board[from];
  if (!piece || piece.color !== state.status.turn) return [];
  return legalMovesFromSquares(state.board, state.status.turn, [from], false);
}

export function isJieqiLegalMove(state: JieqiGameState, move: JieqiMove): boolean {
  return getJieqiLegalMovesFrom(state, move.from).some((m) => m.to === move.to);
}

// ── Apply move + terminal detection ─────────────────────────────────────────

export type JieqiApplyMoveOptions = {
  noCaptureClockLimit?: number;
};

export function applyJieqiMove(
  state: JieqiGameState,
  move: JieqiMove,
  opts: JieqiApplyMoveOptions = {},
): JieqiGameState {
  if (state.status.type !== 'playing') return state;
  if (!isJieqiLegalMove(state, move)) return state;

  const turn = state.status.turn;
  const captured = state.board[move.to];
  const board = simulateBoard(state.board, move.from, move.to);
  const wasCapture = captured !== undefined;
  const noCaptureClock = wasCapture ? 0 : state.noCaptureClock + 1;
  const captures = wasCapture
    ? [
        ...state.captures,
        {
          owner: captured.color,
          role: captured.role,
          revealedAtCapture: !captured.faceDown,
          ...(captured.unknown && captured.faceDown ? { unknown: true as const } : {}),
        },
      ]
    : state.captures;
  const next = oppositeJieqiColor(turn);
  const moveNumber = turn === 'black' ? state.moveNumber + 1 : state.moveNumber;
  const limit = opts.noCaptureClockLimit ?? DEFAULT_NO_CAPTURE_PLY_LIMIT;

  // Repetition window: a capture or a reveal starts a new one (neither can be
  // undone, so no earlier position can come back).
  let positionCounts: Record<string, number> | undefined;
  let repetitionLog: JieqiRepetitionEntry[] | undefined;
  let repeatedThrice = false;
  if (state.positionCounts) {
    const key = jieqiPositionKey(board, next);
    const nextGeneral = findJieqiGeneral(board, next);
    const gaveCheck = nextGeneral ? isAttacked(board, turn, nextGeneral) : false;
    const entry: JieqiRepetitionEntry = { key, mover: turn, gaveCheck };
    const irreversible = wasCapture || state.board[move.from]?.faceDown === true;
    if (irreversible) {
      positionCounts = { [key]: 1 };
      repetitionLog = [entry];
    } else {
      positionCounts = { ...state.positionCounts, [key]: (state.positionCounts[key] ?? 0) + 1 };
      repetitionLog = [...(state.repetitionLog ?? []), entry];
    }
    repeatedThrice = (positionCounts[key] ?? 0) >= 3;
  }

  // Order: general capture > checkmate/stalemate > threefold > no-capture clock.
  let status: JieqiGameStatus = { type: 'playing', turn: next };
  if (captured?.role === 'general') {
    // Pathological under checkmate play, but score it as a win for safety.
    status = { type: 'finished', winner: turn, reason: 'checkmate' };
  } else if (!hasLegalMove(board, next)) {
    const general = findJieqiGeneral(board, next);
    const inCheck = general ? isAttacked(board, turn, general) : true;
    status = { type: 'finished', winner: turn, reason: inCheck ? 'checkmate' : 'stalemate' };
  } else if (repeatedThrice) {
    status = { type: 'finished', winner: null, reason: 'repetition' };
  } else if (noCaptureClock >= limit) {
    status = { type: 'finished', winner: null, reason: 'no-capture-clock' };
  }

  return {
    ...state,
    board,
    status,
    moveNumber,
    noCaptureClock,
    captures,
    lastMove: move,
    ...(positionCounts ? { positionCounts, repetitionLog } : {}),
  };
}

// ── Perpetual-check adjudication ────────────────────────────────────────────

/**
 * Jieqi wins and losses follow xiangqi, so a perpetual check loses. When a game
 * has just ended on 'repetition', take the cycle that closed it (the plies after
 * the second-to-last occurrence of the repeated position, through the last) and
 * name the side that gave check on every one of its own moves in it. Mutual
 * perpetual check and check-free cycles return null: the draw stands. Mirrors
 * xiangqiPerpetualCheckLoser; perpetual chase is not covered, as there.
 */
export function jieqiPerpetualCheckLoser(state: JieqiGameState): JieqiColor | null {
  const log = state.repetitionLog;
  if (!log || log.length === 0) return null;
  const repeatedKey = log[log.length - 1]!.key;
  const occurrences = log.flatMap((entry, i) => (entry.key === repeatedKey ? [i] : []));
  if (occurrences.length < 3) return null;
  const cycle = log.slice(occurrences[occurrences.length - 2]! + 1, occurrences.at(-1)! + 1);
  const perpetualBy = (color: JieqiColor): boolean => {
    const own = cycle.filter((entry) => entry.mover === color);
    return own.length > 0 && own.every((entry) => entry.gaveCheck === true);
  };
  const red = perpetualBy('red');
  const black = perpetualBy('black');
  if (red && !black) return 'red';
  if (black && !red) return 'black';
  return null;
}

// ── Player view (redaction) ─────────────────────────────────────────────────

/**
 * Is the side to move in check? Public information: a face-down piece moves, and
 * so attacks, as the role of its home square, so the masked board settles it and
 * the answer is the same for both seats and a spectator. Once the game is over
 * the side to move is the one that did not play the last move, so a checkmated
 * position still reads as check (the mating ply in a postgame history). This is
 * the reading for seatless views (truth, public); a seat's own view keeps the
 * per-perspective rule every variant view shares.
 */
export function isJieqiSideToMoveInCheck(state: JieqiGameState): boolean {
  const toMove = jieqiSideToMove(state);
  if (!toMove) return false;
  const general = findJieqiGeneral(state.board, toMove);
  return general ? isAttacked(state.board, oppositeJieqiColor(toMove), general) : false;
}

/**
 * The general the board should show in check, or null, from a board any viewer
 * holds: a masked seat or spectator board works, since a face-down piece
 * attacks as the role of its home square and its true role never matters. The
 * side is the one facing the move (checkSubjectColor).
 */
export function jieqiCheckedGeneral(
  board: JieqiBoard | JieqiPlayerBoard,
  status: JieqiGameStatus,
): JieqiSquare | null {
  const color = checkSubjectColor(status);
  if (!color) return null;
  const attackBoard: JieqiBoard = {};
  for (const [square, entry] of Object.entries(board)) {
    if (!entry) continue;
    // A face-down piece's role is never read for attacks (effectiveRole uses
    // the home square), so a placeholder stands in for a hidden one.
    attackBoard[square as JieqiSquare] =
      'role' in entry && entry.role
        ? { color: entry.color, role: entry.role, faceDown: entry.faceDown }
        : { color: entry.color, role: 'soldier', faceDown: true };
  }
  const general = findJieqiGeneral(attackBoard, color);
  if (!general) return null;
  return isAttacked(attackBoard, oppositeJieqiColor(color), general) ? general : null;
}

/**
 * The check suffix for the move that produced this position: `#` when it
 * checkmated, `+` when it left the side to move in check, '' otherwise. Check
 * is public in jieqi, so a masked view's board and status are enough.
 */
export function jieqiCheckMark(after: {
  board: JieqiBoard | JieqiPlayerBoard;
  status: JieqiGameStatus;
}): '' | '+' | '#' {
  if (after.status.type === 'finished' && after.status.reason === 'checkmate') return '#';
  if (after.status.type !== 'playing') return '';
  return jieqiCheckedGeneral(after.board, after.status) ? '+' : '';
}

/** A jieqi move label: from-to, then its check mark (jieqiCheckMark). */
export function jieqiMoveLabel(
  move: JieqiMove,
  after: { board: JieqiBoard | JieqiPlayerBoard; status: JieqiGameStatus },
): string {
  return `${move.from}-${move.to}${jieqiCheckMark(after)}`;
}

function jieqiSideToMove(state: JieqiGameState): JieqiColor | null {
  if (state.status.type === 'playing') return state.status.turn;
  const mover = state.lastMove ? state.board[state.lastMove.to]?.color : undefined;
  return mover ? oppositeJieqiColor(mover) : null;
}

// A full-information "truth" view (every identity revealed, every captured role
// carried with its full role) for postgame review. Unlike getJieqiPlayerView,
// nothing is redacted: this is the canonical board projected onto the player-view
// shape, so the review renderer can show every face-up identity. Never ship this
// to a live client — it is the postgame-only counterpart to the per-color views.
export function jieqiTruthView(state: JieqiGameState): JieqiPlayerView {
  return {
    id: state.id,
    perspective: 'red',
    board: jieqiTruthBoard(state),
    legalMoves: [],
    captured: jieqiTruthCaptures(state),
    inCheck: isJieqiSideToMoveInCheck(state),
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
  };
}

/** Every identity the game determined; a never-determined piece stays unknown. */
export function jieqiTruthBoard(state: JieqiGameState): JieqiPlayerBoard {
  const board: JieqiPlayerBoard = {};
  for (const [square, piece] of Object.entries(state.board)) {
    if (!piece) continue;
    board[square as JieqiSquare] =
      piece.unknown && piece.faceDown
        ? { color: piece.color, faceDown: true, unknown: true }
        : { color: piece.color, role: piece.role, faceDown: false };
  }
  return board;
}

/** Every captured role, except one captured before its identity was determined. */
export function jieqiTruthCaptures(state: JieqiGameState): JieqiCapturedView[] {
  return state.captures.map((c) => ({ owner: c.owner, role: c.unknown ? null : c.role }));
}

/** Home squares still face-down whose identity was never determined. */
export function jieqiUnknownSquares(state: JieqiGameState): JieqiSquare[] {
  return (Object.entries(state.board) as [JieqiSquare, JieqiPiece | undefined][])
    .filter(([, piece]) => piece?.unknown && piece.faceDown)
    .map(([square]) => square)
    .sort();
}

// The board as BOTH players see it. A face-down piece hides its role from its own
// owner too — in jieqi you learn what your piece was when you move it — so the
// masking rule is POV-free and the only per-color redaction is the captured pool.
// Shared so the postgame spectator projection (TV/watch) masks by the SAME rule the
// live per-color view does, rather than restating it and drifting from it.
export function jieqiMaskedBoard(state: JieqiGameState): JieqiPlayerBoard {
  const board: JieqiPlayerBoard = {};
  for (const [sq, piece] of Object.entries(state.board)) {
    if (!piece) continue;
    board[sq as JieqiSquare] = piece.faceDown
      ? { color: piece.color, faceDown: true }
      : { color: piece.color, role: piece.role, faceDown: false };
  }
  return board;
}

export function getJieqiPlayerView(state: JieqiGameState, color: JieqiColor): JieqiPlayerView {
  const board = jieqiMaskedBoard(state);

  // Capturer-only reveal: a captured role is known to the capturer, or if it was
  // already face-up when captured. The former owner of a still-dark piece never
  // learns it (they never knew it).
  const captured: JieqiCapturedView[] = state.captures.map((c) => {
    const capturer = oppositeJieqiColor(c.owner);
    const known = c.revealedAtCapture || capturer === color;
    return { owner: c.owner, role: known ? c.role : null };
  });

  const legalMoves =
    state.status.type === 'playing'
      ? getJieqiLegalMoves({ ...state, status: { type: 'playing', turn: color } })
      : [];

  let inCheck = false;
  if (state.status.type === 'playing') {
    const general = findJieqiGeneral(state.board, color);
    inCheck = general ? isAttacked(state.board, oppositeJieqiColor(color), general) : false;
  }

  return {
    id: state.id,
    perspective: color,
    board,
    legalMoves,
    captured,
    inCheck,
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
  };
}

// What a neutral observer knows from watching the board alone: the live
// spectator view (docs-private/spectator-visibility-matrix.md, the jieqi
// "public view" row). Strictly narrower than either seat's view:
//   - the board is the shared mask (jieqiMaskedBoard), which both seats see;
//   - a capture is listed by owner (the piece visibly left the board) with its
//     role only when the piece was already face-up when taken. A dark capture
//     stays `role: null`, which is exactly what the VICTIM sees for that piece,
//     so the observer never holds a role that one of the seats lacks;
//   - no legal moves (nothing to play); inCheck for the side to move
//     (isJieqiSideToMoveInCheck), which depends only on the public board.
// Never use this to reveal a finished game; that is jieqiTruthView.
export function getJieqiPublicView(state: JieqiGameState): JieqiPlayerView {
  const captured: JieqiCapturedView[] = state.captures.map((c) => ({
    owner: c.owner,
    role: c.revealedAtCapture ? c.role : null,
  }));
  return {
    id: state.id,
    perspective: 'red',
    board: jieqiMaskedBoard(state),
    legalMoves: [],
    captured,
    inCheck: isJieqiSideToMoveInCheck(state),
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
  };
}
