// Per-variant editor specs: geometry, palette, start position, FEN in and out,
// and the render-only board SVG. A Record over EditorVariantId with no default
// branch (variant dispatch is fail-closed): adding a member to
// EDITOR_VARIANT_IDS without a spec is a type error, and the page never guesses
// another variant's grammar.
//
// EditorVariantId, not AnalysisVariantId: the editor covers a SUBSET of the
// analysis catalog (editor-catalog.ts says which, and why), so an analysis
// variant the model cannot represent has no key here and cannot be handed to
// `editorSpec` at all.
//
// Duck Xiangqi is the variant that shaped that rule and then outgrew it. Its
// duck is not a piece, so it rides `model.duck` rather than `model.board`
// (editor-model.ts) and reaches the board through `duckEntry`, a colourless
// brush that is deliberately NOT `tileEntry`: a tile entry carries an
// EditorPiece and is painted straight into the piece map, which is the one
// thing the duck must never be.
//
// FEN assembly mirrors each variant's own writer byte-for-byte for the fields
// the editor controls (placement, side to move, and the derived pool for the
// dealt variants); the fixed trailing fields are the writer's fresh-game values,
// so a start position round-trips through normalizeStartFen unchanged. The
// grammars themselves live in packages/game (xiangqi-position.ts, jungle-fen.ts,
// variants-fortress-xiangqi.ts, variants.ts, banqi-fen.ts, jieqi-fen.ts,
// jungle-flip-fen.ts); the letter tables here are copies, pinned by
// editor-specs.test.ts against normalizeStartFen's canonical spelling.

import {
  BANQI_PIECE_COUNTS,
  type BanqiPieceRole,
  type BanqiPlayerBoard,
  type BanqiPlayerView,
  type BanqiSquare,
  type Board as ChessBoard,
  type Color as ChessColor,
  type PieceRole as ChessRole,
  type Square as ChessSquare,
  createInitialFortressXiangqiBoard,
  createInitialJungleBoard,
  createInitialXiangqiBoard,
  DUCK_XIANGQI_START_FEN,
  type DuckXiangqiBoard,
  type DuckXiangqiPieceRole,
  type DuckXiangqiPlayerView,
  type DuckXiangqiSquare,
  type FortressXiangqiBoard,
  type FortressXiangqiPieceRole,
  type FortressXiangqiPlayerView,
  type FortressXiangqiSquare,
  type JieqiPlayerBoard,
  type JieqiPlayerView,
  type JieqiSquare,
  type JungleBoard,
  type JungleFlipPieceRole,
  type JungleFlipSquare,
  type JunglePieceRole,
  type JungleSquare,
  jieqiHomeSquares,
  parseDuckXiangqiFen,
  type StandardXiangqiPlayerView,
  type XiangqiBoard,
  type XiangqiColor,
  type XiangqiPieceRole,
  type XiangqiSquare,
} from '@mistboard/game';
import { darkChessPieceGhostSvg, renderDarkChessBoardSvg } from '../dark-chess-render.js';
import { duckXiangqiBoardSvg } from '../duck-xiangqi-board.js';
import {
  fortressXiangqiPieceGhostSvg,
  installFortressXiangqiBoardStyles,
  renderFortressXiangqiBoardSvg,
} from '../fortress-xiangqi-render.js';
import type { I18nKey } from '../i18n/catalog.js';
import { jungleFaceDownDiscSvg } from '../jungle-art.js';
import type { JungleFlipRenderBoard } from '../jungle-flip-render.js';
import { jungleFlipPieceGhostSvg, renderJungleFlipBoardSvg } from '../jungle-flip-render.js';
import { junglePieceGhostSvg, renderJungleBoardSvg } from '../jungle-render.js';
import {
  BANQI_PIECE_PX,
  banqiPieceGhostSvg,
  installBanqiBoardStyles,
  renderBanqiBoardSvg,
} from '../live-banqi-render.js';
import {
  installJieqiBoardStyles,
  jieqiPieceGhostSvg,
  renderJieqiBoardSvg,
} from '../live-jieqi-render.js';
import {
  readStoredXiangqiBoardLayout,
  readStoredXiangqiPieceSet,
} from '../xiangqi-appearance-storage.js';
import {
  renderXiangqiBoardSvg,
  XIANGQI_LIVE_PIECE_SIZE,
  xiangqiPieceGhostSvg,
} from '../xiangqi-board.js';
import {
  type XiangqiBoardGeometry,
  xiangqiBoardPoint,
  xiangqiBoardViewBox,
} from '../xiangqi-board-geometry.js';
import { duckPieceMarks } from '../xiangqi-piece-sets.js';
import type { EditorVariantId } from './editor-catalog.js';
import {
  castlingField,
  effectiveChessExtras,
  fullChessExtras,
  parseChessExtras,
  reconcileChessExtras,
  renderChessExtrasCard,
} from './editor-chess.js';
import {
  allSquares,
  capturedKey,
  type EditorBoard,
  type EditorColor,
  type EditorModel,
  type EditorPiece,
  type EditorPlacementSubject,
  type EditorTurn,
  emptyModel,
  isDuckSubject,
  type PlacementGrammar,
  readPlacement,
  writePlacement,
} from './editor-model.js';

// ── Spec contract ───────────────────────────────────────────────────────────

export interface EditorViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** Where the squares sit in the rendered SVG, so the page can lay a transparent
 *  hit layer over it without touching any renderer. Everything is in viewBox
 *  units; the page converts to percentages. */
export interface EditorGeometry {
  viewBox(flipped: boolean): EditorViewBox;
  center(square: string, flipped: boolean): { x: number; y: number };
  /** Hit box side length. */
  hit: number;
}

export interface EditorPaletteEntry {
  piece: EditorPiece;
  labelKey: I18nKey;
}

/** The hidden-deal bookkeeping for banqi, jieqi and jungle-flip. The pool is
 *  never placed: it is what is left of the full multiset once the revealed
 *  pieces on the board and the captured pieces are taken out. */
export interface DealtRules {
  /** Roles in pool-field order. */
  roles: readonly string[];
  /** Full multiset per colour (both colours hold the same set). */
  full: Readonly<Record<string, number>>;
  /** role -> the uppercase pool letter. */
  poolChar: Readonly<Record<string, string>>;
  /** 'all' writes every (colour, role) pair even at zero (jieqi); 'nonzero'
   *  writes only non-zero pairs and '-' for an empty pool (banqi, jungle-flip). */
  style: 'all' | 'nonzero';
}

export interface PlacementProblem {
  key: I18nKey;
  params: Record<string, string>;
}

/** A colourless brush that puts something on the board which is NOT a piece.
 *  Duck Xiangqi's duck is the only one: it has no colour, so it can never be a
 *  `palette(color)` entry, and no role, so it can never be an EditorPiece. It
 *  brings its own art because the piece renderer has nothing to draw it with. */
export interface EditorTokenEntry {
  labelKey: I18nKey;
  /** The `data-role` the palette button carries, so tests and CSS can name it. */
  role: string;
  /** The token as the palette button draws it, in the piece renderer's own
   *  100-unit box so it sits the same size as the pieces beside it. */
  svg(): string;
}

export interface EditorSpec {
  id: EditorVariantId;
  /** [the colour at the bottom of the board by default, the colour at the top]. */
  colors: readonly [EditorColor, EditorColor];
  /** Banqi and jungle-flip show one fixed orientation. */
  flippable: boolean;
  /** Whether side-to-move may be '-' (banqi / jungle-flip's untouched opening). */
  openingTurn: boolean;
  dealt: DealtRules | null;
  grammar: PlacementGrammar;
  geometry: EditorGeometry;
  palette(color: EditorColor): EditorPaletteEntry[];
  /** The colourless face-down tile brush (banqi, jungle-flip), or null. Its
   *  subject IS an EditorPiece and lands in `model.board`; the duck's does not,
   *  which is why the duck gets `duckEntry` rather than a slot here. */
  tileEntry: EditorPaletteEntry | null;
  /** The colourless duck brush (duck-xiangqi), or null. Writes `model.duck`. */
  duckEntry: EditorTokenEntry | null;
  start(): EditorModel;
  toFen(model: EditorModel): string;
  /** Placement + side to move (+ the pool, for the dealt variants); the other
   *  fields are ignored. Null when the text is not this variant's shape. */
  fromFen(fen: string): EditorModel | null;
  renderSvg(model: EditorModel, perspective: EditorColor): string;
  ghostSvg(piece: EditorPiece): string;
  installStyles(): void;
  /** A rule the editor enforces itself before the variant parser sees the
   *  position (jieqi: a dark piece only stands on its colour's home squares;
   *  duck xiangqi: the duck and a piece never share a point). Takes the whole
   *  model because a rule can be about what is already on the board, and the
   *  SUBJECT rather than an EditorPiece because the duck is not one. */
  placementProblem(
    square: string,
    subject: EditorPlacementSubject,
    model: EditorModel,
  ): PlacementProblem | null;
  /** Extra FEN fields the board alone cannot tell (fog chess: castling rights
   *  and en passant), rendered as one more right-rail card under "Side to
   *  move". The page re-renders it on every update and passes the callback the
   *  card calls after it changes the model. Absent on every other variant. */
  extras?(model: EditorModel, onChange: () => void): HTMLElement | null;
}

export const COLOR_LABEL_KEY: Record<EditorColor, I18nKey> = {
  red: 'editor.colorRed',
  black: 'editor.colorBlack',
  white: 'editor.colorWhite',
};

// ── Shared helpers ──────────────────────────────────────────────────────────

const ROLE_LABEL_KEYS: Record<string, I18nKey> = {
  general: 'editor.role.general',
  advisor: 'editor.role.advisor',
  elephant: 'editor.role.elephant',
  horse: 'editor.role.horse',
  chariot: 'editor.role.chariot',
  cannon: 'editor.role.cannon',
  soldier: 'editor.role.soldier',
  treasure: 'editor.role.treasure',
  rat: 'editor.role.rat',
  cat: 'editor.role.cat',
  dog: 'editor.role.dog',
  wolf: 'editor.role.wolf',
  leopard: 'editor.role.leopard',
  tiger: 'editor.role.tiger',
  lion: 'editor.role.lion',
  king: 'editor.role.king',
  queen: 'editor.role.queen',
  rook: 'editor.role.rook',
  bishop: 'editor.role.bishop',
  knight: 'editor.role.knight',
  pawn: 'editor.role.pawn',
};

export function roleLabelKey(role: string): I18nKey {
  return ROLE_LABEL_KEYS[role] ?? 'editor.role.piece';
}

function algebraic(file: number, rank: number): string {
  return `${String.fromCharCode(97 + file)}${rank}`;
}

function fileOf(square: string): number {
  return square.charCodeAt(0) - 97;
}

function rankOf(square: string): number {
  return Number(square.slice(1));
}

function rolePalette(color: EditorColor, roles: readonly string[]): EditorPaletteEntry[] {
  return roles.map((role) => ({
    piece: { faceDown: false, color, role },
    labelKey: roleLabelKey(role),
  }));
}

function boardFromRecord(
  record: Readonly<Record<string, { color: EditorColor; role: string } | undefined>>,
): EditorBoard {
  const board: EditorBoard = new Map();
  for (const [square, piece] of Object.entries(record)) {
    if (piece) board.set(square, { faceDown: false, color: piece.color, role: piece.role });
  }
  return board;
}

/** Ranks 1..N, files a.., pieces on the line crossings; `mirrorFiles` says whether
 *  the renderer mirrors files as well as ranks for the second colour. */
function intersectionGeometry(
  files: number,
  ranks: number,
  cell: number,
  margin: number,
  mirrorFiles: boolean,
  hit: number,
): EditorGeometry {
  const box = {
    minX: 0,
    minY: 0,
    width: margin * 2 + (files - 1) * cell,
    height: margin * 2 + (ranks - 1) * cell,
  };
  return {
    viewBox: () => box,
    center: (square, flipped) => {
      const file = fileOf(square);
      const rank = rankOf(square);
      const col = flipped && mirrorFiles ? files - 1 - file : file;
      const row = flipped ? rank - 1 : ranks - rank;
      return { x: margin + col * cell, y: margin + row * cell };
    },
    hit,
  };
}

/** Pieces in cell centres (the grid boards + banqi); `flips` says whether the
 *  renderer rotates the board for the second colour at all. */
function cellGeometry(
  files: number,
  ranks: number,
  cell: number,
  pad: number,
  flips: boolean,
  hit: number,
): EditorGeometry {
  const box = { minX: 0, minY: 0, width: files * cell + pad * 2, height: ranks * cell + pad * 2 };
  return {
    viewBox: () => box,
    center: (square, flipped) => {
      const file = fileOf(square);
      const rank = rankOf(square);
      const rotate = flips && flipped;
      const col = rotate ? files - 1 - file : file;
      const row = rotate ? rank - 1 : ranks - rank;
      return { x: pad + (col + 0.5) * cell, y: pad + (row + 0.5) * cell };
    },
    hit,
  };
}

function turnOf(token: string | undefined, upper: EditorColor, lower: EditorColor): EditorTurn {
  if (token === 'b') return lower;
  return upper;
}

// ── Dealt-variant pool bookkeeping ──────────────────────────────────────────

export interface PoolRow {
  color: EditorColor;
  role: string;
  /** Full count minus the revealed pieces on the board. */
  remaining: number;
  captured: number;
  /** remaining minus captured: what is still face-down somewhere. */
  pool: number;
}

export function poolRows(model: EditorModel, spec: EditorSpec): PoolRow[] {
  const dealt = spec.dealt;
  if (!dealt) return [];
  const revealed = new Map<string, number>();
  for (const piece of model.board.values()) {
    if (piece.faceDown) continue;
    const key = capturedKey(piece.color, piece.role);
    revealed.set(key, (revealed.get(key) ?? 0) + 1);
  }
  const rows: PoolRow[] = [];
  for (const color of spec.colors) {
    for (const role of dealt.roles) {
      const key = capturedKey(color, role);
      const remaining = Math.max(0, dealt.full[role] - (revealed.get(key) ?? 0));
      const captured = Math.min(remaining, Math.max(0, model.captured.get(key) ?? 0));
      rows.push({ color, role, remaining, captured, pool: remaining - captured });
    }
  }
  return rows;
}

export function faceDownCounts(model: EditorModel): {
  total: number;
  byColor: Partial<Record<EditorColor, number>>;
} {
  let total = 0;
  const byColor: Partial<Record<EditorColor, number>> = {};
  for (const piece of model.board.values()) {
    if (!piece.faceDown) continue;
    total += 1;
    if (piece.color) byColor[piece.color] = (byColor[piece.color] ?? 0) + 1;
  }
  return { total, byColor };
}

function poolFieldFor(model: EditorModel, spec: EditorSpec): string {
  const dealt = spec.dealt;
  if (!dealt) return '-';
  let out = '';
  for (const row of poolRows(model, spec)) {
    if (dealt.style === 'nonzero' && row.pool === 0) continue;
    const letter = dealt.poolChar[row.role] ?? '?';
    out += `${row.color === spec.colors[1] ? letter.toLowerCase() : letter}${row.pool}`;
  }
  return out === '' ? '-' : out;
}

/** Reads a pool field back into captured counts: whatever is neither on the
 *  board nor in the pool was captured. Unreadable text leaves nothing captured. */
function capturedFromPool(
  text: string | undefined,
  board: EditorBoard,
  spec: EditorSpec,
): Map<string, number> {
  const captured = new Map<string, number>();
  const dealt = spec.dealt;
  if (!dealt || !text || text === '-') return captured;
  const roleByChar = new Map<string, string>();
  for (const [role, letter] of Object.entries(dealt.poolChar)) roleByChar.set(letter, role);
  const pooled = new Map<string, number>();
  for (const match of text.matchAll(/([A-Za-z])(\d+)/g)) {
    const letter = match[1];
    const role = roleByChar.get(letter.toUpperCase());
    if (!role) continue;
    const color = letter === letter.toUpperCase() ? spec.colors[0] : spec.colors[1];
    const key = capturedKey(color, role);
    pooled.set(key, (pooled.get(key) ?? 0) + Number(match[2]));
  }
  const model: EditorModel = { board, turn: spec.colors[0], flipped: false, captured };
  for (const row of poolRows(model, spec)) {
    const key = capturedKey(row.color, row.role);
    const taken = row.remaining - (pooled.get(key) ?? 0);
    if (taken > 0) captured.set(key, taken);
  }
  return captured;
}

function dealtModel(
  board: EditorBoard,
  turn: EditorTurn,
  poolText: string | undefined,
  spec: EditorSpec,
): EditorModel {
  return { board, turn, flipped: false, captured: capturedFromPool(poolText, board, spec) };
}

// ── Xiangqi family (xiangqi, dark-xiangqi, jieqi share the 9x10 grammar) ────

const XIANGQI_ROLES: readonly string[] = [
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'soldier',
];

const XIANGQI_ROLE_CHAR: Readonly<Record<string, string>> = {
  general: 'K',
  advisor: 'A',
  elephant: 'B',
  horse: 'N',
  chariot: 'R',
  cannon: 'C',
  soldier: 'P',
};

const XIANGQI_GRAMMAR: PlacementGrammar = {
  files: 9,
  ranks: 10,
  roleChar: XIANGQI_ROLE_CHAR,
  upper: 'red',
  lower: 'black',
  square: algebraic,
};

// The live board's geometry config (xiangqi-board.ts LIVE_BOARD_GEO): the hit
// layer must sit where that renderer puts the points under either layout.
const XIANGQI_LIVE_GEO: XiangqiBoardGeometry = {
  fileCount: 9,
  rankCount: 10,
  cell: 60,
  margin: 36,
  riverGap: 12,
};

const XIANGQI_GEOMETRY: EditorGeometry = {
  viewBox: () => xiangqiBoardViewBox(readStoredXiangqiBoardLayout(), XIANGQI_LIVE_GEO),
  center: (square, flipped) =>
    xiangqiBoardPoint(
      fileOf(square),
      rankOf(square),
      flipped ? 'black' : 'red',
      readStoredXiangqiBoardLayout(),
      XIANGQI_LIVE_GEO,
    ),
  hit: 54,
};

function xiangqiBoardOf(model: EditorModel): XiangqiBoard {
  const board: XiangqiBoard = {};
  for (const [square, piece] of model.board) {
    if (piece.faceDown) continue;
    board[square as XiangqiSquare] = {
      color: piece.color as XiangqiColor,
      role: piece.role as XiangqiPieceRole,
    };
  }
  return board;
}

function xiangqiTurn(model: EditorModel): XiangqiColor {
  return model.turn === 'black' ? 'black' : 'red';
}

function xiangqiSpec(id: 'xiangqi' | 'dark-xiangqi'): EditorSpec {
  const spec: EditorSpec = {
    id,
    colors: ['red', 'black'],
    flippable: true,
    openingTurn: false,
    dealt: null,
    grammar: XIANGQI_GRAMMAR,
    geometry: XIANGQI_GEOMETRY,
    palette: (color) => rolePalette(color, XIANGQI_ROLES),
    tileEntry: null,
    duckEntry: null,
    start: () => ({ ...emptyModel('red'), board: boardFromRecord(createInitialXiangqiBoard()) }),
    // standardXiangqiFen: "<placement> <r|b> - - <progressClock> <moveNumber>".
    toFen: (model) =>
      `${writePlacement(model.board, XIANGQI_GRAMMAR)} ${model.turn === 'black' ? 'b' : 'r'} - - 0 1`,
    fromFen: (fen) => {
      const fields = fen.trim().split(/\s+/);
      const board = readPlacement(fields[0] ?? '', XIANGQI_GRAMMAR);
      if (!board) return null;
      return { ...emptyModel(turnOf(fields[1], 'red', 'black')), board };
    },
    renderSvg: (model, perspective) => {
      const view: StandardXiangqiPlayerView = {
        id: 'editor',
        perspective: perspective as XiangqiColor,
        board: xiangqiBoardOf(model),
        legalMoves: [],
        status: { type: 'playing', turn: xiangqiTurn(model) },
        moveNumber: 1,
      };
      return renderXiangqiBoardSvg(view, perspective as XiangqiColor);
    },
    ghostSvg: (piece) =>
      piece.faceDown
        ? ''
        : xiangqiPieceGhostSvg({
            color: piece.color as XiangqiColor,
            role: piece.role as XiangqiPieceRole,
          }),
    installStyles: () => {},
    placementProblem: () => null,
  };
  return spec;
}

// ── Jieqi ───────────────────────────────────────────────────────────────────

const JIEQI_GRAMMAR: PlacementGrammar = { ...XIANGQI_GRAMMAR, faceDown: 'coloured' };

// jieqi-fen.ts restPieces order (Pikafish: ROOK, ADVISOR, CANNON, PAWN, KNIGHT,
// BISHOP), every pair written even at zero.
const JIEQI_DEALT: DealtRules = {
  roles: ['chariot', 'advisor', 'cannon', 'soldier', 'horse', 'elephant'],
  full: { chariot: 2, advisor: 2, cannon: 2, soldier: 5, horse: 2, elephant: 2 },
  poolChar: XIANGQI_ROLE_CHAR,
  style: 'all',
};

const JIEQI_GEOMETRY = intersectionGeometry(9, 10, 72, 42, true, 62);

function jieqiHome(color: EditorColor): ReadonlySet<string> {
  return new Set<string>(jieqiHomeSquares(color as XiangqiColor));
}

const JIEQI_HOME: Record<'red' | 'black', ReadonlySet<string>> = {
  red: jieqiHome('red'),
  black: jieqiHome('black'),
};

const JIEQI_SPEC: EditorSpec = {
  id: 'jieqi',
  colors: ['red', 'black'],
  flippable: true,
  openingTurn: false,
  dealt: JIEQI_DEALT,
  grammar: JIEQI_GRAMMAR,
  geometry: JIEQI_GEOMETRY,
  // Generals are always face-up, so the dark entry is the only extra.
  palette: (color) => [
    ...rolePalette(color, XIANGQI_ROLES),
    { piece: { faceDown: true, color }, labelKey: 'editor.darkPiece' },
  ],
  tileEntry: null,
  duckEntry: null,
  start: () => {
    const board: EditorBoard = new Map();
    board.set('e1', { faceDown: false, color: 'red', role: 'general' });
    board.set('e10', { faceDown: false, color: 'black', role: 'general' });
    for (const color of ['red', 'black'] as const) {
      for (const square of JIEQI_HOME[color]) board.set(square, { faceDown: true, color });
    }
    return { ...emptyModel('red'), board };
  },
  // jieqiStateToPikafishFen: "<board> <w|b> <restPieces> <noCaptureClock> <moveNumber>".
  toFen: (model) =>
    `${writePlacement(model.board, JIEQI_GRAMMAR)} ${model.turn === 'black' ? 'b' : 'w'} ${poolFieldFor(model, JIEQI_SPEC)} 0 1`,
  fromFen: (fen) => {
    const fields = fen.trim().split(/\s+/);
    const board = readPlacement(fields[0] ?? '', JIEQI_GRAMMAR);
    if (!board) return null;
    return dealtModel(board, turnOf(fields[1], 'red', 'black'), fields[2], JIEQI_SPEC);
  },
  renderSvg: (model, perspective) => {
    const board: JieqiPlayerBoard = {};
    for (const [square, piece] of model.board) {
      const sq = square as JieqiSquare;
      if (piece.faceDown) {
        board[sq] = { color: (piece.color ?? 'red') as XiangqiColor, faceDown: true };
      } else {
        board[sq] = {
          color: piece.color as XiangqiColor,
          role: piece.role as XiangqiPieceRole,
          faceDown: false,
        };
      }
    }
    const view: JieqiPlayerView = {
      id: 'editor',
      perspective: perspective as XiangqiColor,
      board,
      legalMoves: [],
      captured: [],
      inCheck: false,
      status: { type: 'playing', turn: xiangqiTurn(model) },
      moveNumber: 1,
    };
    return renderJieqiBoardSvg(view, perspective as XiangqiColor);
  },
  ghostSvg: (piece) =>
    jieqiPieceGhostSvg(
      piece.faceDown
        ? { color: (piece.color ?? 'red') as XiangqiColor, faceDown: true }
        : {
            color: piece.color as XiangqiColor,
            role: piece.role as XiangqiPieceRole,
            faceDown: false,
          },
    ),
  installStyles: installJieqiBoardStyles,
  placementProblem: (square, subject) => {
    if (isDuckSubject(subject)) return null;
    const piece = subject;
    if (!piece.faceDown || !piece.color) return null;
    const home = piece.color === 'black' ? JIEQI_HOME.black : JIEQI_HOME.red;
    if (home.has(square)) return null;
    return { key: 'editor.jieqiHomeOnly', params: { color: piece.color } };
  },
};

// ── Banqi ───────────────────────────────────────────────────────────────────

const BANQI_ROLES: readonly string[] = [
  'general',
  'advisor',
  'elephant',
  'chariot',
  'horse',
  'cannon',
  'soldier',
];

const BANQI_ROLE_CHAR: Readonly<Record<string, string>> = {
  general: 'G',
  advisor: 'A',
  elephant: 'E',
  chariot: 'R',
  horse: 'H',
  cannon: 'C',
  soldier: 'S',
};

const BANQI_GRAMMAR: PlacementGrammar = {
  files: 8,
  ranks: 4,
  roleChar: BANQI_ROLE_CHAR,
  upper: 'red',
  lower: 'black',
  faceDown: 'colourless',
  square: algebraic,
};

const BANQI_DEALT: DealtRules = {
  roles: BANQI_ROLES,
  full: BANQI_PIECE_COUNTS,
  poolChar: BANQI_ROLE_CHAR,
  style: 'nonzero',
};

// live-banqi-render.ts: CELL 64, MARGIN 28, rank 4 at the top, no flip.
const BANQI_GEOMETRY = cellGeometry(8, 4, 64, 28, false, 62);

function faceDownDiscSvg(className: string, size: number): string {
  const r = size * 0.46;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g class="${className}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}"/></g></svg>`;
}

const BANQI_TILE: EditorPaletteEntry = {
  piece: { faceDown: true, color: null },
  labelKey: 'editor.faceDownTile',
};

const BANQI_SPEC: EditorSpec = {
  id: 'banqi',
  colors: ['red', 'black'],
  flippable: false,
  openingTurn: true,
  dealt: BANQI_DEALT,
  grammar: BANQI_GRAMMAR,
  geometry: BANQI_GEOMETRY,
  palette: (color) => rolePalette(color, BANQI_ROLES),
  tileEntry: BANQI_TILE,
  duckEntry: null,
  start: () => {
    const board: EditorBoard = new Map();
    for (const square of allSquares(BANQI_GRAMMAR))
      board.set(square, { faceDown: true, color: null });
    return { ...emptyModel('-'), board };
  },
  // banqiStateToEngineFen: "<board> <r|b|-> <pool> <noProgressClock> <moveNumber>".
  toFen: (model) =>
    `${writePlacement(model.board, BANQI_GRAMMAR)} ${banqiTurnToken(model.turn)} ${poolFieldFor(model, BANQI_SPEC)} 0 1`,
  fromFen: (fen) => {
    const fields = fen.trim().split(/\s+/);
    const board = readPlacement(fields[0] ?? '', BANQI_GRAMMAR);
    if (!board) return null;
    return dealtModel(board, banqiTurnOf(fields[1]), fields[2], BANQI_SPEC);
  },
  renderSvg: (model) => {
    const board: BanqiPlayerBoard = {};
    for (const [square, piece] of model.board) {
      board[square as BanqiSquare] = piece.faceDown
        ? { faceDown: true }
        : {
            color: piece.color as XiangqiColor,
            role: piece.role as BanqiPieceRole,
            faceDown: false,
          };
    }
    const view: BanqiPlayerView = {
      id: 'editor',
      perspective: 'red',
      board,
      legalMoves: [],
      captured: [],
      status: { type: 'playing', turn: 'red' },
      ply: 0,
      firstColor: null,
      moveNumber: 1,
    };
    return renderBanqiBoardSvg(view);
  },
  ghostSvg: (piece) =>
    piece.faceDown
      ? faceDownDiscSvg('banqi-back', BANQI_PIECE_PX)
      : banqiPieceGhostSvg({
          color: piece.color as XiangqiColor,
          role: piece.role as BanqiPieceRole,
        }),
  installStyles: installBanqiBoardStyles,
  placementProblem: () => null,
};

function banqiTurnToken(turn: EditorTurn): string {
  if (turn === '-') return '-';
  return turn === 'black' ? 'b' : 'r';
}

function banqiTurnOf(token: string | undefined): EditorTurn {
  if (token === '-' || token === undefined) return '-';
  return token === 'b' ? 'black' : 'red';
}

// ── Jungle (Dou Shou Qi) + Flip Jungle ──────────────────────────────────────

// Strongest first for the palette; the FEN letters are JUNGLE_ROLE_LETTER.
const JUNGLE_ROLES: readonly string[] = [
  'elephant',
  'lion',
  'tiger',
  'leopard',
  'wolf',
  'dog',
  'cat',
  'rat',
];

const JUNGLE_ROLE_CHAR: Readonly<Record<string, string>> = {
  rat: 'R',
  cat: 'C',
  dog: 'D',
  wolf: 'W',
  leopard: 'P',
  tiger: 'T',
  lion: 'L',
  elephant: 'E',
};

const JUNGLE_GRAMMAR: PlacementGrammar = {
  files: 7,
  ranks: 9,
  roleChar: JUNGLE_ROLE_CHAR,
  upper: 'red',
  lower: 'black',
  square: algebraic,
};

const JUNGLE_SPEC: EditorSpec = {
  id: 'jungle',
  colors: ['red', 'black'],
  flippable: true,
  openingTurn: false,
  dealt: null,
  grammar: JUNGLE_GRAMMAR,
  // jungle-render.ts: 7x9 grid, CELL 48, pad 0, rotated for black.
  geometry: cellGeometry(7, 9, 48, 0, true, 46),
  palette: (color) => rolePalette(color, JUNGLE_ROLES),
  tileEntry: null,
  duckEntry: null,
  start: () => ({ ...emptyModel('red'), board: boardFromRecord(createInitialJungleBoard()) }),
  // jungleStateToEngineFen: "<board> <r|b> <progressClock> <moveNumber>".
  toFen: (model) =>
    `${writePlacement(model.board, JUNGLE_GRAMMAR)} ${model.turn === 'black' ? 'b' : 'r'} 0 1`,
  fromFen: (fen) => {
    const fields = fen.trim().split(/\s+/);
    const board = readPlacement(fields[0] ?? '', JUNGLE_GRAMMAR);
    if (!board) return null;
    return { ...emptyModel(turnOf(fields[1], 'red', 'black')), board };
  },
  renderSvg: (model, perspective) => {
    const board: JungleBoard = {};
    for (const [square, piece] of model.board) {
      if (piece.faceDown) continue;
      board[square as JungleSquare] = {
        color: piece.color as XiangqiColor,
        role: piece.role as JunglePieceRole,
      };
    }
    return renderJungleBoardSvg(board, {
      perspective: perspective === 'black' ? 'black' : 'red',
      shadow: false,
    });
  },
  ghostSvg: (piece) =>
    piece.faceDown
      ? ''
      : junglePieceGhostSvg({
          color: piece.color as XiangqiColor,
          role: piece.role as JunglePieceRole,
        }),
  installStyles: () => {},
  placementProblem: () => null,
};

const JUNGLE_FLIP_GRAMMAR: PlacementGrammar = {
  files: 4,
  ranks: 4,
  roleChar: JUNGLE_ROLE_CHAR,
  upper: 'red',
  lower: 'black',
  faceDown: 'colourless',
  square: algebraic,
};

// jungle-flip-fen.ts pool order: weak to strong.
const JUNGLE_FLIP_DEALT: DealtRules = {
  roles: ['rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'],
  full: { rat: 1, cat: 1, dog: 1, wolf: 1, leopard: 1, tiger: 1, lion: 1, elephant: 1 },
  poolChar: JUNGLE_ROLE_CHAR,
  style: 'nonzero',
};

const JUNGLE_FLIP_CELL = 64;

const JUNGLE_FLIP_SPEC: EditorSpec = {
  id: 'jungle-flip',
  colors: ['red', 'black'],
  flippable: false,
  openingTurn: true,
  dealt: JUNGLE_FLIP_DEALT,
  grammar: JUNGLE_FLIP_GRAMMAR,
  // jungle-flip-render.ts: 4x4 grid, CELL 64, pad 0, never rotated.
  geometry: cellGeometry(4, 4, JUNGLE_FLIP_CELL, 0, false, 62),
  palette: (color) => rolePalette(color, JUNGLE_ROLES),
  tileEntry: { piece: { faceDown: true, color: null }, labelKey: 'editor.faceDownTile' },
  duckEntry: null,
  start: () => {
    const board: EditorBoard = new Map();
    for (const square of allSquares(JUNGLE_FLIP_GRAMMAR)) {
      board.set(square, { faceDown: true, color: null });
    }
    return { ...emptyModel('-'), board };
  },
  // jungleFlipStateToEngineFen: "<board> <r|b|-> <pool> <noProgressClock> <ply>";
  // a fresh game is at ply 0.
  toFen: (model) =>
    `${writePlacement(model.board, JUNGLE_FLIP_GRAMMAR)} ${banqiTurnToken(model.turn)} ${poolFieldFor(model, JUNGLE_FLIP_SPEC)} 0 0`,
  fromFen: (fen) => {
    const fields = fen.trim().split(/\s+/);
    const board = readPlacement(fields[0] ?? '', JUNGLE_FLIP_GRAMMAR);
    if (!board) return null;
    return dealtModel(board, banqiTurnOf(fields[1]), fields[2], JUNGLE_FLIP_SPEC);
  },
  renderSvg: (model) => {
    const board: JungleFlipRenderBoard = {};
    for (const [square, piece] of model.board) {
      board[square as JungleFlipSquare] = piece.faceDown
        ? { faceDown: true }
        : {
            faceDown: false,
            color: piece.color as XiangqiColor,
            role: piece.role as JungleFlipPieceRole,
          };
    }
    return renderJungleFlipBoardSvg(board, { shadow: false });
  },
  ghostSvg: (piece) =>
    piece.faceDown
      ? `<svg viewBox="0 0 ${JUNGLE_FLIP_CELL} ${JUNGLE_FLIP_CELL}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${jungleFaceDownDiscSvg(JUNGLE_FLIP_CELL / 2, JUNGLE_FLIP_CELL / 2, JUNGLE_FLIP_CELL)}</svg>`
      : jungleFlipPieceGhostSvg({
          color: piece.color as XiangqiColor,
          role: piece.role as JungleFlipPieceRole,
        }),
  installStyles: () => {},
  placementProblem: () => null,
};

// ── Fortress Xiangqi ────────────────────────────────────────────────────────

const FORTRESS_ROLES: readonly string[] = [
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'treasure',
  'soldier',
];

// FORTRESS_ROLE_TO_FEN_LETTER (variants-fortress-xiangqi.ts).
const FORTRESS_ROLE_CHAR: Readonly<Record<string, string>> = {
  general: 'K',
  advisor: 'A',
  elephant: 'E',
  horse: 'N',
  chariot: 'R',
  cannon: 'C',
  treasure: 'Q',
  soldier: 'P',
};

const FORTRESS_GRAMMAR: PlacementGrammar = {
  files: 7,
  ranks: 8,
  roleChar: FORTRESS_ROLE_CHAR,
  upper: 'red',
  lower: 'black',
  square: algebraic,
};

const FORTRESS_SPEC: EditorSpec = {
  id: 'fortress-xiangqi',
  colors: ['red', 'black'],
  flippable: true,
  openingTurn: false,
  dealt: null,
  grammar: FORTRESS_GRAMMAR,
  // fortress-xiangqi-render.ts: 7x8 intersections, CELL 72, MARGIN 42, mirrored for black.
  geometry: intersectionGeometry(7, 8, 72, 42, true, 62),
  palette: (color) => rolePalette(color, FORTRESS_ROLES),
  tileEntry: null,
  duckEntry: null,
  start: () => ({
    ...emptyModel('red'),
    board: boardFromRecord(createInitialFortressXiangqiBoard()),
  }),
  // fortressXiangqiEngineFen: "<placement>[pocket] <w|b> - - 0 <moveNumber>"; the
  // editor has no hands, so the pocket is omitted (the writer omits an empty one).
  toFen: (model) =>
    `${writePlacement(model.board, FORTRESS_GRAMMAR)} ${model.turn === 'black' ? 'b' : 'w'} - - 0 1`,
  fromFen: (fen) => {
    const fields = fen.trim().split(/\s+/);
    // A pocket rides on the placement field in brackets; the editor drops it.
    const placement = (fields[0] ?? '').replace(/\[.*$/, '');
    const board = readPlacement(placement, FORTRESS_GRAMMAR);
    if (!board) return null;
    return { ...emptyModel(turnOf(fields[1], 'red', 'black')), board };
  },
  renderSvg: (model, perspective) => {
    const board: FortressXiangqiBoard = {};
    for (const [square, piece] of model.board) {
      if (piece.faceDown) continue;
      board[square as FortressXiangqiSquare] = {
        color: piece.color as XiangqiColor,
        role: piece.role as FortressXiangqiPieceRole,
      };
    }
    const view: FortressXiangqiPlayerView = {
      id: 'editor',
      perspective: perspective as XiangqiColor,
      board,
      hands: { red: {}, black: {} },
      legalMoves: [],
      inCheck: false,
      status: { type: 'playing', turn: xiangqiTurn(model) },
      moveNumber: 1,
    };
    return renderFortressXiangqiBoardSvg(view, perspective as XiangqiColor);
  },
  ghostSvg: (piece) =>
    piece.faceDown
      ? ''
      : fortressXiangqiPieceGhostSvg({
          color: piece.color as XiangqiColor,
          role: piece.role as FortressXiangqiPieceRole,
        }),
  installStyles: installFortressXiangqiBoardStyles,
  placementProblem: () => null,
};

// ── Fog chess ───────────────────────────────────────────────────────────────

const CHESS_ROLES: readonly string[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

const CHESS_ROLE_CHAR: Readonly<Record<string, string>> = {
  king: 'K',
  queen: 'Q',
  rook: 'R',
  bishop: 'B',
  knight: 'N',
  pawn: 'P',
};

const CHESS_GRAMMAR: PlacementGrammar = {
  files: 8,
  ranks: 8,
  roleChar: CHESS_ROLE_CHAR,
  upper: 'white',
  lower: 'black',
  square: algebraic,
};

const CHESS_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const ALL_CHESS_SQUARES = allSquares(CHESS_GRAMMAR) as ChessSquare[];

const DARK_CHESS_SPEC: EditorSpec = {
  id: 'dark-chess',
  colors: ['white', 'black'],
  flippable: true,
  openingTurn: false,
  dealt: null,
  grammar: CHESS_GRAMMAR,
  // dark-chess-render.ts: 8x8 grid, CELL 50, pad 0, rotated for black.
  geometry: cellGeometry(8, 8, 50, 0, true, 50),
  palette: (color) => rolePalette(color, CHESS_ROLES),
  tileEntry: null,
  duckEntry: null,
  start: () =>
    DARK_CHESS_SPEC.fromFen(CHESS_START_FEN) ?? {
      ...emptyModel('white'),
      chess: fullChessExtras(),
    },
  // Standard chess FEN (darkChessFen is chessops' makeFen). Castling rights and
  // the en passant square come from model.chess (editor-chess.ts), filtered to
  // what the board can honour, so the field never claims a right the position
  // cannot use; the clocks are the fresh-game values.
  toFen: (model) => {
    const extras = effectiveChessExtras(model);
    const turn = model.turn === 'black' ? 'b' : 'w';
    const ep = extras.epSquare ?? '-';
    return `${writePlacement(model.board, CHESS_GRAMMAR)} ${turn} ${castlingField(extras)} ${ep} 0 1`;
  },
  fromFen: (fen) => {
    const fields = fen.trim().split(/\s+/);
    const board = readPlacement(fields[0] ?? '', CHESS_GRAMMAR);
    if (!board) return null;
    const model: EditorModel = {
      ...emptyModel(turnOf(fields[1], 'white', 'black')),
      board,
      chess: parseChessExtras(fields[2], fields[3]),
    };
    reconcileChessExtras(model);
    return model;
  },
  renderSvg: (model, perspective) => {
    const board: ChessBoard = {};
    for (const [square, piece] of model.board) {
      if (piece.faceDown) continue;
      board[square as ChessSquare] = {
        color: piece.color as ChessColor,
        role: piece.role as ChessRole,
      };
    }
    return renderDarkChessBoardSvg(
      { board, visibleSquares: ALL_CHESS_SQUARES },
      { perspective: perspective === 'black' ? 'black' : 'white', showFog: false },
    );
  },
  ghostSvg: (piece) =>
    piece.faceDown
      ? ''
      : darkChessPieceGhostSvg(piece.role as ChessRole, piece.color as ChessColor),
  installStyles: () => {},
  placementProblem: () => null,
  extras: renderChessExtrasCard,
};

// ── Duck Xiangqi ────────────────────────────────────────────────────────────
//
// The same 9x10 board, letters and geometry as standard xiangqi (it shares
// XIANGQI_GRAMMAR and XIANGQI_GEOMETRY outright — duckXiangqiBoardSvg composes
// the standard surface at coordGutter 0, which is what XIANGQI_LIVE_GEO already
// describes). Everything below is about the one thing that differs: the duck.

/** The duck as the palette button draws it. `duckPieceMarks` is the SAME art the
 *  live board paints, in each piece set's own disc grammar, resolved the way
 *  every other duck surface resolves it — a second drawing of the duck would
 *  drift from the board it is a brush for. */
function duckBrushSvg(): string {
  return [
    `<svg class="xq-piece" width="${XIANGQI_LIVE_PIECE_SIZE}" height="${XIANGQI_LIVE_PIECE_SIZE}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="duck">`,
    duckPieceMarks(readStoredXiangqiPieceSet()),
    `</svg>`,
  ].join('');
}

const DUCK_XIANGQI_SPEC: EditorSpec = {
  id: 'duck-xiangqi',
  colors: ['red', 'black'],
  flippable: true,
  openingTurn: false,
  dealt: null,
  grammar: XIANGQI_GRAMMAR,
  geometry: XIANGQI_GEOMETRY,
  // No duck here, ever: palette entries are keyed by colour and the duck has
  // none. It lives on the colourless brush row instead (duckEntry).
  palette: (color) => rolePalette(color, XIANGQI_ROLES),
  tileEntry: null,
  duckEntry: { labelKey: 'editor.duck', role: 'duck', svg: duckBrushSvg },
  // Seeded from the kernel's own start FEN rather than a board literal, so the
  // opening is whatever duck-xiangqi says it is. The trailing '-' is the duck
  // off the board, which IS the opening: it enters as the second half of Red's
  // first turn.
  start: () =>
    DUCK_XIANGQI_SPEC.fromFen(`${DUCK_XIANGQI_START_FEN} -`) ?? {
      ...emptyModel('red'),
      duck: { square: null },
    },
  // duckXiangqiFen: the standard six xiangqi fields plus a SEVENTH naming the
  // duck's point, '-' when it is off the board. Written here rather than by
  // calling the kernel writer because the editor has no DuckXiangqiGameState:
  // an illegal position has no state, and the editor has to be able to spell one.
  toFen: (model) =>
    `${writePlacement(model.board, XIANGQI_GRAMMAR)} ${model.turn === 'black' ? 'b' : 'w'} - - 0 1 ${
      model.duck?.square ?? '-'
    }`,
  // Read through the KERNEL parser, not readPlacement: the duck field is the
  // seventh field and only duck-xiangqi-fen.ts knows the grammar of it. The
  // parser validates placement and re-checks the facing rule WITH the duck, so
  // an illegal position simply fails to load here (every other spec is lenient
  // on read and lets normalizeStartFen report the problem inline). That is the
  // fail-closed direction: a duck FEN the kernel cannot read is one the editor
  // has no honest board for.
  fromFen: (fen) => {
    const parsed = parseDuckXiangqiFen(fen);
    if (!parsed.ok) return null;
    const board: EditorBoard = new Map();
    for (const [square, piece] of Object.entries(parsed.state.board)) {
      if (piece) board.set(square, { faceDown: false, color: piece.color, role: piece.role });
    }
    return {
      ...emptyModel(parsed.state.status.type === 'playing' ? parsed.state.status.turn : 'red'),
      board,
      duck: { square: parsed.state.duck ?? null },
    };
  },
  renderSvg: (model, perspective) => {
    const board: DuckXiangqiBoard = {};
    for (const [square, piece] of model.board) {
      if (piece.faceDown) continue;
      board[square as DuckXiangqiSquare] = {
        color: piece.color as XiangqiColor,
        role: piece.role as DuckXiangqiPieceRole,
      };
    }
    const view: DuckXiangqiPlayerView = {
      id: 'editor',
      perspective: perspective as XiangqiColor,
      board,
      duck: (model.duck?.square ?? undefined) as DuckXiangqiSquare | undefined,
      legalPieceMoves: [],
      status: { type: 'playing', turn: xiangqiTurn(model) },
      moveNumber: 1,
    };
    // Render-only: no click layer, no targets, and the layout the editor's own
    // hit geometry read, so the transparent buttons land on the points.
    return duckXiangqiBoardSvg(view, perspective as XiangqiColor, {
      interactive: false,
      phase: { kind: 'piece', selected: null },
      targets: [],
      layout: readStoredXiangqiBoardLayout(),
    });
  },
  ghostSvg: (piece) =>
    piece.faceDown
      ? ''
      : xiangqiPieceGhostSvg({
          color: piece.color as XiangqiColor,
          role: piece.role as XiangqiPieceRole,
        }),
  installStyles: () => {},
  // The duck and a piece never share a point, in either direction. Both halves
  // live here rather than in the page because it is a rule of the variant, and
  // because the page's brush code must not learn which variants have ducks.
  placementProblem: (square, subject, model) => {
    if (isDuckSubject(subject)) {
      return model.board.has(square) ? { key: 'editor.duckOnPiece', params: {} } : null;
    }
    return model.duck?.square === square ? { key: 'editor.pieceOnDuck', params: {} } : null;
  },
};

// ── Registry ────────────────────────────────────────────────────────────────

export const EDITOR_SPECS: Record<EditorVariantId, EditorSpec> = {
  xiangqi: xiangqiSpec('xiangqi'),
  banqi: BANQI_SPEC,
  jungle: JUNGLE_SPEC,
  'jungle-flip': JUNGLE_FLIP_SPEC,
  'fortress-xiangqi': FORTRESS_SPEC,
  jieqi: JIEQI_SPEC,
  'dark-xiangqi': xiangqiSpec('dark-xiangqi'),
  'dark-chess': DARK_CHESS_SPEC,
  'duck-xiangqi': DUCK_XIANGQI_SPEC,
};

export function editorSpec(id: EditorVariantId): EditorSpec {
  return EDITOR_SPECS[id];
}
