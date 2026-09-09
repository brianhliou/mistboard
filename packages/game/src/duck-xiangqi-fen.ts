// Duck Xiangqi FEN: the standard xiangqi six-field FEN plus a SEVENTH field
// naming the duck's point.
//
//   rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1 -
//                                                                        ^ duck
//
// WHY A SEVENTH FIELD, AND WHY THE DUCK HAS TO BE IN THE FEN AT ALL.
//
// The duck is part of the POSITION, not decoration: it screens for cannons,
// blocks the horse's leg and the elephant's eye, and breaks a flying-general
// file (D1-D3), so every piece's move set depends on where it stands. The
// kernel's own repetition key already treats two boards with identical pieces
// and the duck elsewhere as different positions. A FEN that dropped the duck
// would therefore not describe the position, and a study chapter rooted at one
// would replay the author's line against a board where their moves are illegal.
//
// It rides a TRAILING field, the same shape the dealt variants use for their
// hidden assignment (dealt-fen.ts), rather than being packed into the castling
// slot (field 3). Overloading field 3 would make a duck FEN silently parse as a
// standard xiangqi FEN with the duck thrown away - a wrong board that reads as a
// working one. Appending instead means the first six fields are exactly a
// xiangqi FEN, so the xiangqi parser can do the placement validation here, and a
// plain six-field xiangqi FEN pasted into a duck board is accepted as "the duck
// is not on the board yet", which is precisely the start position.
//
// '-' in the duck field means OFF THE BOARD. That is not a null: the duck starts
// off the board and enters as the second half of Red's first turn, so '-' is the
// only spelling the opening position has.

import {
  type DuckXiangqiBoard,
  type DuckXiangqiGameState,
  type DuckXiangqiPieceRole,
  type DuckXiangqiSquare,
  duckXiangqiGeneralsFace,
  duckXiangqiPositionRepetitionKey,
} from './variants-duck-xiangqi.js';
import { parseStandardXiangqiFen } from './xiangqi-position.js';

const ROLE_TO_FEN: Record<DuckXiangqiPieceRole, string> = {
  general: 'k',
  advisor: 'a',
  elephant: 'b',
  horse: 'n',
  chariot: 'r',
  cannon: 'c',
  soldier: 'p',
};

/** 'a1'..'i10' and nothing else. Structural, not an enumerated set: the square
 *  union is 90 members and a regex says the same thing in one line. */
const SQUARE_RE = /^[a-i](?:[1-9]|10)$/;

function squareAt(file: number, rank: number): DuckXiangqiSquare {
  return `${String.fromCharCode(97 + file)}${rank}` as DuckXiangqiSquare;
}

/** Ranks 10 down to 1, files a..i, uppercase = red. The engine/Pikafish spelling
 *  of a xiangqi placement, identical to standardXiangqiPlacementKey's. */
export function duckXiangqiPlacement(board: DuckXiangqiBoard): string {
  const rows: string[] = [];
  for (let rank = 10; rank >= 1; rank -= 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 9; file += 1) {
      const piece = board[squareAt(file, rank)];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      const code = ROLE_TO_FEN[piece.role];
      row += piece.color === 'red' ? code.toUpperCase() : code;
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  return rows.join('/');
}

/**
 * The canonical spelling of a Duck Xiangqi position.
 *
 * Side to move is written in the engine dialect ('w' / 'b'), matching
 * DUCK_XIANGQI_START_FEN and standardXiangqiEngineFen; a finished position has
 * no side to move, so it defaults to 'w' like every other writer here (only
 * playable positions are ever handed around as FENs).
 */
export function duckXiangqiFen(state: DuckXiangqiGameState): string {
  const turnToken = state.status.type === 'playing' && state.status.turn === 'black' ? 'b' : 'w';
  return [
    duckXiangqiPlacement(state.board),
    turnToken,
    '-',
    '-',
    String(state.progressPlies),
    String(state.moveNumber),
    state.duck ?? '-',
  ].join(' ');
}

export type ParseDuckXiangqiFenResult =
  | { ok: true; state: DuckXiangqiGameState }
  | { ok: false; error: string };

/**
 * Read a Duck Xiangqi FEN back into a game state.
 *
 * The first six fields are ordinary xiangqi, so they are validated by the
 * xiangqi parser rather than re-implemented - piece counts, generals in the
 * palace, advisors on the diagonals, elephants on their points, soldiers not
 * behind their start rank. Two of that parser's assumptions do NOT hold here and
 * are handled explicitly:
 *
 *  - `allowExposedGeneral` is ON. D4 removes check, so a general standing where
 *    the mover can take it is ordinary Duck Xiangqi, not a misread diagram.
 *  - the facing rule is re-checked HERE, with the duck, because the duck blocks
 *    the general file (D1) and the xiangqi parser cannot know about it. Skipping
 *    the parser's own facing check and doing our own is the whole reason the
 *    exposed-general flag is set rather than left off.
 */
export function parseDuckXiangqiFen(fen: string, gameId = 'fen-import'): ParseDuckXiangqiFenResult {
  const fields = fen.trim().split(/\s+/);
  const base = parseStandardXiangqiFen(fields.slice(0, 6).join(' '), gameId, {
    allowExposedGeneral: true,
  });
  if (!base.ok) return base;

  const duckField = fields[6] ?? '-';
  let duck: DuckXiangqiSquare | undefined;
  if (duckField !== '-') {
    if (!SQUARE_RE.test(duckField)) {
      return { ok: false, error: `Unknown duck point "${duckField}" (expected a1-i10 or "-").` };
    }
    duck = duckField as DuckXiangqiSquare;
  }

  // Same square names, same role names, different nominal types: rebuild rather
  // than cast the whole board, so an incompatible square string cannot slip
  // through as a type assertion.
  const board: DuckXiangqiBoard = {};
  for (const [square, piece] of Object.entries(base.state.board)) {
    if (!piece) continue;
    if (!SQUARE_RE.test(square)) return { ok: false, error: `Unknown square "${square}".` };
    board[square as DuckXiangqiSquare] = { color: piece.color, role: piece.role };
  }

  if (duck && board[duck]) {
    return { ok: false, error: `The duck on ${duck} shares its point with a piece.` };
  }
  if (duckXiangqiGeneralsFace(board, duck)) {
    return {
      ok: false,
      error: 'Illegal position: the generals face each other down a clear file.',
    };
  }

  const state: DuckXiangqiGameState = {
    id: gameId,
    board,
    duck,
    status: {
      type: 'playing',
      turn: base.state.status.type === 'playing' ? base.state.status.turn : 'red',
    },
    moveNumber: base.state.moveNumber,
    positionCounts: {},
    // The xiangqi parser calls the same field `progressClock`; the duck kernel
    // counts the same thing (plies since the last capture) as `progressPlies`.
    progressPlies: base.state.progressClock,
  };
  state.positionCounts[duckXiangqiPositionRepetitionKey(state)] = 1;
  return { ok: true, state };
}
