/**
 * A configurable xiangqi kernel for "xiangqi plus a rule" variants.
 *
 * Every candidate in the variant lab is standard xiangqi geometry with one
 * thing changed: a capture that explodes, a capture that is compulsory, a
 * general that may leave the palace, a side with no general, a win on
 * reaching a region. Hand-rolling the geometry per variant is where the bugs
 * live (the duck kernel needed a differential gate to be trusted), so the
 * geometry is written once here and the variants are configurations:
 *
 *   - regions per piece (palace / own half / whole board),
 *   - the facing rule (off, open file, rook line, or a capture),
 *   - the check rule (standard, none, or checks forbidden),
 *   - compulsory capture,
 *   - a blast on capture (shape, immune roles, palace containment),
 *   - royalty per side, extinction values, a flag region,
 *   - stalemate value, progress clock, repetition.
 *
 * The standard configuration is tied to the elephantops-backed standard
 * kernel by a differential test (xiangqi-rule-kernel.test.ts): with nothing
 * changed, this kernel generates exactly the validated kernel's legal moves
 * over hundreds of positions of real play. A variant that only configures
 * this module inherits that gate; a variant that adds a hook should add its
 * own with the hook disabled.
 *
 * NOT A SHIPPED KERNEL. No GameSpecId, no tenant, not re-exported from the
 * package index. It exists for the lab and for the write-ups' diagrams.
 * Perpetual-check and chase adjudication (the AXF chasing law) are out of
 * scope: repetition is a draw or off. The FEN codec is deliberately lenient
 * (a horde has soldiers on rank 1, a freed general stands outside the
 * palace) and validates bounds only.
 */

import type {
  XiangqiBoard,
  XiangqiColor,
  XiangqiMove,
  XiangqiPiece,
  XiangqiPieceRole,
  XiangqiSquare,
} from './variants-xiangqi.js';
import { createInitialXiangqiBoard } from './variants-xiangqi.js';

// ── Configuration ──────────────────────────────────────────────────────────

export type XiangqiRegion = 'palace' | 'ownHalf' | 'board';
export type FacingRule = 'off' | 'file' | 'rookline' | 'capture';
export type CheckRule = 'standard' | 'none' | 'forbidden';
export type BlastShape = 'orthogonal' | 'eight';
export type StalemateValue = 'loss' | 'win' | 'draw';
export type ExtinctionValue = 'none' | 'loses' | 'wins';

export type XiangqiRuleConfig = {
  /** Start array; the standard one by default. */
  startBoard?: XiangqiBoard;
  /** Where the general may stand. `palace` is xiangqi. */
  generalRegion?: XiangqiRegion;
  /** Where the advisors may stand. `palace` is xiangqi. */
  advisorRegion?: XiangqiRegion;
  /** Where the elephants may stand. `ownHalf` is xiangqi. */
  elephantRegion?: 'ownHalf' | 'board';
  /**
   * A royal side must not leave its general attacked (under `check:
   * standard`) and loses the moment its general is gone. A non-royal general
   * is an ordinary piece. A side with no general at all (horde) is non-royal.
   */
  royal?: { red: boolean; black: boolean };
  /**
   * `file`: the generals may not face down an open file (xiangqi). `rookline`:
   * nor along an open rank (for generals that leave the palace). `capture`:
   * facing is legal and a general may fly down the open file and take the
   * enemy general. `off`: no rule.
   */
  facing?: FacingRule;
  /**
   * `standard`: a move may not leave the mover's royal general attacked.
   * `none`: it may; the general is simply captured. `forbidden`: a move may
   * not attack the enemy general either (racing kings).
   */
  check?: CheckRule;
  /** If any capture is legal, only captures are legal (antichess). */
  mustCapture?: boolean;
  /**
   * On a capture, remove the capturing piece too and every non-immune piece
   * on the neighbouring points of the capture square. `palaceContained`: the
   * blast never crosses a palace boundary.
   */
  blast?: { shape: BlastShape; immune: readonly XiangqiPieceRole[]; palaceContained?: boolean };
  /** What happens to a side with no pieces left. */
  extinction?: { red: ExtinctionValue; black: ExtinctionValue };
  /**
   * A side whose general stands on one of its flag points after its move
   * wins. `blackReply`: if red reaches first, black has one reply to reach
   * too, in which case the game is drawn (racing kings).
   */
  flag?: {
    red: readonly XiangqiSquare[];
    black: readonly XiangqiSquare[];
    timing: 'immediate' | 'blackReply';
  };
  /** Result for the side to move with no legal move and not in check. `loss` is xiangqi. */
  stalemate?: StalemateValue;
  /** Plies without a capture before a draw. 60 is the site rule. */
  progressClock?: number;
  /** Three-fold repetition is a draw, or not adjudicated. */
  repetition?: 'draw' | 'off';
};

export const STANDARD_XIANGQI_RULES: Required<
  Omit<XiangqiRuleConfig, 'startBoard' | 'blast' | 'flag'>
> &
  Pick<XiangqiRuleConfig, 'startBoard' | 'blast' | 'flag'> = {
  generalRegion: 'palace',
  advisorRegion: 'palace',
  elephantRegion: 'ownHalf',
  royal: { red: true, black: true },
  facing: 'file',
  check: 'standard',
  mustCapture: false,
  extinction: { red: 'none', black: 'none' },
  stalemate: 'loss',
  progressClock: 60,
  repetition: 'draw',
};

type Resolved = typeof STANDARD_XIANGQI_RULES;

export function resolveXiangqiRules(config: XiangqiRuleConfig): Resolved {
  return { ...STANDARD_XIANGQI_RULES, ...config };
}

// ── State ──────────────────────────────────────────────────────────────────

export type XiangqiRuleEndReason =
  | 'general-captured'
  | 'checkmate'
  | 'stalemate'
  | 'extinction'
  | 'flag'
  | 'repetition'
  | 'progress-clock';

export type XiangqiRuleStatus =
  | { type: 'playing'; turn: XiangqiColor }
  | { type: 'finished'; winner: XiangqiColor | null; reason: XiangqiRuleEndReason };

export type XiangqiRuleState = {
  id: string;
  board: XiangqiBoard;
  status: XiangqiRuleStatus;
  /** Full moves, incremented after black's move; starts at 1. */
  moveNumber: number;
  /** Plies played. */
  ply: number;
  /** Plies since the last capture. */
  progressClock: number;
  lastMove?: XiangqiMove;
  positionCounts: Record<string, number>;
  /** Racing: red reached its flag; black has this reply to equalise. */
  flagPending?: XiangqiColor;
};

// ── Geometry ───────────────────────────────────────────────────────────────

export type Coord = { file: number; rank: number };

export function coordOf(square: XiangqiSquare): Coord {
  return { file: square.charCodeAt(0) - 97, rank: Number(square.slice(1)) };
}

export function squareOf(file: number, rank: number): XiangqiSquare {
  return `${String.fromCharCode(97 + file)}${rank}` as XiangqiSquare;
}

export function inBounds(file: number, rank: number): boolean {
  return file >= 0 && file <= 8 && rank >= 1 && rank <= 10;
}

export function inPalace(color: XiangqiColor, file: number, rank: number): boolean {
  if (file < 3 || file > 5) return false;
  return color === 'red' ? rank >= 1 && rank <= 3 : rank >= 8 && rank <= 10;
}

/** Either palace, whichever colour's. */
export function inAnyPalace(file: number, rank: number): boolean {
  return inPalace('red', file, rank) || inPalace('black', file, rank);
}

export function inOwnHalf(color: XiangqiColor, rank: number): boolean {
  return color === 'red' ? rank <= 5 : rank >= 6;
}

export function hasCrossedRiver(color: XiangqiColor, rank: number): boolean {
  return !inOwnHalf(color, rank);
}

function inRegion(
  region: XiangqiRegion | 'ownHalf' | 'board',
  color: XiangqiColor,
  file: number,
  rank: number,
): boolean {
  if (region === 'board') return true;
  if (region === 'ownHalf') return inOwnHalf(color, rank);
  return inPalace(color, file, rank);
}

const ALL_SQUARES: readonly XiangqiSquare[] = (() => {
  const out: XiangqiSquare[] = [];
  for (let rank = 1; rank <= 10; rank += 1)
    for (let file = 0; file < 9; file += 1) out.push(squareOf(file, rank));
  return out;
})();

export function allXiangqiSquares(): readonly XiangqiSquare[] {
  return ALL_SQUARES;
}

const ORTHO: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAG: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const HORSE: readonly (readonly [number, number, number, number])[] = [
  // [df, dr, legDf, legDr]
  [1, 2, 0, 1],
  [-1, 2, 0, 1],
  [1, -2, 0, -1],
  [-1, -2, 0, -1],
  [2, 1, 1, 0],
  [2, -1, 1, 0],
  [-2, 1, -1, 0],
  [-2, -1, -1, 0],
];

function* ray(from: Coord, df: number, dr: number): Generator<XiangqiSquare> {
  let file = from.file + df;
  let rank = from.rank + dr;
  while (inBounds(file, rank)) {
    yield squareOf(file, rank);
    file += df;
    rank += dr;
  }
}

export function findGeneral(board: XiangqiBoard, color: XiangqiColor): XiangqiSquare | null {
  for (const square of ALL_SQUARES) {
    const piece = board[square];
    if (piece && piece.role === 'general' && piece.color === color) return square;
  }
  return null;
}

/** Is the line between two squares on one file or rank clear? False if not aligned. */
function clearLineBetween(
  board: XiangqiBoard,
  a: XiangqiSquare,
  b: XiangqiSquare,
  allowRank: boolean,
): boolean {
  const ca = coordOf(a);
  const cb = coordOf(b);
  if (ca.file === cb.file) {
    const lo = Math.min(ca.rank, cb.rank);
    const hi = Math.max(ca.rank, cb.rank);
    for (let rank = lo + 1; rank < hi; rank += 1) if (board[squareOf(ca.file, rank)]) return false;
    return true;
  }
  if (allowRank && ca.rank === cb.rank) {
    const lo = Math.min(ca.file, cb.file);
    const hi = Math.max(ca.file, cb.file);
    for (let file = lo + 1; file < hi; file += 1) if (board[squareOf(file, ca.rank)]) return false;
    return true;
  }
  return false;
}

/** Do the generals bear on each other: same file (or rank, if `rookline`) with nothing between. */
export function generalsFace(board: XiangqiBoard, rookline = false): boolean {
  const red = findGeneral(board, 'red');
  const black = findGeneral(board, 'black');
  if (!red || !black) return false;
  return clearLineBetween(board, red, black, rookline);
}

/**
 * Where the piece on `square` could move before any legality rule: geometry,
 * regions and blockers only. `facing: capture` adds the flying capture.
 */
export function pseudoMovesFrom(
  board: XiangqiBoard,
  square: XiangqiSquare,
  rules: Resolved,
): XiangqiSquare[] {
  const piece = board[square];
  if (!piece) return [];
  const { color, role } = piece;
  const from = coordOf(square);
  const out: XiangqiSquare[] = [];
  const landable = (target: XiangqiSquare): boolean => {
    const occupant = board[target];
    return occupant === undefined || occupant.color !== color;
  };
  const step = (deltas: readonly (readonly [number, number])[], region: XiangqiRegion) => {
    for (const [df, dr] of deltas) {
      const file = from.file + df;
      const rank = from.rank + dr;
      if (!inBounds(file, rank) || !inRegion(region, color, file, rank)) continue;
      const target = squareOf(file, rank);
      if (landable(target)) out.push(target);
    }
  };
  switch (role) {
    case 'general': {
      step(ORTHO, rules.generalRegion);
      if (rules.facing === 'capture') {
        const enemy = findGeneral(board, color === 'red' ? 'black' : 'red');
        if (enemy && clearLineBetween(board, square, enemy, false)) out.push(enemy);
      }
      break;
    }
    case 'advisor':
      step(DIAG, rules.advisorRegion);
      break;
    case 'elephant': {
      for (const [df, dr] of DIAG) {
        const file = from.file + 2 * df;
        const rank = from.rank + 2 * dr;
        if (!inBounds(file, rank) || !inRegion(rules.elephantRegion, color, file, rank)) continue;
        if (board[squareOf(from.file + df, from.rank + dr)]) continue; // the eye
        const target = squareOf(file, rank);
        if (landable(target)) out.push(target);
      }
      break;
    }
    case 'horse': {
      for (const [df, dr, legDf, legDr] of HORSE) {
        const file = from.file + df;
        const rank = from.rank + dr;
        if (!inBounds(file, rank)) continue;
        if (board[squareOf(from.file + legDf, from.rank + legDr)]) continue; // the leg
        const target = squareOf(file, rank);
        if (landable(target)) out.push(target);
      }
      break;
    }
    case 'chariot': {
      for (const [df, dr] of ORTHO) {
        for (const target of ray(from, df, dr)) {
          if (!board[target]) {
            out.push(target);
            continue;
          }
          if (landable(target)) out.push(target);
          break;
        }
      }
      break;
    }
    case 'cannon': {
      for (const [df, dr] of ORTHO) {
        let screened = false;
        for (const target of ray(from, df, dr)) {
          const blocked = board[target] !== undefined;
          if (!screened) {
            if (!blocked) {
              out.push(target);
              continue;
            }
            screened = true;
            continue;
          }
          if (!blocked) continue;
          if (landable(target)) out.push(target);
          break;
        }
      }
      break;
    }
    case 'soldier': {
      const forward = color === 'red' ? 1 : -1;
      const steps: (readonly [number, number])[] = [[0, forward]];
      if (hasCrossedRiver(color, from.rank)) steps.push([1, 0], [-1, 0]);
      for (const [df, dr] of steps) {
        const file = from.file + df;
        const rank = from.rank + dr;
        if (!inBounds(file, rank)) continue;
        const target = squareOf(file, rank);
        if (landable(target)) out.push(target);
      }
      break;
    }
  }
  return out;
}

/** Is `target` attacked by any piece of `by`? */
export function isAttacked(
  board: XiangqiBoard,
  by: XiangqiColor,
  target: XiangqiSquare,
  rules: Resolved,
): boolean {
  for (const square of ALL_SQUARES) {
    const piece = board[square];
    if (!piece || piece.color !== by) continue;
    if (pseudoMovesFrom(board, square, rules).includes(target)) return true;
  }
  return false;
}

export function generalAttacked(
  board: XiangqiBoard,
  color: XiangqiColor,
  rules: Resolved,
): boolean {
  const at = findGeneral(board, color);
  return at !== null && isAttacked(board, color === 'red' ? 'black' : 'red', at, rules);
}

// ── Applying a move to a board ─────────────────────────────────────────────

function blastSquares(center: XiangqiSquare, rules: Resolved): XiangqiSquare[] {
  const blast = rules.blast;
  if (!blast) return [];
  const c = coordOf(center);
  const deltas = blast.shape === 'eight' ? [...ORTHO, ...DIAG] : ORTHO;
  const out: XiangqiSquare[] = [];
  for (const [df, dr] of deltas) {
    const file = c.file + df;
    const rank = c.rank + dr;
    if (!inBounds(file, rank)) continue;
    if (blast.palaceContained) {
      // The blast never crosses a palace boundary, in either direction.
      const centerIn = inAnyPalace(c.file, c.rank);
      const targetIn = inAnyPalace(file, rank);
      if (centerIn !== targetIn) continue;
      if (centerIn && targetIn && inPalace('red', c.file, c.rank) !== inPalace('red', file, rank))
        continue;
    }
    out.push(squareOf(file, rank));
  }
  return out;
}

/** The board after `move`, blast included. Does not check legality. */
export function boardAfter(
  board: XiangqiBoard,
  move: XiangqiMove,
  rules: Resolved,
): { board: XiangqiBoard; captured: boolean } {
  const piece = board[move.from];
  if (!piece) throw new Error(`no piece on ${move.from}`);
  const next: XiangqiBoard = { ...board };
  const captured = next[move.to] !== undefined;
  delete next[move.from];
  next[move.to] = piece;
  if (captured && rules.blast) {
    delete next[move.to];
    for (const square of blastSquares(move.to, rules)) {
      const victim = next[square];
      if (victim && !rules.blast.immune.includes(victim.role)) delete next[square];
    }
  }
  return { board: next, captured };
}

// ── Legality ───────────────────────────────────────────────────────────────

function otherColor(color: XiangqiColor): XiangqiColor {
  return color === 'red' ? 'black' : 'red';
}

function isLegalOn(
  board: XiangqiBoard,
  mover: XiangqiColor,
  move: XiangqiMove,
  rules: Resolved,
): boolean {
  const { board: after } = boardAfter(board, move, rules);
  const enemy = otherColor(mover);
  const ownRoyal = rules.royal[mover];
  const enemyRoyal = rules.royal[enemy];
  // A royal side may never lose its own general to its own move (a blast).
  if (ownRoyal && findGeneral(after, mover) === null) return false;
  // Removing the enemy's royal general ends the game and outranks every
  // other legality rule below (atomic: exploding the king wins even from check).
  if (enemyRoyal && findGeneral(after, enemy) === null) return true;
  if (rules.facing === 'file' && generalsFace(after, false)) return false;
  if (rules.facing === 'rookline' && generalsFace(after, true)) return false;
  if (rules.check === 'standard' && ownRoyal && generalAttacked(after, mover, rules)) return false;
  if (rules.check === 'forbidden' && enemyRoyal && generalAttacked(after, enemy, rules))
    return false;
  return true;
}

export function legalMovesOn(
  board: XiangqiBoard,
  mover: XiangqiColor,
  rules: Resolved,
): XiangqiMove[] {
  const out: XiangqiMove[] = [];
  for (const from of ALL_SQUARES) {
    const piece = board[from];
    if (!piece || piece.color !== mover) continue;
    for (const to of pseudoMovesFrom(board, from, rules)) {
      const move = { from, to };
      if (isLegalOn(board, mover, move, rules)) out.push(move);
    }
  }
  if (rules.mustCapture) {
    const captures = out.filter((m) => board[m.to] !== undefined);
    if (captures.length > 0) return captures;
  }
  return out;
}

// ── The kernel ─────────────────────────────────────────────────────────────

const FEN_ROLE: Record<string, XiangqiPieceRole> = {
  k: 'general',
  a: 'advisor',
  b: 'elephant',
  e: 'elephant',
  n: 'horse',
  h: 'horse',
  r: 'chariot',
  c: 'cannon',
  p: 'soldier',
};
const ROLE_FEN: Record<XiangqiPieceRole, string> = {
  general: 'k',
  advisor: 'a',
  elephant: 'b',
  horse: 'n',
  chariot: 'r',
  cannon: 'c',
  soldier: 'p',
};

export function placementOf(board: XiangqiBoard): string {
  const rows: string[] = [];
  for (let rank = 10; rank >= 1; rank -= 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 9; file += 1) {
      const piece = board[squareOf(file, rank)];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) {
        row += String(empty);
        empty = 0;
      }
      const code = ROLE_FEN[piece.role];
      row += piece.color === 'red' ? code.toUpperCase() : code;
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return rows.join('/');
}

/** Bounds-only parse of a placement: any piece on any point. */
export function parsePlacement(placement: string): XiangqiBoard | null {
  const rows = placement.split('/');
  if (rows.length !== 10) return null;
  const board: XiangqiBoard = {};
  for (let i = 0; i < 10; i += 1) {
    const rank = 10 - i;
    let file = 0;
    for (const ch of rows[i]!) {
      if (ch >= '1' && ch <= '9') {
        file += Number(ch);
        continue;
      }
      const role = FEN_ROLE[ch.toLowerCase()];
      if (!role || file > 8) return null;
      board[squareOf(file, rank)] = { color: ch === ch.toUpperCase() ? 'red' : 'black', role };
      file += 1;
    }
    if (file !== 9) return null;
  }
  return board;
}

function positionKey(board: XiangqiBoard, turn: XiangqiColor): string {
  return `${placementOf(board)} ${turn}`;
}

export type XiangqiRuleKernel = {
  readonly rules: Resolved;
  initial(id: string): XiangqiRuleState;
  status(state: XiangqiRuleState): XiangqiRuleStatus;
  legalMoves(state: XiangqiRuleState): XiangqiMove[];
  isLegal(state: XiangqiRuleState, move: XiangqiMove): boolean;
  apply(state: XiangqiRuleState, move: XiangqiMove): XiangqiRuleState;
  fen(state: XiangqiRuleState): string;
  parseFen(fen: string, id: string): XiangqiRuleState | null;
  ply(state: XiangqiRuleState): number;
  moveKey(move: XiangqiMove): string;
  toUci(move: XiangqiMove): string;
  fromUci(state: XiangqiRuleState, uci: string): XiangqiMove | null;
};

const UCI_MOVE = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;

export function createXiangqiRuleKernel(config: XiangqiRuleConfig = {}): XiangqiRuleKernel {
  const rules = resolveXiangqiRules(config);

  const fromBoard = (
    id: string,
    board: XiangqiBoard,
    turn: XiangqiColor,
    progressClock: number,
    moveNumber: number,
  ): XiangqiRuleState => ({
    id,
    board,
    status: { type: 'playing', turn },
    moveNumber,
    ply: (moveNumber - 1) * 2 + (turn === 'black' ? 1 : 0),
    progressClock,
    positionCounts: { [positionKey(board, turn)]: 1 },
  });

  const legalMoves = (state: XiangqiRuleState): XiangqiMove[] =>
    state.status.type === 'playing' ? legalMovesOn(state.board, state.status.turn, rules) : [];

  const finish = (
    state: XiangqiRuleState,
    winner: XiangqiColor | null,
    reason: XiangqiRuleEndReason,
  ): XiangqiRuleState => ({
    ...state,
    status: { type: 'finished', winner, reason },
  });

  /** The terminal rules, in order of precedence, after `mover` has moved. */
  const adjudicate = (
    state: XiangqiRuleState,
    mover: XiangqiColor,
    captured: boolean,
  ): XiangqiRuleState => {
    const next = otherColor(mover);
    const board = state.board;
    if (rules.royal[next] && findGeneral(board, next) === null)
      return finish(state, mover, 'general-captured');
    for (const color of ['red', 'black'] as const) {
      const value = rules.extinction[color];
      if (value === 'none') continue;
      if (ALL_SQUARES.some((s) => board[s]?.color === color)) continue;
      return finish(state, value === 'wins' ? color : otherColor(color), 'extinction');
    }
    if (rules.flag) {
      const at = findGeneral(board, mover);
      const reached = at !== null && rules.flag[mover].includes(at);
      if (state.flagPending === next) {
        // Black's reply to red reaching the flag: both reached is a draw.
        return reached ? finish(state, null, 'flag') : finish(state, next, 'flag');
      }
      if (reached) {
        if (rules.flag.timing === 'blackReply' && mover === 'red') {
          const pending: XiangqiRuleState = { ...state, flagPending: mover };
          // If black cannot reach in one move, red has already won.
          const blackCanReach = legalMovesOn(board, 'black', rules).some((m) => {
            const after = boardAfter(board, m, rules).board;
            const g = findGeneral(after, 'black');
            return g !== null && rules.flag!.black.includes(g);
          });
          return blackCanReach ? pending : finish(state, 'red', 'flag');
        }
        return finish(state, mover, 'flag');
      }
    }
    const replies = legalMovesOn(board, next, rules);
    if (replies.length === 0) {
      const inCheck =
        rules.check === 'standard' && rules.royal[next] && generalAttacked(board, next, rules);
      if (inCheck) return finish(state, mover, 'checkmate');
      if (rules.stalemate === 'loss') return finish(state, mover, 'stalemate');
      if (rules.stalemate === 'win') return finish(state, next, 'stalemate');
      return finish(state, null, 'stalemate');
    }
    if (!captured && state.progressClock >= rules.progressClock)
      return finish(state, null, 'progress-clock');
    if (rules.repetition === 'draw' && (state.positionCounts[positionKey(board, next)] ?? 0) >= 3) {
      return finish(state, null, 'repetition');
    }
    return state;
  };

  return {
    rules,
    initial: (id) => fromBoard(id, config.startBoard ?? createInitialXiangqiBoard(), 'red', 0, 1),
    status: (state) => state.status,
    legalMoves,
    isLegal: (state, move) => {
      if (state.status.type !== 'playing') return false;
      const piece = state.board[move.from];
      if (!piece || piece.color !== state.status.turn) return false;
      if (!pseudoMovesFrom(state.board, move.from, rules).includes(move.to)) return false;
      if (!isLegalOn(state.board, state.status.turn, move, rules)) return false;
      if (rules.mustCapture && state.board[move.to] === undefined) {
        return !legalMovesOn(state.board, state.status.turn, rules).some(
          (m) => state.board[m.to] !== undefined,
        );
      }
      return true;
    },
    apply: (state, move) => {
      if (state.status.type !== 'playing') throw new Error('game is over');
      const mover = state.status.turn;
      const { board, captured } = boardAfter(state.board, move, rules);
      const next = otherColor(mover);
      const key = positionKey(board, next);
      const counts = captured
        ? { [key]: 1 }
        : { ...state.positionCounts, [key]: (state.positionCounts[key] ?? 0) + 1 };
      const moved: XiangqiRuleState = {
        ...state,
        board,
        status: { type: 'playing', turn: next },
        moveNumber: mover === 'black' ? state.moveNumber + 1 : state.moveNumber,
        ply: state.ply + 1,
        progressClock: captured ? 0 : state.progressClock + 1,
        lastMove: move,
        positionCounts: counts,
      };
      return adjudicate(moved, mover, captured);
    },
    fen: (state) => {
      const turn = state.status.type === 'playing' && state.status.turn === 'black' ? 'b' : 'w';
      return `${placementOf(state.board)} ${turn} - - ${state.progressClock} ${state.moveNumber}`;
    },
    parseFen: (fen, id) => {
      const fields = fen.trim().split(/\s+/);
      const board = parsePlacement(fields[0] ?? '');
      if (!board) return null;
      const turn: XiangqiColor = fields[1] === 'b' ? 'black' : 'red';
      const progress = Number(fields[4] ?? 0);
      const moveNumber = Number(fields[5] ?? 1);
      if (!Number.isFinite(progress) || !Number.isFinite(moveNumber) || moveNumber < 1) return null;
      return fromBoard(id, board, turn, progress, moveNumber);
    },
    ply: (state) => state.ply,
    moveKey: (move) => `${move.from}${move.to}`,
    toUci: (move) => `${move.from}${move.to}`,
    fromUci: (_state, uci) => {
      const m = UCI_MOVE.exec(uci);
      return m ? { from: m[1] as XiangqiSquare, to: m[2] as XiangqiSquare } : null;
    },
  };
}

/** A start array from a map of squares to pieces, for hordes and shuffles. */
export function boardFrom(pieces: Readonly<Record<string, XiangqiPiece>>): XiangqiBoard {
  const board: XiangqiBoard = {};
  for (const [square, piece] of Object.entries(pieces)) board[square as XiangqiSquare] = piece;
  return board;
}
