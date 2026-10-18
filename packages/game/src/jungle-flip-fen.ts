// Flip Jungle UCI FEN encoder — the redaction boundary for the MistyJungleFlip engine
// (the `jungle-flip-engine` UCI binary on the server AND the in-browser `jungle-flip-wasm`
// client engine). Lives in @mistboard/game so BOTH sides build the identical redacted FEN
// from the same canonical state. The Flip Jungle
// analogue of banqi-fen.ts: it takes canonical game state and produces exactly what
// the engine is allowed to observe. Flip Jungle is banqi applied to the 8 Dou Shou Qi
// animals on a 4x4 board, so the grammar is banqi's with 4 files and the animal ranks.
//
// FEN grammar (defined jointly with the engine — jungle-flip-engine/src/main.rs):
//
//   <board> <turn> <pool> <clock> <movenum>
//
// - board: 4 ranks top-first (rank 4, 3, 2, 1), files a..d left-to-right within a rank,
//   empty runs collapsed to a digit. A revealed piece is its role char (UPPER=red ink,
//   lower=black ink) from {R rat, C cat, D dog, W wolf, P leopard, T tiger, L lion,
//   E elephant}. A face-down tile is 'X' with NO colour — in Flip Jungle the ink is
//   hidden too (the deal is symmetric-hidden, like banqi).
// - turn: 'r' red-ink to move | 'b' black-ink to move | '-' unbound (the opening, before
//   the first flip binds an ink to the red seat).
// - pool: the unrevealed multiset as <char><count> pairs (red UPPER then black lower),
//   non-zero only; '-' if empty. Σpool === on-board face-down count.
// - clock: noProgressClock. movenum: absolute ply (`state.ply`). Despite the legacy field
//   name this is NOT cosmetic: the engine combines its parity with `turn` to reconstruct
//   the opening ink, which is part of the repetition key.
//
// Redaction argument: the board only ever emits 'X' for a face-down tile, never its ink
// or role, so no hidden identity reaches the engine. The pool carries only PER-(ink,role)
// COUNTS, which are public information (start − revealed − captured, derivable by both
// seats from the visible flip/capture/trade history). As in banqi, no face-down piece is
// ever captured (captures require a revealed target), so the pool is exactly the
// face-down-on-board multiset with no own-captured-while-dark over-disclosure.

import {
  type DealtFenParseOptions,
  type FlipFenSpec,
  flipHiddenField,
  parseFlipFen,
} from './dealt-fen.js';
import {
  JUNGLE_FLIP_HEIGHT,
  JUNGLE_FLIP_WIDTH,
  type JungleFlipBoard,
  type JungleFlipColor,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipPiece,
  type JungleFlipPieceRole,
  type JungleFlipSeat,
  type JungleFlipSquare,
  jungleFlipCoordOf,
  jungleFlipMoverInk,
  jungleFlipSquareOf,
  oppositeJungleFlipColor,
} from './variants-jungle-flip.js';

const RED_ROLE_CHAR: Record<JungleFlipPieceRole, string> = {
  rat: 'R',
  cat: 'C',
  dog: 'D',
  wolf: 'W',
  leopard: 'P',
  tiger: 'T',
  lion: 'L',
  elephant: 'E',
};

// Pool order: rank weak→strong, red ink then black ink (the engine accepts any order,
// but a stable one keeps FENs diffable and matches the engine's golden vectors).
const POOL_ROLES: readonly JungleFlipPieceRole[] = [
  'rat',
  'cat',
  'dog',
  'wolf',
  'leopard',
  'tiger',
  'lion',
  'elephant',
];

function pieceChar(piece: JungleFlipPiece): string {
  if (piece.faceDown) return 'X'; // ink hidden too — a single symbol, no colour
  return jungleFlipPieceLetter(piece);
}

/** A piece's FEN letter by its identity: upper case red, lower case black. */
export function jungleFlipPieceLetter(piece: {
  color: JungleFlipColor;
  role: JungleFlipPieceRole;
}): string {
  const ch = RED_ROLE_CHAR[piece.role];
  return piece.color === 'red' ? ch : ch.toLowerCase();
}

function boardField(board: JungleFlipBoard): string {
  const rows: string[] = [];
  for (let rank = 4; rank >= 1; rank -= 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file <= 3; file += 1) {
      const piece = board[jungleFlipSquareOf(file, rank)];
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

function poolField(board: JungleFlipBoard): string {
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

/** Encode canonical Flip Jungle state as a redacted UCI FEN for the MistyJungleFlip engine. */
export function jungleFlipStateToEngineFen(state: JungleFlipGameState): string {
  const ink = jungleFlipMoverInk(state);
  const turn = ink === null ? '-' : ink === 'red' ? 'r' : 'b';
  return [
    boardField(state.board),
    turn,
    poolField(state.board),
    state.noProgressClock,
    state.ply,
  ].join(' ');
}

/**
 * Clock-independent repetition signature: two positions repeat when the board, mover,
 * pool, and ply parity match (the engine's `rep_key` hashes exactly this, ignoring the
 * no-progress clock). Within a single game `firstColor` is fixed, so board+turn+pool+parity
 * uniquely identifies a repeatable position. Used to count threefold occurrences.
 */
export function jungleFlipRepSignature(state: JungleFlipGameState): string {
  const ink = jungleFlipMoverInk(state);
  const turn = ink === null ? '-' : ink === 'red' ? 'r' : 'b';
  return `${boardField(state.board)}|${turn}|${poolField(state.board)}|${state.ply % 2}`;
}

/**
 * Redacted FENs of positions that have already occurred TWICE in `states` (so the engine
 * re-entering one is the THIRD occurrence = a repetition draw under the kernel's threefold
 * rule). One representative FEN per such signature; the engine hashes each to the `rep_key`
 * shared by every occurrence (rep_key ignores the clock), then seeds its repetition table.
 * Counting by signature is correct across the whole game: a flip or capture resets the pool
 * or board, so no two no-progress blocks share a signature.
 */
export function jungleFlipRepSeedFens(states: readonly JungleFlipGameState[]): string[] {
  const firstFen = new Map<string, string>();
  const count = new Map<string, number>();
  for (const state of states) {
    const sig = jungleFlipRepSignature(state);
    count.set(sig, (count.get(sig) ?? 0) + 1);
    if (!firstFen.has(sig)) firstFen.set(sig, jungleFlipStateToEngineFen(state));
  }
  const seed: string[] = [];
  for (const [sig, n] of count) {
    if (n >= 2) seed.push(firstFen.get(sig)!);
  }
  return seed;
}

/** Platform square -> engine UCI token: file a..d + rank digit 0..3 (rank-1, 0-indexed). */
export function jungleFlipSquareToEngineUci(square: JungleFlipSquare): string {
  const { file, rank } = jungleFlipCoordOf(square);
  return `${String.fromCharCode(97 + file)}${rank - 1}`;
}

/** Platform move -> engine UCI (e.g. {from:'a1',to:'b1'} -> "a0b0"; flip -> "a0a0"). */
export function jungleFlipMoveToEngineUci(move: JungleFlipMove): string {
  return `${jungleFlipSquareToEngineUci(move.from)}${jungleFlipSquareToEngineUci(move.to)}`;
}

const ENGINE_UCI = /^([a-d])([0-3])([a-d])([0-3])$/;

/** Engine bestmove (rank 0..3) -> platform move (rank 1..4). Null if unparseable. */
export function engineUciToJungleFlipMove(uci: string): JungleFlipMove | null {
  const m = ENGINE_UCI.exec(uci.trim());
  if (!m) return null;
  const sq = (f: string, r: string): JungleFlipSquare =>
    jungleFlipSquareOf(f.charCodeAt(0) - 97, Number(r) + 1);
  return { from: sq(m[1]!, m[2]!), to: sq(m[3]!, m[4]!) };
}

// ── Dealt FEN (engine FEN + hidden identities) ───────────────────────────────
// The reverse direction, for seeding an analysis board or an editor from a
// pasted position. The five public fields are the engine FEN above; an optional
// sixth field pins the deal (see dealt-fen.ts for the grammar). A public FEN
// samples the face-down identities from the pool.

const JUNGLE_FLIP_PIECE_COUNTS: Record<JungleFlipPieceRole, number> = {
  rat: 1,
  cat: 1,
  dog: 1,
  wolf: 1,
  leopard: 1,
  tiger: 1,
  lion: 1,
  elephant: 1,
};

const JUNGLE_FLIP_FLIP_SPEC: FlipFenSpec<JungleFlipPieceRole, JungleFlipSquare> = {
  width: JUNGLE_FLIP_WIDTH,
  height: JUNGLE_FLIP_HEIGHT,
  roleChar: RED_ROLE_CHAR,
  pieceCounts: JUNGLE_FLIP_PIECE_COUNTS,
  roleOrder: POOL_ROLES,
  squareOf: jungleFlipSquareOf,
};

export type ParseJungleFlipFenResult =
  | { ok: true; state: JungleFlipGameState; sampled: boolean }
  | { ok: false; error: string };

/** Engine FEN + the sixth `hidden` field: the exact deal, reproducible on reload. */
export function jungleFlipStateToDealtFen(state: JungleFlipGameState): string {
  return `${jungleFlipStateToEngineFen(state)} ${flipHiddenField(state.board, JUNGLE_FLIP_FLIP_SPEC)}`;
}

/** Parse a public (5-field) or dealt (6-field) Flip Jungle FEN into canonical
 *  state. The movenum slot is the absolute ply (as the writer emits it): its
 *  parity picks the seat to move, and `firstColor` is solved so that seat owns
 *  the FEN's turn ink. */
export function parseJungleFlipFen(
  fen: string,
  options: DealtFenParseOptions = {},
): ParseJungleFlipFenResult {
  const parsed = parseFlipFen(fen, JUNGLE_FLIP_FLIP_SPEC, options.rng ?? Math.random);
  if (!parsed.ok) return parsed;
  const { board, turn, clock, movenum: ply, captures, sampled } = parsed.parse;
  if (turn === null && (ply !== 0 || clock !== 0)) {
    return { ok: false, error: 'Before the first flip the clock and the ply must both be 0.' };
  }
  const seat: JungleFlipSeat = ply % 2 === 0 ? 'red' : 'black';
  const firstColor = turn === null ? null : seat === 'red' ? turn : oppositeJungleFlipColor(turn);
  return {
    ok: true,
    sampled,
    state: {
      id: options.gameId ?? 'fen-import',
      board,
      status: { type: 'playing', turn: seat },
      ply,
      firstColor,
      moveNumber: Math.floor(ply / 2) + 1,
      noProgressClock: clock,
      repCounts: {},
      captures,
    },
  };
}
