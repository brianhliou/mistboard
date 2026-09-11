// Share cards for POSITION links: /analysis/<variant>?fen=… and
// /editor/<variant>?fen=…. The card is the position itself on the variant's own
// board, side to move, and a footer naming the variant. One route serves all
// nine FEN-capable variants behind a fail-closed dispatch: an unlisted slug
// falls back to the default card rather than another variant's board.
//
// Hidden-information invariant. The hidden-deal variants (banqi, jieqi,
// jungle-flip) carry the identities under their face-down pieces in a SIXTH
// FEN field. The card is a public artifact served without auth, so it renders
// from a PUBLIC projection of the parsed state: a face-down piece becomes a
// blank disc with no role (and, for banqi and jungle-flip, no ink either),
// before anything reaches the SVG. Two FENs that differ only in their hidden
// field therefore produce byte-identical cards, and the cache key and the
// og:image URL both carry only the five public fields. og-position.test.ts
// pins all three.

import type { ServerResponse } from 'node:http';
import {
  BROWN_PALETTE,
  boardToPieces,
  type PieceOnBoard,
  renderBoardComposition,
  renderXiangqiOgBoardSvg,
  XIANGQI_GLYPH_PATHS,
  type XiangqiOgPiece,
  type XiangqiOgRole,
} from '@mistboard/board-render';
import {
  BANQI_HEIGHT,
  BANQI_WIDTH,
  banqiMoverInk,
  banqiSquareOf,
  banqiStateToEngineFen,
  darkChessFen,
  duckXiangqiFen,
  fortressXiangqiEngineFen,
  fortressXiangqiSquareOf,
  gameSpecForId,
  JUNGLE_DENS,
  JUNGLE_FLIP_HEIGHT,
  JUNGLE_FLIP_WIDTH,
  JUNGLE_HEIGHT,
  JUNGLE_WIDTH,
  type JunglePieceRole,
  jieqiStateToPikafishFen,
  jungleFlipMoverInk,
  jungleFlipSquareOf,
  jungleFlipStateToEngineFen,
  jungleIsWater,
  jungleSquareOf,
  jungleStateToEngineFen,
  jungleTrapOwner,
  parseBanqiFen,
  parseDarkChessFen,
  parseDuckXiangqiFen,
  parseFortressXiangqiFen,
  parseJieqiFen,
  parseJungleFen,
  parseJungleFlipFen,
  parseStandardXiangqiFen,
  standardXiangqiFen,
} from '@mistboard/game';
import { type AuthRateLimiter, createAuthRateLimiter } from './auth-rate-limit.js';
import {
  createPngCache,
  escapeXml,
  OG_FONT,
  OG_HEIGHT,
  OG_WIDTH,
  redirectToDefault,
  svgToPng,
  writePng,
} from './og-image.js';

/** Bumped when the position card's LOOK changes, so scrapers holding an old PNG
 *  under the immutable Cache-Control re-fetch. Content never needs a bump: the
 *  FEN is in the URL. */
export const POSITION_OG_IMAGE_VERSION = 1;

/** Variants with a position card, i.e. the /analysis and /editor catalog. Slugs
 *  double as GameSpecIds. Order is the analysis dropdown's. */
export const POSITION_OG_VARIANTS = [
  'xiangqi',
  'banqi',
  'jieqi',
  'fortress-xiangqi',
  'duck-xiangqi',
  'dark-xiangqi',
  'dark-chess',
  'jungle',
  'jungle-flip',
] as const;

export type PositionOgVariant = (typeof POSITION_OG_VARIANTS)[number];

export function isPositionOgVariant(slug: string): slug is PositionOgVariant {
  return (POSITION_OG_VARIANTS as readonly string[]).includes(slug);
}

/** Site display name, mirroring apps/web/src/analysis-catalog.ts: the spec's
 *  publicName, except Fortress names its game family beside standard Xiangqi. */
export function positionOgVariantLabel(variant: PositionOgVariant): string {
  return variant === 'fortress-xiangqi' ? 'Fortress Xiangqi' : gameSpecForId(variant).publicName;
}

/** A FEN longer than this is refused before parsing. The longest legitimate
 *  form (a six-field jieqi deal) is ~110 characters; the cap only bounds the
 *  work an arbitrary query string can cause. */
export const POSITION_FEN_MAX_LENGTH = 512;

// Bounded LRU of rendered position PNGs, keyed by variant + public FEN, so the
// same shared position is rasterised once per process no matter how many
// scrapers fetch it (and no matter which deal the link carried).
export const POSITION_OG_CACHE_ENTRIES = 500;
const cache = createPngCache(POSITION_OG_CACHE_ENTRIES);

/** Renders (cache MISSES) per client per minute. Unlike the game/study cards,
 *  the position card is keyed by free-form input, so every distinct FEN is a
 *  fresh rasterisation; a crawler or a script cycling FENs would otherwise buy
 *  unbounded CPU for the price of a URL. Hits are never limited (they are a
 *  map lookup), and an over-budget miss degrades to the default card rather
 *  than a 429, so a link preview still shows something. */
export const POSITION_OG_RENDER_LIMIT = 30;
export const POSITION_OG_RENDER_WINDOW_MS = 60_000;
const renderLimiter = createAuthRateLimiter(POSITION_OG_RENDER_LIMIT, POSITION_OG_RENDER_WINDOW_MS);

// ── Public projection of a position ─────────────────────────────────────────

type Ink = 'red' | 'black';

/** A tile on a grid board (banqi, jungle-flip): either a revealed piece with
 *  its mark, or a face-down tile. A face-down tile carries NO role and NO ink:
 *  both are hidden in these variants. */
type GridTile =
  | { file: number; rank: number; hidden: true }
  | { file: number; rank: number; hidden: false; ink: Ink; mark: TileMark };

type TileMark = { kind: 'glyph'; glyph: string } | { kind: 'text'; text: string };

/** Pieces the shared intersection-board renderer cannot draw itself: a jieqi
 *  face-down piece (ink is public, role is not), a Fortress treasure (a role
 *  outside the xiangqi set), or the Duck Xiangqi duck.
 *
 *  The duck member carries NO `ink`, and that absence is the point. `Ink` is
 *  `'red' | 'black'` — a seat — and the duck has no seat: it is shared,
 *  uncapturable, and both players move it. Giving it either value would draw a
 *  piece belonging to one side, which is a lie about the position rather than a
 *  styling choice. `faceDownDisc`'s `Ink | null` is a different statement ("the
 *  ink exists but is hidden"), so it is not reusable here either. The duck is
 *  therefore inked in the variant's own neutral gold, the same answer the live
 *  board reached (DUCK_RING in apps/web/src/xiangqi-piece-sets.ts). */
type IntersectionExtra =
  | { file: number; rank: number; kind: 'face-down'; ink: Ink }
  | { file: number; rank: number; kind: 'glyph'; ink: Ink; glyph: string }
  | { file: number; rank: number; kind: 'duck' };

type PositionOgBoard =
  | {
      kind: 'intersection';
      files: number;
      ranks: number;
      riverBetweenRanks?: [number, number];
      palaces: Array<{ fileLo: number; fileHi: number; rankLo: number; rankHi: number }>;
      pieces: XiangqiOgPiece[];
      extras: IntersectionExtra[];
    }
  | { kind: 'grid'; files: number; ranks: number; tiles: GridTile[] }
  | {
      kind: 'jungle';
      pieces: Array<{ file: number; rank: number; ink: Ink; role: JunglePieceRole }>;
    }
  | { kind: 'chess'; pieces: PieceOnBoard[] };

export type ResolvedPositionOg = {
  variant: PositionOgVariant;
  /** Canonical PUBLIC spelling: the variant's own writer output, which for the
   *  hidden-deal variants is the five-field engine FEN with no hidden field. */
  publicFen: string;
  /** Footer caption for the side to move, or null when the position has none
   *  (a flip variant before its first flip). */
  toMove: string | null;
  board: PositionOgBoard;
};

// Mirrors the TRADITIONAL table in packages/board-render/src/xiangqi-og-board.ts
// (the site default set), for the disc pieces that module does not draw:
// banqi tiles. Keep in sync if that table ever changes.
const TRADITIONAL_GLYPHS: Record<Ink, Record<XiangqiOgRole, string>> = {
  red: {
    general: '帥',
    advisor: '仕',
    elephant: '相',
    horse: '傌',
    chariot: '俥',
    cannon: '炮',
    soldier: '兵',
  },
  black: {
    general: '將',
    advisor: '士',
    elephant: '象',
    horse: '馬',
    chariot: '車',
    cannon: '砲',
    soldier: '卒',
  },
};

// The Fortress treasure in the traditional set (fortress-xiangqi-render.ts).
const TREASURE_GLYPH = '寶';

// Animal marks: a short code on the 7x9 jungle board (cells are small), the
// full name on the 4x4 flip board (cells are large). Letters only: resvg has
// Noto Sans and nothing else, so an emoji or a chess symbol would vanish.
const JUNGLE_SHORT: Record<JunglePieceRole, string> = {
  rat: 'RAT',
  cat: 'CAT',
  dog: 'DOG',
  wolf: 'WLF',
  leopard: 'LEO',
  tiger: 'TGR',
  lion: 'LIO',
  elephant: 'ELE',
};
const JUNGLE_NAME: Record<JunglePieceRole, string> = {
  rat: 'Rat',
  cat: 'Cat',
  dog: 'Dog',
  wolf: 'Wolf',
  leopard: 'Leopard',
  tiger: 'Tiger',
  lion: 'Lion',
  elephant: 'Elephant',
};

// Board geometry the shared intersection renderer takes per call. Fortress is
// 7x8 with opposite-corner palaces; its constants are private to the kernel.
const XIANGQI_GEOMETRY = {
  files: 9,
  ranks: 10,
  riverBetweenRanks: [5, 6] as [number, number],
  palaces: [
    { fileLo: 3, fileHi: 5, rankLo: 1, rankHi: 3 },
    { fileLo: 3, fileHi: 5, rankLo: 8, rankHi: 10 },
  ],
};
const FORTRESS_FILES = 7;
const FORTRESS_RANKS = 8;

function xqCoord(square: string): { file: number; rank: number } {
  return { file: square.charCodeAt(0) - 97, rank: Number(square.slice(1)) };
}

function inkToMove(ink: Ink | null): string | null {
  return ink === null ? null : ink === 'red' ? 'Red to move' : 'Black to move';
}

/** Validate a position link's variant + FEN and project it to what the card may
 *  show. Null for an unknown variant, a missing/overlong/unparseable FEN. */
export function resolvePositionOg(
  variant: string,
  fen: string | null | undefined,
): ResolvedPositionOg | null {
  if (!isPositionOgVariant(variant)) return null;
  if (typeof fen !== 'string') return null;
  const trimmed = fen.trim();
  if (trimmed.length === 0 || trimmed.length > POSITION_FEN_MAX_LENGTH) return null;
  switch (variant) {
    case 'xiangqi':
    case 'dark-xiangqi': {
      // Same board and writer; only the legality bar moves, because under fog a
      // general may stand en prise.
      const parsed = parseStandardXiangqiFen(trimmed, 'og-card', {
        allowExposedGeneral: variant === 'dark-xiangqi',
      });
      if (!parsed.ok) return null;
      const pieces: XiangqiOgPiece[] = Object.entries(parsed.state.board).flatMap(
        ([square, piece]) =>
          piece ? [{ ...xqCoord(square), color: piece.color, role: piece.role }] : [],
      );
      return {
        variant,
        publicFen: standardXiangqiFen(parsed.state),
        toMove: inkToMove(parsed.state.status.type === 'playing' ? parsed.state.status.turn : null),
        board: { kind: 'intersection', ...XIANGQI_GEOMETRY, pieces, extras: [] },
      };
    }
    case 'duck-xiangqi': {
      // Standard xiangqi geometry plus the duck, which rides the SEVENTH FEN
      // field and is part of the position (it screens cannons and blocks the
      // horse's leg), so the card has to draw it. '-' there means the duck is
      // still off the board, which is the start position.
      const parsed = parseDuckXiangqiFen(trimmed, 'og-card');
      if (!parsed.ok) return null;
      const pieces: XiangqiOgPiece[] = [];
      for (const [square, piece] of Object.entries(parsed.state.board)) {
        if (!piece) continue;
        pieces.push({ ...xqCoord(square), color: piece.color, role: piece.role });
      }
      const extras: IntersectionExtra[] = parsed.state.duck
        ? [{ ...xqCoord(parsed.state.duck), kind: 'duck' }]
        : [];
      return {
        variant,
        publicFen: duckXiangqiFen(parsed.state),
        toMove: inkToMove(parsed.state.status.type === 'playing' ? parsed.state.status.turn : null),
        board: { kind: 'intersection', ...XIANGQI_GEOMETRY, pieces, extras },
      };
    }
    case 'jieqi': {
      // The deal (sixth field, or a sample when absent) never leaves this
      // block: a face-down piece is projected to its square and ink only.
      const parsed = parseJieqiFen(trimmed, { gameId: 'og-card' });
      if (!parsed.ok) return null;
      const pieces: XiangqiOgPiece[] = [];
      const extras: IntersectionExtra[] = [];
      for (const [square, piece] of Object.entries(parsed.state.board)) {
        if (!piece) continue;
        const at = xqCoord(square);
        if (piece.faceDown) extras.push({ ...at, kind: 'face-down', ink: piece.color });
        else pieces.push({ ...at, color: piece.color, role: piece.role });
      }
      return {
        variant,
        publicFen: jieqiStateToPikafishFen(parsed.state),
        toMove: inkToMove(parsed.state.status.type === 'playing' ? parsed.state.status.turn : null),
        board: { kind: 'intersection', ...XIANGQI_GEOMETRY, pieces, extras },
      };
    }
    case 'fortress-xiangqi': {
      const parsed = parseFortressXiangqiFen(trimmed, 'og-card');
      if (!parsed.ok) return null;
      const pieces: XiangqiOgPiece[] = [];
      const extras: IntersectionExtra[] = [];
      for (let rank = 1; rank <= FORTRESS_RANKS; rank += 1) {
        for (let file = 0; file < FORTRESS_FILES; file += 1) {
          const piece = parsed.state.board[fortressXiangqiSquareOf(file, rank)];
          if (!piece) continue;
          if (piece.role === 'treasure') {
            extras.push({ file, rank, kind: 'glyph', ink: piece.color, glyph: TREASURE_GLYPH });
          } else {
            pieces.push({ file, rank, color: piece.color, role: piece.role });
          }
        }
      }
      return {
        variant,
        publicFen: fortressXiangqiEngineFen(parsed.state),
        toMove: inkToMove(parsed.state.status.type === 'playing' ? parsed.state.status.turn : null),
        board: {
          kind: 'intersection',
          files: FORTRESS_FILES,
          ranks: FORTRESS_RANKS,
          riverBetweenRanks: [4, 5],
          // Opposite-corner palaces: Red a1-c3, Black e6-g8.
          palaces: [
            { fileLo: 0, fileHi: 2, rankLo: 1, rankHi: 3 },
            { fileLo: 4, fileHi: 6, rankLo: 6, rankHi: 8 },
          ],
          pieces,
          extras,
        },
      };
    }
    case 'banqi': {
      // Ink AND role are hidden under a banqi tile; the projection keeps only
      // the square. The parser's sampled or given identities are dropped here.
      const parsed = parseBanqiFen(trimmed, { gameId: 'og-card' });
      if (!parsed.ok) return null;
      const tiles: GridTile[] = [];
      for (let rank = 1; rank <= BANQI_HEIGHT; rank += 1) {
        for (let file = 0; file < BANQI_WIDTH; file += 1) {
          const piece = parsed.state.board[banqiSquareOf(file, rank)];
          if (!piece) continue;
          tiles.push(
            piece.faceDown
              ? { file, rank, hidden: true }
              : {
                  file,
                  rank,
                  hidden: false,
                  ink: piece.color,
                  mark: { kind: 'glyph', glyph: TRADITIONAL_GLYPHS[piece.color][piece.role] },
                },
          );
        }
      }
      return {
        variant,
        publicFen: banqiStateToEngineFen(parsed.state),
        toMove: inkToMove(banqiMoverInk(parsed.state)) ?? 'First flip',
        board: { kind: 'grid', files: BANQI_WIDTH, ranks: BANQI_HEIGHT, tiles },
      };
    }
    case 'jungle-flip': {
      const parsed = parseJungleFlipFen(trimmed, { gameId: 'og-card' });
      if (!parsed.ok) return null;
      const tiles: GridTile[] = [];
      for (let rank = 1; rank <= JUNGLE_FLIP_HEIGHT; rank += 1) {
        for (let file = 0; file < JUNGLE_FLIP_WIDTH; file += 1) {
          const piece = parsed.state.board[jungleFlipSquareOf(file, rank)];
          if (!piece) continue;
          tiles.push(
            piece.faceDown
              ? { file, rank, hidden: true }
              : {
                  file,
                  rank,
                  hidden: false,
                  ink: piece.color,
                  mark: { kind: 'text', text: JUNGLE_NAME[piece.role] },
                },
          );
        }
      }
      return {
        variant,
        publicFen: jungleFlipStateToEngineFen(parsed.state),
        toMove: inkToMove(jungleFlipMoverInk(parsed.state)) ?? 'First flip',
        board: { kind: 'grid', files: JUNGLE_FLIP_WIDTH, ranks: JUNGLE_FLIP_HEIGHT, tiles },
      };
    }
    case 'jungle': {
      const parsed = parseJungleFen(trimmed, 'og-card');
      if (!parsed.ok) return null;
      const pieces: Array<{ file: number; rank: number; ink: Ink; role: JunglePieceRole }> = [];
      for (let rank = 1; rank <= JUNGLE_HEIGHT; rank += 1) {
        for (let file = 0; file < JUNGLE_WIDTH; file += 1) {
          const piece = parsed.state.board[jungleSquareOf(file, rank)];
          if (piece) pieces.push({ file, rank, ink: piece.color, role: piece.role });
        }
      }
      return {
        variant,
        publicFen: jungleStateToEngineFen(parsed.state),
        toMove: inkToMove(parsed.state.status.type === 'playing' ? parsed.state.status.turn : null),
        board: { kind: 'jungle', pieces },
      };
    }
    case 'dark-chess': {
      const parsed = parseDarkChessFen(trimmed, 'og-card');
      if (!parsed.ok) return null;
      const turn = parsed.state.status.type === 'playing' ? parsed.state.status.turn : null;
      return {
        variant,
        publicFen: darkChessFen(parsed.state),
        toMove: turn === null ? null : turn === 'white' ? 'White to move' : 'Black to move',
        board: { kind: 'chess', pieces: boardToPieces(parsed.state.board) },
      };
    }
    default: {
      const unreachable: never = variant;
      throw new Error(`position og: unhandled variant ${String(unreachable)}`);
    }
  }
}

/** The public FEN a position link's meta may carry (never a hidden field), or
 *  null when the link would get no card. */
export function publicPositionFen(variant: string, fen: string | null | undefined): string | null {
  return resolvePositionOg(variant, fen)?.publicFen ?? null;
}

// ── Rendering ────────────────────────────────────────────────────────────────

// Palette shared with the xiangqi OG board (board-render/xiangqi-og-board.ts)
// so the card family reads as one set.
const BG = '#d9bd82';
const INK = '#4b3c2a';
const DISC = '#f3e6c4';
const RED = '#b91c1c';
const BLACK = '#1f2937';
// The back of a face-down tile: wood, no ink, no glyph.
const TILE_BACK = '#b48a52';
// The duck's ink: Duck Xiangqi's own accent, a colour that belongs to NEITHER
// seat. Same value the live board uses (DUCK_RING, apps/web/src/
// xiangqi-piece-sets.ts), so the card and the board say "no seat" the same way.
const DUCK_INK = '#b8860b';
const WATER = '#7aaed0';
const DEN = '#6b4f2a';
const TRAP = '#a8402a';

const BOARD_Y = 30;
const BOARD_HEIGHT = 486;
const BOARD_MAX_WIDTH = 1040;

export function renderPositionOgSvg(resolved: ResolvedPositionOg): string {
  const board = renderPositionBoard(resolved.board);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    board,
    positionFooter(
      positionOgVariantLabel(resolved.variant),
      resolved.toMove,
      BOARD_Y + BOARD_HEIGHT + 52,
    ),
    `</svg>`,
  ].join('');
}

// One footer line in the study-card style: muted site, bright variant, muted
// side to move.
function positionFooter(label: string, toMove: string | null, y: number): string {
  const sep = `<tspan fill="#5b6470">  ·  </tspan>`;
  const trailing = toMove
    ? `${sep}<tspan fill="#9ca3af" font-weight="600">${escapeXml(toMove)}</tspan>`
    : '';
  return `<text x="${OG_WIDTH / 2}" y="${y}" text-anchor="middle" font-family="${OG_FONT}" font-size="34"><tspan fill="#9ca3af" font-weight="600" letter-spacing="1">mistboard.com</tspan>${sep}<tspan fill="#f3f4f6" font-weight="700">${escapeXml(label)}</tspan>${trailing}</text>`;
}

function renderPositionBoard(board: PositionOgBoard): string {
  switch (board.kind) {
    case 'intersection':
      return renderIntersectionBoard(board);
    case 'grid':
      return renderGridBoard(board);
    case 'jungle':
      return renderJungleBoard(board);
    case 'chess':
      return renderBoardComposition({
        layout: 'single',
        canvasWidth: OG_WIDTH,
        boardY: BOARD_Y,
        boardSize: BOARD_HEIGHT,
        palette: BROWN_PALETTE,
        fogStyle: 'solid',
        boards: [{ pieces: board.pieces, orientation: 'white' }],
      });
    default: {
      const unreachable: never = board;
      throw new Error(`position og: unhandled board ${String(unreachable)}`);
    }
  }
}

/** The shared renderer's own layout ratios (cell 31, margin 18, piece 28 in the
 *  web diagrams), reproduced so extra pieces can be placed on the same points.
 *  Exported for the test that pins it against the renderer's output. */
export function intersectionGeometry(files: number, ranks: number, height: number) {
  const cell = height / (ranks - 1 + 2 * 0.58);
  const margin = 0.58 * cell;
  const pieceSize = 0.9 * cell;
  const width = 2 * margin + (files - 1) * cell;
  const px = (file: number) => margin + file * cell;
  const py = (rank: number) => margin + (ranks - rank) * cell;
  return { cell, margin, pieceSize, width, px, py };
}

function renderIntersectionBoard(
  board: Extract<PositionOgBoard, { kind: 'intersection' }>,
): string {
  const svg = renderXiangqiOgBoardSvg({
    files: board.files,
    ranks: board.ranks,
    pieces: board.pieces,
    riverBetweenRanks: board.riverBetweenRanks,
    palaces: board.palaces,
    centerX: OG_WIDTH / 2,
    y: BOARD_Y,
    height: BOARD_HEIGHT,
  });
  if (board.extras.length === 0) return svg;
  const geom = intersectionGeometry(board.files, board.ranks, BOARD_HEIGHT);
  const extras = board.extras
    .map((extra) => {
      const cx = geom.px(extra.file);
      const cy = geom.py(extra.rank);
      if (extra.kind === 'face-down') return faceDownDisc(cx, cy, geom.pieceSize, extra.ink);
      if (extra.kind === 'duck') return duckDisc(cx, cy, geom.pieceSize);
      return glyphDisc(cx, cy, geom.pieceSize, extra.ink, extra.glyph);
    })
    .join('');
  // The shared renderer returns one nested <svg>; the extras join its
  // coordinate space by landing before its closing tag.
  return svg.replace(/<\/svg>$/, `${extras}</svg>`);
}

/** A revealed disc: ivory face, ink ring, baked CJK glyph path. Same
 *  composition as the shared renderer's piece, in the same 100-unit box. */
function glyphDisc(cx: number, cy: number, size: number, ink: Ink, glyph: string): string {
  const path = XIANGQI_GLYPH_PATHS[glyph];
  if (!path) throw new Error(`no baked glyph path for ${glyph}`);
  const colorHex = ink === 'red' ? RED : BLACK;
  return [
    `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 100})">`,
    `<circle cx="50" cy="50" r="46" fill="${DISC}" stroke="${colorHex}" stroke-width="2.5"/>`,
    `<circle cx="50" cy="50" r="38" fill="none" stroke="${colorHex}" stroke-width="1.5"/>`,
    `<path d="${path}" fill="${colorHex}"/>`,
    `</g>`,
  ].join('');
}

/** The duck: the same disc and ring geometry as a piece, so it sits in the
 *  board's furniture (kernel rule D1 makes it an ordinary blocker, not
 *  decoration), but in the neutral gold rather than either seat's ink.
 *
 *  The mark is the WORD, not a drawing. The live board uses a PNG, which this
 *  renderer cannot reach (resvg resolves no hrefs here), and there is no baked
 *  glyph path for 鴨 — `glyphDisc` would throw. Latin letters are what resvg can
 *  actually draw with its one font, and this module already leans on that for
 *  the animal boards (`textDisc`). */
function duckDisc(cx: number, cy: number, size: number): string {
  // 20 in the 100-unit box: "DUCK" spans ~54 units, which leaves the inner ring
  // (76-unit diameter) visible rather than crowded, so the disc still reads as
  // the same double-ring token as the pieces beside it.
  const fontSize = 20;
  return [
    `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 100})">`,
    `<circle cx="50" cy="50" r="46" fill="${DISC}" stroke="${DUCK_INK}" stroke-width="2.5"/>`,
    `<circle cx="50" cy="50" r="38" fill="none" stroke="${DUCK_INK}" stroke-width="1.5"/>`,
    `<text x="50" y="${50 + fontSize * 0.35}" text-anchor="middle" font-family="${OG_FONT}" font-size="${fontSize}" font-weight="700" fill="${DUCK_INK}">DUCK</text>`,
    `</g>`,
  ].join('');
}

/** A face-down disc: the tile's wooden back and nothing else. `ink` is the
 *  ring colour where the ink is public (jieqi); null draws a neutral ring
 *  where the ink is hidden too (banqi, jungle-flip). */
function faceDownDisc(cx: number, cy: number, size: number, ink: Ink | null): string {
  const ring = ink === null ? INK : ink === 'red' ? RED : BLACK;
  return [
    `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 100})">`,
    `<circle cx="50" cy="50" r="46" fill="${TILE_BACK}" stroke="${ring}" stroke-width="2.5"/>`,
    `<circle cx="50" cy="50" r="38" fill="none" stroke="${ring}" stroke-width="1.5" opacity="0.55"/>`,
    `</g>`,
  ].join('');
}

/** A revealed disc carrying a word (the animal boards). */
function textDisc(cx: number, cy: number, size: number, ink: Ink, text: string): string {
  const colorHex = ink === 'red' ? RED : BLACK;
  // Width-fitted: a long name ("Elephant") gets a smaller face than "Rat".
  const fontSize = Math.min(size * 0.3, (size * 0.78) / (0.6 * Math.max(text.length, 1)));
  return [
    `<circle cx="${cx}" cy="${cy}" r="${size * 0.46}" fill="${DISC}" stroke="${colorHex}" stroke-width="2.5"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${size * 0.38}" fill="none" stroke="${colorHex}" stroke-width="1.5"/>`,
    `<text x="${cx}" y="${cy + fontSize * 0.35}" text-anchor="middle" font-family="${OG_FONT}" font-size="${fontSize}" font-weight="700" fill="${colorHex}">${escapeXml(text)}</text>`,
  ].join('');
}

/** Banqi (8x4) and jungle-flip (4x4): a grid of cells with a disc per tile.
 *  Rank 1 is drawn at the bottom, files left to right, like the live boards. */
function renderGridBoard(board: Extract<PositionOgBoard, { kind: 'grid' }>): string {
  const cell = Math.min(BOARD_HEIGHT / board.ranks, BOARD_MAX_WIDTH / board.files);
  const pad = 0.1 * cell;
  const width = board.files * cell + 2 * pad;
  const height = board.ranks * cell + 2 * pad;
  const x0 = OG_WIDTH / 2 - width / 2;
  const y0 = BOARD_Y + (BOARD_HEIGHT - height) / 2;
  const cx = (file: number) => x0 + pad + (file + 0.5) * cell;
  const cy = (rank: number) => y0 + pad + (board.ranks - rank + 0.5) * cell;
  const parts: string[] = [
    `<rect x="${x0}" y="${y0}" width="${width}" height="${height}" rx="8" fill="${BG}"/>`,
  ];
  for (let file = 0; file <= board.files; file += 1) {
    const x = x0 + pad + file * cell;
    parts.push(
      `<line x1="${x}" y1="${y0 + pad}" x2="${x}" y2="${y0 + pad + board.ranks * cell}" stroke="${INK}" stroke-width="1"/>`,
    );
  }
  for (let rank = 0; rank <= board.ranks; rank += 1) {
    const y = y0 + pad + rank * cell;
    parts.push(
      `<line x1="${x0 + pad}" y1="${y}" x2="${x0 + pad + board.files * cell}" y2="${y}" stroke="${INK}" stroke-width="1"/>`,
    );
  }
  const size = 0.88 * cell;
  for (const tile of board.tiles) {
    const x = cx(tile.file);
    const y = cy(tile.rank);
    if (tile.hidden) {
      parts.push(faceDownDisc(x, y, size, null));
    } else if (tile.mark.kind === 'glyph') {
      parts.push(glyphDisc(x, y, size, tile.ink, tile.mark.glyph));
    } else {
      parts.push(textDisc(x, y, size, tile.ink, tile.mark.text));
    }
  }
  return parts.join('');
}

/** Jungle (7x9): land, the two lakes, each side's traps and den, discs with a
 *  short animal code. Red's den (d1) is at the bottom. */
function renderJungleBoard(board: Extract<PositionOgBoard, { kind: 'jungle' }>): string {
  const cell = BOARD_HEIGHT / JUNGLE_HEIGHT;
  const pad = 0.15 * cell;
  const width = JUNGLE_WIDTH * cell + 2 * pad;
  const height = JUNGLE_HEIGHT * cell + 2 * pad;
  const x0 = OG_WIDTH / 2 - width / 2;
  const y0 = BOARD_Y + (BOARD_HEIGHT - height) / 2;
  const left = (file: number) => x0 + pad + file * cell;
  const top = (rank: number) => y0 + pad + (JUNGLE_HEIGHT - rank) * cell;
  const parts: string[] = [
    `<rect x="${x0}" y="${y0}" width="${width}" height="${height}" rx="8" fill="${BG}"/>`,
  ];
  for (let rank = 1; rank <= JUNGLE_HEIGHT; rank += 1) {
    for (let file = 0; file < JUNGLE_WIDTH; file += 1) {
      const square = jungleSquareOf(file, rank);
      const x = left(file);
      const y = top(rank);
      if (jungleIsWater(square)) {
        parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${WATER}"/>`);
      } else if (square === JUNGLE_DENS.red || square === JUNGLE_DENS.black) {
        parts.push(
          `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${DEN}"/>`,
          `<rect x="${x + cell * 0.22}" y="${y + cell * 0.22}" width="${cell * 0.56}" height="${cell * 0.56}" rx="3" fill="none" stroke="${DISC}" stroke-width="2"/>`,
        );
      } else if (jungleTrapOwner(square)) {
        parts.push(
          `<line x1="${x + cell * 0.18}" y1="${y + cell * 0.18}" x2="${x + cell * 0.82}" y2="${y + cell * 0.82}" stroke="${TRAP}" stroke-width="2" opacity="0.8"/>`,
          `<line x1="${x + cell * 0.82}" y1="${y + cell * 0.18}" x2="${x + cell * 0.18}" y2="${y + cell * 0.82}" stroke="${TRAP}" stroke-width="2" opacity="0.8"/>`,
        );
      }
    }
  }
  for (let file = 0; file <= JUNGLE_WIDTH; file += 1) {
    const x = x0 + pad + file * cell;
    parts.push(
      `<line x1="${x}" y1="${y0 + pad}" x2="${x}" y2="${y0 + pad + JUNGLE_HEIGHT * cell}" stroke="${INK}" stroke-width="1"/>`,
    );
  }
  for (let rank = 0; rank <= JUNGLE_HEIGHT; rank += 1) {
    const y = y0 + pad + rank * cell;
    parts.push(
      `<line x1="${x0 + pad}" y1="${y}" x2="${x0 + pad + JUNGLE_WIDTH * cell}" y2="${y}" stroke="${INK}" stroke-width="1"/>`,
    );
  }
  const size = 0.9 * cell;
  for (const piece of board.pieces) {
    parts.push(
      textDisc(
        left(piece.file) + cell / 2,
        top(piece.rank) + cell / 2,
        size,
        piece.ink,
        JUNGLE_SHORT[piece.role],
      ),
    );
  }
  return parts.join('');
}

// ── Route ────────────────────────────────────────────────────────────────────

/** GET /og/position/<variant>.png?fen=<fen>. Unknown variant or bad FEN falls
 *  back to the default card, like the other OG routes. */
export async function servePositionOgImage(params: {
  variant: string;
  fen: string | null | undefined;
  response: ServerResponse;
  /** Rate-limit key for a render (the client IP). Absent = unlimited (tests). */
  renderKey?: string;
  /** Override the shared limiter (tests). */
  limiter?: AuthRateLimiter;
}): Promise<void> {
  const { response } = params;
  const resolved = resolvePositionOg(params.variant, params.fen);
  if (!resolved) {
    redirectToDefault(response);
    return;
  }
  const key = `position:v${POSITION_OG_IMAGE_VERSION}:${resolved.variant}:${resolved.publicFen}`;
  const cached = cache.get(key);
  if (cached) {
    writePng(response, cached, 'HIT');
    return;
  }
  if (
    params.renderKey !== undefined &&
    !(params.limiter ?? renderLimiter).check(params.renderKey)
  ) {
    redirectToDefault(response);
    return;
  }
  const png = svgToPng(renderPositionOgSvg(resolved));
  cache.set(key, png);
  writePng(response, png, 'MISS');
}
