// Banqi endgame tablebase: the indexing and decoding shared by the exporter
// (scripts/banqi-tablebase/endgame-table.ts --export) and the review panel
// (apps/web/src/review/banqi-tablebase-panel.ts), so the two cannot disagree
// about which byte a position lives in.
//
// Coverage is deliberately narrow: every piece face up, no face-down tile left,
// and a material set the exporter shipped (BANQI_TABLEBASE_MATERIALS, the
// chariot+horse vs chariot+horse+soldier family). A position with any face-down
// tile is never located, and its identities are not read: the check for a
// face-down tile runs before any role is looked at, so a hidden deal cannot
// shape a lookup.
//
// File layout, one file per material (`<red>-<black>`, e.g. `rh-rhs`): gzip of
// two blocks of signed bytes, DTM then DTZ, one byte per slot. A value is the
// solver's: 0 draw (or an impossible slot), +d the side to move wins in d plies,
// -(d+1) it loses in d plies. Neither metric knows the 40-ply clock or the
// repetition rule; the panel applies the clock to DTZ.
//
// Slot: pieces in canonical order (red before black, each by BANQI_TABLEBASE_ROLE_ORDER).
// Banqi moves are the same in every direction, so mirroring files (a<->h) or
// ranks (1<->4) changes no value. Neither axis has a middle square, so one of
// the four mirrors always puts the first piece in files a-d, ranks 1-2: eight
// squares instead of 32, a 4x cut.
//   slot = (stm * 8 + q0) * 32^(k-1) + sum over i >= 1 of sq_i * 32^(i-1)
// with stm 0 when red is to move and q0 = file + 4 * (rank - 1) of the first piece.

import {
  ALL_BANQI_SQUARES,
  type BanqiBoard,
  type BanqiColor,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPieceRole,
  banqiMoverInk,
  banqiSquareIndex,
  DEFAULT_NO_PROGRESS_PLY_LIMIT,
  getBanqiLegalMoves,
} from './variants-banqi.js';

/** Bumped whenever a shipped file's bytes change; it is part of every URL. */
export const BANQI_TABLEBASE_VERSION = 'v1';

export const BANQI_TABLEBASE_ROLE_ORDER: readonly BanqiPieceRole[] = [
  'general',
  'advisor',
  'elephant',
  'chariot',
  'horse',
  'cannon',
  'soldier',
];

const ROLE_LETTER: Record<BanqiPieceRole, string> = {
  general: 'g',
  advisor: 'a',
  elephant: 'e',
  chariot: 'r',
  horse: 'h',
  cannon: 'c',
  soldier: 's',
};
const LETTER_ROLE: Record<string, BanqiPieceRole> = Object.fromEntries(
  Object.entries(ROLE_LETTER).map(([role, letter]) => [letter, role as BanqiPieceRole]),
);

/** Every material the exporter ships: red chariot+horse against black
 *  chariot+horse+soldier, and every ending its captures reach with both inks
 *  still on the board. The colour-swapped material is answered from the same
 *  file (see locate), so `rhs-rh` needs no file of its own. */
export const BANQI_TABLEBASE_MATERIALS: readonly string[] = [
  'r-r',
  'r-h',
  'r-s',
  'r-rh',
  'r-rs',
  'r-hs',
  'r-rhs',
  'h-r',
  'h-h',
  'h-s',
  'h-rh',
  'h-rs',
  'h-hs',
  'h-rhs',
  'rh-r',
  'rh-h',
  'rh-s',
  'rh-rh',
  'rh-rs',
  'rh-hs',
  'rh-rhs',
];
const SHIPPED = new Set(BANQI_TABLEBASE_MATERIALS);

export type BanqiTablebasePiece = { color: BanqiColor; role: BanqiPieceRole };

const SQ = 32;
const QUADRANT = 8;

function canonicalRank(piece: BanqiTablebasePiece): number {
  return (piece.color === 'red' ? 0 : 10) + BANQI_TABLEBASE_ROLE_ORDER.indexOf(piece.role);
}

/** `<red letters>-<black letters>` in canonical order, e.g. `rh-rhs`. */
export function banqiTablebaseKeyOf(pieces: readonly BanqiTablebasePiece[]): string {
  const sorted = [...pieces].sort((a, b) => canonicalRank(a) - canonicalRank(b));
  const side = (color: BanqiColor) =>
    sorted
      .filter((p) => p.color === color)
      .map((p) => ROLE_LETTER[p.role])
      .join('');
  return `${side('red')}-${side('black')}`;
}

/** The pieces of a material key, in canonical (slot) order. */
export function banqiTablebasePieces(key: string): BanqiTablebasePiece[] {
  const [red = '', black = ''] = key.split('-');
  const side = (letters: string, color: BanqiColor): BanqiTablebasePiece[] =>
    [...letters].map((letter) => {
      const role = LETTER_ROLE[letter];
      if (!role) throw new Error(`banqi tablebase: unknown piece letter ${letter} in ${key}`);
      return { color, role };
    });
  return [...side(red, 'red'), ...side(black, 'black')];
}

export function banqiTablebaseSlotCount(pieceCount: number): number {
  return 2 * QUADRANT * SQ ** (pieceCount - 1);
}

/** Where a material's file is served from (under apps/web/public). */
export function banqiTablebaseUrl(key: string): string {
  return `/tablebase/banqi/${BANQI_TABLEBASE_VERSION}/${key}.bin.gz`;
}

const mirrorFile = (sq: number): number => sq - 2 * (sq % 8) + 7;
const mirrorRank = (sq: number): number => (sq % 8) + 8 * (3 - Math.floor(sq / 8));

/** The slot of a position: squares (0..31, a1=0, h4=31) in canonical piece
 *  order, and the side to move (0 red, 1 black). Squares must be distinct. */
export function banqiTablebaseSlot(squares: readonly number[], stm: 0 | 1): number {
  const first = squares[0] ?? 0;
  const flipFile = first % 8 >= 4;
  const flipRank = Math.floor(first / 8) >= 2;
  const map = (sq: number): number => {
    let out = sq;
    if (flipFile) out = mirrorFile(out);
    if (flipRank) out = mirrorRank(out);
    return out;
  };
  const head = map(first);
  let rest = 0;
  for (let i = squares.length - 1; i >= 1; i -= 1) rest = rest * SQ + map(squares[i] ?? 0);
  const q0 = (head % 8) + 4 * Math.floor(head / 8);
  return (stm * QUADRANT + q0) * SQ ** (squares.length - 1) + rest;
}

/** The inverse of banqiTablebaseSlot for the canonical mirror: the squares (in
 *  canonical order) and side to move a slot stands for. */
export function decodeBanqiTablebaseSlot(
  slot: number,
  pieceCount: number,
): { squares: number[]; stm: 0 | 1 } {
  const squares = new Array<number>(pieceCount);
  let rest = slot;
  for (let i = 1; i < pieceCount; i += 1) {
    squares[i] = rest % SQ;
    rest = Math.floor(rest / SQ);
  }
  const q0 = rest % QUADRANT;
  squares[0] = (q0 % 4) + 8 * Math.floor(q0 / 4);
  return { squares, stm: Math.floor(rest / QUADRANT) as 0 | 1 };
}

export type BanqiTablebaseResult = 'win' | 'draw' | 'loss';
/** A stored value read for the side to move; plies is null for a draw. */
export type BanqiTablebaseValue = { result: BanqiTablebaseResult; plies: number | null };

export function decodeBanqiTablebaseValue(value: number): BanqiTablebaseValue {
  if (value > 0) return { result: 'win', plies: value };
  if (value < 0) return { result: 'loss', plies: -value - 1 };
  return { result: 'draw', plies: null };
}

export type BanqiTablebaseTable = { key: string; dtm: Int8Array; dtz: Int8Array };

/** A decompressed file as a table, or null when its length is not the
 *  material's (a truncated or foreign file must not be read as values). */
export function banqiTablebaseTableFromBytes(
  key: string,
  bytes: Uint8Array,
): BanqiTablebaseTable | null {
  const slots = banqiTablebaseSlotCount(banqiTablebasePieces(key).length);
  if (bytes.length !== 2 * slots) return null;
  const signed = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  return { key, dtm: signed.subarray(0, slots), dtz: signed.subarray(slots) };
}

/** A position located in a table: which file, which slot. */
export type BanqiTablebaseProbe = { key: string; slot: number };

type Placed = BanqiTablebasePiece & { sq: number };

/** Locate a board with `moverInk` to move. Null unless every piece is face up,
 *  both inks have a piece, and the material (or its colour swap) is shipped. */
export function locateBanqiTablebase(
  board: BanqiBoard,
  moverInk: BanqiColor,
): BanqiTablebaseProbe | null {
  // Hidden-info gate first: a face-down tile anywhere ends the lookup before any
  // piece identity is read.
  for (const square of ALL_BANQI_SQUARES) if (board[square]?.faceDown) return null;
  const placed: Placed[] = [];
  for (const square of ALL_BANQI_SQUARES) {
    const piece = board[square];
    if (piece) placed.push({ color: piece.color, role: piece.role, sq: banqiSquareIndex(square) });
  }
  return locatePlaced(placed, moverInk);
}

function locatePlaced(placed: Placed[], moverInk: BanqiColor): BanqiTablebaseProbe | null {
  if (!placed.some((p) => p.color === 'red') || !placed.some((p) => p.color === 'black')) {
    return null;
  }
  const seen = new Set<string>();
  for (const p of placed) {
    const id = `${p.color}:${p.role}`;
    if (seen.has(id)) return null; // two identical pieces: no shipped material has them
    seen.add(id);
  }
  for (const swap of [false, true]) {
    const pieces = swap
      ? placed.map((p) => ({ ...p, color: (p.color === 'red' ? 'black' : 'red') as BanqiColor }))
      : placed;
    const key = banqiTablebaseKeyOf(pieces);
    if (!SHIPPED.has(key)) continue;
    const ordered = [...pieces].sort((a, b) => canonicalRank(a) - canonicalRank(b));
    const mover = swap ? (moverInk === 'red' ? 'black' : 'red') : moverInk;
    return {
      key,
      slot: banqiTablebaseSlot(
        ordered.map((p) => p.sq),
        mover === 'red' ? 0 : 1,
      ),
    };
  }
  return null;
}

/** A playing state, located; null for anything not covered (a face-down tile,
 *  an unbound opening, a finished game, unknown material). */
export function probeBanqiTablebase(state: BanqiGameState): BanqiTablebaseProbe | null {
  if (state.status.type !== 'playing') return null;
  for (const square of ALL_BANQI_SQUARES) if (state.board[square]?.faceDown) return null;
  const ink = banqiMoverInk(state);
  if (ink === null) return null;
  return locateBanqiTablebase(state.board, ink);
}

/** One legal move with its exact result for the side making it. */
export type BanqiTablebaseRow = {
  move: BanqiMove;
  capture: boolean;
  result: BanqiTablebaseResult;
  /** Plies to the end of the game with best play (null for a draw). */
  dtm: number | null;
  /** Winning quiet moves: plies, this one included, until the next capture
   *  the win needs. Null for captures, draws and losses. */
  nextCapture: number | null;
  /** Plies, this one included, until the next capture by either side with
   *  best play under the DTZ metric (1 for a capture). Null for a draw. */
  dtz: number | null;
  /** The 40-ply clock reaches the limit before the next capture under best
   *  play, so this decided result is a draw over the board. */
  clockDraw: boolean;
};

export type BanqiTablebaseAnswer = {
  moverInk: BanqiColor;
  result: BanqiTablebaseResult;
  dtm: number | null;
  /** Plies until the next capture with best play (null for a draw). */
  dtz: number | null;
  clockDraw: boolean;
  /** Best first: fastest wins, then draws, then the slowest losses. */
  rows: BanqiTablebaseRow[];
};

/** Every material a covered position may need: its own, and each one a
 *  capture from it reaches. Empty when the position is not covered. */
export function banqiTablebaseKeysFor(state: BanqiGameState): string[] {
  const probe = probeBanqiTablebase(state);
  if (!probe) return [];
  const keys = new Set([probe.key]);
  for (const move of getBanqiLegalMoves(state)) {
    const child = childOf(state, move);
    if (child.capture && child.located) keys.add(child.located.key);
  }
  return [...keys];
}

function childOf(
  state: BanqiGameState,
  move: BanqiMove,
): { capture: boolean; located: BanqiTablebaseProbe | null; wiped: boolean } {
  const board: BanqiBoard = { ...state.board };
  const capture = Boolean(board[move.to]);
  board[move.to] = board[move.from];
  delete board[move.from];
  const mover = banqiMoverInk(state);
  const next: BanqiColor = mover === 'red' ? 'black' : 'red';
  const wiped = !ALL_BANQI_SQUARES.some((sq) => board[sq]?.color === next);
  return { capture, located: wiped ? null : locateBanqiTablebase(board, next), wiped };
}

/** The exact answer for a covered position, or null when it is not covered or
 *  a table it needs is not in hand (`tables` returns undefined for those). */
export function readBanqiTablebase(
  state: BanqiGameState,
  tables: (key: string) => BanqiTablebaseTable | undefined,
  noProgressLimit: number = DEFAULT_NO_PROGRESS_PLY_LIMIT,
): BanqiTablebaseAnswer | null {
  const probe = probeBanqiTablebase(state);
  const moverInk = banqiMoverInk(state);
  if (!probe || moverInk === null) return null;
  const own = tables(probe.key);
  if (!own) return null;
  const left = noProgressLimit - state.noProgressClock;
  const rows: BanqiTablebaseRow[] = [];
  for (const move of getBanqiLegalMoves(state)) {
    const child = childOf(state, move);
    let dtmChild: number;
    let dtzChild: number;
    if (child.wiped) {
      dtmChild = -1; // the opponent has nothing left: lost on the spot
      dtzChild = -1;
    } else {
      if (!child.located) return null; // a covered position only reaches covered ones
      const table = tables(child.located.key);
      if (!table) return null;
      dtmChild = table.dtm[child.located.slot] ?? 0;
      dtzChild = table.dtz[child.located.slot] ?? 0;
    }
    const m = decodeBanqiTablebaseValue(dtmChild);
    const z = decodeBanqiTablebaseValue(dtzChild);
    const result: BanqiTablebaseResult =
      m.result === 'loss' ? 'win' : m.result === 'win' ? 'loss' : 'draw';
    const dtm = m.plies === null ? null : m.plies + 1;
    // The next capture comes z.plies after the child; a capture now restarts the
    // clock, a quiet move spends one more ply of it.
    const clockDraw =
      z.plies === null ? false : child.capture ? z.plies > noProgressLimit : z.plies + 1 > left;
    rows.push({
      move,
      capture: child.capture,
      result,
      dtm,
      nextCapture: result === 'win' && !child.capture && z.plies !== null ? z.plies + 1 : null,
      dtz: z.plies === null ? null : child.capture ? 1 : z.plies + 1,
      clockDraw,
    });
  }
  rows.sort(compareRows);
  const m = decodeBanqiTablebaseValue(own.dtm[probe.slot] ?? 0);
  const z = decodeBanqiTablebaseValue(own.dtz[probe.slot] ?? 0);
  return {
    moverInk,
    result: m.result,
    dtm: m.plies,
    dtz: z.plies,
    clockDraw: z.plies !== null && m.result !== 'draw' && z.plies > left,
    rows,
  };
}

const RESULT_ORDER: Record<BanqiTablebaseResult, number> = { win: 0, draw: 1, loss: 2 };

function compareRows(a: BanqiTablebaseRow, b: BanqiTablebaseRow): number {
  if (a.result !== b.result) return RESULT_ORDER[a.result] - RESULT_ORDER[b.result];
  if (a.result === 'win') {
    return (
      (a.dtm ?? 0) - (b.dtm ?? 0) ||
      Number(a.clockDraw) - Number(b.clockDraw) ||
      (a.nextCapture ?? 0) - (b.nextCapture ?? 0)
    );
  }
  if (a.result === 'loss') return (b.dtm ?? 0) - (a.dtm ?? 0);
  return 0;
}
