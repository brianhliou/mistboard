// Display formatting for standard-xiangqi moves: render the canonical
// {from,to} move history as coordinate, ICCS (0-indexed UCI), chess-style
// algebraic, WXF, or Chinese relative notation. Pure views — nothing here is
// stored or transmitted.
//
// The relative styles derive a RelativeMoveSpec from the pre-move board and
// verify it round-trips through the importer's own resolver before
// serializing, so a label can never be ambiguous or drift from what the
// importer accepts. Positions the shared grammar cannot express uniquely
// (a middle piece in a 3-stack, or the same role stacked on two files, both
// soldier-only situations) fall back to coordinate notation rather than emit
// a wrong or unparseable token.
//
// Standard xiangqi only: fog and reveal variants must keep coordinate labels
// (a role-bearing token like 炮二平五 would leak hidden piece identity), and
// drop variants have no relative-notation drop form.

import {
  ARBITER_ADJUDICATED_DRAWS,
  coordOf,
  createInitialXiangqiState,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPieceRole,
  type XiangqiSquare,
} from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
  isStandardXiangqiGeneralInCheck,
  isStandardXiangqiLegalMove,
} from './variants-xiangqi-standard.js';
import {
  FILE_ARG_ROLES,
  type RelativeMoveSpec,
  type RelativeSelector,
  resolveRelativeMove,
  wxfFileNumber,
} from './xiangqi-relative-notation.js';
import { xiangqiMoveToPikafishUci } from './xiangqi-uci.js';

export type XiangqiNotationStyle =
  | 'coordinate' // native squares: h3-e3 (files a-i, ranks 1-10)
  | 'iccs' // 0-indexed UCI as used by Pikafish/UCCI: h2e2
  | 'algebraic' // chess-style SAN: Ce3, Hc3, Cxe7, Rhe1 (piece letter + destination)
  | 'wxf' // WXF relative: C2.5, H2+3, +C.5
  | 'chinese-simplified' // 炮二平五 / 马8进7
  | 'chinese-traditional'; // 炮二平五 / 馬8進7

export type XiangqiRelativeStyle = Extract<
  XiangqiNotationStyle,
  'wxf' | 'chinese-simplified' | 'chinese-traditional'
>;

// --- spec derivation ---------------------------------------------------------

/**
 * Describe a concrete move as a relative-notation spec against its pre-move
 * state, or null when the shared WXF/Chinese grammar cannot name it uniquely.
 * The returned spec is verified: resolveRelativeMove(state, spec) === move.
 */
export function describeXiangqiRelativeMove(
  state: XiangqiGameState,
  move: XiangqiMove,
): RelativeMoveSpec | null {
  if (state.status.type !== 'playing') return null;
  const color = state.status.turn;
  const piece = state.board[move.from];
  if (!piece || piece.color !== color) return null;

  const a = coordOf(move.from);
  const b = coordOf(move.to);
  const forwardUp = color === 'red';

  let op: RelativeMoveSpec['op'];
  if (b.rank === a.rank) op = '.';
  else op = b.rank > a.rank === forwardUp ? '+' : '-';
  // Traverse is only meaningful for straight movers; a same-rank horse move
  // does not exist, but guard anyway so a malformed move fails cleanly.
  if (op === '.' && FILE_ARG_ROLES.has(piece.role)) return null;

  const arg =
    op === '.' || FILE_ARG_ROLES.has(piece.role)
      ? wxfFileNumber(b.file, color)
      : Math.abs(b.rank - a.rank);

  const selector = selectorFor(state, move.from, piece.role, color, forwardUp);
  if (!selector) return null;

  const spec: RelativeMoveSpec = { role: piece.role, selector, op, arg };

  // Round-trip guarantee: only emit specs the importer resolves back to this
  // exact move. Catches every residual ambiguity in one place.
  const resolved = resolveRelativeMove(state, spec);
  if (!resolved || resolved.from !== move.from || resolved.to !== move.to) return null;
  return spec;
}

function selectorFor(
  state: XiangqiGameState,
  from: XiangqiSquare,
  role: XiangqiPieceRole,
  color: XiangqiColor,
  forwardUp: boolean,
): RelativeSelector | null {
  const sources = Object.entries(state.board)
    .filter(([, piece]) => piece && piece.color === color && piece.role === role)
    .map(([square]) => square as XiangqiSquare);

  const file = coordOf(from).file;
  const onFile = sources.filter((sq) => coordOf(sq).file === file);
  if (onFile.length === 1) {
    return { kind: 'file', wxfFile: wxfFileNumber(file, color) };
  }

  // Stacked: the grammar's tandem form carries no file, so it is only unique
  // when exactly one file holds a stack of this role, and only names the ends.
  const stackedFiles = new Set(
    sources
      .map((sq) => coordOf(sq).file)
      .filter((f, _i, all) => all.filter((x) => x === f).length >= 2),
  );
  if (stackedFiles.size !== 1) return null;

  const ordered = [...onFile].sort((x, y) =>
    forwardUp ? coordOf(y).rank - coordOf(x).rank : coordOf(x).rank - coordOf(y).rank,
  );
  if (from === ordered[0]) return { kind: 'tandem', end: 'front' };
  if (from === ordered[ordered.length - 1]) return { kind: 'tandem', end: 'rear' };
  return null; // middle of a 3+ stack: needs 中, which the grammar does not carry
}

// --- serialization -----------------------------------------------------------

const WXF_ROLE_TO_LETTER: Record<XiangqiPieceRole, string> = {
  general: 'K',
  advisor: 'A',
  elephant: 'E',
  horse: 'H',
  chariot: 'R',
  cannon: 'C',
  soldier: 'P',
};

type ChineseScript = 'simplified' | 'traditional';

// Output glyph sets. Every glyph here must stay parseable by the importer's
// CN_PIECE_TO_ROLE / CN_OP / CN_TANDEM / CN_NUMERAL tables (round-trip tests
// enforce it) — that is why traditional avoids 俥/傌/砲-for-red, which common
// print uses but our parser does not accept.
const CN_ROLE_GLYPHS: Record<
  ChineseScript,
  Record<XiangqiColor, Record<XiangqiPieceRole, string>>
> = {
  simplified: {
    red: {
      chariot: '车',
      horse: '马',
      elephant: '相',
      advisor: '仕',
      general: '帅',
      cannon: '炮',
      soldier: '兵',
    },
    black: {
      chariot: '车',
      horse: '马',
      elephant: '象',
      advisor: '士',
      general: '将',
      cannon: '炮',
      soldier: '卒',
    },
  },
  traditional: {
    red: {
      chariot: '車',
      horse: '馬',
      elephant: '相',
      advisor: '仕',
      general: '帥',
      cannon: '炮',
      soldier: '兵',
    },
    black: {
      chariot: '車',
      horse: '馬',
      elephant: '象',
      advisor: '士',
      general: '將',
      cannon: '包',
      soldier: '卒',
    },
  },
};

const CN_OP_GLYPHS: Record<ChineseScript, Record<RelativeMoveSpec['op'], string>> = {
  simplified: { '+': '进', '-': '退', '.': '平' },
  traditional: { '+': '進', '-': '退', '.': '平' },
};

const CN_TANDEM_GLYPHS: Record<ChineseScript, Record<'front' | 'rear', string>> = {
  simplified: { front: '前', rear: '后' },
  traditional: { front: '前', rear: '後' },
};

const CN_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

// Convention: red writes numerals in Chinese, black in Arabic.
function chineseNumeral(value: number, color: XiangqiColor): string {
  return color === 'red' ? CN_DIGITS[value - 1]! : String(value);
}

function serializeWxf(spec: RelativeMoveSpec): string {
  const letter = WXF_ROLE_TO_LETTER[spec.role];
  const prefix =
    spec.selector.kind === 'file'
      ? `${letter}${spec.selector.wxfFile}`
      : `${spec.selector.end === 'front' ? '+' : '-'}${letter}`;
  return `${prefix}${spec.op}${spec.arg}`;
}

function serializeChinese(
  spec: RelativeMoveSpec,
  color: XiangqiColor,
  script: ChineseScript,
): string {
  const glyph = CN_ROLE_GLYPHS[script][color][spec.role];
  const prefix =
    spec.selector.kind === 'file'
      ? `${glyph}${chineseNumeral(spec.selector.wxfFile, color)}`
      : `${CN_TANDEM_GLYPHS[script][spec.selector.end]}${glyph}`;
  return `${prefix}${CN_OP_GLYPHS[script][spec.op]}${chineseNumeral(spec.arg, color)}`;
}

// --- algebraic (chess-style SAN) --------------------------------------------
// Piece letter, chess-style disambiguation, `x` on capture, destination square,
// `+`/`#` after. The letters are the WXF set (K A E H R C P) so a reader who
// switches between WXF and algebraic meets one alphabet. Soldiers keep their
// letter: chess drops the pawn's because a pawn's file names it, but a xiangqi
// soldier that has crossed the river moves sideways, so `e5` alone would not
// say what moved. Absolute squares, red's a1 bottom-left for both sides, which
// is exactly the address a chess player already reads.

const ALGEBRAIC_CHECK = '+';
const ALGEBRAIC_MATE = '#';

/**
 * Format one move in chess-style algebraic against its pre-move state, or null
 * when the move is not a legal standard move (the label needs the legal move
 * set to disambiguate and the post-move board to mark check).
 */
export function formatXiangqiAlgebraicMove(
  state: XiangqiGameState,
  move: XiangqiMove,
): string | null {
  if (state.status.type !== 'playing') return null;
  const color = state.status.turn;
  const piece = state.board[move.from];
  if (!piece || piece.color !== color) return null;
  if (!isStandardXiangqiLegalMove(state, move)) return null;

  const letter = WXF_ROLE_TO_LETTER[piece.role];
  const capture = state.board[move.to] ? 'x' : '';

  // Chess disambiguation: another piece of the same role can reach the square,
  // so name the origin file if that settles it, else the rank, else the square.
  const rivals = getStandardXiangqiLegalMoves(state).filter(
    (other) =>
      other.to === move.to &&
      other.from !== move.from &&
      state.board[other.from]?.role === piece.role,
  );
  let origin = '';
  if (rivals.length > 0) {
    const from = coordOf(move.from);
    const sharesFile = rivals.some((other) => coordOf(other.from).file === from.file);
    const sharesRank = rivals.some((other) => coordOf(other.from).rank === from.rank);
    if (!sharesFile) origin = move.from[0]!;
    else if (!sharesRank) origin = String(from.rank);
    else origin = move.from;
  }

  const after = applyStandardXiangqiMove(state, move);
  const opponent: XiangqiColor = color === 'red' ? 'black' : 'red';
  let suffix = '';
  if (after.status.type === 'finished' && after.status.reason === 'checkmate') {
    suffix = ALGEBRAIC_MATE;
  } else if (isStandardXiangqiGeneralInCheck(after, opponent)) {
    suffix = ALGEBRAIC_CHECK;
  }

  return `${letter}${origin}${capture}${move.to}${suffix}`;
}

// --- public API --------------------------------------------------------------

export function coordinateXiangqiLabel(move: XiangqiMove): string {
  return `${move.from}-${move.to}`;
}

/** The WXF/algebraic letter for a role: K A E H R C P. */
export function xiangqiPieceLetter(role: XiangqiPieceRole): string {
  return WXF_ROLE_TO_LETTER[role];
}

/**
 * Label a move whose PRE-move board is gone but whose post-move board is at
 * hand (a puzzle's mined setup move: the server ships the position after it).
 * Algebraic gets the long form, piece letter plus both squares (`Ch3-e3`),
 * since without the earlier board a capture cannot be told from a quiet move
 * and the short form would claim one or the other. Relative styles need the
 * earlier board outright, so every other style is the coordinate label.
 */
export function formatXiangqiMoveFromAfter(
  after: XiangqiGameState,
  move: XiangqiMove,
  style: XiangqiNotationStyle,
): string {
  if (style === 'iccs') return xiangqiMoveToPikafishUci(move);
  const piece = style === 'algebraic' ? after.board[move.to] : undefined;
  return piece
    ? `${xiangqiPieceLetter(piece.role)}${move.from}-${move.to}`
    : coordinateXiangqiLabel(move);
}

/**
 * Format one move in a relative style against its pre-move state. Null when
 * the position cannot be named uniquely in the shared grammar (rare,
 * soldier-stack situations) — callers fall back to coordinate.
 */
export function formatXiangqiRelativeMove(
  state: XiangqiGameState,
  move: XiangqiMove,
  style: XiangqiRelativeStyle,
): string | null {
  const spec = describeXiangqiRelativeMove(state, move);
  if (!spec) return null;
  if (style === 'wxf') return serializeWxf(spec);
  const color = state.status.type === 'playing' ? state.status.turn : 'red';
  return serializeChinese(
    spec,
    color,
    style === 'chinese-simplified' ? 'simplified' : 'traditional',
  );
}

/** Format one move in any style; relative and algebraic styles fall back to
 *  coordinate when the position cannot name the move. */
export function formatXiangqiMove(
  state: XiangqiGameState,
  move: XiangqiMove,
  style: XiangqiNotationStyle,
): string {
  switch (style) {
    case 'coordinate':
      return coordinateXiangqiLabel(move);
    case 'iccs':
      return xiangqiMoveToPikafishUci(move);
    case 'algebraic':
      return formatXiangqiAlgebraicMove(state, move) ?? coordinateXiangqiLabel(move);
    default:
      return formatXiangqiRelativeMove(state, move, style) ?? coordinateXiangqiLabel(move);
  }
}

/**
 * Format a whole game line, replaying from `startState` (the standard opening
 * when omitted). If a move is illegal at its turn, that move and the rest of
 * the line render as coordinate labels (the board state is no longer
 * trustworthy).
 *
 * `startState` exists for records that do not begin at the opening: a study
 * chapter set from a FEN, an endgame, a composed problem. Without it those
 * lines are illegal from ply 1 against a board of 32 pieces, so every move
 * silently fell out to coordinates -- which reads as working notation and is
 * not.
 *
 * A record is not live play, so an ARBITER-ADJUDICATED draw does not end the
 * line: this kernel auto-draws on repetition and on the progress clock, and real
 * tournament games run past both. Before this, notating such a game silently
 * dropped to raw coordinates from the auto-draw onward -- 18 plies of a 1965
 * championship game and 16 of the 2025 world final rendered as `f6-g6`.
 */
export function formatXiangqiMoves(
  moves: readonly XiangqiMove[],
  style: XiangqiNotationStyle,
  startState?: XiangqiGameState,
): string[] {
  const initial = startState ?? createInitialXiangqiState('notation-format');
  // Whoever is to move in the start position, not always Red: a chapter FEN can
  // hand the line to Black on ply 1, and the resume below alternates from here.
  const firstMover: XiangqiColor = initial.status.type === 'playing' ? initial.status.turn : 'red';
  let state: XiangqiGameState | null = initial;
  const labels: string[] = [];
  for (const [index, move] of moves.entries()) {
    // Resume through an auto-draw the record clearly played past.
    if (state?.status.type === 'finished' && ARBITER_ADJUDICATED_DRAWS.has(state.status.reason)) {
      const turn: XiangqiColor =
        index % 2 === 0 ? firstMover : firstMover === 'red' ? 'black' : 'red';
      state = { ...state, status: { type: 'playing', turn } };
    }
    if (state?.status.type === 'playing' && isStandardXiangqiLegalMove(state, move)) {
      labels.push(formatXiangqiMove(state, move, style));
      state = applyStandardXiangqiMove(state, move);
    } else {
      state = null;
      labels.push(style === 'iccs' ? xiangqiMoveToPikafishUci(move) : coordinateXiangqiLabel(move));
    }
  }
  return labels;
}
