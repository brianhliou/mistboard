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
import { botsDirectoryBody } from './bots-page-body.js';
import { type BroadcastPage, liveBroadcastPage } from './broadcast-pages.js';
import { broadcastPageMeta } from './og-broadcast.js';
import { type TenantGamePageMeta, tenantGamePageMeta } from './og-game-tenant.js';
import { articleOgImageUrl, GAME_OG_IMAGE_VERSION, STUDY_OG_IMAGE_VERSION } from './og-image.js';
import {
  isPositionOgVariant,
  POSITION_OG_IMAGE_VERSION,
  type PositionOgVariant,
  positionOgVariantLabel,
  publicPositionFen,
} from './og-position.js';
import * as persistence from './persistence.js';
import {
  cachedPlayers,
  livePlayerPage,
  type PlayerPage,
  playerSitemapEntries,
} from './player-pages.js';
import { puzzleById } from './routes/puzzles.js';
import { isNoindexRoute } from './server-policy.js';
import { broadcastSitemapEntries, listBroadcastRoundDates } from './sitemap-broadcasts.js';
import {
  chapterPageMeta,
  renderStudyBody,
  renderStudyIndexBody,
  STUDY_INDEX_PAGES,
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
  /** An alias route's canonical target (bare /analysis names
   *  /analysis/xiangqi). Only on routes outside a locale group, which name
   *  themselves. */
  canonicalPath?: string;
};

const XIANGQI_ANALYSIS_EN = {
  title: 'Xiangqi Analysis Board | Mistboard',
  description:
    'Analyse xiangqi (Chinese chess) positions with a free engine. Import moves or a FEN, branch variations, review any game. Mistboard variants supported too.',
};

const XIANGQI_EDITOR_EN = {
  title: 'Xiangqi Board Editor | Mistboard',
  description:
    'Set up any xiangqi (Chinese chess) position by hand, get its FEN, and send it to the free analysis board. Mistboard variants supported too.',
};

export const SPA_ROUTE_META: Record<string, SpaRouteMeta> = {
  '/videos': {
    title: 'Xiangqi Video Library | Mistboard',
    description:
      'Curated xiangqi (Chinese chess) videos in English and Chinese: rules, openings, tactics, endgames and commented games. Search by title or author, or by topic.',
    localeGroup: '/videos',
  },
  '/zh-hans/videos': {
    title: '象棋视频库：规则、开局与残局 | Mistboard',
    description:
      '精心挑选的中文与英文象棋（中国象棋）视频，内容涵盖规则、开局、战术、残局和讲解对局。可以按标题或作者搜索，也可以按主题筛选。',
    htmlLang: 'zh-Hans',
    localeGroup: '/videos',
  },
  '/zh-hant/videos': {
    title: '象棋影片庫：規則、開局與殘局 | Mistboard',
    description:
      '精心挑選的中文與英文象棋（中國象棋）影片，內容涵蓋規則、開局、戰術、殘局和講解對局。可以按標題或作者搜尋，也可以按主題篩選。',
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
      '和电脑下象棋：八个难度等级，从入门一直到很强，最高一级的对手是皮卡鱼。免费网页版，直接在浏览器里下，无需下载，也无需注册账号。',
    htmlLang: 'zh-Hans',
    localeGroup: '/bots',
  },
  '/zh-hant/bots': {
    title: '象棋人機對戰 · 八個等級與皮卡魚 | Mistboard',
    description:
      '和電腦下象棋：八個難度等級，從入門一直到很強，最高一級的對手是皮卡魚。免費網頁版，直接在瀏覽器裡下，無需下載，也無需註冊帳號。',
    htmlLang: 'zh-Hant',
    localeGroup: '/bots',
  },
  '/about': {
    title: 'About Mistboard | Chinese Chess and the Future of Strategy Games',
    description:
      'Bringing people together across cultures through Chinese chess and original strategy games. Free, open-source play, study, broadcasts and engine challenges.',
  },
  '/faq': {
    title: 'Frequently Asked Questions | Mistboard',
    description:
      'Which games are hosted, whether you need an account, how rated play and cheat prevention work, and where the game library comes from.',
  },
  '/developers': {
    title: 'Developers: Embeds and API | Mistboard',
    description:
      'Embed a xiangqi board with engine annotations in your own page. A public study chapter runs in an iframe with no API key, and Mistboard is an oEmbed provider.',
  },
  '/api-docs': {
    title: 'Public Read API Reference | Mistboard',
    description:
      'The public read API behind mistboard.com: games, watch feeds, puzzles, studies, ratings, the xiangqi opening explorer and the forum, as an OpenAPI 3.1 document.',
  },
  '/forum': {
    title: 'Community Forum | Mistboard',
    description:
      'The Mistboard community forum: talk about xiangqi and the other games, post a game for analysis, give feedback on the site, or chat about anything else.',
  },
  '/coach': {
    title: 'Xiangqi Coaches | Mistboard',
    description:
      'Find a xiangqi (Chinese chess) or chess coach to study with. Every coach listed holds a verified title, with their languages, rate and how to reach them.',
  },
  '/streamer': {
    title: 'Xiangqi Streamers | Mistboard',
    description:
      'Chinese chess (xiangqi) and variant streamers to watch live and on demand on Twitch and YouTube, with the language each streams in and a link to their channel.',
  },
  '/player': {
    title: 'Xiangqi Leaderboard | Mistboard',
    description:
      'The highest rated players on Mistboard, by game and time control. Rated games are played between signed-in accounts in xiangqi, jieqi, banqi, Jungle and more.',
  },
  '/player/rating-stats': {
    title: 'Rating Distribution | Mistboard',
    description:
      'How Mistboard ratings are spread across each rated game, with player counts and averages. Ratings use Glicko-2 and count rated games between signed-in players.',
  },
  '/patron': {
    title: 'Become a Patron | Mistboard',
    description:
      'Mistboard is independent and ad-free. Core play and learning stay free. Patron is an optional monthly subscription with a profile badge.',
  },
  '/source': {
    title: 'Open Source Code | Mistboard',
    description:
      'Mistboard is an independent open-source project, published under AGPL-3.0-or-later. Browse the repository and the license.',
  },
  '/contribute': {
    title: 'How to Contribute | Mistboard',
    description:
      'Help build a future for Chinese chess and original strategy games. Contribute as a player, teacher, translator, game creator or engine author.',
  },
  '/creators': {
    title: 'Work With Us: Creators and Players | Mistboard',
    description:
      'Bring Chinese chess to a world stage with Mistboard. Work with us on teaching, broadcasts, original games and engine challenges across languages.',
  },
  // One reigning champion engine per game, moved from
  // brianhliou.com/challenges/ (and its zh copies) on 2026-10-07; /challenges
  // 301s here. Locale-prefixed like /bots.
  '/champions': {
    title: 'Engine Champions | Mistboard',
    description:
      'The reigning champion engine for jieqi, banqi, Jungle Chess and Flip Jungle: the bot you play on Mistboard, the title history, and how any engine can challenge for the title in a public match.',
    localeGroup: '/champions',
  },
  '/zh-hans/champions': {
    title: '引擎冠军与挑战赛 | Mistboard',
    description:
      '揭棋、暗棋、斗兽棋和翻翻棋的现任冠军引擎：就是你在 Mistboard 上对弈的机器人，附头衔历史，以及任何引擎如何在公开对抗赛中挑战头衔。',
    htmlLang: 'zh-Hans',
    localeGroup: '/champions',
  },
  '/zh-hant/champions': {
    title: '引擎冠軍與挑戰賽 | Mistboard',
    description:
      '揭棋、暗棋、鬥獸棋和翻翻棋的現任冠軍引擎：就是你在 Mistboard 上對弈的機器人，附頭銜歷史，以及任何引擎如何在公開對抗賽中挑戰頭銜。',
    htmlLang: 'zh-Hant',
    localeGroup: '/champions',
  },
  '/changelog': {
    title: 'Changelog: Every Change, Month by Month | Mistboard',
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
    title: '学下象棋：免费互动入门课程 | Mistboard',
    description:
      '免费的互动象棋入门课程，边玩边学：从七种棋子的走法和摆棋开始，再学吃子、保护、将军、应将、将死、困毙和长将等规则与基本战术。',
    htmlLang: 'zh-Hans',
    localeGroup: '/learn/xiangqi',
  },
  '/zh-hant/learn/xiangqi': {
    title: '學下象棋：免費互動入門課程 | Mistboard',
    description:
      '免費的互動象棋入門課程，邊玩邊學：從七種棋子的走法和擺棋開始，再學吃子、保護、將軍、應將、將死、困斃和長將等規則與基本戰術。',
    htmlLang: 'zh-Hant',
    localeGroup: '/learn/xiangqi',
  },
  // The xiangqi analysis board and editor, in three languages (象棋AI and
  // 摆残局 are Chinese search terms; until 2026-10-15 both pages had one English
  // URL). /analysis/xiangqi is the page the nav links; bare /analysis opens
  // the same board and names it as canonical rather than competing with it.
  '/analysis': { ...XIANGQI_ANALYSIS_EN, canonicalPath: '/analysis/xiangqi' },
  '/analysis/xiangqi': { ...XIANGQI_ANALYSIS_EN, localeGroup: '/analysis/xiangqi' },
  '/zh-hans/analysis/xiangqi': {
    title: '象棋AI分析 · 皮卡鱼引擎免费分析棋盘 | Mistboard',
    description:
      '免费的象棋AI分析棋盘：在浏览器里用皮卡鱼引擎分析任意局面。可以粘贴棋谱或 FEN 导入，摆出变着分支，复盘任何一盘对局。无需下载，也无需注册账号。',
    htmlLang: 'zh-Hans',
    localeGroup: '/analysis/xiangqi',
  },
  '/zh-hant/analysis/xiangqi': {
    title: '象棋AI分析 · 皮卡魚引擎免費分析棋盤 | Mistboard',
    description:
      '免費的象棋AI分析棋盤：在瀏覽器裡用皮卡魚引擎分析任意局面。可以貼上棋譜或 FEN 匯入，擺出變著分支，復盤任何一盤對局。無需下載，也無需註冊帳號。',
    htmlLang: 'zh-Hant',
    localeGroup: '/analysis/xiangqi',
  },
  '/editor': { ...XIANGQI_EDITOR_EN, canonicalPath: '/editor/xiangqi' },
  '/editor/xiangqi': { ...XIANGQI_EDITOR_EN, localeGroup: '/editor/xiangqi' },
  '/zh-hans/editor/xiangqi': {
    title: '象棋摆残局 · 免费棋盘编辑器 | Mistboard',
    description:
      '在棋盘编辑器里摆出任意象棋局面或残局：逐个放置棋子，设定走棋方，实时得到局面的 FEN，再一键送到分析棋盘让引擎分析，或者从这个局面开始和电脑对练。免费，无需注册。',
    htmlLang: 'zh-Hans',
    localeGroup: '/editor/xiangqi',
  },
  '/zh-hant/editor/xiangqi': {
    title: '象棋擺殘局 · 免費棋盤編輯器 | Mistboard',
    description:
      '在棋盤編輯器裡擺出任意象棋局面或殘局：逐個放置棋子，設定走棋方，即時得到局面的 FEN，再一鍵送到分析棋盤讓引擎分析，或者從這個局面開始和電腦對練。免費，無需註冊。',
    htmlLang: 'zh-Hant',
    localeGroup: '/editor/xiangqi',
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
    localeGroup: '/practice',
  },
  '/zh-hans/practice': {
    title: '象棋残局练习：与电脑对练 | Mistboard',
    description:
      '和电脑练习象棋残局：每个局面都设定一个目标，比如将死对方或守和若干回合，电脑负责防守，一旦你把胜势丢掉，它会马上提示你。',
    htmlLang: 'zh-Hans',
    localeGroup: '/practice',
  },
  '/zh-hant/practice': {
    title: '象棋殘局練習：與電腦對練 | Mistboard',
    description:
      '和電腦練習象棋殘局：每個局面都設定一個目標，比如將死對方或守和若干回合，電腦負責防守，一旦你把勝勢丟掉，它會馬上提示你。',
    htmlLang: 'zh-Hant',
    localeGroup: '/practice',
  },
  // The study list in three languages; the zh lists were added 2026-10-17
  // (each study already had its /zh-hans/study/:id page, but no list linked them).
  '/study': {
    title: 'Xiangqi Studies | Mistboard',
    description:
      'Browse public xiangqi (Chinese chess) studies: annotated games, classical endgame compositions, and opening lines on an interactive board.',
    localeGroup: '/study',
  },
  '/zh-hans/study': {
    title: '象棋研习：带注解对局与古典排局 | Mistboard',
    description:
      '浏览公开的象棋（中国象棋）及其变体研习：带注解的对局、古典残局排局、开局变着和题目，全部在互动棋盘上呈现，并附有完整着法与评注。',
    htmlLang: 'zh-Hans',
    localeGroup: '/study',
  },
  '/zh-hant/study': {
    title: '象棋研習：帶註解對局與古典排局 | Mistboard',
    description:
      '瀏覽公開的象棋（中國象棋）及其變體研習：帶註解的對局、古典殘局排局、開局變著和題目，全部在互動棋盤上呈現，並附有完整著法與評註。',
    htmlLang: 'zh-Hant',
    localeGroup: '/study',
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
      'Search and browse xiangqi (Chinese chess) and variant games: tournament archives, live broadcasts, engine matches, and games played on Mistboard. Filter by variant, player, event, result, date, or length.',
  },
  '/data': {
    title: 'Game Data Downloads | Mistboard',
    description:
      'Download every finished game played on Mistboard, one file per variant per month, as JSON lines and PGN under CC BY 4.0: xiangqi, Fog Chess, Jungle and more, plus engine match collections.',
  },
  '/data/about': {
    title: 'About the Game Data | Mistboard',
    description:
      'What the Mistboard monthly game files hold: the JSONL and PGN formats field by field, the CC BY 4.0 license, which games are included, and how fog and face-down pieces appear.',
  },
  '/import': {
    title: 'Import a Xiangqi Game | Mistboard',
    description:
      'Paste a xiangqi (Chinese chess) game and get a browsable board with free engine analysis. Reads PGN, WXF, Chinese notation, ICCS coordinates, and dpxq records.',
  },
  '/stats': {
    title: 'Site Statistics | Mistboard',
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
// The xiangqi boards also answer under /zh-hans and /zh-hant (and only they:
// the other variants have one English URL each).
const POSITION_ROUTE = /^(?:\/(zh-hans|zh-hant))?\/(analysis|editor)(?:\/([a-z0-9-]+))?$/;

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
  localePrefix: '' | '/zh-hans' | '/zh-hant',
): { title: string; description: string } {
  // The flagship's copy is its route entry, in the locale of the URL.
  if (variant === 'xiangqi') return SPA_ROUTE_META[`${localePrefix}/${surface}/xiangqi`]!;
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
  const localePrefix: '' | '/zh-hans' | '/zh-hant' =
    match[1] === 'zh-hans' ? '/zh-hans' : match[1] === 'zh-hant' ? '/zh-hant' : '';
  const surface = match[2] as 'analysis' | 'editor';
  const slug = match[3] ?? 'xiangqi';
  // Unknown slugs get the plain shell (the client 404s them); never another
  // variant's meta.
  if (!isPositionOgVariant(slug)) return null;
  // A locale prefix is a route only on the spelled-out xiangqi board.
  if (localePrefix && match[3] !== 'xiangqi') return null;
  const copy = positionPageCopy(surface, slug, localePrefix);
  const fen = new URLSearchParams(search).get('fen')?.trim();
  const publicFen = fen ? publicPositionFen(slug, fen) : null;
  if (!fen || !publicFen) return { ...copy, urlPath: pathname };
  return {
    ...copy,
    urlPath: `${pathname}?fen=${encodeURIComponent(fen)}`,
    imagePath: `/og/position/${slug}.png?fen=${encodeURIComponent(publicFen)}&v=${POSITION_OG_IMAGE_VERSION}`,
  };
}

export const ARTICLES_INDEX_META: Record<
  'en' | 'zh-hans' | 'zh-hant',
  { title: string; description: string; htmlLang: string }
> = {
  en: {
    title: 'Xiangqi and Variant Articles | Mistboard',
    description:
      'Long-form articles on xiangqi (Chinese chess) and its variants: rules explained, champions and players, engine research, puzzles, and how Mistboard is built.',
    htmlLang: 'en',
  },
  'zh-hans': {
    title: '象棋与变体文章 | Mistboard',
    description:
      '关于象棋（中国象棋）及其变体的长文：规则详解、历届冠军与棋手、引擎研究、残局题目，以及 Mistboard 是怎样做出来的。',
    htmlLang: 'zh-Hans',
  },
  'zh-hant': {
    title: '象棋與變體文章 | Mistboard',
    description:
      '關於象棋（中國象棋）及其變體的長文：規則詳解、歷屆冠軍與棋手、引擎研究、殘局題目，以及 Mistboard 是怎樣做出來的。',
    htmlLang: 'zh-Hant',
  },
};

export const RULES_INDEX_META: Record<
  'en' | 'zh-hans' | 'zh-hant',
  { title: string; description: string; htmlLang: string }
> = {
  en: {
    title: 'Xiangqi and Variant Rules | Mistboard',
    description:
      'Full rules for every game on Mistboard: xiangqi (Chinese chess), jieqi, banqi, Jungle and chess, plus Fog of War, Duck Xiangqi and other xiangqi variants.',
    htmlLang: 'en',
  },
  'zh-hans': {
    title: '象棋与变体规则 | Mistboard',
    description:
      'Mistboard 上每一种棋的完整规则：象棋（中国象棋）、揭棋、暗棋、斗兽棋和国际象棋，以及迷雾、鸭子等各种象棋变体。',
    htmlLang: 'zh-Hans',
  },
  'zh-hant': {
    title: '象棋與變體規則 | Mistboard',
    description:
      'Mistboard 上每一種棋的完整規則：象棋（中國象棋）、揭棋、暗棋、鬥獸棋和國際象棋，以及迷霧、鴨子等各種象棋變體。',
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
  // Retitled from the launch post to a strategy guide on 2026-09-25.
  'duck-xiangqi-build': 'duck-xiangqi-strategy',
};

const ROBOTS_META = /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/;

/** Sets the page's one robots tag. The shell carries `max-image-preview:large`
 *  for indexable pages; a noindex page REPLACES that tag rather than adding a
 *  second one, because crawlers merge every robots tag they find and two tags
 *  is a page whose directives nobody wrote down in one place. */
export function setRobotsMeta(html: string, content: string): string {
  const tag = `<meta name="robots" content="${content}">`;
  return ROBOTS_META.test(html)
    ? html.replace(ROBOTS_META, tag)
    : html.replace('</head>', `${tag}</head>`);
}

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

// Routes whose query string picks what the page shows but not which page it is:
// /watch?channel=…&game=… is the one watch page tuned to a channel or game, and
// each combination crawled as its own URL (SEO backlog D8). They canonicalise to
// the bare path.
const QUERY_FREE_CANONICAL_ROUTES: ReadonlySet<string> = new Set(['/watch', '/games']);

// Client routes whose list is live (it changes by the minute, so nothing in it
// is worth baking) but whose page still needs a heading and its links for a
// crawler that does not run the bundle. The client clears the root on mount.
const STATIC_ROUTE_BODIES: Readonly<Record<string, string>> = {
  '/games':
    '<main><h1>Current games</h1><p>Every xiangqi (Chinese chess) and variant game in progress on Mistboard right now: live games with clocks, and correspondence games waiting on a move.</p><ul><li><a href="/watch">Watch live games</a></li><li><a href="/games/search">Search finished games</a></li><li><a href="/broadcast/xiangqi">Xiangqi tournament broadcasts</a></li><li><a href="/">Play a game</a></li></ul></main>',
};

// A puzzle deep link (/puzzles/:idOrShortCode) is its own page, and served
// with no canonical until 2026-10-17, so each ?utm= or share-tracking copy
// read to a crawler as another URL for it.
const QUERY_FREE_CANONICAL_PATTERNS: readonly RegExp[] = [/^\/puzzles\/[^/]+$/];

const PUZZLE_DEEP_LINK = /^\/puzzles\/([^/]+)$/;

// /puzzles/:idOrShortCode reaches one puzzle by its full id or by its short
// code (Puzzle #bMpKA), so the query-free path alone left two self canonicals
// per puzzle. Both name the full-id URL: the form the client pushes and the
// short-code link in the info card points at (puzzles.ts, queue-panel.ts).
// An unknown puzzle, or a lookup that throws, keeps the query-free path.
async function puzzleCanonicalPath(
  canonicalPath: string | null,
  lookupPuzzleId: (idOrShortCode: string) => Promise<string | null>,
): Promise<string | null> {
  const match = canonicalPath ? PUZZLE_DEEP_LINK.exec(canonicalPath) : null;
  if (!match) return canonicalPath;
  let idOrShortCode: string;
  try {
    idOrShortCode = decodeURIComponent(match[1]!);
  } catch {
    return canonicalPath;
  }
  const id = await lookupPuzzleId(idOrShortCode).catch(() => null);
  return id ? `/puzzles/${encodeURIComponent(id)}` : canonicalPath;
}

async function livePuzzleId(idOrShortCode: string): Promise<string | null> {
  return (await puzzleById(idOrShortCode))?.id ?? null;
}

function queryFreeCanonicalPath(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return QUERY_FREE_CANONICAL_ROUTES.has(normalized) ||
    QUERY_FREE_CANONICAL_PATTERNS.some((pattern) => pattern.test(normalized))
    ? normalized
    : null;
}

/** hreflang links for a route that exists at '', '/zh-hans' and '/zh-hant',
 *  with the English URL as x-default (the page for a reader whose language is
 *  none of the three), as the prerendered blog and rules pages do. */
function localeAlternateLinks(publicHost: string, basePath: string): string {
  const links = (['en', 'zh-hans', 'zh-hant'] as const).map((slug) => {
    const href = `${publicHost}${slug === 'en' ? '' : `/${slug}`}${basePath}`;
    const hreflang = slug === 'en' ? 'en' : slug === 'zh-hans' ? 'zh-Hans' : 'zh-Hant';
    return `<link rel="alternate" hreflang="${hreflang}" href="${href}">`;
  });
  links.push(`<link rel="alternate" hreflang="x-default" href="${publicHost}${basePath}">`);
  return links.join('');
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

// Text the server writes into #app for a crawler that runs no script (/players,
// /bots, /study/:id). It is plain markup with none of the page's classes, and
// the client replaces it on mount, so painted it read as a bare text page that
// then snapped into the real one (Brian, 2026-10-17, on /players). The wrapper
// keeps it in the HTML but out of the first paint (app-base.css); the reveal
// after a few seconds covers a script that never runs.
export function crawlerCopyRoot(body: string): string {
  return `<div id="app"><div class="crawler-copy">${body}</div></div>`;
}

export async function serveSpaShellWithRoutePreloads(params: {
  response: ServerResponse;
  staticDir: string;
  pathname: string;
  /** The request's query string ('?…' or ''), read by the position routes. */
  search?: string;
  publicHost?: string;
  /** Override the study list's public studies (tests); the default is the
   *  sitemap's own read, so the list page and sitemap-studies.xml agree. */
  listPublicStudies?: () => Promise<persistence.PublicStudySummary[]>;
  /** Override the finished-game meta lookup (tests); the default reads persistence. */
  gameMeta?: (pathname: string) => Promise<TenantGamePageMeta | null>;
  /** Override the server-rendered route body (tests); the default reads persistence. */
  routeBody?: (pathname: string) => Promise<string | null>;
  /** Override the player-page lookup (tests); the default reads persistence. */
  playerPage?: (pathname: string) => Promise<PlayerPage | null>;
  /** Override the broadcast-page lookup (tests); the default reads persistence. */
  broadcastPage?: (pathname: string) => Promise<BroadcastPage | null>;
  /** Override the puzzle id-or-short-code lookup (tests); the default is the
   *  one /api/puzzles/:id uses. */
  puzzleId?: (idOrShortCode: string) => Promise<string | null>;
}): Promise<boolean> {
  const links = await routePreloadLinksForPath(params);
  // A player, team or the players index (#458, player-pages.ts): its own meta,
  // a canonical link and a crawler body, from one read of the archive. A name
  // the archive does not know keeps the generic meta and is kept out of the
  // index, the way an unlisted study is.
  const playerPage = await (
    params.playerPage ?? ((pathname: string) => livePlayerPage(pathname, params.staticDir))
  )(params.pathname).catch(() => null);
  // A broadcast index, event, round or game (broadcast-pages.ts) rides the same
  // slot: before 2026-10-17 all 195 sitemap-broadcasts URLs served an empty
  // #app with no canonical, and Google folded them as duplicates.
  const player =
    playerPage ??
    (await (params.broadcastPage ?? liveBroadcastPage)(params.pathname).catch(() => null));
  // A tenant game page (/<tenant>/game/:id, /room/:id) names a finished game:
  // its own title, description, canonical review URL and card (#368). Needs
  // persistence; without it (or for a live game) the route keeps its generic
  // meta exactly as before.
  const lookupGameMeta = params.gameMeta ?? liveGameMeta;
  const gameMeta = player?.meta ? null : await lookupGameMeta(params.pathname).catch(() => null);
  const positionMeta =
    player?.meta ?? gameMeta ?? positionRouteMeta(params.pathname, params.search ?? '');
  // Read separately from routeMeta: that one is a union with the position-route
  // shape, which carries no locale of its own (a FEN is not a language).
  const spaMeta = SPA_ROUTE_META[params.pathname];
  const routeMeta = positionMeta ?? spaMeta;
  const noindex = isNoindexRoute(params.pathname) || player?.noindex === true;
  const canonicalPath = await puzzleCanonicalPath(
    queryFreeCanonicalPath(params.pathname),
    params.puzzleId ?? livePuzzleId,
  );
  // Any one signal alone is worth serving the shell ourselves: a route can have
  // meta but no preload manifest entry, or vice versa, or neither but still need
  // the robots tag. Only bail when we would add nothing over the plain static
  // file. Leaving noindex out of this condition would silently do nothing for
  // exactly the private routes that have no meta and no preloads.
  if (!links && !routeMeta && !noindex && !canonicalPath) return false;
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
    // A self canonical beside the alternates: each member of the group is its
    // own page, and hreflang without a canonical left a crawler to pick which
    // URL (query-string or trailing-slash copies included) each one is. Until
    // 2026-10-02 the zh videos, bots and course URLs had alternates only.
    html = html.replace(
      '</head>',
      `<link rel="canonical" href="${params.publicHost}${params.pathname}">` +
        `${localeAlternateLinks(params.publicHost, spaMeta.localeGroup)}</head>`,
    );
  } else if (spaMeta?.canonicalPath && params.publicHost) {
    html = html.replace(
      '</head>',
      `<link rel="canonical" href="${params.publicHost}${spaMeta.canonicalPath}"></head>`,
    );
  }
  if (player?.meta && params.publicHost) {
    html = html.replace(
      '</head>',
      `<link rel="canonical" href="${escapeHtml(`${params.publicHost}${player.meta.urlPath}`)}"></head>`,
    );
  }
  if (canonicalPath && params.publicHost && !player?.meta) {
    html = html.replace(
      '</head>',
      `<link rel="canonical" href="${params.publicHost}${canonicalPath}"></head>`,
    );
  }
  // The study list, in each locale: its locale group above writes the self
  // canonical with no query (?tab= and ?q= pick a view of the one list) and the
  // alternates; the body links every study sitemap-studies.xml lists.
  const studyIndexPage = STUDY_INDEX_PAGES[params.pathname];
  if (studyIndexPage) {
    const studies = await (params.listPublicStudies ?? listEveryPublicStudy)().catch(() => []);
    html = html.replace(
      '<div id="app"></div>',
      crawlerCopyRoot(renderStudyIndexBody(studies, studyIndexPage)),
    );
  }
  if (noindex) {
    html = setRobotsMeta(html, 'noindex, follow');
  }
  if (links) html = html.replace('</head>', `${links}</head>`);
  // A client route that exists to answer a search (/bots) also carries its text
  // in the HTML, for a crawler that does not run the bundle. The client clears
  // the root on mount, so the two never show together.
  const body =
    player?.body ??
    STATIC_ROUTE_BODIES[params.pathname.replace(/\/+$/, '') || '/'] ??
    (await (params.routeBody ?? botsDirectoryBody)(params.pathname).catch(() => null));
  if (body) html = html.replace('<div id="app"></div>', crawlerCopyRoot(body));
  params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
  return true;
}

export async function serveGamePage(params: {
  roomId: string;
  response: ServerResponse;
  publicHost: string;
  staticDir: string;
  /** Override the game lookup (tests); the default reads persistence. */
  getGame?: (roomId: string) => Promise<persistence.RecentEveGameRecord | null>;
}): Promise<void> {
  const game = await (params.getGame ?? persistence.getGameSummary)(params.roomId);
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
  // Every bare /game/:id is a Fog Chess replay, and most of them are the
  // site's own testing games under one repeated title; they served indexable
  // (SEO backlog D8, 2026-09-17 Search Console read). The page still serves and
  // still previews when shared. Tenant games live at /<variant>/game/:id and go
  // through serveSpaShellWithRoutePreloads, which noindexes them the same way
  // since 2026-10-17 (isNoindexRoute).
  html = setRobotsMeta(html, 'noindex, follow');

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
  /** Override the study lookup (tests); the default reads persistence. */
  getStudy?: (studyId: string) => Promise<persistence.StudyWithChapters | null>;
}): Promise<void> {
  const indexPath = resolve(params.staticDir, 'index.html');
  let html = await fs.readFile(indexPath, 'utf-8');

  const slug = params.localeSlug ?? 'en';
  const localePath = slug === 'en' ? '' : `/${slug}`;
  const locale = STUDY_LOCALE_BY_SLUG[slug];
  // The served language follows the prefix, published or not: /zh-hans/study/:id
  // said lang="en" until 2026-10-15, to crawlers and screen readers alike.
  if (locale !== 'en') html = html.replace('<html lang="en">', `<html lang="${locale}">`);
  const study = await (params.getStudy ?? persistence.getStudyById)(params.studyId).catch(
    () => null,
  );
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
    const studyPath = `/study/${encodeURIComponent(params.studyId)}`;
    if (chapter) {
      // A chapter is about forty server-rendered words on the study's shell,
      // and Google folded them as duplicates without a canonical (SEO backlog
      // D8: 1,373 of 1,492 sitemap URLs were chapters). Each one names its
      // study, in the same locale, as the page to index; the chapter still
      // serves, links and previews as itself. Reversible on purpose: no
      // noindex, so a chapter that earns on its own can be given back its own
      // canonical. hreflang stays on the study root only, since alternates of
      // a page that canonicalises elsewhere would contradict it.
      html = html.replace(
        '</head>',
        `<link rel="canonical" href="${params.publicHost}${localePath}${studyPath}"></head>`,
      );
    } else {
      // A self canonical plus hreflang alternates, so the locale variants read
      // as one page in three languages rather than three competing
      // near-duplicates. The root had alternates and no canonical until
      // 2026-10-15, which left a crawler to pick between query-string copies.
      html = html.replace(
        '</head>',
        `<link rel="canonical" href="${params.publicHost}${localePath}${studyPath}">` +
          `${localeAlternateLinks(params.publicHost, studyPath)}</head>`,
      );
    }
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
    // Bake the text into the shell so a crawler gets real content instead of
    // an empty #app. mountStudy() replaceChildren()s the root
    // on boot, so this markup never coexists with the client render.
    html = html.replace(
      '<div id="app"></div>',
      crawlerCopyRoot(renderStudyBody({ study, chapter, locale, localePath })),
    );
  } else {
    // An unlisted study (or one that is gone) gets none of the above, so the
    // shell keeps the HOME PAGE's title and description and is otherwise
    // indexable. Google had eleven chapters of an unlisted manual in its index
    // that way, all reading "Free Online Chinese Chess (Xiangqi) | Mistboard".
    // Unlisted means anyone with the link, not anyone with a search box: the
    // page still serves, it just stops advertising itself. `follow` because the
    // links on it are ordinary site links.
    html = setRobotsMeta(html, 'noindex, follow');
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
  html = setRobotsMeta(
    html.replace(/<title>[^<]*<\/title>/, '<title>Page not found · Mistboard</title>'),
    'noindex, follow',
  );
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
  html = setRobotsMeta(
    html.replace(/<title>[^<]*<\/title>/, '<title>Page retired · Mistboard</title>'),
    'noindex, nofollow',
  );
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
// index.html (the bare shell), and for the feed once a scheduled post or
// announcement has gone live since the build: the baked list predates it, and
// the shell renders a current one client-side until the next deploy
// (article-schedule.ts).
//
// The three home pages are not on the list (2026-10-03). Their only dated part
// is the News box, which the client redraws current anyway, and the shell they
// used to fall back to is the English one: /zh-hans answered with an English
// title, lang="en" and no content from 09:00 PT on any announcement day until
// the next release, while it ranks on Bing for 象棋在线. One stale News line
// in the baked page is the better trade.
const SCHEDULE_DATED_PAGES: ReadonlySet<string> = new Set(['feed.html']);

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
    | `feed-${string}.html`
    | 'changelog.html'
    | `changelog-${string}.html`
    | 'puzzles.html'
    | 'patron.html';
}): Promise<void> {
  if (
    (SCHEDULE_DATED_PAGES.has(params.file) || params.file.startsWith('feed-')) &&
    prerenderedIndexIsStale(await readArticleSchedule(params.staticDir))
  ) {
    throw new Error(`${params.file} predates a scheduled entry that is now live`);
  }
  const html = await fs.readFile(resolve(params.staticDir, params.file), 'utf-8');
  params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
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
  '/zh-hans/practice',
  '/zh-hant/practice',
  '/analysis/xiangqi',
  '/zh-hans/analysis/xiangqi',
  '/zh-hant/analysis/xiangqi',
  '/editor/xiangqi',
  '/zh-hans/editor/xiangqi',
  '/zh-hant/editor/xiangqi',
  '/study',
  '/zh-hans/study',
  '/zh-hant/study',
  '/games',
  '/games/search',
  '/data',
  '/data/about',
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
  '/creators',
  '/champions',
  '/zh-hans/champions',
  '/zh-hant/champions',
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
// Players and broadcasts (#458) are their own sections for the same reason:
// they are dynamic pages dated from their latest game, and the index should
// report on them apart from the hand-listed routes.
//
// Study chapters had a section of their own until SEO backlog D8 (2026-10-01):
// 1,373 of the sitemap's 1,492 URLs, each about forty words on the study's
// shell, mostly folded as duplicates. A chapter now canonicalises to its study
// (serveStudyPage) and only the study roots are listed. The per-study chapter
// selection that section used is in git history if a chapter set earns its way
// back.
export const SITEMAP_SECTIONS = ['pages', 'studies', 'players', 'broadcasts'] as const;
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
    const loaders: Record<Exclude<SitemapSection, 'pages'>, () => Promise<SitemapEntry[]>> = {
      studies: studySitemapEntries,
      players: playerSectionEntries,
      broadcasts: broadcastSectionEntries,
    };
    entries = await loaders[params.section]().catch(() => [] as SitemapEntry[]);
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

// Absent persistence (in-memory dev) there is no archive and both are empty.
async function playerSectionEntries(): Promise<SitemapEntry[]> {
  if (!persistence.isInitialized()) return [];
  return playerSitemapEntries(await cachedPlayers());
}

async function broadcastSectionEntries(): Promise<SitemapEntry[]> {
  if (!persistence.isInitialized()) return [];
  return broadcastSitemapEntries(await listBroadcastRoundDates());
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
      imageUrl: articleOgImageUrl(params.publicHost, params.slug, params.langPrefix),
    });
    if (!articleIsIndexable(params.slug)) {
      html = setRobotsMeta(html, 'noindex, follow');
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

  // Each locale's post list is prerendered (blog.html, zh-hans/blog.html,
  // zh-hant/blog.html). The community view is not, and stays on the shell
  // below. Once a scheduled post has gone live since the build, the baked list
  // predates it; the shell renders a current list client-side until the next
  // deploy.
  if (
    params.view !== 'community' &&
    !prerenderedIndexIsStale(await readArticleSchedule(params.staticDir))
  ) {
    const bakedFile = langKey === 'en' ? 'blog.html' : `${langKey}/blog.html`;
    const prerendered = await fs
      .readFile(resolve(params.staticDir, bakedFile), 'utf-8')
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
  const langKey =
    params.langPrefix === 'zh-hans' || params.langPrefix === 'zh-hant' ? params.langPrefix : 'en';

  // Each locale's rules index is prerendered (rules.html, zh-hans/rules.html,
  // zh-hant/rules.html) with its own canonical and the locale group's
  // hreflang; until 2026-10-02 all three answered with the bare shell. The
  // tile list honours publish times the way the blog index does, so the same
  // staleness rule hands a page gone live since the build to the shell below.
  if (!prerenderedIndexIsStale(await readArticleSchedule(params.staticDir))) {
    const bakedFile = langKey === 'en' ? 'rules.html' : `${langKey}/rules.html`;
    const prerendered = await fs
      .readFile(resolve(params.staticDir, bakedFile), 'utf-8')
      .catch(() => null);
    if (prerendered !== null) {
      params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      params.response.end(prerendered);
      return;
    }
  }

  const indexPath = resolve(params.staticDir, 'index.html');
  let html = await fs.readFile(indexPath, 'utf-8');
  const meta = RULES_INDEX_META[langKey];
  if (langKey !== 'en') {
    html = html.replace('<html lang="en">', `<html lang="${meta.htmlLang}">`);
  }
  const url = `${params.publicHost}${langKey === 'en' ? '' : `/${langKey}`}/rules`;
  html = injectPageMeta(html, {
    title: meta.title,
    description: meta.description,
    url,
  });
  // The fallback names the same canonical and alternates as the baked file, so
  // a crawler that lands on it sees one page in three languages either way.
  html = html.replace(
    '</head>',
    `<link rel="canonical" href="${url}">${localeAlternateLinks(params.publicHost, '/rules')}</head>`,
  );
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
