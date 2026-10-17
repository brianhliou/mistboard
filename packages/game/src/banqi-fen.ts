// Banqi UCI FEN encoder — the redaction boundary for the MistyBanqi engine (the
// `banqi-engine` UCI binary on the server AND the in-browser `banqi-wasm` client engine).
// The Banqi analogue of jieqi-fen.ts: it takes canonical game state and produces exactly
// what the engine is allowed to observe. Lives in @mistboard/game so BOTH the server
// (analysis sweep, PvE) and the web client (local engine panel) build the identical
// redacted FEN from the same canonical state — the engine must never see more on the
// client than on the server.
//
// FEN grammar (defined jointly with the engine — banqi_rust/src/engine.rs FEN section):
//
//   <board> <turn> <pool> <clock> <movenum>
//
// - board: 4 ranks top-first (rank 4, 3, 2, 1), files a..h left-to-right within a rank,
//   empty runs collapsed to a digit. A revealed piece is its role char (UPPER=red ink,
//   lower=black ink) from {G general, A advisor, E elephant, R chariot, H horse,
//   C cannon, S soldier}. A face-down tile is 'X' with NO colour — in Banqi the ink is
//   hidden too (the key contrast with jieqi, where a dark piece's colour is known).
// - turn: 'r' red-ink to move | 'b' black-ink to move | '-' unbound (the opening, before
//   the first flip binds an ink to the red seat).
// - pool: the unrevealed multiset as <char><count> pairs (red UPPER then black lower),
//   non-zero only; '-' if empty. Σpool === on-board face-down count.
// - clock: noProgressClock (0..40). movenum: moveNumber (cosmetic for the engine).
//
// Redaction argument: the board only ever emits 'X' for a face-down tile, never its ink
// or role, so no hidden identity reaches the engine. The pool carries only PER-(ink,role)
// COUNTS, which are public information (start − revealed − captured, derivable by both
// seats from the visible flip/capture history). And — cleaner than jieqi — no face-down
// piece is ever captured in Banqi (captures require a revealed target), so the pool is
// exactly the face-down-on-board multiset with no own-captured-while-dark over-disclosure.

import {
  type DealtFenParseOptions,
  type FlipFenSpec,
  flipHiddenField,
  parseFlipFen,
} from './dealt-fen.js';
import {
  BANQI_HEIGHT,
  BANQI_PIECE_COUNTS,
  BANQI_WIDTH,
  type BanqiBoard,
  type BanqiColor,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPiece,
  type BanqiPieceRole,
  type BanqiSquare,
  banqiCoordOf,
  banqiMoverInk,
  banqiSquareOf,
} from './variants-banqi.js';

const RED_ROLE_CHAR: Record<BanqiPieceRole, string> = {
  general: 'G',
  advisor: 'A',
  elephant: 'E',
  chariot: 'R',
  horse: 'H',
  cannon: 'C',
  soldier: 'S',
};

const POOL_ROLES: readonly BanqiPieceRole[] = [
  'general',
  'advisor',
  'elephant',
  'chariot',
  'horse',
  'cannon',
  'soldier',
];

function pieceChar(piece: BanqiPiece): string {
  if (piece.faceDown) return 'X'; // ink hidden too — a single symbol, no colour
  return banqiPieceLetter(piece);
}

/** A piece's FEN letter by its identity: upper case red, lower case black. */
export function banqiPieceLetter(piece: { color: BanqiColor; role: BanqiPieceRole }): string {
  const ch = RED_ROLE_CHAR[piece.role];
  return piece.color === 'red' ? ch : ch.toLowerCase();
}

function boardField(board: BanqiBoard): string {
  const rows: string[] = [];
  for (let rank = 4; rank >= 1; rank -= 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file <= 7; file += 1) {
      const piece = board[banqiSquareOf(file, rank)];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      row += pieceChar(piece);
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  return rows.join('/');
}

function poolField(board: BanqiBoard): string {
  const counts = new Map<string, number>();
  for (const piece of Object.values(board)) {
    if (!piece?.faceDown) continue;
    counts.set(
      `${piece.color}:${piece.role}`,
      (counts.get(`${piece.color}:${piece.role}`) ?? 0) + 1,
    );
  }
  let out = '';
  for (const color of ['red', 'black'] as const) {
    for (const role of POOL_ROLES) {
      const n = counts.get(`${color}:${role}`) ?? 0;
      if (n === 0) continue;
      const ch = color === 'red' ? RED_ROLE_CHAR[role] : RED_ROLE_CHAR[role].toLowerCase();
      out += `${ch}${n}`;
    }
  }
  return out === '' ? '-' : out;
}

/** Encode canonical Banqi state as a redacted UCI FEN for the MistyBanqi engine. */
export function banqiStateToEngineFen(state: BanqiGameState): string {
  const ink = banqiMoverInk(state);
  const turn = ink === null ? '-' : ink === 'red' ? 'r' : 'b';
  return [
    boardField(state.board),
    turn,
    poolField(state.board),
    state.noProgressClock,
    state.moveNumber,
  ].join(' ');
}

/** Platform square -> engine UCI token: file a..h + rank digit 0..3 (rank-1, 0-indexed). */
export function banqiSquareToEngineUci(square: BanqiSquare): string {
  const { file, rank } = banqiCoordOf(square);
  return `${String.fromCharCode(97 + file)}${rank - 1}`;
}

/** Platform move -> engine UCI (e.g. {from:'a1',to:'b1'} -> "a0b0"; flip -> "a0a0"). */
export function banqiMoveToEngineUci(move: BanqiMove): string {
  return `${banqiSquareToEngineUci(move.from)}${banqiSquareToEngineUci(move.to)}`;
}

const ENGINE_UCI = /^([a-h])([0-3])([a-h])([0-3])$/;

/** Engine bestmove (rank 0..3) -> platform move (rank 1..4). Null if unparseable. */
export function engineUciToBanqiMove(uci: string): BanqiMove | null {
  const m = ENGINE_UCI.exec(uci.trim());
  if (!m) return null;
  const sq = (f: string, r: string): BanqiSquare =>
    banqiSquareOf(f.charCodeAt(0) - 97, Number(r) + 1);
  return { from: sq(m[1], m[2]), to: sq(m[3], m[4]) };
}

// ── Dealt FEN (engine FEN + hidden identities) ───────────────────────────────
// The reverse direction, for seeding an analysis board or an editor from a
// pasted position. The five public fields are the engine FEN above; an optional
// sixth field pins the deal (see dealt-fen.ts for the grammar). A public FEN
// samples the face-down identities from the pool.

const BANQI_FLIP_SPEC: FlipFenSpec<BanqiPieceRole, BanqiSquare> = {
  width: BANQI_WIDTH,
  height: BANQI_HEIGHT,
  roleChar: RED_ROLE_CHAR,
  pieceCounts: BANQI_PIECE_COUNTS,
  roleOrder: POOL_ROLES,
  squareOf: banqiSquareOf,
};

export type ParseBanqiFenResult =
  | { ok: true; state: BanqiGameState; sampled: boolean }
  | { ok: false; error: string };

/** Engine FEN + the sixth `hidden` field: the exact deal, reproducible on reload. */
export function banqiStateToDealtFen(state: BanqiGameState): string {
  return `${banqiStateToEngineFen(state)} ${flipHiddenField(state.board, BANQI_FLIP_SPEC)}`;
}

/** Parse a public (5-field) or dealt (6-field) banqi FEN into canonical state.
 *  The red SEAT is always the side to move in the rebuilt state (`ply` is even),
 *  and `firstColor` carries the turn ink, so the mover's ink matches the FEN. */
export function parseBanqiFen(
  fen: string,
  options: DealtFenParseOptions = {},
): ParseBanqiFenResult {
  const parsed = parseFlipFen(fen, BANQI_FLIP_SPEC, options.rng ?? Math.random);
  if (!parsed.ok) return parsed;
  const { board, turn, clock, movenum, captures, sampled } = parsed.parse;
  if (movenum < 1) return { ok: false, error: 'The move number must be at least 1.' };
  if (turn === null && (movenum !== 1 || clock !== 0)) {
    return {
      ok: false,
      error: 'Before the first flip the clock must be 0 and the move number 1.',
    };
  }
  return {
    ok: true,
    sampled,
    state: {
      id: options.gameId ?? 'fen-import',
      board,
      status: { type: 'playing', turn: 'red' },
      ply: 2 * (movenum - 1),
      firstColor: turn,
      moveNumber: movenum,
      noProgressClock: clock,
      repCounts: {},
      captures,
    },
  };
}
