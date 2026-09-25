import { promises as fs } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Color } from '@mistboard/game';
import { ARTICLE_META, articleIsIndexable, canonicalArticleBase } from './article-meta.js';
import {
  articleIsScheduledAhead,
  prerenderedIndexIsStale,
  readArticleSchedule,
} from './article-schedule.js';
import { botPageMeta } from './bot-page-meta.js';
import { broadcastPageMeta } from './og-broadcast.js';
import { type TenantGamePageMeta, tenantGamePageMeta } from './og-game-tenant.js';
import {
  ARTICLE_OG_IMAGE_VERSION,
  GAME_OG_IMAGE_VERSION,
  STUDY_OG_IMAGE_VERSION,
} from './og-image.js';
import {
  isPositionOgVariant,
  POSITION_OG_IMAGE_VERSION,
  type PositionOgVariant,
  positionOgVariantLabel,
  publicPositionFen,
} from './og-position.js';
import * as persistence from './persistence.js';
import { isNoindexRoute } from './server-policy.js';
import {
  chapterHasMoveCommentary,
  chapterIsSubstantial,
  chapterPageMeta,
  renderStudyBody,
} from './study-page-body.js';

export { ARTICLE_META, canonicalArticleBase };

export type PageMeta = {
  title: string;
  description: string;
  url: string;
  imageUrl?: string; // omit to keep the default OG image from index.html
};

// Per-route title/description for SPA shell routes. Without these, every client
// route serves index.html's generic homepage <title>, so /learn/xiangqi,
// /analysis and /puzzles are byte-identical to a crawler and read as duplicates
// of one another. Keyed by exact pathname; a route absent here keeps the default
// homepage meta. Only list a route in SITEMAP_STATIC_ROUTES once it has an entry
// here, or the sitemap advertises a set of identical shells.
type SpaRouteMeta = {
  title: string;
  description: string;
  /** Sets <html lang> on the served shell. Omit for English routes. */
  htmlLang?: string;
  /** The unprefixed path shared by this route's locale variants (e.g.
   *  '/videos'). Present on all three, it emits hreflang alternates so the set
   *  reads as one page in three languages rather than three near-duplicates
   *  competing with each other. */
  localeGroup?: string;
};

const SPA_ROUTE_META: Record<string, SpaRouteMeta> = {
  '/videos': {
    title: 'Xiangqi Video Library | Mistboard',
    description:
      'Curated xiangqi (Chinese chess) videos in English and Chinese: rules, openings, tactics, endgames, and commented games.',
    localeGroup: '/videos',
  },
  '/zh-hans/videos': {
    title: '象棋视频库 | Mistboard',
    description: '精选中文与英文象棋视频：规则、开局、战术、残局与讲解对局。',
    htmlLang: 'zh-Hans',
    localeGroup: '/videos',
  },
  '/zh-hant/videos': {
    title: '象棋影片庫 | Mistboard',
    description: '精選中文與英文象棋影片：規則、開局、戰術、殘局與講解對局。',
    htmlLang: 'zh-Hant',
    localeGroup: '/videos',
  },
  // The ten routes below were advertised in the sitemap while serving the
  // homepage title and description, which the note above forbids. Each
  // description is drawn from the page's own copy rather than written fresh,
  // so a search result cannot promise something the page does not say.
  // The page for "play xiangqi against the computer" (象棋人机对战, 25K Bing
  // impressions a quarter on 象棋ai alone, 2026-09-20 demand read). It served
  // the homepage title until 2026-09-25, and had no Chinese URL.
  '/bots': {
    title: 'Play Xiangqi Against the Computer · 8 Levels and Pikafish | Mistboard',
    description:
      'Play Chinese chess (xiangqi) against the computer: eight levels from beginner to strong, with Pikafish at the top. Free, in the browser, no account needed.',
    localeGroup: '/bots',
  },
  '/zh-hans/bots': {
    title: '象棋人机对战 · 八个等级与皮卡鱼 | Mistboard',
    description:
      '和电脑下象棋：八个难度等级，从入门到很强，最强的对手是皮卡鱼。免费网页版，无需下载，无需注册。',
    htmlLang: 'zh-Hans',
    localeGroup: '/bots',
  },
  '/zh-hant/bots': {
    title: '象棋人機對戰 · 八個等級與皮卡魚 | Mistboard',
    description:
      '和電腦下象棋：八個難度等級，從入門到很強，最強的對手是皮卡魚。免費網頁版，無需下載，無需註冊。',
    htmlLang: 'zh-Hant',
    localeGroup: '/bots',
  },
  '/about': {
    title: 'About Mistboard | Chinese Chess (Xiangqi) in English',
    description:
      'A free, open-source place to play xiangqi (Chinese chess) in English, built for serious play. What the site is, and who it is for.',
  },
  '/faq': {
    title: 'FAQ | Mistboard',
    description:
      'Which games are hosted, whether you need an account, how rated play and cheat prevention work, and where the game library comes from.',
  },
  '/developers': {
    title: 'Developers | Mistboard',
    description:
      'Embed a xiangqi board with engine annotations in your own page. A public study chapter runs in an iframe with no API key, and Mistboard is an oEmbed provider.',
  },
  '/api-docs': {
    title: 'API | Mistboard',
    description:
      'The public read API behind mistboard.com: games, watch feeds, puzzles, studies, ratings, the xiangqi opening explorer and the forum, as an OpenAPI 3.1 document.',
  },
  '/forum': {
    title: 'Forum | Mistboard',
    description:
      'Community discussion: general games talk, game analysis, site feedback, and off-topic.',
  },
  '/coach': {
    title: 'Xiangqi Coaches | Mistboard',
    description:
      'Find a coach to study with. Every coach listed here holds a verified xiangqi or chess title.',
  },
  '/streamer': {
    title: 'Xiangqi Streamers | Mistboard',
    description: 'Chinese chess (xiangqi) and variant streamers to watch live and on demand.',
  },
  '/player': {
    title: 'Xiangqi Leaderboard | Mistboard',
    description: 'The highest rated players on Mistboard, by game and time control.',
  },
  '/player/rating-stats': {
    title: 'Rating Distribution | Mistboard',
    description:
      'How Mistboard ratings are spread across each rated game, with player counts and averages.',
  },
  '/patron': {
    title: 'Become a Patron | Mistboard',
    description:
      'Mistboard is independent and ad-free. Core play and learning stay free. Patron is an optional monthly subscription with a profile badge.',
  },
  '/source': {
    title: 'Source Code | Mistboard',
    description:
      'Mistboard is an independent open-source project, published under AGPL-3.0-or-later. Browse the repository and the license.',
  },
  '/contribute': {
    title: 'Contribute | Mistboard',
    description: 'Mistboard is free and open source. Ways to help, whether or not you write code.',
  },
  '/changelog': {
    title: 'Changelog | Mistboard',
    description:
      'Every change to mistboard.com, month by month, newest first: playing, learning, watching, community, the site, removals and fixes, each linking its commit.',
  },
  '/learn/xiangqi': {
    title: 'Learn Chinese Chess (Xiangqi) | Mistboard',
    description:
      'A free interactive xiangqi course in English. Learn the pieces, the rules, and core tactics by playing them.',
    localeGroup: '/learn/xiangqi',
  },
  // The course ships in all three interface locales; before 2026-09-22 only the
  // English URL was routable, so the Chinese course had no indexable address.
  '/zh-hans/learn/xiangqi': {
    title: '学下象棋 | Mistboard',
    description: '免费的互动象棋入门课程：边玩边学棋子走法、规则和基本战术。',
    htmlLang: 'zh-Hans',
    localeGroup: '/learn/xiangqi',
  },
  '/zh-hant/learn/xiangqi': {
    title: '學下象棋 | Mistboard',
    description: '免費的互動象棋入門課程：邊玩邊學棋子走法、規則和基本戰術。',
    htmlLang: 'zh-Hant',
    localeGroup: '/learn/xiangqi',
  },
  '/analysis': {
    title: 'Xiangqi Analysis Board | Mistboard',
    description:
      'Analyse xiangqi (Chinese chess) positions with a free engine. Import moves or a FEN, branch variations, review any game. Mistboard variants supported too.',
  },
  '/editor': {
    title: 'Xiangqi Board Editor | Mistboard',
    description:
      'Set up any xiangqi (Chinese chess) position by hand, get its FEN, and send it to the free analysis board. Mistboard variants supported too.',
  },
  '/puzzles': {
    title: 'Xiangqi Puzzles | Mistboard',
    description:
      'Free xiangqi (Chinese chess) puzzles drawn from real games, with puzzles for Mistboard variants alongside.',
  },
  '/practice': {
    title: 'Xiangqi Practice | Mistboard',
    description:
      'Practise xiangqi (Chinese chess) endgames against the engine: each position sets a goal, the engine defends, and it tells you when the win has slipped.',
  },
  '/study': {
    title: 'Xiangqi Studies | Mistboard',
    description:
      'Browse public xiangqi (Chinese chess) studies: annotated games, classical endgame compositions, and opening lines on an interactive board.',
  },
  '/feed': {
    title: 'Updates and Announcements | Mistboard',
    description:
      'Every Mistboard release, article, and status update, newest first: new variants, engine work, and changes to the site.',
  },
  '/games': {
    title: 'Current Games | Mistboard',
    description:
      'Every xiangqi (Chinese chess) and variant game in progress on Mistboard right now: live games with clocks, and correspondence games waiting on a move.',
  },
  '/games/search': {
    // Unfiltered, this route lists the most recently finished games across
    // every lane, so it is a live content page rather than a search form. That
    // is what makes it worth indexing at all.
    title: 'Xiangqi Game Database | Mistboard',
    description:
      'Search and browse xiangqi (Chinese chess) games: tournament archives, live broadcasts, and games played on Mistboard. Filter by player, event, result, date, or length.',
  },
  '/import': {
    title: 'Import a Xiangqi Game | Mistboard',
    description:
      'Paste a xiangqi (Chinese chess) game and get a browsable board with free engine analysis. Reads PGN, WXF, Chinese notation, ICCS coordinates, and dpxq records.',
  },
  '/stats': {
    title: 'Statistics | Mistboard',
    description:
      'Live statistics for Mistboard: total xiangqi and variant games played, activity over time, and a breakdown by variant and game type.',
  },
};

// Position routes: /analysis[/<variant>] and /editor[/<variant>], the same
// catalog as apps/web/src/analysis-catalog.ts (bare paths open xiangqi). Each
// variant gets its own title so the eight boards do not read as duplicates of
// one another, and a link carrying a valid ?fen= gets a card of that position
// (og-position.ts) plus an og:url of the shared link itself.
//
// Hidden-deal variants: the link may carry the deal in a sixth FEN field. The
// og:image URL carries the PUBLIC five-field spelling only, so the image URL
// itself never names a hidden identity; og:url keeps the link as shared, since
// that is the page the preview is for.
const POSITION_ROUTE = /^\/(analysis|editor)(?:\/([a-z0-9-]+))?$/;

type PositionRouteMeta = {
  title: string;
  description: string;
  /** Path + query of the canonical link (no host). */
  urlPath: string;
  /** Path + query of the position card (no host); absent without a valid FEN. */
  imagePath?: string;
};

function positionPageCopy(
  surface: 'analysis' | 'editor',
  variant: PositionOgVariant,
): { title: string; description: string } {
  // The flagship keeps the wording of its long-standing route entries.
  if (variant === 'xiangqi') return SPA_ROUTE_META[`/${surface}`]!;
  const label = positionOgVariantLabel(variant);
  return surface === 'analysis'
    ? {
        title: `${label} Analysis Board | Mistboard`,
        description: `Analyse ${label} positions on a free interactive board. Import a FEN, branch variations, and share any position by link.`,
      }
    : {
        title: `${label} Board Editor | Mistboard`,
        description: `Set up any ${label} position by hand, get its FEN, and send it to the free ${label} analysis board.`,
      };
}

export function positionRouteMeta(pathname: string, search: string): PositionRouteMeta | null {
  const match = POSITION_ROUTE.exec(pathname);
  if (!match) return null;
  const surface = match[1] as 'analysis' | 'editor';
  const slug = match[2] ?? 'xiangqi';
  // Unknown slugs get the plain shell (the client 404s them); never another
  // variant's meta.
  if (!isPositionOgVariant(slug)) return null;
  const copy = positionPageCopy(surface, slug);
  const fen = new URLSearchParams(search).get('fen')?.trim();
  const publicFen = fen ? publicPositionFen(slug, fen) : null;
  if (!fen || !publicFen) return { ...copy, urlPath: pathname };
  return {
    ...copy,
    urlPath: `${pathname}?fen=${encodeURIComponent(fen)}`,
    imagePath: `/og/position/${slug}.png?fen=${encodeURIComponent(publicFen)}&v=${POSITION_OG_IMAGE_VERSION}`,
  };
}

const ARTICLES_INDEX_META: Record<
  'en' | 'zh-hans' | 'zh-hant',
  { title: string; description: string; htmlLang: string }
> = {
  en: {
    title: 'Articles | Mistboard',
    description: 'Long-form writing on original strategy games, rules, and engine research.',
    htmlLang: 'en',
  },
  'zh-hans': {
    title: '文章 | Mistboard',
    description: '原创策略游戏的文章、规则说明与引擎工作。',
    htmlLang: 'zh-Hans',
  },
  'zh-hant': {
    title: '文章 | Mistboard',
    description: '原創策略遊戲的文章、規則說明與引擎工作。',
    htmlLang: 'zh-Hant',
  },
};

const RULES_INDEX_META: Record<
  'en' | 'zh-hans' | 'zh-hant',
  { title: string; description: string; htmlLang: string }
> = {
  en: {
    title: 'Rules | Mistboard',
    description: 'Reference rules for Mistboard games, classic bases, and Fog of War variants.',
    htmlLang: 'en',
  },
  'zh-hans': {
    title: '规则 | Mistboard',
    description: 'Mistboard 游戏、经典基础规则与战争迷雾变体的规则参考。',
    htmlLang: 'zh-Hans',
  },
  'zh-hant': {
    title: '規則 | Mistboard',
    description: 'Mistboard 遊戲、經典基礎規則與戰爭迷霧變體的規則參考。',
    htmlLang: 'zh-Hant',
  },
};

// Articles renamed for cleaner URLs (old slug -> new clean slug). serveArticlePage
// 301s these to the new slug's canonical base so previously-published links and
// crawler-cached URLs don't 404. The rules docs also moved from /articles/<slug>
// to /rules/<slug>, so every legacy rules slug redirects here too.
const RENAMED_ARTICLE_SLUGS: Record<string, string> = {
  'chess-rules-primer': 'chess',
  'xiangqi-rules-primer': 'xiangqi',
  'chess-rules': 'chess',
  'dark-chess-rules': 'fog-chess',
  'xiangqi-rules': 'xiangqi',
  'dark-xiangqi-rules': 'fog-xiangqi',
  'flip-xiangqi': 'banqi',
  'dark-chess': 'fog-chess',
  'dark-xiangqi': 'fog-xiangqi',
  'reveal-xiangqi': 'jieqi',
};

export function injectPageMeta(html: string, meta: PageMeta): string {
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      `$1${escapeHtml(meta.description)}$2`,
    )
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, `$1${escapeHtml(meta.title)}$2`)
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
      `$1${escapeHtml(meta.description)}$2`,
    )
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/, `$1${escapeHtml(meta.url)}$2`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/, `$1${escapeHtml(meta.title)}$2`)
    .replace(
      /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
      `$1${escapeHtml(meta.description)}$2`,
    );
  if (meta.imageUrl) {
    out = out
      .replace(
        /(<meta\s+property="og:image"\s+content=")[^"]*(")/,
        `$1${escapeHtml(meta.imageUrl)}$2`,
      )
      .replace(
        /(<meta\s+name="twitter:image"\s+content=")[^"]*(")/,
        `$1${escapeHtml(meta.imageUrl)}$2`,
      );
  }
  return out;
}

// --- per-route modulepreload hints (issue #31) ---------------------------------
// The SPA shell (dist/index.html) declares only the entry script, so a cold
// navigation to a non-prerendered route loads entry -> route chunk -> data as a
// serial staircase. The web build emits dist/route-preload-manifest.json
// (apps/web/scripts/prerender-articles.mjs): route patterns mapped to the hashed
// chunk + CSS files that route needs, generated from the Vite build manifest so
// the hrefs always point at really-emitted files. When the server serves the
// shell for a known route it injects those links into <head>, collapsing one
// full round-trip layer off the cold-load critical path. Vite's runtime preload
// helper dedupes by href, so nothing double-loads. A missing/older-build
// manifest, an unmatched route, or a malformed file all degrade to the plain
// shell.
type RoutePreloadEntry = { pattern: string; css?: string[]; js?: string[] };

export async function routePreloadLinksForPath(params: {
  staticDir: string;
  pathname: string;
}): Promise<string | null> {
  let routes: RoutePreloadEntry[];
  try {
    const raw = await fs.readFile(
      resolve(params.staticDir, 'route-preload-manifest.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as { routes?: RoutePreloadEntry[] };
    if (!Array.isArray(parsed.routes)) return null;
    routes = parsed.routes;
  } catch {
    return null;
  }
  // Same normalization as isClientRoute, so /watch/ matches ^/watch$.
  const normalized = params.pathname.replace(/\/+$/, '') || '/';
  for (const route of routes) {
    if (typeof route?.pattern !== 'string') continue;
    let matches = false;
    try {
      matches = new RegExp(route.pattern).test(normalized);
    } catch {
      continue; // one bad pattern must not take out the rest
    }
    if (!matches) continue;
    const links = [
      ...(route.css ?? []).map((file) => `<link rel="stylesheet" crossorigin href="/${file}">`),
      ...(route.js ?? []).map((file) => `<link rel="modulepreload" crossorigin href="/${file}">`),
    ];
    return links.length > 0 ? links.join('') : null;
  }
  return null;
}

/** hreflang links for a route that exists at '', '/zh-hans' and '/zh-hant'. */
function localeAlternateLinks(publicHost: string, basePath: string): string {
  return (['en', 'zh-hans', 'zh-hant'] as const)
    .map((slug) => {
      const href = `${publicHost}${slug === 'en' ? '' : `/${slug}`}${basePath}`;
      const hreflang = slug === 'en' ? 'en' : slug === 'zh-hans' ? 'zh-Hans' : 'zh-Hant';
      return `<link rel="alternate" hreflang="${hreflang}" href="${href}">`;
    })
    .join('');
}

// Serves the SPA shell with the matched route's preload hints baked into <head>.
// Returns false without touching the response when the route has no hints (or
// the manifest is absent), so the caller can fall back to the plain static
// shell exactly as before.
async function liveGameMeta(pathname: string): Promise<TenantGamePageMeta | null> {
  if (!persistence.isInitialized()) return null;
  // A bot profile page names its bot the way a finished game names its
  // players (bot-page-meta.ts); both ride the same slot.
  // A broadcast game, round or event (og-broadcast.ts, #454) names its game.
  return (
    (await botPageMeta(pathname)) ??
    (await tenantGamePageMeta(pathname)) ??
    broadcastPageMeta(pathname)
  );
}

export async function serveSpaShellWithRoutePreloads(params: {
  response: ServerResponse;
  staticDir: string;
  pathname: string;
  /** The request's query string ('?…' or ''), read by the position routes. */
  search?: string;
  publicHost?: string;
  /** Override the finished-game meta lookup (tests); the default reads persistence. */
  gameMeta?: (pathname: string) => Promise<TenantGamePageMeta | null>;
}): Promise<boolean> {
  const links = await routePreloadLinksForPath(params);
  // A tenant game page (/<tenant>/game/:id, /room/:id) names a finished game:
  // its own title, description, canonical review URL and card (#368). Needs
  // persistence; without it (or for a live game) the route keeps its generic
  // meta exactly as before.
  const lookupGameMeta = params.gameMeta ?? liveGameMeta;
  const gameMeta = await lookupGameMeta(params.pathname).catch(() => null);
  const positionMeta = gameMeta ?? positionRouteMeta(params.pathname, params.search ?? '');
  // Read separately from routeMeta: that one is a union with the position-route
  // shape, which carries no locale of its own (a FEN is not a language).
  const spaMeta = SPA_ROUTE_META[params.pathname];
  const routeMeta = positionMeta ?? spaMeta;
  const noindex = isNoindexRoute(params.pathname);
  // Any one signal alone is worth serving the shell ourselves: a route can have
  // meta but no preload manifest entry, or vice versa, or neither but still need
  // the robots tag. Only bail when we would add nothing over the plain static
  // file. Leaving noindex out of this condition would silently do nothing for
  // exactly the private routes that have no meta and no preloads.
  if (!links && !routeMeta && !noindex) return false;
  const indexPath = resolve(params.staticDir, 'index.html');
  let html = await fs.readFile(indexPath, 'utf-8');
  if (routeMeta && params.publicHost) {
    html = injectPageMeta(html, {
      title: routeMeta.title,
      description: routeMeta.description,
      url: `${params.publicHost}${positionMeta?.urlPath ?? params.pathname}`,
      imageUrl: positionMeta?.imagePath
        ? `${params.publicHost}${positionMeta.imagePath}`
        : undefined,
    });
  }
  if (spaMeta?.htmlLang) {
    html = html.replace('<html lang="en">', `<html lang="${spaMeta.htmlLang}">`);
  }
  if (spaMeta?.localeGroup && params.publicHost) {
    html = html.replace(
      '</head>',
      `${localeAlternateLinks(params.publicHost, spaMeta.localeGroup)}</head>`,
    );
  }
  if (noindex) {
    html = html.replace('</head>', '<meta name="robots" content="noindex, follow"></head>');
  }
  if (links) html = html.replace('</head>', `${links}</head>`);
  params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
  return true;
}

export async function serveGamePage(params: {
  roomId: string;
  response: ServerResponse;
  publicHost: string;
  staticDir: string;
}): Promise<void> {
  const game = await persistence.getGameSummary(params.roomId);
  const indexPath = resolve(params.staticDir, 'index.html');
  let html = await fs.readFile(indexPath, 'utf-8');

  if (game) {
    const white = gamePageParticipantName(game, 'white');
    const black = gamePageParticipantName(game, 'black');
    const title = `${white} vs ${black} · Fog Chess replay | Mistboard`;
    const description = 'Replay this Fog Chess game from both player views on Mistboard.';
    const url = `${params.publicHost}/game/${encodeURIComponent(params.roomId)}`;
    const imageUrl = `${params.publicHost}/og/game/${encodeURIComponent(params.roomId)}.png?v=${GAME_OG_IMAGE_VERSION}`;
    html = injectPageMeta(html, { title, description, url, imageUrl });
  }

  // /game/:id bypasses the isClientRoute shell path, so bake the route's chunk
  // preloads here too (the replay/board graph is the heaviest cold load).
  const preloadLinks = await routePreloadLinksForPath({
    staticDir: params.staticDir,
    pathname: `/game/${encodeURIComponent(params.roomId)}`,
  });
  if (preloadLinks) html = html.replace('</head>', `${preloadLinks}</head>`);

  params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
}

// /study/:id — a public study gets its own title/description (the study name is
// the content; without this every study serves the generic homepage shell and
// reads as a duplicate to a crawler). Unlisted/private studies get the plain
// shell: their names must not leak into a shared-link preview or the index.
/** URL slug -> the Locale code a study's `i18n` overlay is keyed by. */
const STUDY_LOCALE_BY_SLUG = {
  en: 'en',
  'zh-hans': 'zh-Hans',
  'zh-hant': 'zh-Hant',
} as const;

/** Pick a study's localized string for a locale, falling back to the base
 *  column. Mirrors study-i18n.ts on the client; kept tiny and local rather than
 *  importing web code into the server. */
function localizedStudyField(
  base: string,
  i18n: unknown,
  locale: string,
  field: 'name' | 'description',
): string {
  if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) return base;
  const entry = (i18n as Record<string, unknown>)[locale];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return base;
  const value = (entry as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() ? value : base;
}

export async function serveStudyPage(params: {
  studyId: string;
  /** Present on a chapter permalink (/study/:id/:chapterId). An unknown id falls
   *  back to the study page rather than 404ing: the client resolves chapters too
   *  and a stale link should still land somewhere useful. */
  chapterId?: string;
  localeSlug?: 'en' | 'zh-hans' | 'zh-hant';
  response: ServerResponse;
  publicHost: string;
  staticDir: string;
}): Promise<void> {
  const indexPath = resolve(params.staticDir, 'index.html');
  let html = await fs.readFile(indexPath, 'utf-8');

  const slug = params.localeSlug ?? 'en';
  const localePath = slug === 'en' ? '' : `/${slug}`;
  const locale = STUDY_LOCALE_BY_SLUG[slug];
  const study = await persistence.getStudyById(params.studyId).catch(() => null);
  if (study && study.visibility === 'public') {
    const chapter = params.chapterId
      ? study.chapters.find((c) => c.id === params.chapterId)
      : undefined;
    const pathSuffix = chapter ? `/${encodeURIComponent(chapter.id)}` : '';
    const chapterCount = study.chapters.length;
    const name = localizedStudyField(study.name, study.i18n, locale, 'name');
    const described = localizedStudyField(study.description, study.i18n, locale, 'description');
    const studyMeta = {
      title: `${name} | Mistboard study`,
      description:
        described ||
        `A xiangqi study on Mistboard with ${chapterCount} ${chapterCount === 1 ? 'chapter' : 'chapters'}: annotated moves on an interactive board.`,
    };
    // A chapter permalink carries the CHAPTER's title and prose. Without this,
    // every chapter of a 66-composition study serves the study's own meta and
    // the set reads as near-duplicates.
    const meta = chapter ? chapterPageMeta({ study, chapter, locale }) : studyMeta;
    html = injectPageMeta(html, {
      title: meta.title,
      description: meta.description,
      url: `${params.publicHost}${localePath}/study/${encodeURIComponent(params.studyId)}${pathSuffix}`,
      // The card is the chapter's own starting diagram, so a shared composition
      // previews as that composition. Locale-independent: it is a board.
      imageUrl: `${params.publicHost}/og/study/${encodeURIComponent(params.studyId)}${pathSuffix}.png?v=${STUDY_OG_IMAGE_VERSION}`,
    });
    // hreflang alternates so the locale variants read as one page in three
    // languages rather than three competing near-duplicates.
    const alternates = (['en', 'zh-hans', 'zh-hant'] as const)
      .map((other) => {
        const href = `${params.publicHost}${other === 'en' ? '' : `/${other}`}/study/${encodeURIComponent(params.studyId)}${pathSuffix}`;
        const hreflang = other === 'en' ? 'en' : other === 'zh-hans' ? 'zh-Hans' : 'zh-Hant';
        return `<link rel="alternate" hreflang="${hreflang}" href="${href}">`;
      })
      .join('');
    html = html.replace('</head>', `${alternates}</head>`);
    // oEmbed discovery. A consumer that speaks oEmbed (WordPress, Ghost,
    // Discourse) finds the provider by reading this link off the page someone
    // pasted; without it the endpoint exists but nothing knows to ask. Only on
    // a chapter permalink, because a chapter is the embeddable unit: a whole
    // study is a set, and there is no single board to put in a frame.
    if (chapter) {
      const permalink = `${params.publicHost}/study/${encodeURIComponent(params.studyId)}${pathSuffix}`;
      const discovery =
        `<link rel="alternate" type="application/json+oembed" ` +
        `href="${params.publicHost}/api/oembed?url=${encodeURIComponent(permalink)}" ` +
        `title="Mistboard study chapter">`;
      html = html.replace('</head>', `${discovery}</head>`);
    }
    // Bake the text into the shell so a crawler (and first paint) gets real
    // content instead of an empty #app. mountStudy() replaceChildren()s the root
    // on boot, so this markup never coexists with the client render.
    html = html.replace(
      '<div id="app"></div>',
      `<div id="app">${renderStudyBody({ study, chapter, locale, localePath })}</div>`,
    );
  } else {
    // An unlisted study (or one that is gone) gets none of the above, so the
    // shell keeps the HOME PAGE's title and description and is otherwise
    // indexable. Google had eleven chapters of an unlisted manual in its index
    // that way, all reading "Free Online Chinese Chess (Xiangqi) | Mistboard".
    // Unlisted means anyone with the link, not anyone with a search box: the
    // page still serves, it just stops advertising itself. `follow` because the
    // links on it are ordinary site links.
    html = html.replace('</head>', '<meta name="robots" content="noindex, follow"></head>');
  }

  const preloadLinks = await routePreloadLinksForPath({
    staticDir: params.staticDir,
    pathname: `/study/${encodeURIComponent(params.studyId)}`,
  });
  if (preloadLinks) html = html.replace('</head>', `${preloadLinks}</head>`);

  params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
}

// Serves the SPA shell with a 404 status for an unknown page navigation, so the
// client boots and renders its branded not-found page (nav + panel) instead of
// serve-handler's bare default 404. The status is a real 404 (crawlers must not
// index junk paths as 200); noindex is belt-and-suspenders for the no-JS crawl.
// Missing *assets* never reach here — server-http routes only extensionless page
// navigations to this handler; extensioned paths fall through to serve-handler's
// real asset 404.
export async function serveNotFoundShell(params: {
  response: ServerResponse;
  staticDir: string;
}): Promise<void> {
  const indexPath = resolve(params.staticDir, 'index.html');
  let html = await fs.readFile(indexPath, 'utf-8');
  html = html
    .replace(/<title>[^<]*<\/title>/, '<title>Page not found · Mistboard</title>')
    .replace('</head>', '<meta name="robots" content="noindex, follow"></head>');
  params.response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
}

// 410 for a page that existed and is not coming back (a retired variant's
// rules page): the shell boots and renders the not-found panel, and the
// status tells crawlers to drop the URL instead of retrying a 404.
export async function serveGoneShell(params: {
  response: ServerResponse;
  staticDir: string;
}): Promise<void> {
  const indexPath = resolve(params.staticDir, 'index.html');
  let html = await fs.readFile(indexPath, 'utf-8');
  html = html
    .replace(/<title>[^<]*<\/title>/, '<title>Page retired · Mistboard</title>')
    .replace('</head>', '<meta name="robots" content="noindex, nofollow"></head>');
  params.response.writeHead(410, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
}

function gamePageParticipantName(game: persistence.GameRecord, color: Color): string {
  return (
    game.participants.find((participant) => participant.color === color)?.displayName ??
    (color === 'white' ? game.whiteName : game.blackName) ??
    (color === 'white' ? 'White' : 'Black')
  );
}

// Serves a prerendered page file from dist (home.html for `/`,
// player.html for `/player`, learn-xiangqi.html for `/learn/xiangqi`), so
// crawlers, no-JS clients, and first
// paint get real content instead of the empty SPA shell. Throws when the file
// is absent (e.g. an older build) so the caller can fall back to serving
// index.html (the bare shell), and for the pages that list dated entries
// (home.html, feed.html) once a scheduled post or announcement has gone live
// since the build: the baked page predates it, and the shell renders a
// current one client-side until the next deploy (article-schedule.ts).
const SCHEDULE_DATED_PAGES: ReadonlySet<string> = new Set([
  'home.html',
  'zh-hans-home.html',
  'zh-hant-home.html',
  'feed.html',
]);

export async function servePrerenderedPage(params: {
  response: ServerResponse;
  staticDir: string;
  file:
    | 'home.html'
    | 'zh-hans-home.html'
    | 'zh-hant-home.html'
    | 'leaderboard.html'
    | 'player.html'
    | 'learn-xiangqi.html'
    | 'feed.html'
    | 'changelog.html'
    | 'puzzles.html'
    | 'patron.html';
}): Promise<void> {
  if (
    SCHEDULE_DATED_PAGES.has(params.file) &&
    prerenderedIndexIsStale(await readArticleSchedule(params.staticDir))
  ) {
    throw new Error(`${params.file} predates a scheduled entry that is now live`);
  }
  const html = await fs.readFile(resolve(params.staticDir, params.file), 'utf-8');
  params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
}

// Studies whose chapters are machine-enumerated: a game number or a position
// out of a bulk set, not a thing anyone types into a search box. Their study
// page is still advertised and their chapters still serve, they are just not
// listed one by one.
//
// Measured, not guessed. Over the 90 days to 2026-09-22, Search Console had
// 160 chapter pages earning impressions; the teaching studies carried them
// (basic endgames 38 pages/73 impressions, Every Xiangqi Champion 22/38, and
// the Chinese variants outperformed the English), while these two studies had
// 344 chapter URLs in the sitemap the whole time and earned zero between them.
//
// Add a study here when its chapters are numbered rather than named.
const STUDIES_WITH_ENUMERATED_CHAPTERS: ReadonlySet<string> = new Set([
  '0t8xpyv6', // KataGo-AnimalChess vs MistyJungle: 200 engine games
  'ibFQtGAL', // The most played move is an inaccuracy: 144 opening positions
]);

/** Whether this study's chapters are worth a sitemap entry each. */
export function studyChaptersAreListable(studyId: string): boolean {
  return !STUDIES_WITH_ENUMERATED_CHAPTERS.has(studyId);
}

// Studies whose chapters Search Console shows earning: 10+ chapter impressions
// over the 90 days to 2026-09-18 (docs-private/seo/gsc/gsc-pages.tsv, summed
// per study across the three locales). Every substantial chapter of these is
// listed, commented or not; basic endgames carried 73 impressions and 3 of the
// 4 chapter clicks with barely a comment on a move, which a commentary gate
// alone would have thrown out. Re-read the TSV and redo this list at each GSC
// pull; a study earns its way on, it is not reasoned on.
const STUDIES_WHOSE_CHAPTERS_EARN: ReadonlySet<string> = new Set([
  'tOceiaI7', // Xiangqi basic endgames: 38 pages, 73 impressions, 3 clicks
  'ytSzepET', // Every Xiangqi Champion: 22 pages, 38 impressions
  '3LGIVr59', // The Riverbank Cannon: 27 pages, 28 impressions
  'wd6c7qvG', // Jieqi: eighteen engine games: 15 pages, 21 impressions
  'NUVBVjFf', // Fortress Xiangqi: twenty engine games: 15 pages, 20 impressions
  'EarRoCib', // 11 pages, 20 impressions
  '1pfJeXA1', // Every Xiangqi World Champion: 10 pages, 14 impressions
]);

// Which chapters get a sitemap entry each. Everywhere else a chapter must carry
// commentary on its moves: the classical manuals were listed wholesale on the
// argument that a composition is looked up by its name, and a sample of the
// live pages (2026-09-25) found 74 of 80 listed chapters carrying only a title,
// a move count and a source line, three times over for the locales. The
// unlisted chapters still serve and stay linked from their study page; this
// decides what the site advertises, not what exists.
export function chapterIsListable(
  studyId: string,
  chapter: persistence.StudyChapterRecord,
): boolean {
  if (!studyChaptersAreListable(studyId)) return false;
  if (STUDIES_WHOSE_CHAPTERS_EARN.has(studyId)) return chapterIsSubstantial(chapter);
  return chapterHasMoveCommentary(chapter);
}

// Static, always-on public routes advertised in the sitemap. Every entry
// (except '/', served as the static index itself) must be accepted by the SPA
// fallback allowlist (server-policy.ts isClientRoute) and must not be a
// parked/prod-404 route — server-policy.test.ts holds a conformance test over
// this list so it cannot drift from the routing policy again (it once
// advertised /learn, which prod 404s).
export const SITEMAP_STATIC_ROUTES: readonly string[] = [
  '/',
  '/zh-hans',
  '/zh-hant',
  '/blog',
  '/zh-hans/blog',
  '/zh-hant/blog',
  '/rules',
  '/zh-hans/rules',
  '/zh-hant/rules',
  '/about',
  '/stats',
  '/puzzles',
  '/learn/xiangqi',
  '/zh-hans/learn/xiangqi',
  '/zh-hant/learn/xiangqi',
  '/practice',
  '/analysis',
  '/editor',
  '/study',
  '/games',
  '/games/search',
  '/import',
  '/feed',
  '/videos',
  '/zh-hans/videos',
  '/zh-hant/videos',
  '/bots',
  '/zh-hans/bots',
  '/zh-hant/bots',
  '/streamer',
  '/player',
  '/player/rating-stats',
  '/coach',
  '/forum',
  '/source',
  '/faq',
  '/patron',
  '/contribute',
  '/changelog',
  '/developers',
  '/api-docs',
];

// The sitemap is an index of three sections rather than one list, so Search
// Console and Bing Webmaster report submitted-vs-indexed per section. Measured
// 2026-09-25 over a week of proxy logs: 94% of Googlebot's page fetches went to
// study chapters (98% of a single 6,362-URL sitemap), while 8 of 36 rules URLs
// and 19 of 66 blog URLs were fetched at all. One list could not say which of
// those the index actually kept.
export const SITEMAP_SECTIONS = ['pages', 'studies', 'chapters'] as const;
export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

type SitemapEntry = { path: string; lastmod?: string };

export function sitemapSectionFromPath(pathname: string): SitemapSection | null {
  const match = /^\/sitemap-([a-z]+)\.xml$/.exec(pathname);
  const section = match?.[1];
  return SITEMAP_SECTIONS.find((known) => known === section) ?? null;
}

export function serveSitemapIndex(params: { response: ServerResponse; publicHost: string }): void {
  const body = SITEMAP_SECTIONS.map(
    (section) => `  <sitemap><loc>${params.publicHost}/sitemap-${section}.xml</loc></sitemap>`,
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
  params.response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
  params.response.end(xml);
}

// A prerendered article's last change, from the JSON-LD the prerender bakes in
// (dateModified, else datePublished). Never the file's mtime: every deploy
// rewrites dist, and a lastmod that moves on every deploy teaches a crawler to
// ignore it. dist is immutable for the life of the process, hence the cache.
const articleLastmodCache = new Map<string, string | null>();

async function articleLastmod(file: string): Promise<string | undefined> {
  if (!articleLastmodCache.has(file)) {
    const html = await fs.readFile(file, 'utf-8').catch(() => '');
    const modified = /"dateModified":"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1];
    const published = /"datePublished":"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1];
    articleLastmodCache.set(file, modified ?? published ?? null);
  }
  return articleLastmodCache.get(file) ?? undefined;
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

// Every public study. listTopPublicStudies clamps a page to 50, and the sitemap
// once asked it for 100 in one call: past the fiftieth study the oldest would
// have dropped out of the sitemap one by one, silently, as new ones landed.
async function listEveryPublicStudy(): Promise<persistence.PublicStudySummary[]> {
  const pageSize = 50;
  const seen = new Map<string, persistence.PublicStudySummary>();
  for (let offset = 0; offset < 5_000; offset += pageSize) {
    const page = await persistence.listTopPublicStudies(pageSize, undefined, offset);
    for (const summary of page) seen.set(summary.id, summary);
    if (page.length < pageSize) break;
  }
  return [...seen.values()];
}

// Each study URL is listed once per interface language. serveStudyPage
// already renders a localized name, description and body at the prefixed
// path AND emits hreflang naming all three, so listing only the English URL
// told a crawler the alternates existed and then never pointed at them.
const everyLocale = (path: string): string[] => [path, `/zh-hans${path}`, `/zh-hant${path}`];

async function studySitemapEntries(): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = [];
  for (const summary of await listEveryPublicStudy()) {
    const lastmod = isoDate(summary.updatedAt);
    for (const path of everyLocale(`/study/${encodeURIComponent(summary.id)}`)) {
      entries.push({ path, lastmod });
    }
  }
  return entries;
}

// Chapter permalinks, filtered by chapterIsListable: chapters of studies that
// earn in Search Console, and elsewhere only chapters with commentary on their
// moves. The set grows as annotation lands instead of advertising it early.
async function chapterSitemapEntries(): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = [];
  for (const summary of await listEveryPublicStudy()) {
    if (!studyChaptersAreListable(summary.id)) continue;
    const full = await persistence.getStudyById(summary.id).catch(() => null);
    if (!full) continue;
    const base = `/study/${encodeURIComponent(summary.id)}`;
    for (const chapter of [...full.chapters].sort((a, b) => a.ordinal - b.ordinal)) {
      if (!chapterIsListable(summary.id, chapter)) continue;
      const lastmod = isoDate(chapter.updatedAt);
      for (const path of everyLocale(`${base}/${encodeURIComponent(chapter.id)}`)) {
        entries.push({ path, lastmod });
      }
    }
  }
  return entries;
}

// One section of the sitemap. 'pages' is the static content routes plus every
// pre-rendered article (discovered from dist/blog/*.html, so the published set
// stays the single source of truth in articles-data -> prerender output).
// Public studies are indexable dynamic content (each serves real per-study meta
// AND a server-rendered body via serveStudyPage); absent persistence (in-memory
// dev) the study sections are empty.
export async function serveSitemap(params: {
  response: ServerResponse;
  publicHost: string;
  staticDir: string;
  section: SitemapSection;
}): Promise<void> {
  let entries: SitemapEntry[];
  if (params.section === 'pages') {
    entries = await pageSitemapEntries(params.staticDir);
  } else {
    const load = params.section === 'studies' ? studySitemapEntries : chapterSitemapEntries;
    entries = await load().catch(() => [] as SitemapEntry[]);
  }
  const body = entries
    .map(({ path, lastmod }) => {
      const date = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
      return `  <url><loc>${params.publicHost}${path}</loc>${date}</url>`;
    })
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  params.response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
  params.response.end(xml);
}

async function pageSitemapEntries(staticDir: string): Promise<SitemapEntry[]> {
  // Each article is listed once per pre-rendered language variant (dist/blog,
  // dist/zh-hans/blog, dist/zh-hant/blog), so the published+translated set
  // stays single-sourced in the prerender output.
  const readSlugs = (dir: string): Promise<string[]> =>
    fs
      .readdir(resolve(staticDir, dir))
      .then((files) =>
        files
          .filter((f) => f.endsWith('.html'))
          .map((f) => f.slice(0, -'.html'.length))
          .filter(articleIsIndexable),
      )
      .catch(() => [] as string[]);
  const langDirs: Array<[string, string]> = [
    ['blog', '/blog'],
    ['zh-hans/blog', '/zh-hans/blog'],
    ['zh-hant/blog', '/zh-hant/blog'],
    ['rules', '/rules'],
    ['zh-hans/rules', '/zh-hans/rules'],
    ['zh-hant/rules', '/zh-hant/rules'],
  ];
  const entries: SitemapEntry[] = SITEMAP_STATIC_ROUTES.map((path) => ({ path }));
  for (const [dir, urlBase] of langDirs) {
    for (const slug of await readSlugs(dir)) {
      const lastmod = await articleLastmod(resolve(staticDir, dir, `${slug}.html`));
      entries.push({ path: `${urlBase}/${encodeURIComponent(slug)}`, lastmod });
    }
  }
  return entries;
}

export async function serveArticlePage(params: {
  slug: string;
  // Which URL space the request arrived on. Rules docs are canonical under
  // /rules/<slug>, everything else under /blog/<slug>; a mismatch 301s. The
  // legacy 'articles' base is never canonical, so a request on /articles/<slug>
  // always 301s to its /blog (or /rules) home.
  base: 'blog' | 'rules' | 'articles';
  response: ServerResponse;
  publicHost: string;
  staticDir: string;
  langPrefix?: string;
}): Promise<void> {
  // Resolve any renamed legacy slug, then 301 if the slug was renamed or the URL
  // space doesn't match the article's canonical base (rules vs blog), preserving
  // the language prefix. This single redirect covers legacy /articles/<slug> ->
  // /blog (or /rules), the old *-rules / *-rules-primer slugs, and the reverse
  // /rules/<article> -> /blog/<article>.
  const resolved = RENAMED_ARTICLE_SLUGS[params.slug] ?? params.slug;
  const canonicalBase = canonicalArticleBase(resolved);
  const prefix = params.langPrefix ? `/${params.langPrefix}` : '';
  if (resolved !== params.slug || params.base !== canonicalBase) {
    params.response.writeHead(301, { location: `${prefix}/${canonicalBase}/${resolved}` });
    params.response.end();
    return;
  }

  // A scheduled post (article-schedule.ts) is not public before its moment:
  // no prerendered file exists, and the shell fallback below would hand a
  // crawler a 200 with real meta for a page the client then 404s.
  if (articleIsScheduledAhead(await readArticleSchedule(params.staticDir), params.slug)) {
    await serveNotFoundShell({ response: params.response, staticDir: params.staticDir });
    return;
  }

  // Published articles are pre-rendered at build time (apps/web/scripts/
  // prerender-articles.mjs): prose + meta baked into the document so crawlers
  // and LLMs see real content, not an empty #app. Translated variants live under
  // dist/<lang>/<base>/<slug>.html. Serve the file when present; the client SPA
  // still boots and rebuilds #app on takeover. Slug + lang are charset-validated
  // so a decoded path can't escape the dist root.
  if (
    /^[a-z0-9-]+$/.test(params.slug) &&
    (params.langPrefix === undefined || /^zh-han[st]$/.test(params.langPrefix))
  ) {
    const segments = params.langPrefix
      ? [params.staticDir, params.langPrefix, canonicalBase, `${params.slug}.html`]
      : [params.staticDir, canonicalBase, `${params.slug}.html`];
    const prerendered = await fs.readFile(resolve(...segments), 'utf-8').catch(() => null);
    if (prerendered !== null) {
      params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      params.response.end(prerendered);
      return;
    }

    // A published English prerender with no matching localized file means the
    // translation has not crossed its review gate. Redirect to the complete
    // English article instead of booting the SPA into a mixed-language page.
    // Keep this temporary so a future reviewed translation can claim the URL.
    if (params.langPrefix) {
      const englishPath = resolve(params.staticDir, canonicalBase, `${params.slug}.html`);
      const englishPrerender = await fs.readFile(englishPath, 'utf-8').catch(() => null);
      if (englishPrerender !== null) {
        params.response.writeHead(302, { location: `/${canonicalBase}/${params.slug}` });
        params.response.end();
        return;
      }
    }
  }

  // Fallback for draft/outline articles (not pre-rendered): shell + meta only.
  // Published language-prefixed routes without a reviewed translation redirect
  // above; drafts can still use the shell in development.
  const indexPath = resolve(params.staticDir, 'index.html');
  let html = await fs.readFile(indexPath, 'utf-8');
  const article = ARTICLE_META[params.slug];
  if (article) {
    const url = `${params.publicHost}/${canonicalBase}/${encodeURIComponent(params.slug)}`;
    html = injectPageMeta(html, {
      title: `${article.title} | Mistboard`,
      description: article.description,
      url,
      imageUrl: `${params.publicHost}/og/article/${encodeURIComponent(params.slug)}.png?v=${ARTICLE_OG_IMAGE_VERSION}`,
    });
    if (!articleIsIndexable(params.slug)) {
      html = html.replace('</head>', '<meta name="robots" content="noindex, follow"></head>');
    }
  }
  params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
}

export async function serveArticlesIndexPage(params: {
  response: ServerResponse;
  publicHost: string;
  staticDir: string;
  langPrefix?: string;
  view?: 'community' | 'mistboard';
}): Promise<void> {
  const langKey =
    params.langPrefix === 'zh-hans' || params.langPrefix === 'zh-hant' ? params.langPrefix : 'en';

  // The default-locale post list is prerendered (blog.html). The localized
  // indexes and the community view are not, and stay on the shell below.
  // Once a scheduled post has gone live since the build, blog.html predates
  // it; the shell renders a current list client-side until the next deploy.
  if (
    langKey === 'en' &&
    params.view !== 'community' &&
    !prerenderedIndexIsStale(await readArticleSchedule(params.staticDir))
  ) {
    const prerendered = await fs
      .readFile(resolve(params.staticDir, 'blog.html'), 'utf-8')
      .catch(() => null);
    if (prerendered !== null) {
      params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      params.response.end(prerendered);
      return;
    }
  }

  const indexPath = resolve(params.staticDir, 'index.html');
  let html = await fs.readFile(indexPath, 'utf-8');
  const meta = ARTICLES_INDEX_META[langKey];
  if (langKey !== 'en') {
    html = html.replace('<html lang="en">', `<html lang="${meta.htmlLang}">`);
  }
  html = injectPageMeta(html, {
    title: meta.title,
    description: meta.description,
    url: `${params.publicHost}${langKey === 'en' ? '' : `/${langKey}`}/blog${
      params.view === 'community' ? '/community' : ''
    }`,
  });
  params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
}

export async function serveRulesIndexPage(params: {
  response: ServerResponse;
  publicHost: string;
  staticDir: string;
  langPrefix?: string;
}): Promise<void> {
  const indexPath = resolve(params.staticDir, 'index.html');
  let html = await fs.readFile(indexPath, 'utf-8');
  const langKey =
    params.langPrefix === 'zh-hans' || params.langPrefix === 'zh-hant' ? params.langPrefix : 'en';
  const meta = RULES_INDEX_META[langKey];
  if (langKey !== 'en') {
    html = html.replace('<html lang="en">', `<html lang="${meta.htmlLang}">`);
  }
  html = injectPageMeta(html, {
    title: meta.title,
    description: meta.description,
    url: `${params.publicHost}${langKey === 'en' ? '' : `/${langKey}`}/rules`,
  });
  params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
