import { promises as fs } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARTICLE_OG_POSITIONS,
  type ArticleOgPosition,
  BROWN_PALETTE,
  boardToPieces,
  fogSquaresFromVisible,
  type PieceOnBoard,
  renderBoardComposition,
  renderXiangqiOgBoardSvg,
  SERVER_FOG_TRIPTYCH,
  type XiangqiOgPiece,
  xiangqiChampionTimelineSvg,
  xiangqiWorldTitleTimelineSvg,
} from '@mistboard/board-render';
import {
  applyGameEvent,
  createInitialXiangqiState,
  type GameEvent,
  getPlayerView as getXiangqiPlayerView,
  initialGameProjection,
  parseStandardXiangqiFen,
  type Square,
  variantForId,
} from '@mistboard/game';
import { Resvg } from '@resvg/resvg-js';
import { SKILL_VS_LUCK_OG_SERIES } from './banqi-luck-og-data.js';
import * as persistence from './persistence.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const GAME_OG_IMAGE_VERSION = 4;

// Bounded LRU of rendered per-game PNGs. Each card is rendered once on first
// scraper fetch, then served from here (and from the scraper/CDN cache, via the
// immutable Cache-Control header) — so this rarely sees repeat traffic per
// game. The cap keeps memory bounded regardless of how many distinct games get
// shared: at ~100-150 KB per PNG, 1000 entries is ~100-150 MB worst case.
// Eviction is simplest-possible LRU: a Map keeps insertion order, so reads
// re-insert (mark as recent) and writes drop the oldest key when over cap.
const MAX_CACHE_ENTRIES = 1000;

export type PngCache = {
  get(key: string): Buffer | undefined;
  set(key: string, png: Buffer): void;
  readonly size: number;
};

/** A bounded LRU of rendered PNGs (the cache described above). Shared by the
 *  card families so each gets the same eviction behaviour under its own cap. */
export function createPngCache(maxEntries: number): PngCache {
  const cache = new Map<string, Buffer>();
  return {
    get(key) {
      const hit = cache.get(key);
      if (hit) {
        cache.delete(key);
        cache.set(key, hit); // move to most-recently-used end
      }
      return hit;
    },
    set(key, png) {
      cache.set(key, png);
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    },
    get size() {
      return cache.size;
    },
  };
}

const cache = createPngCache(MAX_CACHE_ENTRIES);

function cacheGet(key: string): Buffer | undefined {
  return cache.get(key);
}

function cacheSet(key: string, png: Buffer): void {
  cache.set(key, png);
}

export async function serveGameOgImage(roomId: string, response: ServerResponse): Promise<void> {
  const cacheKey = `game:v${GAME_OG_IMAGE_VERSION}:${roomId}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    writePng(response, cached, 'HIT');
    return;
  }

  const game = await persistence.getGameSummary(roomId);
  if (!game?.result) {
    redirectToDefault(response);
    return;
  }

  // Prefer the game-record card built from the finished position. If the event
  // log is missing or replay throws, fall back to a text card so a shared link
  // always resolves to *some* image.
  let svg: string;
  try {
    const position = await reconstructOgPosition(roomId);
    svg = position ? renderGameOgSvg(game, position) : renderStubSvg(game);
  } catch {
    svg = renderStubSvg(game);
  }
  const png = svgToPng(svg);
  cacheSet(cacheKey, png);
  writePng(response, png, 'MISS');
}

type OgPosition = { pieces: PieceOnBoard[]; whiteFog: Square[]; blackFog: Square[] };

// Replay the completed event log to the final position, then compute each side's
// fog there. Game OG images are only served for completed games, so this does
// not expose live hidden information.
async function reconstructOgPosition(roomId: string): Promise<OgPosition | null> {
  const events = await persistence.loadRoom(roomId);
  if (!events || events.length === 0) return null;

  let projection = initialGameProjection(events[0]?.roomId ?? roomId);
  let pliesApplied = 0;
  for (const event of events as GameEvent[]) {
    projection = applyGameEvent(projection, event);
    if (event.type === 'move-played') {
      pliesApplied += 1;
    }
  }
  if (pliesApplied === 0) return null;

  const variant = variantForId(projection.variant);
  const state = projection.state;
  const pieces = boardToPieces(state.board);
  const whiteFog = fogSquaresFromVisible(variant.getPlayerView(state, 'white').visibleSquares);
  const blackFog = fogSquaresFromVisible(variant.getPlayerView(state, 'black').visibleSquares);
  return { pieces, whiteFog, blackFog };
}

// Clean game-record card: Mistboard branding, player pairing, and the same
// finished position from both player views.
function renderGameOgSvg(game: persistence.GameRecord, position: OgPosition): string {
  const boardSize = 300;
  const boardY = 262;
  const white = truncateName(displayNameForColor(game, 'white'));
  const black = truncateName(displayNameForColor(game, 'black'));
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
  );
  parts.push(`<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`);
  parts.push(`<rect x="84" y="64" width="1032" height="534" fill="none" stroke="#253023"/>`);
  parts.push(
    `<text x="${OG_WIDTH / 2}" y="125" text-anchor="middle" fill="#f4f6ef" font-family="${FONT}" font-size="52" font-weight="900" letter-spacing="8">MISTBOARD</text>`,
  );
  parts.push(
    `<text x="${OG_WIDTH / 2}" y="164" text-anchor="middle" fill="#9ba39a" font-family="${FONT}" font-size="22" font-weight="700">Fog Chess replay</text>`,
  );
  parts.push(
    renderBoardComposition({
      layout: 'pair',
      canvasWidth: OG_WIDTH,
      boardY,
      boardSize,
      gap: 104,
      labelY: 236,
      labelFill: '#e1e6da',
      labelFontSize: 24,
      labelLetterSpacing: 0,
      palette: BROWN_PALETTE,
      fogStyle: 'solid',
      boards: [
        {
          pieces: position.pieces,
          fogSquares: position.whiteFog,
          orientation: 'white',
          label: white,
        },
        {
          pieces: position.pieces,
          fogSquares: position.blackFog,
          orientation: 'black',
          label: black,
        },
      ],
    }),
  );
  parts.push(`</svg>`);
  return parts.join('');
}

function truncateName(name: string): string {
  return name.length > 24 ? `${name.slice(0, 23)}…` : name;
}

function displayNameForColor(game: persistence.GameRecord, color: 'white' | 'black'): string {
  return (
    game.participants.find((participant) => participant.color === color)?.displayName ??
    (color === 'white' ? game.whiteName : game.blackName) ??
    (color === 'white' ? 'White' : 'Black')
  );
}

export function writePng(response: ServerResponse, png: Buffer, cacheStatus: 'HIT' | 'MISS'): void {
  response.writeHead(200, {
    'content-type': 'image/png',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-og-cache': cacheStatus,
  });
  response.end(png);
}

export function redirectToDefault(response: ServerResponse): void {
  response.writeHead(302, { location: '/og-image.png' });
  response.end();
}

// Per-article share card: the article's thumbnail position (the same one the
// /blog list shows, via ARTICLE_OG_POSITIONS) rendered green/solid, with
// the article title below. Title is passed in by the route handler, which owns
// the slug→title map. Falls back to the default card if the slug has no
// thumbnail position.
//
// Articles whose card is not a single chess position (other games, image art,
// compositions) get a custom renderer here, checked before the single-board map.
type ArticleOgContext = { staticDir: string };
const CUSTOM_ARTICLE_OG_SVGS: Record<
  string,
  (title: string, ctx: ArticleOgContext) => Promise<string> | string
> = {
  'server-enforced-fog': renderServerFogOgSvg,
  'skill-vs-luck': renderSkillVsLuckOgSvg,
  shogi4: renderShogi4OgSvg,
  misty: renderMistyOgSvg,
  xiangqi: (title, ctx) => renderXiangqiFamilyOgSvg(title, ctx, false),
  'dark-xiangqi': (title, ctx) => renderXiangqiFamilyOgSvg(title, ctx, true),
  'xiangqi-champions': renderChampionsOgSvg,
  'xiangqi-world-championship': renderWorldTitleOgSvg,
  'how-puzzle-mining-works': renderPuzzleMiningOgSvg,
};

export async function serveArticleOgImage(params: {
  slug: string;
  title: string;
  kind: 'rules' | 'article';
  response: ServerResponse;
  staticDir: string;
}): Promise<void> {
  const { slug, kind, response, staticDir } = params;
  const key = `article:${slug}`;
  const cached = cacheGet(key);
  if (cached) {
    writePng(response, cached, 'HIT');
    return;
  }
  const custom = CUSTOM_ARTICLE_OG_SVGS[slug];
  const position = ARTICLE_OG_POSITIONS[slug];
  if (!custom && !position) {
    redirectToDefault(response);
    return;
  }
  // Page H1s drift on the "Rules" suffix (some rules pages carry it, some
  // don't); cards say it uniformly so a shared rules link always reads as one.
  const title =
    kind === 'rules' && !/\bRules$/.test(params.title) ? `${params.title} Rules` : params.title;
  const svg = custom ? await custom(title, { staticDir }) : renderArticleOgSvg(title, position!);
  const png = svgToPng(svg);
  cacheSet(key, png);
  writePng(response, png, 'MISS');
}

/** Bumped when the study card's LOOK changes, so scrapers holding an old PNG
 *  under the immutable Cache-Control re-fetch. Content changes need no bump: a
 *  chapter's diagram is its start position, which does not move.
 *
 *  v2: titles wrap to two lines instead of truncating at 24 characters. v1 cards
 *  are already at the CDN edge and in scraper caches under `?v=1` with a
 *  one-year immutable max-age, so without this bump every card that was fetched
 *  while v1 was live would keep showing the cut-off title indefinitely. */
export const STUDY_OG_IMAGE_VERSION = 2;

// Per-composition share card: the chapter's own starting diagram plus its name.
// A 排局 IS its diagram, so a link to one composition should preview that
// composition rather than the site's generic card. Chapters that begin from the
// standard opening (the game volumes) render the standard start.
//
// Only xiangqi chapters render a board; other variants fall back to the default
// card rather than guessing a renderer, per the fail-closed dispatch rule.
export async function serveStudyOgImage(params: {
  studyId: string;
  chapterId?: string;
  response: ServerResponse;
}): Promise<void> {
  const { chapterId, response, studyId } = params;
  const key = `study:v${STUDY_OG_IMAGE_VERSION}:${studyId}:${chapterId ?? ''}`;
  const cached = cacheGet(key);
  if (cached) {
    writePng(response, cached, 'HIT');
    return;
  }

  const study = await persistence.getStudyById(studyId).catch(() => null);
  // Unlisted and private studies get no generated card. An OG image is a public
  // artifact served without auth, so rendering one would publish a non-public
  // study's position to anyone who guessed the id.
  if (study?.visibility !== 'public') {
    redirectToDefault(response);
    return;
  }
  const chapters = [...study.chapters].sort((a, b) => a.ordinal - b.ordinal);
  const chapter = chapterId ? chapters.find((c) => c.id === chapterId) : chapters[0];
  if (chapter?.variant !== 'xiangqi') {
    redirectToDefault(response);
    return;
  }
  const pieces = studyChapterOgPieces(chapter.root);
  if (!pieces) {
    redirectToDefault(response);
    return;
  }

  const lines = fitStudyTitleLines(chapter.name);
  // A second title line needs room, so the board gives some back rather than the
  // text running off the canvas.
  const boardHeight = lines.length > 1 ? 452 : 486;
  const boardY = 30;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    xiangqiOgBoardFromPieces({ pieces, centerX: OG_WIDTH / 2, y: boardY, height: boardHeight }),
    studyFooter(lines, boardY + boardHeight + 52),
    `</svg>`,
  ].join('');
  const png = svgToPng(svg);
  cacheSet(key, png);
  writePng(response, png, 'MISS');
}

/** Footer for the study card: the brand sits with the first title line, and a
 *  wrapped title continues underneath. Font drops a step on two lines so the
 *  pair still reads as one block rather than crowding the board. */
function studyFooter(lines: string[], firstBaseline: number): string {
  const size = lines.length > 1 ? 30 : 34;
  const parts = [
    `<text x="${OG_WIDTH / 2}" y="${firstBaseline}" text-anchor="middle" font-family="${FONT}" font-size="${size}"><tspan fill="#9ca3af" font-weight="600" letter-spacing="1">MISTBOARD</tspan><tspan fill="#5b6470">  ·  </tspan><tspan fill="#f3f4f6" font-weight="700">${escapeXml(lines[0] ?? '')}</tspan></text>`,
  ];
  for (let i = 1; i < lines.length; i += 1) {
    parts.push(
      `<text x="${OG_WIDTH / 2}" y="${firstBaseline + i * (size + 8)}" text-anchor="middle" font-family="${FONT}" font-size="${size}" fill="#f3f4f6" font-weight="700">${escapeXml(lines[i]!)}</text>`,
    );
  }
  return parts.join('');
}

// Composition titles are sentences, not names: "Small opposing cannons give up
// the elephant to trap the chariot" is 63 characters, and 50 of the 52 published
// chapter titles exceed the 24-char cap `truncateName` applies to player names on
// the game card. That cap is right there (two names share the canvas) and wrong
// here (one title owns it), so the study card wraps to two lines instead.
//
// Width is measured in half-widths because a CJK title occupies roughly twice
// the advance per character, and these titles come in both scripts.
const STUDY_TITLE_LINE_HALFWIDTHS = 46;
const STUDY_TITLE_MAX_LINES = 2;

function halfWidths(text: string): number {
  let total = 0;
  for (const ch of text) {
    // Rough but sufficient: CJK ideographs, kana, and full-width forms are wide.
    total += /[ᄀ-ᅟ⺀-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/.test(ch) ? 2 : 1;
  }
  return total;
}

/** Wrap a title into at most two lines, breaking on spaces where the script has
 *  them and on characters where it does not (CJK). Overflow past the last line is
 *  ellipsized, so a pathological title degrades instead of overrunning the card. */
export function fitStudyTitleLines(
  title: string,
  perLine = STUDY_TITLE_LINE_HALFWIDTHS,
  maxLines = STUDY_TITLE_MAX_LINES,
): string[] {
  const trimmed = title.trim();
  if (!trimmed) return [''];
  if (halfWidths(trimmed) <= perLine) return [trimmed];

  const tokens = trimmed.includes(' ') ? trimmed.split(/\s+/) : Array.from(trimmed);
  const joiner = trimmed.includes(' ') ? ' ' : '';
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const candidate = current ? `${current}${joiner}${token}` : token;
    if (halfWidths(candidate) <= perLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = token;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);

  if (lines.length === maxLines) {
    // Anything that did not fit is dropped, so mark the truncation.
    const consumed = lines.join(joiner);
    if (consumed.length < trimmed.length) {
      const last = lines[maxLines - 1]!;
      lines[maxLines - 1] = `${trimTo(last, perLine - 1, joiner)}…`;
    }
  }
  return lines;
}

function trimTo(line: string, perLine: number, joiner: string): string {
  let out = line;
  while (halfWidths(out) > perLine && out.length > 0) {
    out =
      joiner === ' ' ? out.slice(0, out.lastIndexOf(' ')) || out.slice(0, -1) : out.slice(0, -1);
  }
  return out;
}

/** A chapter's start position as OG pieces: its hand-set `rootFen` when it has
 *  one (every composition does), otherwise the standard xiangqi start (the game
 *  volumes begin from the normal opening). Returns null on an unparseable FEN so
 *  the caller falls back to the default card rather than rendering a wrong board. */
export function studyChapterOgPieces(root: unknown): XiangqiOgPiece[] | null {
  const rootFen =
    root && typeof root === 'object' && typeof (root as { rootFen?: unknown }).rootFen === 'string'
      ? (root as { rootFen: string }).rootFen
      : undefined;
  let board: Record<string, { color: 'red' | 'black'; role: XiangqiOgPiece['role'] } | undefined>;
  // PRESENT-but-unparseable (including empty) is a failure, not an absence. A
  // chapter that carries a rootFen is a composition, so falling through to the
  // standard start would publish a board the study does not hold.
  if (rootFen !== undefined) {
    const parsed = parseStandardXiangqiFen(rootFen, 'og-card');
    if (!parsed.ok) return null;
    board = parsed.state.board as typeof board;
  } else {
    board = createInitialXiangqiState('og-card').board as typeof board;
  }
  return Object.entries(board).flatMap(([square, piece]) =>
    piece ? [{ ...xqOgCoord(square), color: piece.color, role: piece.role }] : [],
  );
}

/** The full 9x10 board over a caller-supplied piece set. `xiangqiOgBoard` builds
 *  its own start position for the article cards; a study card needs the same
 *  geometry over an arbitrary position. */
function xiangqiOgBoardFromPieces(params: {
  pieces: XiangqiOgPiece[];
  centerX: number;
  y: number;
  height: number;
}): string {
  return renderXiangqiOgBoardSvg({
    files: 9,
    ranks: 10,
    pieces: params.pieces,
    riverBetweenRanks: [5, 6],
    palaces: [
      { fileLo: 3, fileHi: 5, rankLo: 1, rankHi: 3 },
      { fileLo: 3, fileHi: 5, rankLo: 8, rankHi: 10 },
    ],
    centerX: params.centerX,
    y: params.y,
    height: params.height,
  });
}

// One footer line carries both brand and title (muted brand, bright title),
// so the hero gets the rest of the canvas.
function ogFooterLine(title: string, y: number): string {
  return `<text x="${OG_WIDTH / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="34"><tspan fill="#9ca3af" font-weight="600" letter-spacing="1">MISTBOARD</tspan><tspan fill="#5b6470">  ·  </tspan><tspan fill="#f3f4f6" font-weight="700">${escapeXml(title)}</tspan></text>`;
}

// Reads a file from the built web bundle as a data URI, so card SVGs can
// embed site assets (piece art, article art) without resvg needing network
// or filesystem access at raster time.
async function fileDataUri(staticDir: string, relPath: string, mime: string): Promise<string> {
  const buf = await fs.readFile(resolve(staticDir, relPath));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// Shogi4 start-position art. Geometry mirrors SHOGI4_RULES_THUMBNAIL in
// apps/web/src/shogi4-rules-diagrams.ts (generated from the shogi4 repo's
// gen_rules_diagrams.py); if that art regenerates differently, update this
// list with it. Images rotate 180° around their own center for the far side.
const SHOGI4_CARD_PIECES: Array<{ href: string; x: number; y: number; rotated?: boolean }> = [
  { href: 'shogi4/pieces/crane.png', x: 11.2, y: 193.2 },
  { href: 'shogi4/pieces/fox.png', x: 71.2, y: 193.2 },
  { href: 'shogi4/pieces/raccoon.png', x: 131.2, y: 193.2 },
  { href: 'shogi4/pieces/tapir.png', x: 191.2, y: 193.2 },
  { href: 'shogi4/pieces/carp.png', x: 11.2, y: 133.2 },
  { href: 'shogi4/pieces/dark/carp.png', x: 191.2, y: 73.2, rotated: true },
  { href: 'shogi4/pieces/dark/tapir.png', x: 11.2, y: 13.2, rotated: true },
  { href: 'shogi4/pieces/dark/raccoon.png', x: 71.2, y: 13.2, rotated: true },
  { href: 'shogi4/pieces/dark/fox.png', x: 131.2, y: 13.2, rotated: true },
  { href: 'shogi4/pieces/pheasant.png', x: 191.2, y: 13.2, rotated: true },
];

async function renderShogi4OgSvg(title: string, ctx: ArticleOgContext): Promise<string> {
  const boardSize = 500;
  const boardY = 36;
  const boardX = (OG_WIDTH - boardSize) / 2;
  const pieceSize = 57.6;
  const uris = new Map<string, string>();
  for (const piece of SHOGI4_CARD_PIECES) {
    if (!uris.has(piece.href)) {
      uris.set(piece.href, await fileDataUri(ctx.staticDir, piece.href, 'image/png'));
    }
  }
  const inner: string[] = [
    `<rect x="10" y="12" width="240" height="240" rx="9" fill="#f4ead2" stroke="#c9b07f" stroke-width="2"/>`,
  ];
  for (const i of [0, 1, 2]) {
    const offset = 70 + i * 60;
    inner.push(
      `<line x1="${offset}" y1="13" x2="${offset}" y2="251" stroke="#ddcca6" stroke-width="1"/>`,
    );
    inner.push(
      `<line x1="11" y1="${offset + 2}" x2="249" y2="${offset + 2}" stroke="#ddcca6" stroke-width="1"/>`,
    );
  }
  for (const piece of SHOGI4_CARD_PIECES) {
    const rotate = piece.rotated
      ? ` transform="rotate(180 ${piece.x + pieceSize / 2} ${piece.y + pieceSize / 2})"`
      : '';
    inner.push(
      `<image href="${uris.get(piece.href)}" x="${piece.x}" y="${piece.y}" width="${pieceSize}" height="${pieceSize}"${rotate}/>`,
    );
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    `<svg x="${boardX}" y="${boardY}" width="${boardSize}" height="${boardSize}" viewBox="0 0 262 262">${inner.join('')}</svg>`,
    ogFooterLine(title, boardY + boardSize + 48),
    `</svg>`,
  ].join('');
}

// Xiangqi-family cards: the start position on a proper intersection board
// (palaces, river on the full game), with the dark variants showing Red's
// opening view — the same convention as the dark-chess cards. Positions and
// fog come from the game kernel, never hand-authored.
function xqOgCoord(square: string): { file: number; rank: number } {
  return { file: square.charCodeAt(0) - 97, rank: Number(square.slice(1)) };
}

function renderXiangqiFamilyOgSvg(title: string, _ctx: ArticleOgContext, dark: boolean): string {
  const boardHeight = 504;
  const boardY = 36;
  const board = xiangqiOgBoard({
    dark,
    centerX: OG_WIDTH / 2,
    y: boardY,
    height: boardHeight,
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    board,
    ogFooterLine(title, boardY + boardHeight + 46),
    `</svg>`,
  ].join('');
}

function xiangqiOgBoard(params: {
  dark: boolean;
  centerX: number;
  y: number;
  height: number;
}): string {
  const { dark } = params;
  const state = createInitialXiangqiState('og-card');
  const pieces: XiangqiOgPiece[] = Object.entries(state.board).flatMap(([square, piece]) =>
    piece ? [{ ...xqOgCoord(square), color: piece.color, role: piece.role }] : [],
  );
  const files = 9;
  const ranks = 10;
  let fogPoints: Array<{ file: number; rank: number }> | undefined;
  if (dark) {
    const visible = new Set(
      getXiangqiPlayerView(state, 'red').visibleSquares.map((square) => square as string),
    );
    fogPoints = [];
    for (let file = 0; file < files; file += 1) {
      for (let rank = 1; rank <= ranks; rank += 1) {
        if (!visible.has(`${String.fromCharCode(97 + file)}${rank}`)) {
          fogPoints.push({ file, rank });
        }
      }
    }
  }
  return renderXiangqiOgBoardSvg({
    files,
    ranks,
    pieces,
    fogPoints,
    riverBetweenRanks: [5, 6],
    palaces: [
      { fileLo: 3, fileHi: 5, rankLo: 1, rankHi: 3 },
      { fileLo: 3, fileHi: 5, rankLo: 8, rankHi: 10 },
    ],
    centerX: params.centerX,
    y: params.y,
    height: params.height,
  });
}

// Misty's card is the article's art rather than a board: the image centered
// like a board tile, title below.
async function renderMistyOgSvg(title: string, ctx: ArticleOgContext): Promise<string> {
  const artSize = 500;
  const artY = 36;
  const artX = (OG_WIDTH - artSize) / 2;
  const uri = await fileDataUri(ctx.staticDir, 'article-thumbs/misty.jpg', 'image/jpeg');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    `<clipPath id="misty-art"><rect x="${artX}" y="${artY}" width="${artSize}" height="${artSize}" rx="10"/></clipPath>`,
    `<image href="${uri}" x="${artX}" y="${artY}" width="${artSize}" height="${artSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#misty-art)"/>`,
    ogFooterLine(title, artY + artSize + 48),
    `</svg>`,
  ].join('');
}

// The skill-vs-luck card is the article's thesis in one image: the exhibit
// game as played against the same game with every flip at its average tile.
// Series are generated from the mined game (banqi-luck-og-data.ts).
/**
 * The champions article's card is its chart: the shape (a green cascade turning
 * red from 2005) is the one thing that survives being viewed at feed size, and
 * it is the only image on the page a reader would recognise later.
 *
 * Row labels are dropped: 22 names at card scale are illegible, and the card
 * has the title for identification. The generator is the same one the article
 * figure uses, called with an explicit palette because there is no stylesheet
 * out here.
 */
/**
 * The champions card and the world title card are the same card with a
 * different chart and a different eyebrow. Sharing the body is the same
 * decision as sharing the chart renderer: they are a pair, and two copies is
 * how a pair stops matching.
 */
function renderTimelineOgSvg(title: string, eyebrow: string, chart: string): string {
  // The generator emits a full <svg>; strip its wrapper and place the content
  // on the card canvas rather than nesting one root inside another.
  const inner = chart.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const viewBox = chart.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const cw = Number(viewBox?.[1] ?? 920);
  const ch = Number(viewBox?.[2] ?? 500);
  const margin = 56;
  const availW = OG_WIDTH - margin * 2;
  const availH = 452;
  const scale = Math.min(availW / cw, availH / ch);
  const dx = (OG_WIDTH - cw * scale) / 2;
  const dy = 84;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    `<text x="${margin}" y="58" font-family="${FONT}" font-size="26" fill="#9ba39a" font-weight="700">${eyebrow}</text>`,
    `<g transform="translate(${dx.toFixed(1)} ${dy}) scale(${scale.toFixed(4)})">${inner}</g>`,
    ogFooterLine(title, dy + ch * scale + 62),
    `</svg>`,
  ].join('');
}

const OG_TIMELINE_PALETTE = {
  bar: '#5da271',
  barBanned: '#c96f62',
  text: '#f4f6ef',
  muted: '#9ba39a',
  border: '#3a4048',
};

function renderChampionsOgSvg(title: string): string {
  return renderTimelineOgSvg(
    title,
    '57 CHAMPIONSHIPS \u00b7 22 WINNERS \u00b7 1956-2025',
    xiangqiChampionTimelineSvg({
      labels: false,
      legend: false,
      credit: false,
      palette: OG_TIMELINE_PALETTE,
    }),
  );
}

function renderWorldTitleOgSvg(title: string): string {
  return renderTimelineOgSvg(
    title,
    '19 CHAMPIONSHIPS \u00b7 11 WINNERS \u00b7 1990-2025',
    xiangqiWorldTitleTimelineSvg({
      labels: false,
      legend: false,
      credit: false,
      palette: OG_TIMELINE_PALETTE,
    }),
  );
}

// The puzzle-mining card is the article's thesis as one bar: of every blunder
// the miner finds, most are thrown away, and the reasons they are thrown away
// are what a puzzle is. Same shares and same red/green vocabulary as the
// article's own thumbnail (PUZZLE_MINING_THUMBNAIL), so the two surfaces read
// as one picture.
//
// "MATE NOT REACHED", never "no mate": the band is candidates whose engine
// score was a MATE score that the line then failed to deliver inside the ply
// cap, so the claim could not be verified. It is not "candidates without a
// mate" -- an ordinary winning eval skips that check entirely and ships as a
// winning-advantage puzzle, which is 640 of the 1,605 served. The short label
// read as the second thing and misled a reader who knew the corpus.
const PUZZLE_MINING_OG_BANDS: [label: string, share: number, fill: string][] = [
  ['NEAR-TIE', 35, '#c96f62'],
  ['TOO SHORT', 32, '#cf8479'],
  ['MATE NOT REACHED', 12, '#d69a91'],
  ['NOT UNIQUE', 9, '#ddb0a9'],
  ['PUZZLE', 12, '#5da271'],
];

// Legend metrics. Approximate advance width for Noto Sans semibold at 24px
// with 1.2 tracking; the legend is centred as a whole, so a few px of drift
// moves the block rather than colliding anything.
const PM_LEGEND_CHAR_W = 15.4;
const PM_LEGEND_SWATCH = 22;
const PM_LEGEND_GAP = 14;
const PM_LEGEND_PAD = 40;

function renderPuzzleMiningOgSvg(title: string): string {
  const barX = 80;
  const barY = 150;
  const barW = OG_WIDTH - barX * 2;
  const barH = 190;
  const legendY = 440;

  const bands: { label: string; share: number; fill: string; x: number; w: number }[] = [];
  let cursor = barX;
  for (const [label, share, fill] of PUZZLE_MINING_OG_BANDS) {
    const w = (share / 100) * barW;
    bands.push({ label, share, fill, x: cursor, w });
    cursor += w;
  }

  const rects = bands
    .map(
      (b) =>
        `<rect x="${b.x.toFixed(1)}" y="${barY}" width="${b.w.toFixed(1)}" height="${barH}" fill="${b.fill}"/>`,
    )
    .join('');
  const shares = bands
    .map(
      (b) =>
        `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${barY + barH / 2 + 14}" text-anchor="middle" font-family="${FONT}" font-size="38" font-weight="700" fill="#171a1f">${b.share}%</text>`,
    )
    .join('');

  // Laid out sequentially rather than positioned per band: a label's place no
  // longer depends on how wide its band is, so the 9% band cannot squeeze its
  // own name into its neighbour. Centring by band centre is what broke here.
  const widths = bands.map(
    (b) => PM_LEGEND_SWATCH + PM_LEGEND_GAP + b.label.length * PM_LEGEND_CHAR_W,
  );
  const legendTotal = widths.reduce((sum, n) => sum + n, 0) + PM_LEGEND_PAD * (bands.length - 1);
  let legendX = (OG_WIDTH - legendTotal) / 2;
  const legend: string[] = [];
  bands.forEach((b, i) => {
    legend.push(
      `<rect x="${legendX.toFixed(1)}" y="${legendY - 19}" width="${PM_LEGEND_SWATCH}" height="${PM_LEGEND_SWATCH}" rx="4" fill="${b.fill}"/>`,
      `<text x="${(legendX + PM_LEGEND_SWATCH + PM_LEGEND_GAP).toFixed(1)}" y="${legendY}" font-family="${FONT}" font-size="24" font-weight="600" letter-spacing="1.2" fill="#c8ccd2">${b.label}</text>`,
    );
    legendX += (widths[i] ?? 0) + PM_LEGEND_PAD;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    `<defs><clipPath id="pm-og-bar"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="12"/></clipPath></defs>`,
    `<g clip-path="url(#pm-og-bar)">${rects}</g>`,
    shares,
    legend.join(''),
    ogFooterLine(title, 578),
    `</svg>`,
  ].join('');
}

function renderSkillVsLuckOgSvg(title: string): string {
  const { win, ghost } = SKILL_VS_LUCK_OG_SERIES;
  const plotX = 80;
  const plotY = 120;
  const plotW = OG_WIDTH - plotX * 2;
  const plotH = 360;
  const x = (i: number) => plotX + (i / (win.length - 1)) * plotW;
  const y = (w: number) => plotY + ((100 - w) / 100) * plotH;
  const pts = (series: number[]) =>
    series.map((w, i) => `${x(i).toFixed(1)},${y(w).toFixed(1)}`).join(' ');
  const band = `${pts(win)} ${[...ghost.keys()]
    .reverse()
    .map((i) => `${x(i).toFixed(1)},${y(ghost[i]!).toFixed(1)}`)
    .join(' ')}`;
  const SOLID = '#5da271';
  const GHOST = '#e1e6da';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    `<line x1="${plotX}" y1="68" x2="${plotX + 44}" y2="68" stroke="${SOLID}" stroke-width="6"/>`,
    `<text x="${plotX + 56}" y="76" font-family="${FONT}" font-size="26" fill="${SOLID}" font-weight="700">THE GAME AS PLAYED</text>`,
    `<line x1="${plotX + 360}" y1="68" x2="${plotX + 404}" y2="68" stroke="#9ca3af" stroke-width="5" stroke-dasharray="14 10"/>`,
    `<text x="${plotX + 416}" y="76" font-family="${FONT}" font-size="26" fill="#9ca3af" font-weight="600">IF EVERY FLIP RAN AVERAGE</text>`,
    `<line x1="${plotX}" y1="${y(50).toFixed(1)}" x2="${plotX + plotW}" y2="${y(50).toFixed(1)}" stroke="#3a4048" stroke-width="2"/>`,
    `<polygon points="${band}" fill="${SOLID}" fill-opacity="0.16"/>`,
    `<polyline points="${pts(ghost)}" fill="none" stroke="${GHOST}" stroke-opacity="0.55" stroke-width="4" stroke-dasharray="14 10"/>`,
    `<polyline points="${pts(win)}" fill="none" stroke="${SOLID}" stroke-width="6"/>`,
    ogFooterLine(title, plotY + plotH + 74),
    `</svg>`,
  ].join('');
}

// The server-enforced-fog card is the article's thesis in one image: the same
// position as White sees it, as the server holds it, and as Black sees it.
function renderServerFogOgSvg(title: string): string {
  const boardSize = 360;
  const boardY = 96;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
  );
  parts.push(`<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`);
  parts.push(
    renderBoardComposition({
      layout: 'triptych',
      canvasWidth: OG_WIDTH,
      boardY,
      boardSize,
      gap: 36,
      labelY: 72,
      labelFill: '#e1e6da',
      labelFontSize: 20,
      palette: BROWN_PALETTE,
      fogStyle: 'solid',
      boards: [
        {
          pieces: SERVER_FOG_TRIPTYCH.pieces,
          fogSquares: SERVER_FOG_TRIPTYCH.whiteFog,
          orientation: 'white',
          label: "WHITE'S VIEW",
        },
        {
          pieces: SERVER_FOG_TRIPTYCH.pieces,
          orientation: 'white',
          label: 'CANONICAL TRUTH',
        },
        {
          pieces: SERVER_FOG_TRIPTYCH.pieces,
          fogSquares: SERVER_FOG_TRIPTYCH.blackFog,
          orientation: 'white',
          label: "BLACK'S VIEW",
        },
      ],
    }),
  );
  parts.push(ogFooterLine(title, boardY + boardSize + 60));
  parts.push(`</svg>`);
  return parts.join('');
}

function renderArticleOgSvg(title: string, position: ArticleOgPosition): string {
  const boardSize = 500;
  const boardY = 36;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
  );
  parts.push(`<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`);
  parts.push(
    renderBoardComposition({
      layout: 'single',
      canvasWidth: OG_WIDTH,
      boardY,
      boardSize,
      palette: BROWN_PALETTE,
      fogStyle: 'solid',
      boards: [
        {
          pieces: position.pieces,
          fogSquares: position.fogSquares,
          orientation: position.orientation ?? 'white',
        },
      ],
    }),
  );
  parts.push(ogFooterLine(title, boardY + boardSize + 48));
  parts.push(`</svg>`);
  return parts.join('');
}

function renderStubSvg(game: persistence.GameRecord): string {
  const white = escapeXml(truncateName(displayNameForColor(game, 'white')));
  const black = escapeXml(truncateName(displayNameForColor(game, 'black')));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>
  <rect x="84" y="64" width="1032" height="534" fill="none" stroke="#253023"/>
  <text x="600" y="170" text-anchor="middle" fill="#f4f6ef" font-family="${FONT}" font-size="56" font-weight="900" letter-spacing="8">MISTBOARD</text>
  <text x="600" y="214" text-anchor="middle" fill="#9ba39a" font-family="${FONT}" font-size="24" font-weight="700">Fog Chess replay</text>
  <text x="600" y="316" text-anchor="middle" fill="#e1e6da" font-family="${FONT}" font-size="40" font-weight="800">${white} vs ${black}</text>
</svg>`;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Default OG card: brand mark ───────────────────────────────────────────────
//
// Logo, wordmark, tagline. Brian picked this over board-collage variants
// (2026-06-10); per-game boards live on the article cards instead. The logo
// SVG is passed in by the bake script (it lives at apps/web/public/logo.svg)
// so this module needs no filesystem access. Re-run
// `npm run og:default --workspace @mistboard/server` to re-bake
// `apps/web/public/og-image.png`, then bump the ?v= on the og:image meta in
// apps/web/index.html so scrapers refetch.

const FONT = "'Noto Sans', system-ui, -apple-system, Helvetica, Arial, sans-serif";
export const OG_FONT = FONT;

export function renderDefaultOgSvg(logoSvg: string): string {
  const logoSize = 224;
  const logo = logoSvg.replace(
    /^<svg[^>]*>/,
    `<svg x="${(OG_WIDTH - logoSize) / 2}" y="100" width="${logoSize}" height="${logoSize}" viewBox="0 0 1024 1024">`,
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    logo,
    `<text x="${OG_WIDTH / 2}" y="396" text-anchor="middle" fill="#f3f4f6" font-family="${FONT}" font-size="64" font-weight="800" letter-spacing="8">MISTBOARD</text>`,
    `<text x="${OG_WIDTH / 2}" y="452" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="30" font-weight="500">Original games and hidden-information engines.</text>`,
    `</svg>`,
  ].join('');
}

// resvg renders <text> with whatever fonts it can load, and the prod
// container has NONE — text silently vanishes (shipped textless cards until
// 2026-06-10). Bundle Noto Sans with the server and load ONLY it, so a local
// render is byte-identical to prod and a missing font can never ship quietly
// again. OFL attribution: apps/web/public/fonts/CREDITS.md. CJK piece
// characters are baked paths and never go through font resolution.
const FONT_FILES = ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'].map((file) =>
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts', file),
);

// Render at 2x the SVG's nominal dimensions so the resulting PNG stays crisp
// on retina displays and survives scraper recompression.
/**
 * Rasterize an SVG. `zoom` multiplies the SVG's own dimensions: 2 is right for
 * OG cards (rendered at half their delivered size), 1 for a figure whose SVG is
 * already authored at twice its display width. Oversampling past ~2x the display
 * size is not free quality — it thins hairlines below a pixel on the way down.
 */
export function svgToPng(svg: string, background = '#0f1115', zoom = 2): Buffer {
  return new Resvg(svg, {
    background,
    fitTo: { mode: 'zoom', value: zoom },
    font: {
      loadSystemFonts: false,
      fontFiles: FONT_FILES,
      defaultFontFamily: 'Noto Sans',
    },
  })
    .render()
    .asPng();
}
