// Three Kingdoms banqi (#628) dealt FEN: the study root's start-position format.
//
// The same six-field shape banqi uses (dealt-fen.ts), on the 9x5 board:
//
//   <placement> <turn ink r|b|-> <pool> <clock> <move number> [<hidden>]
//
// The placement is top rank first, `X` a face-down tile, UPPER/lower a revealed
// red/black piece. The pool counts the face-down identities by kind; the sixth
// field pins which identity lies under each face-down tile, in board order, so a
// stored root replays the same deal every time. A five-field FEN samples it.
//
// This is a study and analysis format, NOT the live room's projection: the live
// room's threeKingdomsBanqiStateToFen is public-only and never carries a deal.
// A study's deal is the author's own material, so it is stored and served with
// the chapter, and the board masks it until a flip in the line reveals a tile
// (the same model as banqi studies).
//
// Seat-keyed fields the FEN does not spell are rebuilt: the red SEAT is always
// the side to move (`ply` even) with `firstColor` = the turn ink, so the
// mover's ink matches the FEN, and each seat's score is the points of the
// captured enemy-ink pieces, since only the other ink can have taken them.

import { banqiPieceLetter } from './banqi-fen.js';
import {
  type DealtFenParseOptions,
  type FlipFenSpec,
  flipHiddenField,
  parseFlipFen,
} from './dealt-fen.js';
import {
  BANQI_PIECE_COUNTS,
  type BanqiColor,
  type BanqiPieceRole,
  banqiInkForSeat,
} from './variants-banqi.js';
import {
  ALL_THREE_KINGDOMS_BANQI_SQUARES,
  getThreeKingdomsBanqiResult,
  THREE_KINGDOMS_BANQI_HEIGHT,
  THREE_KINGDOMS_BANQI_POINTS,
  THREE_KINGDOMS_BANQI_WIDTH,
  type ThreeKingdomsBanqiBoard,
  type ThreeKingdomsBanqiSquare,
  type ThreeKingdomsBanqiState,
  threeKingdomsBanqiSeatToMove,
} from './variants-three-kingdoms-banqi.js';

const ROLE_CHAR: Record<BanqiPieceRole, string> = {
  general: 'G',
  advisor: 'A',
  elephant: 'E',
  chariot: 'R',
  horse: 'H',
  cannon: 'C',
  soldier: 'S',
};

const ROLE_ORDER: readonly BanqiPieceRole[] = [
  'general',
  'advisor',
  'elephant',
  'chariot',
  'horse',
  'cannon',
  'soldier',
];

const FILES = 'abcdefghi';

function squareOf(file: number, rank: number): ThreeKingdomsBanqiSquare {
  return `${FILES[file]}${rank}` as ThreeKingdomsBanqiSquare;
}

const TK_FLIP_SPEC: FlipFenSpec<BanqiPieceRole, ThreeKingdomsBanqiSquare> = {
  width: THREE_KINGDOMS_BANQI_WIDTH,
  height: THREE_KINGDOMS_BANQI_HEIGHT,
  roleChar: ROLE_CHAR,
  pieceCounts: BANQI_PIECE_COUNTS,
  roleOrder: ROLE_ORDER,
  squareOf,
};

function placementField(board: ThreeKingdomsBanqiBoard): string {
  const rows: string[] = [];
  for (let rank = THREE_KINGDOMS_BANQI_HEIGHT; rank >= 1; rank -= 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < THREE_KINGDOMS_BANQI_WIDTH; file += 1) {
      const piece = board[squareOf(file, rank)];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      row += piece.faceDown ? 'X' : banqiPieceLetter(piece);
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  return rows.join('/');
}

function poolField(board: ThreeKingdomsBanqiBoard): string {
  const counts = new Map<string, number>();
  for (const square of ALL_THREE_KINGDOMS_BANQI_SQUARES) {
    const piece = board[square];
    if (!piece?.faceDown) continue;
    const key = `${piece.color}:${piece.role}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let out = '';
  for (const color of ['red', 'black'] as const) {
    for (const role of ROLE_ORDER) {
      const n = counts.get(`${color}:${role}`) ?? 0;
      if (n > 0) out += `${banqiPieceLetter({ color, role })}${n}`;
    }
  }
  return out === '' ? '-' : out;
}

/** The six-field dealt FEN: the public position, the pool, and the exact deal. */
export function threeKingdomsBanqiStateToDealtFen(state: ThreeKingdomsBanqiState): string {
  const ink = banqiInkForSeat(state, threeKingdomsBanqiSeatToMove(state));
  const turn = ink === null ? '-' : ink[0];
  return [
    placementField(state.board),
    turn,
    poolField(state.board),
    state.noProgressClock,
    state.moveNumber,
    flipHiddenField(state.board, TK_FLIP_SPEC),
  ].join(' ');
}

export type ParseThreeKingdomsBanqiFenResult =
  | { ok: true; state: ThreeKingdomsBanqiState; sampled: boolean }
  | { ok: false; error: string };

/** Parse a five-field (sampled) or six-field (dealt) Three Kingdoms banqi FEN. */
export function parseThreeKingdomsBanqiFen(
  fen: string,
  options: DealtFenParseOptions = {},
): ParseThreeKingdomsBanqiFenResult {
  const parsed = parseFlipFen(fen, TK_FLIP_SPEC, options.rng ?? Math.random);
  if (!parsed.ok) return parsed;
  const { board, turn, clock, movenum, captures, sampled } = parsed.parse;
  if (movenum < 1) return { ok: false, error: 'The move number must be at least 1.' };
  if (turn === null && (movenum !== 1 || clock !== 0)) {
    return {
      ok: false,
      error: 'Before the first flip the clock must be 0 and the move number 1.',
    };
  }
  const inkOfRedSeat: BanqiColor | null = turn;
  const scores = { red: 0, black: 0 };
  for (const capture of captures) {
    // A captured piece was taken by the other ink, whichever seat holds it.
    const captorSeat = inkOfRedSeat === null || capture.owner !== inkOfRedSeat ? 'red' : 'black';
    scores[captorSeat] += THREE_KINGDOMS_BANQI_POINTS[capture.role];
  }
  const state: ThreeKingdomsBanqiState = {
    id: options.gameId ?? 'fen-import',
    board,
    status: { type: 'playing', turn: 'red' },
    ply: 2 * (movenum - 1),
    moveNumber: movenum,
    firstColor: turn,
    scores,
    noProgressClock: clock,
    captures,
    repCounts: {},
  };
  // A composed position may already be over (a score at 100, no legal move).
  state.status = getThreeKingdomsBanqiResult(state);
  return { ok: true, sampled, state };
}
