// Engine-only Gomoku (#761): no GameSpecId, tenant, route or UI registration.
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
export type GomokuStatus =
  | { readonly type: 'playing'; readonly turn: GomokuColor }
  | { readonly type: 'finished'; readonly winner: GomokuColor; readonly reason: 'five' }
  | { readonly type: 'finished'; readonly winner: null; readonly reason: 'board-full' };
export type GomokuState = {
  readonly rule: GomokuRule;
  // Flat row-major board: a1 = 0, o1 = 14, a2 = 15, o15 = 224.
  readonly board: readonly (GomokuColor | null)[];
  readonly status: GomokuStatus;
  // Total stones, including any dealt opening; Black plays at even ply counts.
  readonly ply: number;
  readonly lastMove?: GomokuMove;
};

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
 * so alternating counts and the absence of an existing five suffice. */
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
  if (black !== white + (opening.turn === 'white' ? 1 : 0)) {
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
