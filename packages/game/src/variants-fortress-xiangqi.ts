// Fortress Xiangqi — pure rules kernel (perfect information + crazyhouse drops).
//
// "Xiangqi with a pocket." A 7x8 board with two 3x3 palaces in OPPOSITE corners
// (pinwheel), faithful xiangqi movement, one new piece (the Treasure), and
// crazyhouse-style drops. The blessed flagship config is both-side attacker
// drops + the chasing rule (perpetual check/chase = loss for the aggressor).
//
// This kernel is intentionally self-contained: Fortress has its own geometry
// and piece set, so it does not extend an existing kernel.
//
// CHASING RULE BOUNDARY: this pure kernel adjudicates a three-fold repetition as
// a DRAW. The faithful "perpetual check/chase = loss for the aggressor" verdict
// is applied server-side via the Fairy-Stockfish adjudicator (see
// docs-private/fortress-xiangqi-build-track.md, Phase 2) so that PvP matches the
// measured PvE game exactly. The `'chasing'` end reason and the winner override
// live in the tenant, not here; keeping this kernel a pure sync function is what
// makes it testable.

import type { AbortReason } from './types.js';

export type FortressXiangqiColor = 'red' | 'black';

export type FortressXiangqiPieceRole =
  | 'general'
  | 'advisor'
  | 'elephant'
  | 'horse'
  | 'cannon'
  | 'chariot'
  | 'soldier'
  | 'treasure';

export type FortressXiangqiPiece = {
  color: FortressXiangqiColor;
  role: FortressXiangqiPieceRole;
};

export type FortressXiangqiCoord = { file: number; rank: number };

type FortressFileChar = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
type FortressRankNum = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type FortressXiangqiSquare = `${FortressFileChar}${FortressRankNum}`;

export type FortressXiangqiBoard = Partial<Record<FortressXiangqiSquare, FortressXiangqiPiece>>;

export type FortressXiangqiBoardMove = {
  from: FortressXiangqiSquare;
  to: FortressXiangqiSquare;
};

// Every non-general piece can be captured into hand and dropped back.
export type FortressXiangqiDropRole = Exclude<FortressXiangqiPieceRole, 'general'>;

export type FortressXiangqiDropMove = {
  drop: FortressXiangqiDropRole;
  to: FortressXiangqiSquare;
};

export type FortressXiangqiMove = FortressXiangqiBoardMove | FortressXiangqiDropMove;

export type FortressXiangqiHand = Partial<Record<FortressXiangqiDropRole, number>>;
export type FortressXiangqiHands = Record<FortressXiangqiColor, FortressXiangqiHand>;

export type FortressXiangqiGameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'repetition'
  | 'chasing'
  | 'timeout'
  | 'resignation'
  | 'abandonment';

export type FortressXiangqiGameStatus =
  | { type: 'playing'; turn: FortressXiangqiColor }
  | { type: 'finished'; winner: FortressXiangqiColor | null; reason: FortressXiangqiGameEndReason }
  | { type: 'aborted'; reason: AbortReason };

export type FortressXiangqiGameState = {
  id: string;
  board: FortressXiangqiBoard;
  hands: FortressXiangqiHands;
  status: FortressXiangqiGameStatus;
  moveNumber: number;
  lastMove?: FortressXiangqiMove;
  positionCounts: Record<string, number>;
  // Ordered move history from the initial position. Carried so the chasing-rule
  // adjudicator (fortressXiangqiPerpetualCheckLoser) can inspect the repeating
  // cycle at a three-fold. Excluded from the repetition key and the player view.
  moveLog?: readonly FortressXiangqiMove[];
};

export type FortressXiangqiPlayerView = {
  id: string;
  perspective: FortressXiangqiColor;
  board: FortressXiangqiBoard;
  hands: FortressXiangqiHands;
  legalMoves: FortressXiangqiMove[];
  inCheck: boolean;
  status: FortressXiangqiGameStatus;
  moveNumber: number;
  lastMove?: FortressXiangqiMove;
};

const FILE_CHARS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
const FILES = 7;
const RANKS = 8;
const RIVER_RED_MAX_RANK = 4; // red owns ranks 1-4, black owns ranks 5-8

// Drop classes. Attackers parachute anywhere; defenders stay in their legal
// standing region (advisor -> own palace, elephant -> own half). Matches the
// flagship zmini-drop-ck-bs-chase FSF config.
export const FORTRESS_ATTACKER_DROP_ROLES = [
  'chariot',
  'horse',
  'cannon',
  'soldier',
  'treasure',
] as const satisfies readonly FortressXiangqiDropRole[];

export const FORTRESS_DEFENDER_DROP_ROLES = [
  'advisor',
  'elephant',
] as const satisfies readonly FortressXiangqiDropRole[];

export const FORTRESS_DROP_ROLES = [
  ...FORTRESS_ATTACKER_DROP_ROLES,
  ...FORTRESS_DEFENDER_DROP_ROLES,
] as const satisfies readonly FortressXiangqiDropRole[];

export const FORTRESS_XIANGQI_START_FEN = 'rnceakq/pp1p1pp/7/7/7/7/PP1P1PP/QKAECNR w - - 0 1';

const ROLE_REPETITION_CODES: Record<FortressXiangqiPieceRole, string> = {
  general: 'k',
  advisor: 'a',
  elephant: 'e',
  horse: 'h',
  cannon: 'n',
  chariot: 'r',
  soldier: 's',
  treasure: 't',
};

const ORTHOGONAL_STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const DIAGONAL_STEPS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

const ALL_STEPS = [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS] as const;

// [df, dr, legDf, legDr] — knight offset plus the orthogonal leg that hobbles it.
const HORSE_MOVES = [
  [1, 2, 0, 1],
  [1, -2, 0, -1],
  [-1, 2, 0, 1],
  [-1, -2, 0, -1],
  [2, 1, 1, 0],
  [2, -1, 1, 0],
  [-2, 1, -1, 0],
  [-2, -1, -1, 0],
] as const;

const ALL_FORTRESS_XIANGQI_SQUARES: readonly FortressXiangqiSquare[] = (() => {
  const squares: FortressXiangqiSquare[] = [];
  for (let rank = 1; rank <= RANKS; rank += 1) {
    for (let file = 0; file < FILES; file += 1) squares.push(fortressXiangqiSquareOf(file, rank));
  }
  return squares;
})();

// ── Coordinates & regions ───────────────────────────────────────────────────

export function fortressXiangqiSquareOf(file: number, rank: number): FortressXiangqiSquare {
  if (!fortressXiangqiInBounds(file, rank)) {
    throw new RangeError(`fortress xiangqi coord out of range: file=${file} rank=${rank}`);
  }
  return `${FILE_CHARS[file]}${rank}` as FortressXiangqiSquare;
}

export function fortressXiangqiCoordOf(square: FortressXiangqiSquare): FortressXiangqiCoord {
  const file = FILE_CHARS.indexOf(square[0] as FortressFileChar);
  const rank = Number(square.slice(1));
  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > RANKS) {
    throw new RangeError(`invalid fortress xiangqi square: ${square}`);
  }
  return { file, rank };
}

export function fortressXiangqiInBounds(file: number, rank: number): boolean {
  return file >= 0 && file < FILES && rank >= 1 && rank <= RANKS;
}

// Opposite-corner palaces: Red a1-c3 (files a-c, ranks 1-3), Black e6-g8 (files
// e-g, ranks 6-8).
export function fortressXiangqiInPalace(
  color: FortressXiangqiColor,
  file: number,
  rank: number,
): boolean {
  return color === 'red'
    ? file >= 0 && file <= 2 && rank >= 1 && rank <= 3
    : file >= 4 && file <= 6 && rank >= 6 && rank <= 8;
}

// The half a color starts on (elephants and defender drops never leave it).
export function fortressXiangqiInOwnHalf(color: FortressXiangqiColor, rank: number): boolean {
  return color === 'red' ? rank <= RIVER_RED_MAX_RANK : rank > RIVER_RED_MAX_RANK;
}

// A soldier that has crossed the river gains its sideways step.
export function fortressXiangqiCrossedRiver(color: FortressXiangqiColor, rank: number): boolean {
  return color === 'red' ? rank > RIVER_RED_MAX_RANK : rank <= RIVER_RED_MAX_RANK;
}

export function oppositeFortressXiangqiColor(color: FortressXiangqiColor): FortressXiangqiColor {
  return color === 'red' ? 'black' : 'red';
}

export function allFortressXiangqiSquares(): readonly FortressXiangqiSquare[] {
  return ALL_FORTRESS_XIANGQI_SQUARES;
}

export function isFortressXiangqiDropMove(
  move: FortressXiangqiMove,
): move is FortressXiangqiDropMove {
  return 'drop' in move;
}

// ── Engine (Fairy-Stockfish) UCI ─────────────────────────────────────────────
// Fortress serves PvE + review ceval via Fairy-Stockfish (UCI_Variant
// 'fortressxiangqi'). Board moves are plain from+to; drops use the crazyhouse
// '<letter>@<square>' form. The Treasure drops as 'Q' (FSF's queen slot); every
// other role keeps its xiangqi letter. These mirror the server engine's private
// converters so the client tree adapter speaks the same dialect.
const FORTRESS_DROP_ROLE_TO_FSF_LETTER: Record<FortressXiangqiDropRole, string> = {
  chariot: 'R',
  horse: 'N',
  cannon: 'C',
  soldier: 'P',
  treasure: 'Q',
  advisor: 'A',
  elephant: 'E',
};

const FORTRESS_FSF_LETTER_TO_DROP_ROLE: Record<string, FortressXiangqiDropRole> =
  Object.fromEntries(
    Object.entries(FORTRESS_DROP_ROLE_TO_FSF_LETTER).map(([role, letter]) => [
      letter,
      role as FortressXiangqiDropRole,
    ]),
  );

export function fortressXiangqiMoveToFsfUci(move: FortressXiangqiMove): string {
  return isFortressXiangqiDropMove(move)
    ? `${FORTRESS_DROP_ROLE_TO_FSF_LETTER[move.drop]}@${move.to}`
    : `${move.from}${move.to}`;
}

/** Inverse of fortressXiangqiMoveToFsfUci. Parse only (no legality check — the
 *  tree's addMove validates on rebuild); returns null for a non-move token. */
export function fsfUciToFortressXiangqiMove(uci: string): FortressXiangqiMove | null {
  const drop = /^([RNCPQAE])@([a-g][1-8])$/.exec(uci);
  if (drop) {
    const role = FORTRESS_FSF_LETTER_TO_DROP_ROLE[drop[1]!];
    return role ? { drop: role, to: drop[2] as FortressXiangqiSquare } : null;
  }
  const board = /^([a-g][1-8])([a-g][1-8])$/.exec(uci);
  if (board) {
    return { from: board[1] as FortressXiangqiSquare, to: board[2] as FortressXiangqiSquare };
  }
  return null;
}

// ── Engine FEN (Fairy-Stockfish) ──────────────────────────────────────────────

// FSF FEN letter per role (red = uppercase, black = lowercase). The droppable roles
// reuse the drop-dialect letters; the general (never droppable) is 'K'.
const FORTRESS_ROLE_TO_FEN_LETTER: Record<FortressXiangqiPieceRole, string> = {
  ...FORTRESS_DROP_ROLE_TO_FSF_LETTER,
  general: 'K',
};

// Stable pocket ordering (FSF parses pockets order-independently, but a fixed order
// keeps the FEN deterministic for the Share tab + the parity test).
const FORTRESS_POCKET_ROLE_ORDER: FortressXiangqiDropRole[] = [
  'chariot',
  'horse',
  'cannon',
  'elephant',
  'advisor',
  'treasure',
  'soldier',
];

function fortressHandFenLetters(hand: FortressXiangqiHand, color: FortressXiangqiColor): string {
  let out = '';
  for (const role of FORTRESS_POCKET_ROLE_ORDER) {
    const count = hand[role] ?? 0;
    const letter = FORTRESS_DROP_ROLE_TO_FSF_LETTER[role];
    out += (color === 'red' ? letter : letter.toLowerCase()).repeat(count);
  }
  return out;
}

/** Fairy-Stockfish FEN for the fortressxiangqi variant, for the review Share tab:
 *  the 7x8 placement (rank 8 down to 1, files a..g), a `[pocket]` of captured-in-hand
 *  pieces (crazyhouse-style; omitted when both hands are empty, matching the .ini
 *  startFen), side to move, and the move number. The engine is fed startpos+moves,
 *  so this FEN is display-only — but it is a valid position FSF can load. */
export function fortressXiangqiEngineFen(state: FortressXiangqiGameState): string {
  const ranks: string[] = [];
  for (let rank = RANKS; rank >= 1; rank -= 1) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < FILES; f += 1) {
      const piece = state.board[fortressXiangqiSquareOf(f, rank)];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      const letter = FORTRESS_ROLE_TO_FEN_LETTER[piece.role];
      row += piece.color === 'red' ? letter : letter.toLowerCase();
    }
    if (empty > 0) row += String(empty);
    ranks.push(row);
  }
  const placement = ranks.join('/');
  const pocket =
    fortressHandFenLetters(state.hands.red, 'red') +
    fortressHandFenLetters(state.hands.black, 'black');
  const board = pocket ? `${placement}[${pocket}]` : placement;
  const turn = state.status.type === 'playing' && state.status.turn === 'black' ? 'b' : 'w';
  return `${board} ${turn} - - 0 ${state.moveNumber}`;
}

// ── FEN parsing ──────────────────────────────────────────────────────────────
// Inverse of fortressXiangqiEngineFen, so a hand-set position can seed a study
// chapter or an analysis board. Lives next to the writer on purpose: the two
// share the letter tables, and a dialect drift between them would be invisible
// anywhere else.
//
// Validation covers only what play can never produce: a general off its palace,
// a defender outside its standing region, more copies of a role than the sets
// contain (board AND pockets — a capture moves a piece into the CAPTURER's hand,
// so the bound is per role across both colours), and a side to move who can
// simply take the enemy general.

export type ParseFortressXiangqiFenResult =
  | { ok: true; state: FortressXiangqiGameState }
  | { ok: false; error: string };

const FORTRESS_FEN_LETTER_TO_ROLE: Record<string, FortressXiangqiPieceRole> = {
  ...Object.fromEntries(
    Object.entries(FORTRESS_FSF_LETTER_TO_DROP_ROLE).map(([letter, role]) => [
      letter.toLowerCase(),
      role as FortressXiangqiPieceRole,
    ]),
  ),
  k: 'general',
};

// Total copies of a role in the two starting sets. A captured piece changes
// owner (it lands in the capturer's pocket), so the ceiling is shared, not
// per-colour.
const FORTRESS_ROLE_SUPPLY: Record<FortressXiangqiPieceRole, number> = {
  general: 2,
  advisor: 2,
  elephant: 2,
  horse: 2,
  cannon: 2,
  chariot: 2,
  treasure: 2,
  soldier: 10, // five a side (pp1p1pp)
};

export function parseFortressXiangqiFen(
  fen: string,
  gameId = 'fen-import',
): ParseFortressXiangqiFenResult {
  const fields = fen.trim().split(/\s+/);
  const first = fields[0];
  if (!first) return { ok: false, error: 'Empty FEN.' };

  // The pocket rides in brackets on the placement field (crazyhouse dialect).
  const bracket = first.indexOf('[');
  let placement = first;
  let pocketText = '';
  if (bracket >= 0) {
    if (!first.endsWith(']')) return { ok: false, error: 'Unclosed "[" in the pocket field.' };
    placement = first.slice(0, bracket);
    pocketText = first.slice(bracket + 1, -1);
  }

  const rows = placement.split('/');
  if (rows.length !== RANKS) {
    return { ok: false, error: `Expected ${RANKS} ranks in the placement, got ${rows.length}.` };
  }

  const supply: Partial<Record<FortressXiangqiPieceRole, number>> = {};
  const board: FortressXiangqiBoard = {};
  const generals: Partial<Record<FortressXiangqiColor, FortressXiangqiSquare>> = {};
  for (let i = 0; i < RANKS; i += 1) {
    const rank = RANKS - i;
    let file = 0;
    for (const ch of rows[i]!) {
      if (ch >= '1' && ch <= '9') {
        file += Number(ch);
        continue;
      }
      const role = FORTRESS_FEN_LETTER_TO_ROLE[ch.toLowerCase()];
      if (!role) return { ok: false, error: `Unknown piece "${ch}" on rank ${rank}.` };
      if (file > FILES - 1) return { ok: false, error: `Rank ${rank} runs past ${FILES} files.` };
      const color: FortressXiangqiColor = /[A-Z]/.test(ch) ? 'red' : 'black';
      const square = fortressXiangqiSquareOf(file, rank);
      if (role === 'general') {
        if (generals[color]) return { ok: false, error: `Two ${color} generals.` };
        if (!fortressXiangqiInPalace(color, file, rank)) {
          return { ok: false, error: `The ${color} general on ${square} is outside its palace.` };
        }
        generals[color] = square;
      } else if (role === 'advisor' && !fortressXiangqiInPalace(color, file, rank)) {
        return { ok: false, error: `The ${color} advisor on ${square} is outside its palace.` };
      } else if (role === 'elephant' && !fortressXiangqiInOwnHalf(color, rank)) {
        return { ok: false, error: `The ${color} elephant on ${square} has crossed the river.` };
      }
      supply[role] = (supply[role] ?? 0) + 1;
      board[square] = { color, role };
      file += 1;
    }
    if (file !== FILES) {
      return { ok: false, error: `Rank ${rank} covers ${file} files, expected ${FILES}.` };
    }
  }

  const hands: FortressXiangqiHands = emptyHands();
  for (const ch of pocketText) {
    const role = FORTRESS_FEN_LETTER_TO_ROLE[ch.toLowerCase()];
    if (!role) return { ok: false, error: `Unknown pocket piece "${ch}".` };
    if (role === 'general') return { ok: false, error: 'A general can never be in hand.' };
    const color: FortressXiangqiColor = /[A-Z]/.test(ch) ? 'red' : 'black';
    const hand = hands[color];
    hand[role] = (hand[role] ?? 0) + 1;
    supply[role] = (supply[role] ?? 0) + 1;
  }

  for (const [role, count] of Object.entries(supply)) {
    const max = FORTRESS_ROLE_SUPPLY[role as FortressXiangqiPieceRole];
    if (count > max) {
      return { ok: false, error: `Too many ${role}s: ${count} on board and in hand (max ${max}).` };
    }
  }
  for (const color of ['red', 'black'] as const) {
    if (!generals[color]) return { ok: false, error: `Missing the ${color} general.` };
  }

  const turnToken = fields[1] ?? 'w';
  let turn: FortressXiangqiColor;
  if (turnToken === 'w' || turnToken === 'r') turn = 'red';
  else if (turnToken === 'b') turn = 'black';
  else return { ok: false, error: `Unknown side-to-move "${turnToken}" (expected w/r or b).` };

  const moveField = fields[5];
  const base: FortressXiangqiGameState = {
    id: gameId,
    board,
    hands,
    status: { type: 'playing', turn },
    moveNumber: moveField && /^\d+$/.test(moveField) ? Number(moveField) : 1,
    positionCounts: {},
  };
  // The side NOT to move must not be sitting in check: the move that produced
  // this position could never have been played, so the diagram is wrong.
  const waiting = oppositeFortressXiangqiColor(turn);
  if (isFortressXiangqiGeneralInCheck(base, waiting)) {
    return {
      ok: false,
      error: `Illegal position: the ${waiting} general is in check with ${turn} to move.`,
    };
  }
  return {
    ok: true,
    state: { ...base, positionCounts: { [fortressXiangqiPositionRepetitionKey(base)]: 1 } },
  };
}

// ── Initial position ────────────────────────────────────────────────────────

export function createInitialFortressXiangqiBoard(): FortressXiangqiBoard {
  const board: FortressXiangqiBoard = {};
  // Red back rank (a1..g1): Treasure, General, Advisor, Elephant, Cannon, Horse,
  // Chariot. Black is the 180-degree rotation.
  const redBackRank: FortressXiangqiPieceRole[] = [
    'treasure',
    'general',
    'advisor',
    'elephant',
    'cannon',
    'horse',
    'chariot',
  ];
  const blackBackRank: FortressXiangqiPieceRole[] = [
    'chariot',
    'horse',
    'cannon',
    'elephant',
    'advisor',
    'general',
    'treasure',
  ];
  for (let f = 0; f < FILES; f += 1) {
    board[fortressXiangqiSquareOf(f, 1)] = { color: 'red', role: redBackRank[f] };
    board[fortressXiangqiSquareOf(f, 8)] = { color: 'black', role: blackBackRank[f] };
  }
  // Five soldiers a side, gaps at the c- and e-files.
  for (const f of [0, 1, 3, 5, 6]) {
    board[fortressXiangqiSquareOf(f, 2)] = { color: 'red', role: 'soldier' };
    board[fortressXiangqiSquareOf(f, 7)] = { color: 'black', role: 'soldier' };
  }
  return board;
}

function emptyHands(): FortressXiangqiHands {
  return { red: {}, black: {} };
}

export function createInitialFortressXiangqiState(gameId: string): FortressXiangqiGameState {
  const base: FortressXiangqiGameState = {
    id: gameId,
    board: createInitialFortressXiangqiBoard(),
    hands: emptyHands(),
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    moveLog: [],
  };
  return {
    ...base,
    positionCounts: { [fortressXiangqiPositionRepetitionKey(base)]: 1 },
  };
}

// ── Move generation ─────────────────────────────────────────────────────────

// Pseudo-legal board moves for the piece on `from` (own-color blocking only;
// does NOT filter self-check or forbid capturing the general — the legal layer
// does that). Used both for legal-move generation and for attack detection.
function pseudoBoardMovesFrom(
  board: FortressXiangqiBoard,
  from: FortressXiangqiSquare,
): FortressXiangqiBoardMove[] {
  const piece = board[from];
  if (!piece) return [];
  const { file, rank } = fortressXiangqiCoordOf(from);
  const moves: FortressXiangqiBoardMove[] = [];
  const addStep = (f: number, r: number): void => {
    if (!fortressXiangqiInBounds(f, r)) return;
    const to = fortressXiangqiSquareOf(f, r);
    if (board[to]?.color === piece.color) return;
    moves.push({ from, to });
  };

  switch (piece.role) {
    case 'general':
      for (const [df, dr] of ORTHOGONAL_STEPS) {
        const f = file + df;
        const r = rank + dr;
        if (fortressXiangqiInPalace(piece.color, f, r)) addStep(f, r);
      }
      break;
    case 'advisor':
      for (const [df, dr] of DIAGONAL_STEPS) {
        const f = file + df;
        const r = rank + dr;
        if (fortressXiangqiInPalace(piece.color, f, r)) addStep(f, r);
      }
      break;
    case 'elephant':
      for (const [df, dr] of DIAGONAL_STEPS) {
        const eyeF = file + df;
        const eyeR = rank + dr;
        const toF = file + 2 * df;
        const toR = rank + 2 * dr;
        if (!fortressXiangqiInBounds(toF, toR)) continue;
        if (isOccupied(board, eyeF, eyeR)) continue; // blocked eye
        if (!fortressXiangqiInOwnHalf(piece.color, toR)) continue; // cannot cross river
        addStep(toF, toR);
      }
      break;
    case 'horse':
      for (const [df, dr, legDf, legDr] of HORSE_MOVES) {
        if (isOccupied(board, file + legDf, rank + legDr)) continue; // hobbled leg
        addStep(file + df, rank + dr);
      }
      break;
    case 'chariot':
      rayMovesInto(moves, board, from, piece.color, file, rank, false);
      break;
    case 'cannon':
      rayMovesInto(moves, board, from, piece.color, file, rank, true);
      break;
    case 'soldier': {
      const forward = piece.color === 'red' ? 1 : -1;
      addStep(file, rank + forward);
      // RIVER SOLDIER (2026-09-02, reverting the 2026-07-03 veteran ship): forward
      // only at home, sideways as well once across, exactly as in xiangqi. The
      // veteran soldier took draws from 12% to 34% and the median game from 75
      // plies to 131 at Modal depth 16 — measured five ways in the 2026-09-02
      // section of docs-private/drop-game-lab/DESIGN-SPEC.md. It also deleted the
      // one rule that defines the piece: crossing the river is the soldier's only
      // irreversible commitment.
      if (fortressXiangqiCrossedRiver(piece.color, rank)) {
        addStep(file - 1, rank);
        addStep(file + 1, rank);
      }
      break;
    }
    case 'treasure':
      // TREASURE HOME (2026-09-02): one step in any of the eight directions, but
      // never across the river — the piece being stormed for stays in the fortress.
      // Free once the soldier is river-gated: it costs no draws (12% -> 9%) and
      // adds 43 plies a game. Under the veteran soldier it cost 12pp of draws,
      // which is why this looked unaffordable until the soldier was fixed.
      for (const [df, dr] of ALL_STEPS) {
        if (fortressXiangqiCrossedRiver(piece.color, rank + dr)) continue;
        addStep(file + df, rank + dr);
      }
      break;
  }
  return moves;
}

function rayMovesInto(
  moves: FortressXiangqiBoardMove[],
  board: FortressXiangqiBoard,
  from: FortressXiangqiSquare,
  color: FortressXiangqiColor,
  file: number,
  rank: number,
  cannon: boolean,
): void {
  for (const [df, dr] of ORTHOGONAL_STEPS) {
    let f = file + df;
    let r = rank + dr;
    if (!cannon) {
      while (fortressXiangqiInBounds(f, r)) {
        const to = fortressXiangqiSquareOf(f, r);
        const target = board[to];
        if (!target) {
          moves.push({ from, to });
        } else {
          if (target.color !== color) moves.push({ from, to });
          break;
        }
        f += df;
        r += dr;
      }
      continue;
    }
    // Cannon: slide freely, then need exactly one screen before a capture.
    while (fortressXiangqiInBounds(f, r) && !isOccupied(board, f, r)) {
      moves.push({ from, to: fortressXiangqiSquareOf(f, r) });
      f += df;
      r += dr;
    }
    if (!fortressXiangqiInBounds(f, r)) continue; // ran off the board with no screen
    f += df;
    r += dr;
    while (fortressXiangqiInBounds(f, r) && !isOccupied(board, f, r)) {
      f += df;
      r += dr;
    }
    if (!fortressXiangqiInBounds(f, r)) continue;
    const to = fortressXiangqiSquareOf(f, r);
    if (board[to]?.color !== color) moves.push({ from, to });
  }
}

// ── Legality (self-check filtering) ─────────────────────────────────────────

function isBoardMoveLegal(
  board: FortressXiangqiBoard,
  move: FortressXiangqiBoardMove,
  color: FortressXiangqiColor,
): boolean {
  if (board[move.to]?.role === 'general') return false; // general is won by mate, never captured
  const next = fortressXiangqiBoardAfterMove(board, move);
  return !isFortressXiangqiGeneralInCheckOnBoard(next, color);
}

function legalBoardMovesFor(
  board: FortressXiangqiBoard,
  color: FortressXiangqiColor,
): FortressXiangqiBoardMove[] {
  const moves: FortressXiangqiBoardMove[] = [];
  for (const [sq, piece] of Object.entries(board)) {
    if (!piece || piece.color !== color) continue;
    for (const move of pseudoBoardMovesFrom(board, sq as FortressXiangqiSquare)) {
      if (isBoardMoveLegal(board, move, color)) moves.push(move);
    }
  }
  return moves;
}

function isDropRegionLegal(
  role: FortressXiangqiDropRole,
  color: FortressXiangqiColor,
  square: FortressXiangqiSquare,
): boolean {
  const { file, rank } = fortressXiangqiCoordOf(square);
  if (role === 'advisor') return fortressXiangqiInPalace(color, file, rank);
  if (role === 'elephant') return fortressXiangqiInOwnHalf(color, rank);
  // The Treasure joined the defenders on 2026-09-02. It has to be listed HERE as
  // well as in the move generator: FSF derives drop legality from the piece's
  // mobility region, so confining it there confined its drops for free, and the
  // kernel — which keeps the two rules apart — silently kept letting it
  // parachute. The parity harness caught it as 20 mismatches in 3 games.
  if (role === 'treasure') return fortressXiangqiInOwnHalf(color, rank);
  return true; // attackers drop anywhere
}

function isDropLegal(
  board: FortressXiangqiBoard,
  hands: FortressXiangqiHands,
  move: FortressXiangqiDropMove,
  color: FortressXiangqiColor,
): boolean {
  if (!FORTRESS_DROP_ROLES.includes(move.drop)) return false;
  if ((hands[color][move.drop] ?? 0) <= 0) return false;
  if (board[move.to]) return false; // must land on an empty point
  if (!isDropRegionLegal(move.drop, color, move.to)) return false;
  const next: FortressXiangqiBoard = { ...board, [move.to]: { color, role: move.drop } };
  // Drop-check is allowed, but you may not leave your own general in check.
  return !isFortressXiangqiGeneralInCheckOnBoard(next, color);
}

function legalDropsFor(
  board: FortressXiangqiBoard,
  hands: FortressXiangqiHands,
  color: FortressXiangqiColor,
): FortressXiangqiDropMove[] {
  const drops: FortressXiangqiDropMove[] = [];
  for (const role of FORTRESS_DROP_ROLES) {
    if ((hands[color][role] ?? 0) <= 0) continue;
    for (const to of ALL_FORTRESS_XIANGQI_SQUARES) {
      const move: FortressXiangqiDropMove = { drop: role, to };
      if (isDropLegal(board, hands, move, color)) drops.push(move);
    }
  }
  return drops;
}

export function getFortressXiangqiLegalMoves(
  state: FortressXiangqiGameState,
): FortressXiangqiMove[] {
  if (state.status.type !== 'playing') return [];
  const color = state.status.turn;
  return [
    ...legalBoardMovesFor(state.board, color),
    ...legalDropsFor(state.board, state.hands, color),
  ];
}

export function isFortressXiangqiLegalMove(
  state: FortressXiangqiGameState,
  move: FortressXiangqiMove,
): boolean {
  if (state.status.type !== 'playing') return false;
  const color = state.status.turn;
  if (isFortressXiangqiDropMove(move)) return isDropLegal(state.board, state.hands, move, color);
  return legalBoardMovesFor(state.board, color).some(
    (candidate) => candidate.from === move.from && candidate.to === move.to,
  );
}

// Perpetual-check adjudication — the headline chasing case ("you cannot
// perpetual-check your way out of a lost game"). Replays the move list; if the
// three-fold repetition that ended the game was reached by ONE side giving check
// on every one of its moves in the repeating cycle (and the other side not),
// that side is the perpetual checker and LOSES. Mutual or check-free repetitions
// stay draws. Returns the losing color, or null to keep the draw.
//
// This is the pure-kernel, deterministic subset of the chasing rule. Perpetual
// material *chase* (non-check harassment, which needs "is this piece genuinely
// chased net of protection/trades") is NOT covered here — it is left to the
// Fairy-Stockfish adjudicator (see docs-private/fortress-xiangqi-build-track.md).
export function fortressXiangqiPerpetualCheckLoser(
  moves: readonly FortressXiangqiMove[],
  initialState: FortressXiangqiGameState = createInitialFortressXiangqiState('adjudicate'),
): FortressXiangqiColor | null {
  let state = initialState;
  const plies: { mover: FortressXiangqiColor; gaveCheck: boolean; key: string }[] = [];
  for (const move of moves) {
    if (state.status.type !== 'playing') break;
    const mover = state.status.turn;
    if (!isFortressXiangqiLegalMove(state, move)) return null; // desync — do not adjudicate
    state = applyFortressXiangqiMove(state, move);
    const opponent = oppositeFortressXiangqiColor(mover);
    const gaveCheck = isFortressXiangqiGeneralInCheckOnBoard(state.board, opponent);
    // Key with the opponent to move, so it is comparable regardless of whether
    // this ply finished the game.
    const key = fortressXiangqiPositionRepetitionKey({
      ...state,
      status: { type: 'playing', turn: opponent },
    });
    plies.push({ mover, gaveCheck, key });
  }
  if (plies.length === 0) return null;
  const repeatedKey = plies[plies.length - 1]!.key;
  const occurrences = plies.flatMap((ply, i) => (ply.key === repeatedKey ? [i] : []));
  if (occurrences.length < 2) return null;
  // The cycle that closed the repetition: moves after the 2nd-to-last occurrence
  // through the last occurrence.
  const cycle = plies.slice(occurrences[occurrences.length - 2]! + 1, occurrences.at(-1)! + 1);
  const perpetualBy = (color: FortressXiangqiColor): boolean => {
    const own = cycle.filter((ply) => ply.mover === color);
    return own.length > 0 && own.every((ply) => ply.gaveCheck);
  };
  const redPerpetual = perpetualBy('red');
  const blackPerpetual = perpetualBy('black');
  if (redPerpetual && !blackPerpetual) return 'red';
  if (blackPerpetual && !redPerpetual) return 'black';
  return null;
}

function hasLegalMove(
  board: FortressXiangqiBoard,
  hands: FortressXiangqiHands,
  color: FortressXiangqiColor,
): boolean {
  if (legalBoardMovesFor(board, color).length > 0) return true;
  return legalDropsFor(board, hands, color).length > 0;
}

// ── Check detection ─────────────────────────────────────────────────────────

export function isFortressXiangqiGeneralInCheck(
  state: FortressXiangqiGameState,
  color: FortressXiangqiColor,
): boolean {
  return isFortressXiangqiGeneralInCheckOnBoard(state.board, color);
}

export function isFortressXiangqiGeneralInCheckOnBoard(
  board: FortressXiangqiBoard,
  color: FortressXiangqiColor,
): boolean {
  const general = findFortressXiangqiGeneral(board, color);
  if (!general) return true; // no general = lost; treat as "in check" for legality
  return isSquareAttacked(board, oppositeFortressXiangqiColor(color), general);
}

function isSquareAttacked(
  board: FortressXiangqiBoard,
  byColor: FortressXiangqiColor,
  target: FortressXiangqiSquare,
): boolean {
  for (const [sq, piece] of Object.entries(board)) {
    // Generals never attack via a normal step here (opposite-corner palaces are
    // never adjacent); general-vs-general is the flying-general check below.
    if (!piece || piece.color !== byColor || piece.role === 'general') continue;
    if (pseudoBoardMovesFrom(board, sq as FortressXiangqiSquare).some((m) => m.to === target)) {
      return true;
    }
  }
  return generalsFaceOnOpenFile(board, byColor, target);
}

// Flying-general: two generals may not stand on the same file with a clear path.
// (With opposite-corner palaces the files never overlap, so this is dead in
// normal play, but it is kept for rule fidelity.)
function generalsFaceOnOpenFile(
  board: FortressXiangqiBoard,
  byColor: FortressXiangqiColor,
  target: FortressXiangqiSquare,
): boolean {
  const enemyGeneral = findFortressXiangqiGeneral(board, byColor);
  if (!enemyGeneral) return false;
  const attacker = fortressXiangqiCoordOf(enemyGeneral);
  const attacked = fortressXiangqiCoordOf(target);
  if (attacker.file !== attacked.file || attacker.rank === attacked.rank) return false;
  const lo = Math.min(attacker.rank, attacked.rank);
  const hi = Math.max(attacker.rank, attacked.rank);
  for (let rank = lo + 1; rank < hi; rank += 1) {
    if (board[fortressXiangqiSquareOf(attacker.file, rank)]) return false;
  }
  return true;
}

function findFortressXiangqiGeneral(
  board: FortressXiangqiBoard,
  color: FortressXiangqiColor,
): FortressXiangqiSquare | null {
  for (const [sq, piece] of Object.entries(board)) {
    if (piece?.color === color && piece.role === 'general') return sq as FortressXiangqiSquare;
  }
  return null;
}

// ── Apply move ──────────────────────────────────────────────────────────────

export function applyFortressXiangqiMove(
  state: FortressXiangqiGameState,
  move: FortressXiangqiMove,
): FortressXiangqiGameState {
  if (state.status.type !== 'playing') return state;
  if (!isFortressXiangqiLegalMove(state, move)) return state;
  return isFortressXiangqiDropMove(move) ? applyDrop(state, move) : applyBoardMove(state, move);
}

function applyBoardMove(
  state: FortressXiangqiGameState,
  move: FortressXiangqiBoardMove,
): FortressXiangqiGameState {
  if (state.status.type !== 'playing') return state;
  const movingColor = state.status.turn;
  const movingPiece = state.board[move.from];
  const capturedPiece = state.board[move.to];
  if (!movingPiece || capturedPiece?.role === 'general') return state;

  const board = fortressXiangqiBoardAfterMove(state.board, move);
  const hands = cloneHands(state.hands);
  if (capturedPiece)
    incrementHand(hands[movingColor], capturedPiece.role as FortressXiangqiDropRole);

  return finalize(state, board, hands, movingColor, move);
}

function applyDrop(
  state: FortressXiangqiGameState,
  move: FortressXiangqiDropMove,
): FortressXiangqiGameState {
  if (state.status.type !== 'playing') return state;
  const movingColor = state.status.turn;
  const hands = cloneHands(state.hands);
  decrementHand(hands[movingColor], move.drop);
  const board: FortressXiangqiBoard = {
    ...state.board,
    [move.to]: { color: movingColor, role: move.drop },
  };
  return finalize(state, board, hands, movingColor, move);
}

function finalize(
  previous: FortressXiangqiGameState,
  board: FortressXiangqiBoard,
  hands: FortressXiangqiHands,
  movingColor: FortressXiangqiColor,
  move: FortressXiangqiMove,
): FortressXiangqiGameState {
  const nextTurn = oppositeFortressXiangqiColor(movingColor);
  const moveNumber = movingColor === 'black' ? previous.moveNumber + 1 : previous.moveNumber;

  const provisional: FortressXiangqiGameState = {
    ...previous,
    board,
    hands,
    status: { type: 'playing', turn: nextTurn },
    moveNumber,
    lastMove: move,
    moveLog: [...(previous.moveLog ?? []), move],
  };

  const repKey = fortressXiangqiPositionRepetitionKey(provisional);
  const positionCounts = { ...previous.positionCounts };
  positionCounts[repKey] = (positionCounts[repKey] ?? 0) + 1;

  let status: FortressXiangqiGameStatus = { type: 'playing', turn: nextTurn };
  if (!hasLegalMove(board, hands, nextTurn)) {
    status = {
      type: 'finished',
      winner: movingColor,
      reason: isFortressXiangqiGeneralInCheckOnBoard(board, nextTurn) ? 'checkmate' : 'stalemate',
    };
  } else if ((positionCounts[repKey] ?? 0) >= 3) {
    // Baseline draw. The Fortress tenant upgrades this to a `'chasing'` loss when
    // fortressXiangqiPerpetualCheckLoser(moveLog) finds a sole perpetual checker.
    // (Kept out of the kernel core so the adjudicator's own replay can't recurse.)
    status = { type: 'finished', winner: null, reason: 'repetition' };
  }

  return { ...provisional, status, positionCounts };
}

// ── Views & helpers ─────────────────────────────────────────────────────────

export function getFortressXiangqiPlayerView(
  state: FortressXiangqiGameState,
  color: FortressXiangqiColor,
): FortressXiangqiPlayerView {
  return {
    id: state.id,
    perspective: color,
    board: { ...state.board },
    hands: cloneHands(state.hands),
    legalMoves:
      state.status.type === 'playing'
        ? getFortressXiangqiLegalMoves({ ...state, status: { type: 'playing', turn: color } })
        : [],
    inCheck:
      state.status.type === 'playing'
        ? isFortressXiangqiGeneralInCheckOnBoard(state.board, color)
        : false,
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
  };
}

export function fortressXiangqiBoardAfterMove(
  board: FortressXiangqiBoard,
  move: FortressXiangqiBoardMove,
): FortressXiangqiBoard {
  const movingPiece = board[move.from];
  if (!movingPiece) return { ...board };
  const next: FortressXiangqiBoard = { ...board };
  delete next[move.from];
  next[move.to] = movingPiece;
  return next;
}

export function fortressXiangqiPositionRepetitionKey(state: FortressXiangqiGameState): string {
  const turn = state.status.type === 'playing' ? state.status.turn : '-';
  const board = Object.entries(state.board)
    .filter(([, piece]) => piece)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sq, p]) => `${sq}${p!.color[0]}${ROLE_REPETITION_CODES[p!.role]}`)
    .join(',');
  return `${turn}|${board}|h:${handsKey(state.hands)}`;
}

function isOccupied(board: FortressXiangqiBoard, file: number, rank: number): boolean {
  return (
    fortressXiangqiInBounds(file, rank) && board[fortressXiangqiSquareOf(file, rank)] !== undefined
  );
}

function cloneHands(hands: FortressXiangqiHands): FortressXiangqiHands {
  return { red: { ...hands.red }, black: { ...hands.black } };
}

function incrementHand(hand: FortressXiangqiHand, role: FortressXiangqiDropRole): void {
  hand[role] = (hand[role] ?? 0) + 1;
}

function decrementHand(hand: FortressXiangqiHand, role: FortressXiangqiDropRole): void {
  const next = (hand[role] ?? 0) - 1;
  if (next > 0) hand[role] = next;
  else delete hand[role];
}

function handsKey(hands: FortressXiangqiHands): string {
  return `r:${handKey(hands.red)}|b:${handKey(hands.black)}`;
}

function handKey(hand: FortressXiangqiHand): string {
  return FORTRESS_DROP_ROLES.map((role) => `${ROLE_REPETITION_CODES[role]}${hand[role] ?? 0}`).join(
    '',
  );
}
