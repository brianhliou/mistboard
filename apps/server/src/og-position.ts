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
  boardToPieces,
  type PieceOnBoard,
  type XiangqiOgPiece,
  type XiangqiOgRole,
} from '@mistboard/board-render';
import {
  BANQI_HEIGHT,
  BANQI_WIDTH,
  banqiMoverInk,
  banqiSquareOf,
  banqiStateToEngineFen,
  createInitialBanqiState,
  createInitialDuckXiangqiState,
  createInitialFortressXiangqiState,
  createInitialJieqiState,
  createInitialJungleFlipState,
  createInitialJungleState,
  createInitialXiangqiState,
  darkChessFen,
  duckXiangqiFen,
  fortressXiangqiEngineFen,
  fortressXiangqiSquareOf,
  gameSpecForId,
  JUNGLE_FLIP_HEIGHT,
  JUNGLE_FLIP_WIDTH,
  JUNGLE_HEIGHT,
  JUNGLE_WIDTH,
  type JunglePieceRole,
  jieqiStateToPikafishFen,
  jungleFlipMoverInk,
  jungleFlipSquareOf,
  jungleFlipStateToEngineFen,
  jungleSquareOf,
  jungleStateToEngineFen,
  parseBanqiFen,
  parseDarkChessFen,
  parseDuckXiangqiFen,
  parseFortressXiangqiFen,
  parseJieqiFen,
  parseJungleFen,
  parseJungleFlipFen,
  parseStandardXiangqiFen,
  type Square,
  standardXiangqiFen,
} from '@mistboard/game';
import { type AuthRateLimiter, createAuthRateLimiter } from './auth-rate-limit.js';
import { type CardArt, loadCardArt, renderBoardCard } from './og-card-board.js';
import { createPngCache, redirectToDefault, svgToPng, writePng } from './og-raster.js';

/** Bumped when the position card's LOOK changes, so scrapers holding an old PNG
 *  under the immutable Cache-Control re-fetch. Content never needs a bump: the
 *  FEN is in the URL. */
// v2 (2026-09-12): the live board and the site's default piece set, board at full
// height with the caption beside it (og-card-board.ts).
export const POSITION_OG_IMAGE_VERSION = 2;

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

export type PositionOgBoard =
  | {
      kind: 'intersection';
      files: number;
      ranks: number;
      riverBetweenRanks?: [number, number];
      palaces: Array<{ fileLo: number; fileHi: number; rankLo: number; rankHi: number }>;
      pieces: XiangqiOgPiece[];
      extras: IntersectionExtra[];
      /** Points under fog (a rules card showing one seat's opening view). The
       *  pieces there are already filtered out; this only draws the wash. */
      fog?: Array<{ file: number; rank: number }>;
    }
  | { kind: 'grid'; files: number; ranks: number; tiles: GridTile[] }
  | {
      kind: 'jungle';
      pieces: Array<{ file: number; rank: number; ink: Ink; role: JunglePieceRole }>;
    }
  | {
      kind: 'chess';
      pieces: PieceOnBoard[];
      /** Fogged squares (a rules card showing one side's view). */
      fogSquares?: readonly Square[];
      orientation?: 'white' | 'black';
    };

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

// Flip-jungle tile marks name the animal; og-card-board.ts maps the name back
// to the role to pick its art. Letters only, and the same strings the card
// renderer expects (roleOfJungleName lowercases them).
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

/** Every variant's start position, spelled by the kernel's own writer. The
 *  rules cards draw it; the hidden-deal variants get a sampled deal, which the
 *  public projection then drops (every piece is face-down at the start). */
export function startPositionFen(variant: PositionOgVariant): string {
  switch (variant) {
    case 'xiangqi':
    case 'dark-xiangqi':
      return standardXiangqiFen(createInitialXiangqiState('og-card'));
    case 'jieqi':
      return jieqiStateToPikafishFen(createInitialJieqiState('og-card'));
    case 'fortress-xiangqi':
      return fortressXiangqiEngineFen(createInitialFortressXiangqiState('og-card'));
    case 'banqi':
      return banqiStateToEngineFen(createInitialBanqiState('og-card'));
    case 'jungle-flip':
      return jungleFlipStateToEngineFen(createInitialJungleFlipState('og-card'));
    case 'jungle':
      return jungleStateToEngineFen(createInitialJungleState('og-card'));
    case 'duck-xiangqi':
      return duckXiangqiFen(createInitialDuckXiangqiState('og-card'));
    case 'dark-chess':
      return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
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

/** The position card: the board at full height, the variant and the side to
 *  move beside it (og-card-board.ts). `art` is the site piece art from
 *  loadCardArt; an empty map draws the glyph fallback. */
export function renderPositionOgSvg(
  resolved: ResolvedPositionOg,
  art: CardArt = new Map(),
): string {
  return renderBoardCard(resolved.board, art, {
    title: [positionOgVariantLabel(resolved.variant)],
    ...(resolved.toMove ? { subtitle: resolved.toMove } : {}),
  });
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
  /** The web build, for the piece art. Absent (tests) = glyph fallback. */
  staticDir?: string;
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
  const art = params.staticDir ? await loadCardArt(params.staticDir) : new Map<string, string>();
  const png = svgToPng(renderPositionOgSvg(resolved, art));
  cache.set(key, png);
  writePng(response, png, 'MISS');
}
