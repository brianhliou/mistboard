// Pure Gomoku kernel (#761) and the open-information room view (#768).
import openingPool from './gomoku-openings.json' with { type: 'json' };
import type { AbortReason } from './types.js';
export const GOMOKU_BOARD_SIZE = 15;
const POINT_COUNT = GOMOKU_BOARD_SIZE * GOMOKU_BOARD_SIZE;
const FILES = 'abcdefghijklmno';
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

export type GomokuColor = 'black' | 'white';
export type GomokuRule = 'freestyle';
export type GomokuSquare = `${
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15}`;
export type GomokuMove = { readonly to: GomokuSquare };
export type GomokuStone = { square: GomokuSquare; color: GomokuColor };
export type GomokuOpening = {
  readonly stones: readonly GomokuStone[];
  readonly turn: GomokuColor;
  readonly rule?: GomokuRule;
};
export const GOMOKU_OPENING_SCREEN = openingPool.screening;
export const GOMOKU_OPENINGS = openingPool.openings as readonly (GomokuOpening & {
  readonly id: string;
  readonly classicId?: string;
  readonly source?: 'classic' | 'mined-2B3W-7x7';
  readonly screening: {
    readonly score: number;
    readonly finalScore: number;
    readonly winrate: number;
    readonly nodes: number;
    readonly depth: number;
    readonly forcedWin: boolean;
  };
})[];
// New games use only mined 2B+3W positions. Keep the full pool above and
// opening validation unchanged so recorded classic openings still replay.
export const GOMOKU_DEALT_OPENINGS: typeof GOMOKU_OPENINGS = GOMOKU_OPENINGS.filter(
  (opening) => opening.source === 'mined-2B3W-7x7',
);
export type GomokuStatus =
  | { readonly type: 'playing'; readonly turn: GomokuColor }
  | { readonly type: 'finished'; readonly winner: GomokuColor; readonly reason: 'five' }
  | { readonly type: 'finished'; readonly winner: null; readonly reason: 'board-full' };
export type GomokuState = {
  readonly rule: GomokuRule;
  // Flat row-major board: a1 = 0, o1 = 14, a2 = 15, o15 = 224.
  readonly board: readonly (GomokuColor | null)[];
  readonly status: GomokuStatus;
  // Total stones, including any dealt opening; the turn is explicit in status.
  readonly ply: number;
  readonly lastMove?: GomokuMove;
};

// The live referee can also end a game by clock, resignation or agreement.
// Keep those room endings outside the kernel's placement-only status union.
export type GomokuRoomState = Omit<GomokuState, 'status'> & {
  readonly id: string;
  readonly moveNumber: number;
  // Public starting stones for replay. Legacy empty-board rooms omit this.
  // Screening evaluations stay off the wire.
  readonly opening?: GomokuOpening;
  readonly status:
    | GomokuStatus
    | {
        readonly type: 'finished';
        readonly winner: GomokuColor | null;
        readonly reason: 'timeout' | 'resignation' | 'abandonment' | 'agreement';
      }
    | { readonly type: 'aborted'; readonly reason: AbortReason };
};

export type GomokuPlayerView = GomokuRoomState & {
  readonly perspective: GomokuColor;
  readonly legalMoves: readonly GomokuMove[];
  readonly winningLine: readonly GomokuSquare[];
};

export function isGomokuColor(value: unknown): value is GomokuColor {
  return value === 'black' || value === 'white';
}

export function createGomokuRoomState(id: string, opening?: GomokuOpening): GomokuRoomState {
  const initial = createInitialGomokuState(opening);
  return {
    ...initial,
    id,
    moveNumber: 1,
    ...(opening
      ? { opening: { stones: opening.stones.map((stone) => ({ ...stone })), turn: opening.turn } }
      : {}),
  };
}

export function applyGomokuRoomMove(state: GomokuRoomState, move: GomokuMove): GomokuRoomState {
  if (state.status.type !== 'playing') return state;
  const kernel: GomokuState = { ...state, status: state.status };
  const next = applyGomokuMove(kernel, move);
  if (next === kernel) return state;
  return {
    ...next,
    id: state.id,
    moveNumber: 1 + Math.floor((next.ply - (state.opening?.stones.length ?? 0)) / 2),
    ...(state.opening ? { opening: state.opening } : {}),
  };
}

/** Public terminal evidence, never an evaluation or a live threat overlay. */
function winningLine(state: GomokuRoomState): GomokuSquare[] {
  if (state.status.type !== 'finished' || state.status.reason !== 'five' || !state.lastMove)
    return [];
  const index = indexOf(state.lastMove.to);
  const col = index % GOMOKU_BOARD_SIZE;
  const row = Math.floor(index / GOMOKU_BOARD_SIZE);
  for (const [dx, dy] of DIRECTIONS) {
    const line = [state.lastMove.to];
    for (const sign of [-1, 1]) {
      for (let step = 1; step < GOMOKU_BOARD_SIZE; step += 1) {
        const x = col + dx * sign * step;
        const y = row + dy * sign * step;
        if (x < 0 || x >= GOMOKU_BOARD_SIZE || y < 0 || y >= GOMOKU_BOARD_SIZE) break;
        if (state.board[y * GOMOKU_BOARD_SIZE + x] !== state.status.winner) break;
        const square = moveAt(y * GOMOKU_BOARD_SIZE + x).to;
        if (sign === -1) line.unshift(square);
        else line.push(square);
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}

export function getGomokuPlayerView(
  state: GomokuRoomState,
  perspective: GomokuColor,
  spectator = false,
): GomokuPlayerView {
  return {
    ...state,
    perspective,
    legalMoves:
      !spectator && state.status.type === 'playing' && state.status.turn === perspective
        ? getGomokuLegalMoves({ ...state, status: state.status })
        : [],
    winningLine: winningLine(state),
  };
}

/** Strict canonical a1-o15 notation; ranks increase from row 0 (a1) to row 14. */
export function parseGomokuMove(notation: string): GomokuMove | null {
  const match = /^[a-o](?:[1-9]|1[0-5])$/.exec(notation);
  // JS's $ also matches before a final newline: require the entire input.
  return match && match[0] === notation ? { to: notation as GomokuSquare } : null;
}

export function formatGomokuMove(move: GomokuMove): string {
  if (!parseGomokuMove(move.to)) throw new Error('Invalid Gomoku coordinate');
  return move.to;
}

function indexOf(square: GomokuSquare): number {
  return (Number(square.slice(1)) - 1) * GOMOKU_BOARD_SIZE + square.charCodeAt(0) - 97;
}

function moveAt(index: number): GomokuMove {
  return {
    to: `${FILES[index % GOMOKU_BOARD_SIZE]}${1 + Math.floor(index / GOMOKU_BOARD_SIZE)}` as GomokuSquare,
  };
}

function opposite(color: GomokuColor): GomokuColor {
  return color === 'black' ? 'white' : 'black';
}

/** Canonical study position: ranks 15..1, B/W stones, decimal empty runs,
 * then b/w to move. No move history or opening-screen metadata is encoded.
 * A finished state has no side to move and cannot be a study start. */
export function gomokuFen(state: Pick<GomokuRoomState, 'board' | 'status'>): string {
  if (state.status.type !== 'playing') throw new Error('Gomoku position has no side to move');
  const rows: string[] = [];
  for (let row = GOMOKU_BOARD_SIZE - 1; row >= 0; row -= 1) {
    let rank = '';
    let empty = 0;
    for (let file = 0; file < GOMOKU_BOARD_SIZE; file += 1) {
      const color = state.board[row * GOMOKU_BOARD_SIZE + file];
      if (!color) {
        empty += 1;
        continue;
      }
      if (empty) rank += String(empty);
      empty = 0;
      rank += color === 'black' ? 'B' : 'W';
    }
    if (empty) rank += String(empty);
    rows.push(rank);
  }
  return `${rows.join('/')} ${state.status.turn === 'black' ? 'b' : 'w'}`;
}

export type ParseGomokuFenResult =
  | { ok: true; state: GomokuRoomState }
  | { ok: false; error: string };

/** Study roots accept either turn independently of stone counts: a dealt
 * opening (and its continuations) need not follow empty-board parity. The
 * board must be 15x15 and undecided so replay can continue from it. */
export function parseGomokuFen(fen: string, id = 'fen-import'): ParseGomokuFenResult {
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 2) return { ok: false, error: 'Expected a board and side-to-move.' };
  const turn = fields[1] === 'b' ? 'black' : fields[1] === 'w' ? 'white' : null;
  if (!turn) return { ok: false, error: 'Expected side-to-move b or w.' };
  const rows = fields[0]!.split('/');
  if (rows.length !== GOMOKU_BOARD_SIZE) return { ok: false, error: 'Expected 15 ranks.' };
  const board: (GomokuColor | null)[] = Array(POINT_COUNT).fill(null);
  const stones: GomokuStone[] = [];
  for (let row = 0; row < GOMOKU_BOARD_SIZE; row += 1) {
    let file = 0;
    for (const token of rows[row]!.match(/\d+|./g) ?? []) {
      if (/^[1-9]\d*$/.test(token)) {
        file += Number(token);
      } else if (token === 'B' || token === 'W') {
        if (file >= GOMOKU_BOARD_SIZE) return { ok: false, error: 'Rank exceeds 15 files.' };
        const index = (GOMOKU_BOARD_SIZE - 1 - row) * GOMOKU_BOARD_SIZE + file;
        const color = token === 'B' ? 'black' : 'white';
        board[index] = color;
        stones.push({ square: moveAt(index).to, color });
        file += 1;
      } else {
        return { ok: false, error: `Invalid Gomoku placement token "${token}".` };
      }
      if (file > GOMOKU_BOARD_SIZE) return { ok: false, error: 'Rank exceeds 15 files.' };
    }
    if (file !== GOMOKU_BOARD_SIZE) return { ok: false, error: 'Expected 15 files per rank.' };
  }
  if (stones.length === POINT_COUNT) return { ok: false, error: 'Gomoku board is already full.' };
  for (let index = 0; index < POINT_COUNT; index += 1) {
    const color = board[index];
    if (color && makesFive(board, index, color)) {
      return { ok: false, error: 'Gomoku position already contains five in a row.' };
    }
  }
  return {
    ok: true,
    state: {
      id,
      rule: 'freestyle',
      board,
      ply: stones.length,
      moveNumber: 1,
      status: { type: 'playing', turn },
      opening: { stones, turn },
    },
  };
}

// The origin is treated as `color` even when it is empty. This lets the threat
// helpers test a placement without cloning or mutating the board. At most four
// neighbors in either direction are needed for freestyle's >= 5 rule.
function makesFive(board: GomokuState['board'], index: number, color: GomokuColor): boolean {
  const col = index % GOMOKU_BOARD_SIZE;
  const row = Math.floor(index / GOMOKU_BOARD_SIZE);
  for (const [dx, dy] of DIRECTIONS) {
    let length = 1;
    for (const sign of [-1, 1]) {
      for (let step = 1; step <= 4; step += 1) {
        const x = col + dx * sign * step;
        const y = row + dy * sign * step;
        if (x < 0 || x >= GOMOKU_BOARD_SIZE || y < 0 || y >= GOMOKU_BOARD_SIZE) break;
        if (board[y * GOMOKU_BOARD_SIZE + x] !== color) break;
        length += 1;
      }
    }
    if (length >= 5) return true;
  }
  return false;
}

/** Validate a dealt opening once; subsequent helpers accept states from here
 * or applyGomokuMove. There are no captures or forbidden moves in freestyle,
 * so supported dealt counts and the absence of an existing five suffice. */
export function createInitialGomokuState(
  opening: GomokuOpening = { stones: [], turn: 'black' },
): GomokuState {
  const rule = opening.rule ?? 'freestyle';
  if (rule !== 'freestyle') throw new Error('Unsupported Gomoku rule');
  if (opening.turn !== 'black' && opening.turn !== 'white') throw new Error('Invalid Gomoku turn');
  const board: (GomokuColor | null)[] = Array(POINT_COUNT).fill(null);
  let black = 0;
  let white = 0;
  for (const stone of opening.stones) {
    if (!parseGomokuMove(stone.square)) throw new Error('Invalid Gomoku coordinate');
    if (stone.color !== 'black' && stone.color !== 'white') throw new Error('Invalid Gomoku color');
    const index = indexOf(stone.square);
    if (board[index] !== null) throw new Error('Duplicate Gomoku stone');
    board[index] = stone.color;
    if (stone.color === 'black') black += 1;
    else white += 1;
  }
  // Mined five-stone deals reverse the usual colour counts. Black moves
  // first from 2B+3W; never infer the turn from the total stone count.
  const minedDeal = black === 2 && white === 3 && opening.turn === 'black';
  if (!minedDeal && black !== white + (opening.turn === 'white' ? 1 : 0)) {
    throw new Error('Gomoku stone counts do not match the side to move');
  }
  for (let index = 0; index < POINT_COUNT; index += 1) {
    const color = board[index];
    if (color && makesFive(board, index, color)) {
      throw new Error('Gomoku opening already contains five in a row');
    }
  }
  const ply = black + white;
  return {
    rule,
    board,
    ply,
    status:
      ply === POINT_COUNT
        ? { type: 'finished', winner: null, reason: 'board-full' }
        : { type: 'playing', turn: opening.turn },
  };
}

/** Every empty point is legal in freestyle. Terminal states have no moves. */
export function getGomokuLegalMoves(state: GomokuState): GomokuMove[] {
  if (state.status.type !== 'playing') return [];
  const moves: GomokuMove[] = [];
  for (let index = 0; index < POINT_COUNT; index += 1) {
    if (state.board[index] === null) moves.push(moveAt(index));
  }
  return moves;
}

/** Immutable placement; an illegal move returns the original state, matching
 * the other variant kernels. A five on the last empty point wins before draw. */
export function applyGomokuMove(state: GomokuState, move: GomokuMove): GomokuState {
  if (state.status.type !== 'playing' || !parseGomokuMove(move.to)) return state;
  const index = indexOf(move.to);
  if (state.board[index] !== null) return state;
  const color = state.status.turn;
  const board = [...state.board];
  board[index] = color;
  const ply = state.ply + 1;
  let status: GomokuStatus;
  if (makesFive(board, index, color)) status = { type: 'finished', winner: color, reason: 'five' };
  else if (ply === POINT_COUNT) status = { type: 'finished', winner: null, reason: 'board-full' };
  else status = { type: 'playing', turn: opposite(color) };
  return { rule: state.rule, board, ply, status, lastMove: { to: move.to } };
}

function winningPlacements(state: GomokuState, color: GomokuColor): GomokuMove[] {
  const moves: GomokuMove[] = [];
  for (let index = 0; index < POINT_COUNT; index += 1) {
    if (state.board[index] === null && makesFive(state.board, index, color)) {
      moves.push(moveAt(index));
    }
  }
  return moves;
}

/** All immediate wins for the side to move, in board order (a1..o1, a2..o15).
 * O(225 * 4 directions * 8 neighbors), with no speculative board copies. */
export function winsInOne(pos: GomokuState): GomokuMove[] {
  return pos.status.type === 'playing' ? winningPlacements(pos, pos.status.turn) : [];
}

/** The opponent's immediate winning points, in board order. These remain
 * reported even if the mover can win now: callers should prefer winsInOne.
 * Multiple distinct points mean no single block suffices; this is a threat
 * list, not a promise that a defensive move can save the position. */
export function mustBlock(pos: GomokuState): GomokuMove[] {
  return pos.status.type === 'playing' ? winningPlacements(pos, opposite(pos.status.turn)) : [];
}
