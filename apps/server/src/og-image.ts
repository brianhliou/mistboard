import { promises as fs } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import {
  ARTICLE_OG_POSITIONS,
  type ArticleOgPosition,
  BROWN_PALETTE,
  boardToPieces,
  type PieceOnBoard,
  renderBoardComposition,
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
} from '@mistboard/game';
import type { ArticleZhTitles } from './article-meta.js';
import { SKILL_VS_LUCK_OG_SERIES } from './banqi-luck-og-data.js';
import {
  CARD_ASPECT_FRAMES,
  CARD_BG,
  type CardAspect,
  type CardPieceSet,
  loadCardArt,
  renderBoardAspectCard,
  renderBoardCard,
} from './og-card-board.js';
import {
  type PositionOgBoard,
  type PositionOgVariant,
  resolvePositionOg,
  startPositionFen,
} from './og-position.js';
import { escapeXml, OG_FONT, OG_HEIGHT, OG_WIDTH } from './og-primitives.js';
import {
  createPngCache,
  type PngCache,
  redirectToDefault,
  svgToPng,
  writePng,
} from './og-raster.js';
import * as persistence from './persistence.js';

export {
  createPngCache,
  escapeXml,
  OG_FONT,
  OG_HEIGHT,
  OG_WIDTH,
  type PngCache,
  redirectToDefault,
  svgToPng,
  writePng,
};
// v5 (2026-09-12): the shared board card (one board, seats beside it) in place
// of the two-fog-view frame.
export const GAME_OG_IMAGE_VERSION = 5;

// Bounded LRU of rendered per-game PNGs. Each card is rendered once on first
// scraper fetch, then served from here (and from the scraper/CDN cache, via the
// immutable Cache-Control header) — so this rarely sees repeat traffic per
// game. The cap keeps memory bounded regardless of how many distinct games get
// shared: at ~100-150 KB per PNG, 1000 entries is ~100-150 MB worst case.
// Eviction is simplest-possible LRU: a Map keeps insertion order, so reads
// re-insert (mark as recent) and writes drop the oldest key when over cap.
const MAX_CACHE_ENTRIES = 1000;

const cache = createPngCache(MAX_CACHE_ENTRIES);

function cacheGet(key: string): Buffer | undefined {
  return cache.get(key);
}

function cacheSet(key: string, png: Buffer): void {
  cache.set(key, png);
}

/** The fog chess game card (chess-stack rooms, /game/:id): the final position
 *  on the chess board with the two seats beside it, through the shared board
 *  card like every other variant. A finished game reveals in full, so there is
 *  no fog to draw. Falls back to a pairing-only card when the log will not
 *  replay, so a shared link always resolves to some image. */
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

  let svg: string;
  try {
    const pieces = await reconstructFinalPieces(roomId);
    svg = pieces ? renderChessGameCard(game, pieces) : renderStubSvg(game);
  } catch {
    svg = renderStubSvg(game);
  }
  const png = await svgToPng(svg);
  cacheSet(cacheKey, png);
  writePng(response, png, 'MISS');
}

// Replay the completed event log to the final position. Game OG images are
// only served for completed games, so this does not expose live hidden
// information.
async function reconstructFinalPieces(roomId: string): Promise<PieceOnBoard[] | null> {
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
  return boardToPieces(projection.state.board);
}

function chessSeatScore(result: string, seat: 'white' | 'black'): string | undefined {
  if (result === 'draw') return '½';
  if (result === 'white-wins' || result === 'black-wins') {
    return result.startsWith(seat) ? '1' : '0';
  }
  return undefined;
}

export function renderChessGameCard(game: persistence.GameRecord, pieces: PieceOnBoard[]): string {
  const board: PositionOgBoard = { kind: 'chess', pieces };
  return renderBoardCard(board, new Map(), {
    players: {
      top: {
        name: displayNameForColor(game, 'black'),
        ink: 'black',
        score: chessSeatScore(game.result, 'black'),
      },
      bottom: {
        name: displayNameForColor(game, 'white'),
        ink: 'white',
        score: chessSeatScore(game.result, 'white'),
      },
      variant: 'Fog Chess',
    },
  });
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
  'yin-sheng': playerFaceOgSvg('article-thumbs/yin-sheng-2022-face.jpg'),
  'cao-yanlei': playerFaceOgSvg('article-thumbs/cao-yanlei-2024-face.jpg'),
  'lai-ly-huynh': playerFaceOgSvg('article-thumbs/lai-ly-huynh-2026-face.jpg'),
  'tony-fung-ga-zen': playerFaceOgSvg('article-thumbs/tony-fung-2023-face.jpg'),
  'xiangqi-champions': renderChampionsOgSvg,
  'xiangqi-world-championship': renderWorldTitleOgSvg,
  'how-puzzle-mining-works': renderPuzzleMiningOgSvg,
  'banqi-statistics': renderBanqiStatsOgSvg,
  'one-thousand-games': renderOneThousandGamesOgSvg,
};

// Banqi's start is 32 face-down tiles, which at thumbnail size reads as a
// pattern rather than a game (Brian, 2026-10-11). The card shows a game under
// way instead: 13 tiles face up (both inks, both generals), 5 captured squares
// empty, 14 still face down; the pool is what is left to turn, and the parser
// checks it adds up. Red to move, with captures on the board.
export const BANQI_RULES_CARD_FEN =
  'XXrX1XHX/XgXS1cXX/X1GXsAX1/CXRhS1aX r A1E1R1H1C1S2a1e1r1c1s3 4 21';

// The Pikafish page shows no position of its own, so its card is the one a
// xiangqi player knows on sight: the Central Cannon with the rook across the
// river against the Screen Horses (五九炮过河车对屏风马平炮兑车), after Red's
// tenth move, 车九平八. Replayed legally from the start by the kernel in
// og-image.test.ts, so the FEN cannot drift into an impossible board.
export const PIKAFISH_CARD_MOVES =
  '炮二平五 马8进7 马二进三 车9平8 车一平二 马2进3 兵七进一 卒7进1 车二进六 炮8平9 ' +
  '车二平三 炮9退1 马八进七 士4进5 炮八平九 炮9平7 车三平四 马7进8 车九平八';
export const PIKAFISH_CARD_FEN =
  'r1b1kabr1/4a1c2/1cn6/p1p1pR2p/6pn1/2P6/P3P1P1P/C1N1C1N2/9/1RBAKAB2 b - - 19 10';

// Pages whose card is a position on the site board (og-card-board.ts), keyed by
// the ARTICLE_META slug: the variant's start unless `fen` says otherwise. Mostly
// rules pages; an article whose subject is a board game gets one too. The fog
// xiangqi card shows Red's opening view: the kernel decides what Red can see,
// never a hand list. These slugs used to be 'dark-*' and the cards silently
// vanished at the dark->fog rename (2026-09-12 audit); the key here MUST be the
// live slug. `hanzi` marks a xiangqi-family board, whose zh pages get the card
// in the traditional set with a zh caption (ARTICLE_OG_ZH_SLUGS).
const BOARD_POSITION_CARDS: Record<
  string,
  { variant: PositionOgVariant; fen?: string; redFog?: boolean; hanzi?: true }
> = {
  xiangqi: { variant: 'xiangqi', hanzi: true },
  'fog-xiangqi': { variant: 'dark-xiangqi', redFog: true, hanzi: true },
  jieqi: { variant: 'jieqi', hanzi: true },
  banqi: { variant: 'banqi', fen: BANQI_RULES_CARD_FEN, hanzi: true },
  'fortress-xiangqi': { variant: 'fortress-xiangqi', hanzi: true },
  'duck-xiangqi': { variant: 'duck-xiangqi', hanzi: true },
  // Unlisted, but a rules link is still shared: the card is the standard
  // array on the standard board, which is the array atomic starts from.
  'atomic-xiangqi': { variant: 'atomic-xiangqi', hanzi: true },
  // The kernel's start (startPositionFen): the standard array without its
  // advisors and elephants, which start in hand.
  'crazyhouse-xiangqi': { variant: 'crazyhouse-xiangqi', hanzi: true },
  jungle: { variant: 'jungle' },
  'jungle-flip': { variant: 'jungle-flip' },
  pikafish: { variant: 'xiangqi', fen: PIKAFISH_CARD_FEN, hanzi: true },
};

/** The page languages a card has its own version for, as route prefixes. */
export const ARTICLE_OG_LANGS = ['zh-hans', 'zh-hant'] as const;
export type ArticleOgLang = (typeof ARTICLE_OG_LANGS)[number];

export function isArticleOgLang(value: string): value is ArticleOgLang {
  return (ARTICLE_OG_LANGS as readonly string[]).includes(value);
}

/** Slugs whose card has a zh version per script (`?lang=zh-hans|zh-hant`):
 *  the same board in the traditional (hanzi) set, captioned with the page's
 *  own zh title. The site gives zh readers hanzi pieces by default (memory
 *  piece_set_default_by_locale_settled); one card URL per page language lets
 *  the card follow. Every one has published zh titles (og-image.test.ts).
 *  Mirrored by the web build (apps/web/src/article-og-image.ts); og-image.test.ts
 *  pins the two. */
export const ARTICLE_OG_ZH_SLUGS: readonly string[] = Object.entries(BOARD_POSITION_CARDS)
  .filter(([, entry]) => entry.hanzi)
  .map(([slug]) => slug);

// ARTICLE_OG_POSITIONS (board-render) is keyed by the chess positions' original
// names, which the web's article thumbnails still use; the page slugs moved to
// 'fog-*' in the dark->fog rename and the cards went missing for two months.
// The slug->key hop lives here so the shared map does not have to move.
const ARTICLE_POSITION_KEY: Record<string, string> = {
  'fog-chess': 'dark-chess',
  'fog-chess-concepts': 'dark-chess-concepts',
};

/** Bumped when the article card's LOOK changes. Article image URLs carried no
 *  version before v2, so scrapers hold the old cards under the bare URL; the
 *  page meta now appends ?v= (server-static-pages.ts). */
//  v3 (2026-09-25): Chinese characters in a title render (Noto Sans SC in
//  og-raster.ts); the player cards had shown them as empty boxes.
//  v5 (2026-10-11): banqi shows a game under way, not 32 face-down tiles, and
//  its outline meets the board's rounded corner; a rules title with "Rules"
//  mid-title (banqi, jieqi, jungle, flip jungle) no longer gets a second one;
//  pikafish gets a board card instead of the site card. The ?lang= and
//  ?aspect= URLs are new with v5, so no older URL ever named them.
export const ARTICLE_OG_IMAGE_VERSION = 5;

/** The page's wide card URL (og:image), as the server-rendered article shell
 *  writes it. A zh page (`langPrefix` zh-hans / zh-hant) of a slug with a zh
 *  card gets its own script's. The prerender writes the same URLs from the web
 *  mirror. */
export function articleOgImageUrl(host: string, slug: string, langPrefix?: string): string {
  const base = `${host}/og/article/${encodeURIComponent(slug)}.png?v=${ARTICLE_OG_IMAGE_VERSION}`;
  const lang = langPrefix?.toLowerCase();
  return lang && isArticleOgLang(lang) && ARTICLE_OG_ZH_SLUGS.includes(slug)
    ? `${base}&lang=${lang}`
    : base;
}

/** Slugs whose card is hand-drawn (a chart, a timeline, a photo, an art
 *  composition) and has no board to re-frame, so it has no aspect versions: the
 *  Article JSON-LD keeps its one wide card. Mirrored by the web build
 *  (apps/web/src/article-og-image.ts); og-image.test.ts pins the two. */
export const ARTICLE_OG_WIDE_ONLY_SLUGS: readonly string[] = Object.keys(CUSTOM_ARTICLE_OG_SVGS);

/** The board a page's position card shows (its start position, or the entry's
 *  own), or null when the slug has none. */
export function positionCardBoard(slug: string): PositionOgBoard | null {
  const entry = BOARD_POSITION_CARDS[slug];
  if (!entry) return null;
  const resolved = resolvePositionOg(entry.variant, entry.fen ?? startPositionFen(entry.variant));
  if (!resolved) return null;
  let board = resolved.board;
  if (entry.redFog && board.kind === 'intersection') {
    const state = createInitialXiangqiState('og-card');
    const visible = new Set(
      getXiangqiPlayerView(state, 'red').visibleSquares.map((square) => square as string),
    );
    const fog: Array<{ file: number; rank: number }> = [];
    for (let file = 0; file < board.files; file += 1) {
      for (let rank = 1; rank <= board.ranks; rank += 1) {
        if (!visible.has(`${String.fromCharCode(97 + file)}${rank}`)) fog.push({ file, rank });
      }
    }
    const shown = (at: { file: number; rank: number }) =>
      visible.has(`${String.fromCharCode(97 + at.file)}${at.rank}`);
    board = {
      ...board,
      pieces: board.pieces.filter(shown),
      extras: board.extras.filter(shown),
      fog,
    };
  }
  return board;
}

/** A single chess position article's board. */
function articlePositionBoard(position: ArticleOgPosition): PositionOgBoard {
  return {
    kind: 'chess',
    pieces: position.pieces,
    ...(position.fogSquares ? { fogSquares: position.fogSquares } : {}),
    ...(position.orientation ? { orientation: position.orientation } : {}),
  };
}

/** The site card re-framed for an aspect: logo and wordmark, centred, no
 *  tagline (it is what a crop or a 150px thumbnail loses first). What an
 *  article with no card of its own offers in its JSON-LD, the same as its
 *  og:image falls back to the wide site card. */
export function renderDefaultOgAspectSvg(logoSvg: string, aspect: CardAspect): string {
  const { width, height } = CARD_ASPECT_FRAMES[aspect];
  const logoSize = Math.round(height * 0.4);
  const wordmarkSize = 56;
  const gap = 64;
  const top = (height - (logoSize + gap + wordmarkSize * 0.72)) / 2;
  const logo = logoSvg.replace(
    /^<svg[^>]*>/,
    `<svg x="${(width - logoSize) / 2}" y="${top}" width="${logoSize}" height="${logoSize}" viewBox="0 0 1024 1024">`,
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${CARD_BG}"/>`,
    logo,
    `<text x="${width / 2}" y="${top + logoSize + gap + wordmarkSize * 0.72}" text-anchor="middle" fill="#f3f4f6" font-family="${OG_FONT}" font-size="${wordmarkSize}" font-weight="800" letter-spacing="8">MISTBOARD</text>`,
    `</svg>`,
  ].join('');
}

/** The wide card's title. Page H1s drift on the word "Rules" (some rules
 *  pages carry it, some don't); the card says it once, so a shared rules link
 *  always reads as one. A title that already has it anywhere keeps its own
 *  ("Banqi Rules (Chinese Dark Chess)" had become "... Dark Chess) Rules"). */
export function articleCardTitle(kind: 'rules' | 'article', title: string): string {
  return kind === 'rules' && !/\bRules\b/.test(title) ? `${title} Rules` : title;
}

/** A zh card's title: the page's published zh title up to its full-width
 *  colon. Several zh titles carry a search subtitle after it ("暗棋規則：玩法
 *  詳解與免費線上對弈"); the card keeps the name ("暗棋規則"), as the English
 *  card keeps "Banqi Rules (Chinese Dark Chess)". Every zh rules title already
 *  says 规则 / 規則, so no suffix is added. */
export function articleCardTitleZh(title: string): string {
  const head = title.split('：')[0]!.trim();
  return head || title;
}

export async function serveArticleOgImage(params: {
  slug: string;
  title: string;
  kind: 'rules' | 'article';
  response: ServerResponse;
  staticDir: string;
  /** One of the JSON-LD shapes; absent for the wide og:image card. The route
   *  rejects any other value before it gets here. */
  aspect?: CardAspect;
  /** A zh page's card: hanzi pieces and the page's zh title. Only a slug in
   *  ARTICLE_OG_ZH_SLUGS with published zh titles has one; any other slug
   *  answers 404 rather than its English card under a URL that promised zh. */
  lang?: ArticleOgLang;
  /** The article's published zh titles (ARTICLE_META), read when `lang` is set. */
  zhTitles?: ArticleZhTitles;
}): Promise<void> {
  const { slug, kind, response, staticDir, aspect, lang } = params;
  const zhTitle = lang ? params.zhTitles?.[lang] : undefined;
  if (lang && (!ARTICLE_OG_ZH_SLUGS.includes(slug) || !zhTitle)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`no ${lang} card for ${slug}: it has no xiangqi-family board or no ${lang} page`);
    return;
  }
  const pieceSet: CardPieceSet = lang ? 'traditional' : 'international';
  const custom = CUSTOM_ARTICLE_OG_SVGS[slug];
  const position = ARTICLE_OG_POSITIONS[ARTICLE_POSITION_KEY[slug] ?? slug];
  const boardCard = BOARD_POSITION_CARDS[slug];
  if (aspect) {
    await serveArticleAspectImage({
      slug,
      aspect,
      custom,
      position,
      response,
      staticDir,
      pieceSet,
    });
    return;
  }
  const key = `article:v${ARTICLE_OG_IMAGE_VERSION}:${slug}:${lang ?? 'en'}`;
  const cached = cacheGet(key);
  if (cached) {
    writePng(response, cached, 'HIT');
    return;
  }
  if (!custom && !position && !boardCard) {
    redirectToDefault(response);
    return;
  }
  const title = zhTitle ? articleCardTitleZh(zhTitle) : articleCardTitle(kind, params.title);
  const art = await loadCardArt(staticDir);
  const board = positionCardBoard(slug);
  const svg = custom
    ? await custom(title, { staticDir })
    : board
      ? renderBoardCard(board, art, { title: [title] }, pieceSet)
      : renderArticleOgSvg(title, position!);
  const png = await svgToPng(svg);
  cacheSet(key, png);
  writePng(response, png, 'MISS');
}

/** An aspect card: the page's board re-framed, or the site card re-framed for a
 *  page with no card of its own. A hand-drawn card has none and 404s rather
 *  than standing in a wide image under an aspect URL. */
async function serveArticleAspectImage(params: {
  slug: string;
  aspect: CardAspect;
  custom: unknown;
  position: ArticleOgPosition | undefined;
  response: ServerResponse;
  staticDir: string;
  pieceSet: CardPieceSet;
}): Promise<void> {
  const { slug, aspect, response, staticDir, pieceSet } = params;
  if (params.custom) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`no ${aspect} card for ${slug}: its card has no board to re-frame`);
    return;
  }
  const board =
    positionCardBoard(slug) ?? (params.position ? articlePositionBoard(params.position) : null);
  // Cards with no board share one site card per aspect.
  const key = `article:v${ARTICLE_OG_IMAGE_VERSION}:${aspect}:${board ? `${slug}:${pieceSet}` : '(site)'}`;
  const cached = cacheGet(key);
  if (cached) {
    writePng(response, cached, 'HIT');
    return;
  }
  const svg = board
    ? renderBoardAspectCard(board, await loadCardArt(staticDir), aspect, pieceSet)
    : renderDefaultOgAspectSvg(await fs.readFile(resolve(staticDir, 'logo.svg'), 'utf-8'), aspect);
  const png = await svgToPng(svg);
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
//  v3 (2026-09-12): the live board and the site's default piece set, board at
//  full height with the title beside it (og-card-board.ts). */
//  v4 (2026-09-25): Chinese study and chapter titles render instead of boxes.
export const STUDY_OG_IMAGE_VERSION = 5;

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
  /** The web build, for the piece art. Absent (tests) = glyph fallback. */
  staticDir?: string;
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

  // The caption column beside a 9x10 board is ~530px: about 22 half-width
  // characters a line at the card's title size, three lines at most.
  const lines = fitStudyTitleLines(chapter.name, 22, 3);
  const art = params.staticDir ? await loadCardArt(params.staticDir) : new Map();
  const board: PositionOgBoard = {
    kind: 'intersection',
    files: 9,
    ranks: 10,
    riverBetweenRanks: [5, 6],
    palaces: [
      { fileLo: 3, fileHi: 5, rankLo: 1, rankHi: 3 },
      { fileLo: 3, fileHi: 5, rankLo: 8, rankHi: 10 },
    ],
    pieces,
    extras: [],
  };
  const svg = renderBoardCard(board, art, { title: lines });
  const png = await svgToPng(svg);
  cacheSet(key, png);
  writePng(response, png, 'MISS');
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

function xqOgCoord(square: string): { file: number; rank: number } {
  return { file: square.charCodeAt(0) - 97, rank: Number(square.slice(1)) };
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

// A player page's card is the player: the same face crop the index card uses,
// landscape, title below. Same shape as Misty's card with a wider frame,
// because a face crop is 3:2 and a square would cut the sides off it. One
// renderer for every player page; the face crop is the only thing that varies.
function playerFaceOgSvg(facePath: string) {
  return async (title: string, ctx: ArticleOgContext): Promise<string> => {
    const artW = 660;
    const artH = 420;
    const artY = 36;
    const artX = (OG_WIDTH - artW) / 2;
    const uri = await fileDataUri(ctx.staticDir, facePath, 'image/jpeg');
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
      `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
      `<clipPath id="player-face-art"><rect x="${artX}" y="${artY}" width="${artW}" height="${artH}" rx="10"/></clipPath>`,
      `<image href="${uri}" x="${artX}" y="${artY}" width="${artW}" height="${artH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#player-face-art)"/>`,
      ogFooterLine(title, artY + artH + 48),
      `</svg>`,
    ].join('');
  };
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

// The banqi statistics card: one row of the article's lead-safety grid, the
// move-30 cut, which is the finding the post is quoted for. Four numbers is
// what a share card can carry; the grid's other three rows are the article's
// job. Numbers are the move-30 row of LEAD_SAFETY in
// apps/web/src/articles/articles/banqi-statistics-diagrams.ts (the server cannot
// import the web bundle); change them together.
const BANQI_STATS_OG_ROW: ReadonlyArray<{ bucket: string; pct: number }> = [
  { bucket: '1-9', pct: 59 },
  { bucket: '10-19', pct: 81 },
  { bucket: '20-39', pct: 89 },
  { bucket: '40+', pct: 100 },
];

function renderBanqiStatsOgSvg(title: string): string {
  const cellW = 236;
  const gap = 24;
  const totalW = cellW * BANQI_STATS_OG_ROW.length + gap * (BANQI_STATS_OG_ROW.length - 1);
  const left = (OG_WIDTH - totalW) / 2;
  const top = 214;
  const cellH = 188;
  const cells = BANQI_STATS_OG_ROW.flatMap(({ bucket, pct }, i) => {
    const x = left + i * (cellW + gap);
    // One hue, opacity carrying the rate, exactly as the in-article grid does.
    const alpha = (0.14 + (Math.max(pct - 40, 0) / 60) * 0.7).toFixed(2);
    return [
      `<rect x="${x}" y="${top}" width="${cellW}" height="${cellH}" rx="14" fill="#5da271" fill-opacity="${alpha}"/>`,
      `<text x="${x + cellW / 2}" y="${top + 104}" text-anchor="middle" font-family="${FONT}" font-size="72" font-weight="700" fill="#f3f4f6">${pct}%</text>`,
      `<text x="${x + cellW / 2}" y="${top + 150}" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="600" fill="#cbd5cf">${bucket} pts</text>`,
    ];
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    `<text x="${OG_WIDTH / 2}" y="104" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="600" letter-spacing="2" fill="#5da271">200 ENGINE GAMES, TAIWANESE RULES</text>`,
    `<text x="${OG_WIDTH / 2}" y="168" text-anchor="middle" font-family="${FONT}" font-size="46" font-weight="700" fill="#f3f4f6">How often the material leader wins</text>`,
    ...cells,
    `<text x="${OG_WIDTH / 2}" y="${top + cellH + 52}" text-anchor="middle" font-family="${FONT}" font-size="30" fill="#9ca3af">points ahead after move 30</text>`,
    ogFooterLine(title, OG_HEIGHT - 44),
    `</svg>`,
  ].join('');
}

// The milestone card: the number, what it counts, and the footer. Text only,
// on the default card's ground, so it reads at thumbnail size in any feed.
// The footer says thanks instead of repeating the title the hero already says.
function renderOneThousandGamesOgSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    `<text x="${OG_WIDTH / 2}" y="330" text-anchor="middle" font-family="${FONT}" font-size="230" font-weight="700" letter-spacing="-6" fill="#f3f4f6">1,000</text>`,
    `<text x="${OG_WIDTH / 2}" y="420" text-anchor="middle" font-family="${FONT}" font-size="44" font-weight="600" letter-spacing="6" fill="#5da271">GAMES PLAYED</text>`,
    ogFooterLine('Thank you for playing', OG_HEIGHT - 44),
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
  return renderBoardCard(articlePositionBoard(position), new Map(), { title: [title] });
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

// ── Default OG card: brand mark ───────────────────────────────────────────────
//
// Logo, wordmark, tagline. Brian picked this over board-collage variants
// (2026-06-10); per-game boards live on the article cards instead. The logo
// SVG is passed in by the bake script (it lives at apps/web/public/logo.svg)
// so this module needs no filesystem access. Re-run
// `npm run og:default --workspace @mistboard/server` to re-bake
// `apps/web/public/og-image.png`, then bump the ?v= on the og:image meta in
// apps/web/index.html so scrapers refetch.

const FONT = OG_FONT;

export function renderDefaultOgSvg(
  logoSvg: string,
  copy: { wordmark: string; lines: string[]; note?: string } = {
    wordmark: 'MISTBOARD',
    lines: ['Chinese chess and original strategy games.'],
    note: 'Free and open source.',
  },
): string {
  const logoSize = 200;
  const logoY = 96;
  const logo = logoSvg.replace(
    /^<svg[^>]*>/,
    `<svg x="${(OG_WIDTH - logoSize) / 2}" y="${logoY}" width="${logoSize}" height="${logoSize}" viewBox="0 0 1024 1024">`,
  );
  const wordmarkY = logoY + logoSize + 84;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    logo,
    `<text x="${OG_WIDTH / 2}" y="${wordmarkY}" text-anchor="middle" fill="#f3f4f6" font-family="${FONT}" font-size="64" font-weight="800" letter-spacing="8">${escapeXml(copy.wordmark)}</text>`,
  ];
  let y = wordmarkY + 66;
  for (const line of copy.lines) {
    parts.push(
      `<text x="${OG_WIDTH / 2}" y="${y}" text-anchor="middle" fill="#e5e9df" font-family="${FONT}" font-size="38" font-weight="600">${escapeXml(line)}</text>`,
    );
    y += 50;
  }
  if (copy.note) {
    parts.push(
      `<text x="${OG_WIDTH / 2}" y="${y + 8}" text-anchor="middle" fill="#8b9289" font-family="${FONT}" font-size="30" font-weight="600">${escapeXml(copy.note)}</text>`,
    );
  }
  parts.push(`</svg>`);
  return parts.join('');
}
