// Shared core of xiangqi relative move notation (WXF + Chinese).
//
// Both notations describe a move relative to the mover: which piece (by file,
// front/rear when stacked, or in WXF a front-first number for a soldier in a
// 3-5 stack), which direction (advance / retreat / traverse),
// and an argument that is a destination FILE for pieces that change file when
// moving vertically (horse/elephant/advisor) or a RANK COUNT for straight
// movers (chariot/cannon/soldier/general). File numbers run 1-9 from each
// side's own right: red file N is our file index 9-N (file 2 = 'h'), black
// file N is index N-1 (file 2 = 'b'). Verified against the documented game in
// articles/content (h3e3 = C2.5, h1g3 = H2+3).
//
// The importer (xiangqi-import.ts) parses tokens into a RelativeMoveSpec and
// resolves it against the legal-move set; the formatter
// (xiangqi-notation-format.ts) derives a spec from a concrete move and
// serializes it. Keeping the spec model and resolver here means the two
// directions can never drift apart.

import {
  coordOf,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPieceRole,
  type XiangqiSquare,
} from './variants-xiangqi.js';
import { getStandardXiangqiLegalMoves } from './variants-xiangqi-standard.js';

export type RelativeSelector =
  | { kind: 'file'; wxfFile: number }
  | { kind: 'tandem'; end: 'front' | 'rear' }
  // WXF only: the Nth soldier from the front of a 3-5 soldier stack on wxfFile.
  | { kind: 'ordinal'; index: number; wxfFile: number };

/** WXF numbers soldiers from the front, in place of the letter, from this stack size. */
export const WXF_ORDINAL_MIN_STACK = 3;

export interface RelativeMoveSpec {
  role: XiangqiPieceRole;
  selector: RelativeSelector;
  /** '+' advance, '-' retreat, '.' traverse (we normalize '=' to '.'). */
  op: '+' | '-' | '.';
  /** Destination file for '.', and for '+'/'-' of a file-arg role; else rank count. */
  arg: number;
}

/** Occupancy and public roles only; a masked piece has no role. */
export type XiangqiNotationBoard = Partial<
  Record<XiangqiSquare, { color: XiangqiColor; role?: XiangqiPieceRole }>
>;

// Roles whose +/- argument is the destination FILE (they always change file on a
// vertical move); everything else uses a rank-count argument.
export const FILE_ARG_ROLES = new Set<XiangqiPieceRole>(['horse', 'elephant', 'advisor']);

export function wxfFileNumber(fileIndex: number, color: XiangqiColor): number {
  return color === 'red' ? 9 - fileIndex : fileIndex + 1;
}

// Resolve a relative spec to the single legal move that fits — we filter the
// rules engine's legal moves rather than re-deriving piece geometry. Returns null
// if the spec is unsatisfiable or ambiguous (so the codec fails cleanly).
export function resolveRelativeMove(
  state: XiangqiGameState,
  spec: RelativeMoveSpec,
): XiangqiMove | null {
  if (state.status.type !== 'playing') return null;
  return resolveRelativeMoveFromLegalMoves(
    state.board,
    state.status.turn,
    spec,
    getStandardXiangqiLegalMoves(state),
  );
}

/** Resolve with the caller's rule-specific legal moves, without reading a deal. */
export function resolveRelativeMoveFromLegalMoves(
  board: XiangqiNotationBoard,
  color: XiangqiColor,
  spec: RelativeMoveSpec,
  legal: readonly XiangqiMove[],
): XiangqiMove | null {
  const forwardUp = color === 'red';

  const sources = Object.entries(board)
    .filter(([, piece]) => piece && piece.color === color && piece.role === spec.role)
    .map(([square]) => square as XiangqiSquare);

  let candidates: XiangqiSquare[];
  if (spec.selector.kind === 'file') {
    const wanted = spec.selector.wxfFile;
    candidates = sources.filter((sq) => wxfFileNumber(coordOf(sq).file, color) === wanted);
  } else if (spec.selector.kind === 'ordinal') {
    const wanted = spec.selector.wxfFile;
    const stack = sources
      .filter((sq) => wxfFileNumber(coordOf(sq).file, color) === wanted)
      .sort((a, b) =>
        forwardUp ? coordOf(b).rank - coordOf(a).rank : coordOf(a).rank - coordOf(b).rank,
      );
    const pick =
      spec.role === 'soldier' && stack.length >= WXF_ORDINAL_MIN_STACK
        ? stack[spec.selector.index - 1]
        : undefined;
    candidates = pick ? [pick] : [];
  } else {
    // Tandem: the file holding >=2 of this role, ordered front (nearest enemy) to rear.
    const byFile = new Map<number, XiangqiSquare[]>();
    for (const sq of sources) {
      const file = coordOf(sq).file;
      const list = byFile.get(file) ?? [];
      list.push(sq);
      byFile.set(file, list);
    }
    const stacked = [...byFile.values()].find((list) => list.length >= 2) ?? [];
    const ordered = [...stacked].sort((a, b) =>
      forwardUp ? coordOf(b).rank - coordOf(a).rank : coordOf(a).rank - coordOf(b).rank,
    );
    const pick = spec.selector.end === 'front' ? ordered[0] : ordered[ordered.length - 1];
    candidates = pick ? [pick] : [];
  }

  const matches: XiangqiMove[] = [];
  for (const from of candidates) {
    for (const move of legal) {
      if (move.from !== from) continue;
      const a = coordOf(move.from);
      const b = coordOf(move.to);
      if (spec.op === '.') {
        if (b.rank === a.rank && wxfFileNumber(b.file, color) === spec.arg) matches.push(move);
        continue;
      }
      const goesForward = forwardUp ? b.rank > a.rank : b.rank < a.rank;
      if (goesForward !== (spec.op === '+')) continue;
      if (FILE_ARG_ROLES.has(spec.role)) {
        if (wxfFileNumber(b.file, color) === spec.arg) matches.push(move);
      } else if (b.file === a.file && Math.abs(b.rank - a.rank) === spec.arg) {
        matches.push(move);
      }
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}

// --- WXF token grammar -------------------------------------------------------

export const WXF_LETTER_TO_ROLE: Record<string, XiangqiPieceRole> = {
  K: 'general',
  A: 'advisor',
  E: 'elephant',
  B: 'elephant', // Bishop
  H: 'horse',
  N: 'horse', // kNight
  R: 'chariot',
  C: 'cannon',
  P: 'soldier',
};
// normal <letter><file 1-9><op><arg 1-9>, tandem <+|-><letter><op><arg>, or a
// soldier in a 3-5 stack: <ordinal 1-5 from the front><file><op><arg> (25=4).
export const WXF_TOKEN =
  /^(?:([kaebhnrcp])([1-9])|([+-])([kaebhnrcp])|([1-5])([1-9]))([+\-.=])([1-9])$/i;

export function parseWxfToken(token: string): RelativeMoveSpec | null {
  const match = WXF_TOKEN.exec(token);
  if (!match) return null;
  const letter = match[1] ?? match[4];
  const role = letter ? WXF_LETTER_TO_ROLE[letter.toUpperCase()] : 'soldier';
  if (!role) return null;
  const selector: RelativeSelector = match[1]
    ? { kind: 'file', wxfFile: Number(match[2]) }
    : match[3]
      ? { kind: 'tandem', end: match[3] === '+' ? 'front' : 'rear' }
      : { kind: 'ordinal', index: Number(match[5]), wxfFile: Number(match[6]) };
  const opChar = match[7]!;
  const op = opChar === '=' ? '.' : (opChar as '+' | '-' | '.');
  return { role, selector, op, arg: Number(match[8]) };
}

// --- Chinese token grammar ---------------------------------------------------
// Same relative structure as WXF, in CJK: piece char, then either a file numeral
// or a 前/后 (front/rear) tandem marker, an operator (进 advance / 退 retreat /
// 平 traverse), and an argument numeral. Red conventionally writes numerals in
// Chinese (一-九), black in Arabic (1-9); we accept either glyph and let the
// mover's colour drive the file mapping (identical to WXF). Every move is exactly
// four characters, so a spaceless record chunks cleanly by four.

export const CN_PIECE_TO_ROLE: Record<string, XiangqiPieceRole> = {
  车: 'chariot',
  車: 'chariot',
  马: 'horse',
  馬: 'horse',
  相: 'elephant',
  象: 'elephant',
  仕: 'advisor',
  士: 'advisor',
  帅: 'general',
  将: 'general',
  帥: 'general',
  將: 'general',
  炮: 'cannon',
  砲: 'cannon',
  包: 'cannon', // classical woodblock spelling for the Black cannon
  兵: 'soldier',
  卒: 'soldier',
};
export const CN_OP: Record<string, '+' | '-' | '.'> = { 进: '+', 進: '+', 退: '-', 平: '.' };
export const CN_TANDEM: Record<string, 'front' | 'rear'> = { 前: 'front', 后: 'rear', 後: 'rear' };
export const CN_NUMERAL: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
};

export function parseChineseToken(token: string): RelativeMoveSpec | null {
  if (token.length !== 4) return null;
  const c0 = token[0]!;
  const c1 = token[1]!;
  const op = CN_OP[token[2]!];
  const arg = CN_NUMERAL[token[3]!];
  if (!op || !arg) return null;
  let role: XiangqiPieceRole | undefined;
  let selector: RelativeSelector;
  if (CN_TANDEM[c0]) {
    role = CN_PIECE_TO_ROLE[c1];
    selector = { kind: 'tandem', end: CN_TANDEM[c0]! };
  } else {
    role = CN_PIECE_TO_ROLE[c0];
    const file = CN_NUMERAL[c1];
    if (!file) return null;
    selector = { kind: 'file', wxfFile: file };
  }
  return role ? { role, selector, op, arg } : null;
}
