import { promises as fs } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { type Color, GAME_SPECS } from '@mistboard/game';
import { ARTICLE_META, articleIsIndexable, canonicalArticleBase } from './article-meta.js';
import {
  type ArticleSchedule,
  articleIsScheduledAhead,
  prerenderedIndexIsStale,
  readArticleSchedule,
} from './article-schedule.js';
import {
  boardLocale,
  botBoardPage,
  historicalBoardPage,
  profileBoardBody,
  puzzleBoardBody,
  puzzleHeading,
} from './board-pages.js';
import { type BoardLocale, boardCopy, boardTimeClass } from './board-text-copy.js';
import { botPageMeta } from './bot-page-meta.js';
import { botsDirectoryBody } from './bots-page-body.js';
import { type BroadcastPage, liveBroadcastPage } from './broadcast-pages.js';
import { type DataPageSources, dataRouteBody } from './data-page-body.js';
import { forumExcerpt } from './forum-excerpt.js';
import { broadcastPageMeta } from './og-broadcast.js';
import {
  type TenantGameCardStore,
  type TenantGamePageMeta,
  tenantGamePageMeta,
  tenantGameRoutePage,
} from './og-game-tenant.js';
import { articleOgImageUrl, GAME_OG_IMAGE_VERSION, STUDY_OG_IMAGE_VERSION } from './og-image.js';
import {
  isPositionOgVariant,
  POSITION_OG_IMAGE_VERSION,
  type PositionOgVariant,
  positionOgVariantLabel,
  publicPositionFen,
} from './og-position.js';
import * as persistence from './persistence.js';
import type { BotProfilePage } from './persistence-bots.js';
import type { HistoricalXiangqiGameInput } from './persistence-historical-xiangqi.js';
import { variantName } from './player-email.js';
import {
  cachedPlayers,
  livePlayerPage,
  type PlayerPage,
  playerSitemapEntries,
} from './player-pages.js';
import { practiceChapterPath } from './practice-chapter-redirect.js';
import { practiceRouteBody } from './practice-page-body.js';
import { isPublicRatingPool, visibleRatingTimeClasses } from './rating-buckets.js';
import { type PublicPuzzle, puzzleById } from './routes/puzzles.js';
import { isNoFollowRoute, isNoindexRoute } from './server-policy.js';
import { broadcastSitemapEntries, listBroadcastRoundDates } from './sitemap-broadcasts.js';
import {
  localeAlternates,
  SITEMAP_STATIC_ROUTES,
  type SitemapEntry,
  sitemapContract,
  sitemapPathIsTracked,
  sitemapXml,
} from './sitemap-content.js';
import {
  archiveSitemapEntries,
  bodyMeetsSitemapFloor,
  serverBodyDates,
} from './sitemap-records.js';
import { studyHasAdminOnlyChapter } from './study-admin-only.js';
import {
  chapterPageMeta,
  renderStudyBody,
  renderStudyIndexBody,
  STUDY_INDEX_PAGES,
  studyPageMeta,
} from './study-page-body.js';

export { ARTICLE_META, canonicalArticleBase, SITEMAP_STATIC_ROUTES };

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
  '/play': {
    title: 'Play Chinese Chess (Xiangqi) and Variants | Mistboard',
    description:
      'Play xiangqi (Chinese chess) and its variants online. Challenge a friend, find an opponent, or play against the computer. Free, in your browser.',
  },
  // Public practice tool: preview the tool, never the URL's position or hints.
  '/practice/position': {
    title: 'Play Out a Xiangqi Position | Mistboard',
    description:
      'Practise a xiangqi (Chinese chess) position against the engine. Set up a position in the board editor, then play it out to practise winning or holding a draw.',
  },
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
  '/zh-hans/about': {
    title: '关于 Mistboard | Mistboard',
    description:
      'Mistboard 是免费、开源的中国象棋对弈与学习网站，支持英文、简体中文和繁体中文。通过中国象棋与世界经典策略游戏，让不同文化背景的人走到一起。',
    htmlLang: 'zh-Hans',
    localeGroup: '/about',
  },
  '/zh-hant/about': {
    title: '關於 Mistboard | Mistboard',
    description:
      'Mistboard 是免費、開源的象棋對弈與學習網站，支援英文、簡體中文和繁體中文。透過象棋與世界經典策略遊戲，連結不同文化背景的人。',
    htmlLang: 'zh-Hant',
    localeGroup: '/about',
  },
  '/about': {
    localeGroup: '/about',
    title: 'About Mistboard | Chinese Chess for Every Player',
    description:
      "Bringing people together across cultures through Chinese chess and the world's classic strategy games. Free, open-source play, study and broadcasts.",
  },
  '/zh-hans/faq': {
    title: '常见问题：对弈、账号与计分 | Mistboard',
    description:
      '关于 Mistboard 网页版的常见问题：如何与电脑或朋友下象棋，是否需要下载或注册账号，计分对局与防作弊如何运作，以及棋谱库的对局来自哪里。',
    htmlLang: 'zh-Hans',
    localeGroup: '/faq',
  },
  '/zh-hant/faq': {
    title: '常見問題：對弈、帳號與計分 | Mistboard',
    description:
      '關於 Mistboard 網頁版的常見問題：如何與電腦或朋友下象棋，是否需要下載或註冊帳號，計分對局與防作弊如何運作，以及棋譜庫的對局來自哪裡。',
    htmlLang: 'zh-Hant',
    localeGroup: '/faq',
  },
  '/faq': {
    localeGroup: '/faq',
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
  '/forum/etiquette': {
    title: 'Forum etiquette · Mistboard',
    description:
      'A clear title, the right category, readable boards, no spam and respect for other players: guidelines for posting on the Mistboard forum.',
  },
  '/coach': {
    title: 'Xiangqi Coaches | Mistboard',
    description:
      'Find a verified xiangqi or chess coach, or help shape teaching on Mistboard. Share interactive studies and work with us on what your students need.',
  },
  '/streamer': {
    title: 'Xiangqi Streamers | Mistboard',
    description:
      'Stream xiangqi or its variants with Mistboard. Bring an idea, prepare games and studies, and work directly with us as our tools for creators develop.',
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
  '/zh-hans/source': {
    title: '开放源代码与第三方组件 | Mistboard',
    description:
      'Mistboard 是一个独立的开源策略游戏项目。源代码以 AGPL-3.0-or-later 发布。托管服务与 lichess、chess.com 或任何其他棋类平台无关联。',
    htmlLang: 'zh-Hans',
    localeGroup: '/source',
  },
  '/zh-hant/source': {
    title: '開放原始碼與第三方元件 | Mistboard',
    description:
      'Mistboard 是一個獨立的開源策略遊戲專案。原始碼以 AGPL-3.0-or-later 發布。託管服務與 lichess、chess.com 或任何其他棋類平台無關。',
    htmlLang: 'zh-Hant',
    localeGroup: '/source',
  },
  '/source': {
    localeGroup: '/source',
    title: 'Open Source Code | Mistboard',
    description:
      'Mistboard is an independent open-source project, published under AGPL-3.0-or-later. Browse the repository and the license.',
  },
  '/zh-hans/contribute': {
    title: '参与贡献：玩家、教师与开发者 | Mistboard',
    description:
      'Mistboard 免费且开源，玩家、教师、游戏创作者和引擎作者都可以参与。从一件你在意、想改进的事开始：下棋并反馈问题、审阅中文翻译、制作教学内容，或提交代码与引擎。',
    htmlLang: 'zh-Hans',
    localeGroup: '/contribute',
  },
  '/zh-hant/contribute': {
    title: '參與貢獻：玩家、教師與開發者 | Mistboard',
    description:
      'Mistboard 免費且開源，玩家、教師、遊戲創作者和引擎作者都可以參與。從一件你在意、想改進的事開始：下棋並回報問題、審閱中文翻譯、製作教學內容，或提交程式碼與引擎。',
    htmlLang: 'zh-Hant',
    localeGroup: '/contribute',
  },
  '/contribute': {
    localeGroup: '/contribute',
    title: 'How to Contribute | Mistboard',
    description:
      'Ways to contribute to Mistboard as a player, teacher, translator, game creator or engine author, and where each one starts.',
  },
  // In-person xiangqi for Greater Seattle, starting in Bellevue; Mistboard hosts
  // its page, and washingtonxiangqi.org and .com forward here (2026-10-23).
  // Nothing is running yet, so the copy says so (private issue 19, 2026-11-03).
  '/washington-xiangqi': {
    title: 'Washington Xiangqi: Chinese chess in Greater Seattle',
    description:
      'In-person xiangqi, Chinese chess, for Greater Seattle, with meetups forming in Bellevue. Every level is welcome. Write in to play, learn, host or help organize.',
    localeGroup: '/washington-xiangqi',
  },
  '/zh-hans/washington-xiangqi': {
    title: '华州象棋 Washington Xiangqi：大西雅图地区的象棋',
    description:
      '面向大西雅图地区的线下象棋，正在贝尔维尤筹备聚会。欢迎各种水平的棋友，无论是多年老手还是刚学走法的新手。想下棋、学棋、提供场地或协助组织，欢迎来信联系华州象棋。',
    htmlLang: 'zh-Hans',
    localeGroup: '/washington-xiangqi',
  },
  '/zh-hant/washington-xiangqi': {
    title: '華州象棋 Washington Xiangqi：大西雅圖地區的象棋',
    description:
      '面向大西雅圖地區的實體象棋，正在貝爾維尤籌備聚會。歡迎各種程度的棋友，無論是多年老手還是剛學走法的新手。想下棋、學棋、提供場地或協助組織，歡迎來信聯繫華州象棋。',
    htmlLang: 'zh-Hant',
    localeGroup: '/washington-xiangqi',
  },
  '/zh-hans/creators': {
    title: '与我们合作：创作者与棋手 | Mistboard',
    description:
      'Mistboard 将对弈和研究与赛事直播、原创游戏和引擎挑战赛连接起来。我们跨越语言，在线上和线下与棋手、教师、创作者及主办方合作。网站免费、开源、无广告。',
    htmlLang: 'zh-Hans',
    localeGroup: '/creators',
  },
  '/zh-hant/creators': {
    title: '與我們合作：創作者與棋手 | Mistboard',
    description:
      'Mistboard 將對弈和研究與賽事直播、原創遊戲和引擎挑戰賽連結起來。我們跨越語言，在線上和線下與棋手、教師、創作者及主辦方合作。網站免費、開源、無廣告。',
    htmlLang: 'zh-Hant',
    localeGroup: '/creators',
  },
  '/creators': {
    localeGroup: '/creators',
    title: 'Work With Us: Creators and Players | Mistboard',
    description:
      'Work with Mistboard on teaching, broadcasts, original games and engine challenges across languages, and how to get in touch.',
  },
  // One reigning champion engine per game, moved from
  // brianhliou.com/challenges/ (and its zh copies) on 2026-10-07; /challenges
  // 301s here. Locale-prefixed like /bots.
  '/champions': {
    title: 'Engine Champions | Mistboard',
    description:
      'The reigning champion engine for jieqi, banqi, Jungle Chess and Flip Jungle: the strongest bot on Mistboard, the title history, and how any engine can challenge for the title in a public match.',
    localeGroup: '/champions',
  },
  '/zh-hans/champions': {
    title: '引擎冠军与挑战赛 | Mistboard',
    description:
      '揭棋、暗棋、斗兽棋和翻翻兽棋的现任冠军引擎：Mistboard 上最强的机器人，附头衔历史，以及任何引擎如何在公开对抗赛中挑战头衔。',
    htmlLang: 'zh-Hans',
    localeGroup: '/champions',
  },
  '/zh-hant/champions': {
    title: '引擎冠軍與挑戰賽 | Mistboard',
    description:
      '揭棋、暗棋、鬥獸棋和翻翻獸棋的現任冠軍引擎：Mistboard 上最強的機器人，附頭銜歷史，以及任何引擎如何在公開對抗賽中挑戰頭銜。',
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
  '/zh-hans/data/about': {
    title: '关于棋谱数据：格式与使用许可 | Mistboard',
    description:
      'Mistboard 每月对局数据说明：逐项介绍 JSONL 和 PGN 文件格式、CC BY 4.0 许可与署名方式、包含和排除哪些对局，以及迷雾和暗子信息如何记录。',
    htmlLang: 'zh-Hans',
    localeGroup: '/data/about',
  },
  '/zh-hant/data/about': {
    title: '關於棋譜資料：格式與使用授權 | Mistboard',
    description:
      'Mistboard 每月對局資料說明：逐項介紹 JSONL 和 PGN 檔案格式、CC BY 4.0 授權與署名方式、包含和排除哪些對局，以及迷霧和暗子資訊如何記錄。',
    htmlLang: 'zh-Hant',
    localeGroup: '/data/about',
  },
  '/data/about': {
    localeGroup: '/data/about',
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
  // Linked from every page's footer or nav, and each served the homepage title
  // and description until 2026-10-24, so Bing read them as duplicates of '/'.
  // Terms and privacy share locale groups; utility pages keep their bare canonical.
  '/zh-hans/terms': {
    title: '使用条款：对弈、计分与公平竞赛 | Mistboard',
    description:
      '使用 mistboard.com 的规则：匿名与计分对弈、账号和评分、公平竞赛要求、已结束对局按 CC BY 4.0 公开的许可，以及赞助扣款、取消和退款规定。',
    htmlLang: 'zh-Hans',
    localeGroup: '/terms',
  },
  '/zh-hant/terms': {
    title: '使用條款：對弈、計分與公平競賽 | Mistboard',
    description:
      '使用 mistboard.com 的規則：匿名與計分對弈、帳號和評分、公平競賽要求、已結束對局按 CC BY 4.0 公開的授權，以及贊助扣款、取消和退款規定。',
    htmlLang: 'zh-Hant',
    localeGroup: '/terms',
  },
  '/terms': {
    localeGroup: '/terms',
    title: 'Terms of Use: Play, Ratings and Fair Play | Mistboard',
    description:
      'The rules for using mistboard.com: anonymous and rated play, ratings and fair play, finished games published under CC BY 4.0, and patron billing and refunds.',
  },
  '/zh-hans/privacy': {
    title: '隐私政策：网站收集的数据与用途 | Mistboard',
    description:
      '说明 mistboard.com 收集的分析数据、对局记录，以及注册账号时的用户名和邮箱；介绍这些数据的用途、计分对局的公平性数据与私信的保存。网站无广告，也不出售你的数据。',
    htmlLang: 'zh-Hans',
    localeGroup: '/privacy',
  },
  '/zh-hant/privacy': {
    title: '隱私政策：網站收集的資料與用途 | Mistboard',
    description:
      '說明 mistboard.com 收集的分析資料、對局記錄，以及註冊帳號時的使用者名稱和信箱；介紹這些資料的用途、計分對局的公平性資料與私訊的保存。網站無廣告，也不出售你的資料。',
    htmlLang: 'zh-Hant',
    localeGroup: '/privacy',
  },
  '/privacy': {
    localeGroup: '/privacy',
    title: 'Privacy: What Mistboard Collects | Mistboard',
    description:
      'What mistboard.com collects and why: analytics, the games you play, and your handle and email if you make an account. No ads, and no data sold.',
  },
  '/contact': {
    title: 'Contact: Bugs, Accounts and Billing | Mistboard',
    description:
      'A private line to the person who runs Mistboard: report a bug or a broken game, or raise an account or billing problem. Add an email if you want a reply.',
  },
  '/watch': {
    title: 'Watch Live Xiangqi Games | Mistboard',
    description:
      'Watch xiangqi (Chinese chess) and variant games live on Mistboard, move by move: humans against humans, humans against engines, and engine against engine.',
  },
  '/thanks': {
    title: 'Credits: Engines, Sources and Thanks | Mistboard',
    description:
      'The engines you play against on Mistboard, the sites whose games and photos we show, and the players who reported what was broken, each thanked by name.',
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

type RoutePageMeta = {
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

export function positionRouteMeta(pathname: string, search: string): RoutePageMeta | null {
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
      'Mistboard 上每一種棋類的完整規則：象棋（中國象棋）、揭棋、暗棋、鬥獸棋和西洋棋，以及迷霧、鴨子等各種象棋變體。',
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
  // The rules slug carries the tile count (32); the plain name is the one
  // people type.
  'xiangqi-mahjong': 'xiangqi-mahjong-32',
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
// the bare path. /contact?about=<page> prefills the form with the page a message
// is about; every player, team and broadcast page links one, and Search Console
// filed 43 of them as duplicates without a canonical (validation failed
// 2026-10-19). /contact has no locale-prefixed form.
const QUERY_FREE_CANONICAL_ROUTES: ReadonlySet<string> = new Set([
  '/stats',
  '/data',
  '/coach',
  '/forum',
  '/player/rating-stats',
  '/watch',
  '/games',
  '/contact',
  '/terms',
  '/privacy',
  '/thanks',
  '/faq',
]);

// Client routes whose list is live (it changes by the minute, so nothing in it
// is worth baking) but whose page still needs a heading and its links for a
// crawler that does not run the bundle. The client clears the root on mount.
const STATIC_ROUTE_BODIES: Readonly<Record<string, string>> = {
  '/games':
    '<main><h1>Current games</h1><p>Every xiangqi (Chinese chess) and variant game in progress on Mistboard right now: live games with clocks, and correspondence games waiting on a move.</p><ul><li><a href="/watch">Watch live games</a></li><li><a href="/games/search">Search finished games</a></li><li><a href="/broadcast/xiangqi">Xiangqi tournament broadcasts</a></li><li><a href="/">Play a game</a></li></ul></main>',
};

const PUZZLE_DEEP_LINK = /^\/puzzles\/([^/]+)$/;

// Use the public forum reads, never a request's account or pagination. A
// hidden topic reads as null; a hidden opening post keeps its position in the
// list with its text blanked. Neither may acquire a preview from a later reply.
async function forumRoutePage(
  pathname: string,
  lookupTopic: typeof persistence.getForumTopic,
  listCategories: typeof persistence.listForumCategories,
): Promise<{ meta?: RoutePageMeta; noindex: boolean } | null> {
  const normalized = pathname.replace(/\/+$/, '');
  if (
    !normalized.startsWith('/forum/') ||
    normalized === '/forum/etiquette' ||
    normalized === '/forum/reports'
  )
    return null;
  try {
    const thread = /^\/forum\/t\/([^/]+)(?:\/[^/]+)?$/.exec(normalized);
    const category = /^\/forum\/([^/]+)$/.exec(normalized);
    const encodedId = thread?.[1] ?? category?.[1];
    if (!encodedId) return { noindex: true };
    const id = decodeURIComponent(encodedId);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return { noindex: true };
    if (thread) {
      const topic = await lookupTopic(id, { postLimit: 1, postOffset: 0, viewerAccountId: null });
      const opening = topic?.posts[0];
      if (!topic || !opening || opening.hiddenAt !== null) return { noindex: true };
      return {
        noindex: false,
        meta: {
          title: `${topic.title} · ${topic.category.name} · Mistboard forum`,
          description: forumExcerpt(opening.bodyText),
          urlPath: `/forum/t/${encodeURIComponent(topic.id)}/${encodeURIComponent(topic.slug)}`,
        },
      };
    }
    const entry = (await listCategories()).find((entry) => entry.slug === id);
    if (!entry) return { noindex: true };
    return {
      noindex: false,
      meta: {
        title: `${entry.name} · Mistboard forum`,
        description: entry.description,
        urlPath: `/forum/${encodeURIComponent(entry.slug)}`,
      },
    };
  } catch {
    return { noindex: true };
  }
}

// Like the public profile API, always read as an anonymous visitor. Account
// play locks and stats exclusions do not hide profiles; profile visibility
// does. The body whitelists public game summaries, never replay state or account-only fields.
async function profileRoutePage(
  pathname: string,
  lookupProfile: typeof persistence.getUserProfileByHandle,
  locale: BoardLocale,
): Promise<{ meta?: RoutePageMeta; body?: string; noindex: boolean } | null> {
  if (!pathname.startsWith('/@/')) return null;
  const match = /^\/@\/([^/]+)$/.exec(pathname.replace(/\/+$/, ''));
  if (!match) return { noindex: true };
  let profile: persistence.UserProfile | null;
  try {
    const handle = decodeURIComponent(match[1]!);
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(handle)) return { noindex: true };
    profile = await lookupProfile(handle, null);
  } catch {
    return { noindex: true };
  }
  if (profile?.user.profileVisibility !== 'public') return { noindex: true };
  const visibleClasses = visibleRatingTimeClasses();
  const facts = GAME_SPECS.flatMap((spec) => {
    if (!spec.rated || spec.publicSurface === 'hidden' || !isPublicRatingPool(spec.ratingPoolBase))
      return [];
    const buckets = profile.ratings.filter(
      (rating) =>
        rating.variant === spec.ratingPoolBase &&
        visibleClasses.includes(rating.timeClass) &&
        (rating.totalGamesPlayed > 0 || rating.ratedGamesPlayed > 0),
    );
    if (buckets.length === 0) return [];
    const ratings = buckets
      .filter((rating) => rating.eloRating !== null && rating.ratedGamesPlayed > 0)
      .map(
        (rating) =>
          `${locale === 'en' ? `${rating.timeClass} rating` : `${boardTimeClass(rating.timeClass, locale)} ${boardCopy(locale, 'bots.ratings')}`} ${rating.eloRating}${rating.provisional ? '?' : ''}`,
      );
    return [
      `${locale === 'en' ? spec.publicName : variantName(spec.id, locale)}${ratings.length ? ` (${ratings.join(', ')})` : ''}`,
    ];
  });
  return {
    noindex: false,
    meta: {
      title: `${profile.user.displayName} (@${profile.user.handle}) · Mistboard`,
      description:
        locale !== 'en'
          ? facts.join(' · ')
          : facts.length
            ? `Plays ${facts.join(', ')} on Mistboard.`
            : `View ${profile.user.displayName}'s public profile on Mistboard.`,
      urlPath: `/@/${encodeURIComponent(profile.user.handle)}`,
    },
    body: profileBoardBody(profile, facts, locale),
  };
}

// Resolve through the public API's serving set: withheld/retired puzzles never
// get meta or a canonical. One read supplies both the preview and the full-id
// canonical shared by short-code links. No editorial title, motifs, board,
// source game or solution moves enter the preview head; the body gates the solution in details.
async function puzzleRoutePage(
  pathname: string,
  lookupPuzzle: (idOrShortCode: string) => Promise<PublicPuzzle | null>,
  locale: BoardLocale,
): Promise<{ meta?: RoutePageMeta; body?: string; noindex: boolean } | null> {
  const match = PUZZLE_DEEP_LINK.exec(pathname.replace(/\/+$/, ''));
  if (!match) return null;
  let puzzle: PublicPuzzle | null;
  try {
    puzzle = await lookupPuzzle(decodeURIComponent(match[1]!));
  } catch {
    return { noindex: true };
  }
  if (!puzzle) return { noindex: true };
  // Explicit allowlist: a future hidden-information variant must not silently
  // acquire public previews merely by joining the puzzle store.
  let variant: string;
  switch (puzzle.variant) {
    case 'xiangqi':
      variant = 'Xiangqi';
      break;
    case 'jungle':
      variant = 'Jungle';
      break;
    default:
      return { noindex: true };
  }
  if (puzzle.initial.status.type !== 'playing') return { noindex: true };
  const side = puzzle.initial.status.turn === 'red' ? 'Red' : 'Black';
  // The solver already shows this count in its goal, before any moves are made.
  const moves = Math.ceil(puzzle.solution.length / 2);
  let goal: string;
  let prompt: string;
  switch (puzzle.goal.type) {
    case 'checkmate':
      goal = `${side} mates in ${moves}`;
      prompt = `Find mate in ${moves}`;
      break;
    case 'win':
      goal = `${side} wins in ${moves}`;
      prompt = `Find a win in ${moves}`;
      break;
    case 'winning-advantage':
      goal = `${side} to move for a winning advantage`;
      prompt = 'Find a winning advantage';
      break;
    default:
      return { noindex: true };
  }
  return {
    noindex: false,
    meta: {
      title:
        locale === 'en'
          ? `${variant} puzzle: ${goal} | Mistboard`
          : `${puzzleHeading(puzzle, locale)} | Mistboard`,
      description:
        locale === 'en'
          ? `${side} to move. ${prompt} in this ${variant} puzzle on Mistboard. Play your moves on the board and check your solution.`
          : `${boardCopy(locale, 'puzzle.toMove').replace('{color}', boardCopy(locale, puzzle.initial.status.turn === 'red' ? 'replay.red' : 'replay.black'))}。${boardCopy(locale, 'puzzle.findBestMove')}`,
      urlPath: `/puzzles/${encodeURIComponent(puzzle.id)}`,
    },
    body: await puzzleBoardBody(puzzle, puzzleHeading(puzzle, locale), locale),
  };
}

function queryFreeCanonicalPath(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  // /play mounts the home lobby and replaces its URL with / on the client.
  if (normalized === '/play') return '/';
  return QUERY_FREE_CANONICAL_ROUTES.has(normalized) ? normalized : null;
}

/** hreflang links for a route that exists at '', '/zh-hans' and '/zh-hant',
 *  with the English URL as x-default (the page for a reader whose language is
 *  none of the three), as the prerendered blog and rules pages do. */
function localeAlternateLinks(publicHost: string, basePath: string): string {
  return localeAlternates(basePath)
    .map(
      ({ lang, path }) => `<link rel="alternate" hreflang="${lang}" href="${publicHost}${path}">`,
    )
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
  /** Override tenant game reads (tests); live previews never load a board card. */
  tenantGameStore?: TenantGameCardStore;
  /** Override the server-rendered route body (tests); the default reads persistence. */
  routeBody?: (pathname: string) => Promise<string | null>;
  /** Existing public API reads for the data directories (socketless fixtures). */
  dataPages?: DataPageSources;
  /** The practice API's single public shelf read. */
  practiceStudies?: typeof persistence.getPracticeStudiesBySlug;
  /** Override the player-page lookup (tests); the default reads persistence. */
  playerPage?: (pathname: string, locale?: BoardLocale) => Promise<PlayerPage | null>;
  /** Override the broadcast-page lookup (tests); the default reads persistence. */
  broadcastPage?: (pathname: string, locale?: BoardLocale) => Promise<BroadcastPage | null>;
  /** Override the public puzzle lookup (tests); the default is the one
   *  /api/puzzles/:id uses, excluding unpublished/withheld puzzles. */
  puzzle?: (idOrShortCode: string) => Promise<PublicPuzzle | null>;
  /** Override the profile API's anonymous, visibility-gated read (tests). */
  profile?: typeof persistence.getUserProfileByHandle;
  historicalGame?: (id: string) => Promise<HistoricalXiangqiGameInput | null>;
  bot?: (id: string) => Promise<BotProfilePage | null>;
  /** Override the public forum reads (tests); previews always read anonymously. */
  forumTopic?: typeof persistence.getForumTopic;
  forumCategories?: typeof persistence.listForumCategories;
  /** Override the shelf deep-link lookup (tests); the default reads persistence. */
  practiceChapterPath?: (pathname: string) => Promise<string | null>;
}): Promise<boolean> {
  // A shelf deep link (/practice/endgames-horse/horse-vs-advisor) names a
  // chapter the client would bounce to anyway: answer with the move itself, so
  // a crawler follows it rather than indexing a shell that reads as '/'. A day
  // of max-age, not forever: the ids are per database and a reseed of a fresh
  // one could move them.
  const practiceTarget = await (params.practiceChapterPath ?? practiceChapterPath)(
    params.pathname,
  ).catch(() => null);
  if (practiceTarget) {
    params.response.writeHead(301, {
      location: `${practiceTarget}${params.search ?? ''}`,
      'cache-control': 'public, max-age=86400',
    });
    params.response.end();
    return true;
  }
  const locale = boardLocale(params.search);
  const links = await routePreloadLinksForPath(params);
  // A player, team or the players index (#458, player-pages.ts): its own meta,
  // a canonical link and a crawler body, from one read of the archive. A name
  // the archive does not know keeps the generic meta and is kept out of the
  // index, the way an unlisted study is.
  const playerPage = await (
    params.playerPage ??
    ((pathname: string, pageLocale?: BoardLocale) =>
      livePlayerPage(pathname, params.staticDir, pageLocale))
  )(params.pathname, locale).catch(() => null);
  // A broadcast index, event, round or game (broadcast-pages.ts) rides the same
  // slot: before 2026-10-17 all 195 sitemap-broadcasts URLs served an empty
  // #app with no canonical, and Google folded them as duplicates.
  const player =
    playerPage ??
    (await (params.broadcastPage ?? liveBroadcastPage)(params.pathname, locale).catch(() => null));
  // Tenant review pages distinguish missing ids from live names-only previews
  // and finished cards. Keep the existing override for callers supplying meta.
  const tenantGame =
    params.gameMeta && !params.tenantGameStore
      ? null
      : await tenantGameRoutePage(params.pathname, params.tenantGameStore);
  if (tenantGame?.notFound) {
    await serveNotFoundShell(params);
    return true;
  }
  const historical = await historicalBoardPage(params.pathname, locale, params.historicalGame);
  const bot = await botBoardPage(params.pathname, locale, params.bot);
  const lookupGameMeta = params.gameMeta ?? liveGameMeta;
  const gameMeta =
    player?.meta || bot?.meta
      ? null
      : tenantGame
        ? tenantGame.meta
        : await lookupGameMeta(params.pathname).catch(() => null);
  const puzzle = await puzzleRoutePage(params.pathname, params.puzzle ?? puzzleById, locale);
  const profile = await profileRoutePage(
    params.pathname,
    params.profile ?? persistence.getUserProfileByHandle,
    locale,
  );
  const forum = await forumRoutePage(
    params.pathname,
    params.forumTopic ?? persistence.getForumTopic,
    params.forumCategories ?? persistence.listForumCategories,
  );
  const positionMeta =
    player?.meta ??
    historical?.meta ??
    bot?.meta ??
    gameMeta ??
    puzzle?.meta ??
    profile?.meta ??
    forum?.meta ??
    positionRouteMeta(params.pathname, params.search ?? '');
  // Read separately from routeMeta: that one is a union with the position-route
  // shape, which carries no locale of its own (a FEN is not a language).
  const spaMeta = SPA_ROUTE_META[params.pathname];
  const routeMeta = positionMeta ?? spaMeta;
  const noindex =
    isNoindexRoute(params.pathname) ||
    tenantGame?.noindex === true ||
    player?.noindex === true ||
    historical?.noindex === true ||
    bot?.noindex === true ||
    puzzle?.noindex === true ||
    profile?.noindex === true ||
    forum?.noindex === true;
  const canonicalPath =
    historical?.meta?.urlPath ??
    bot?.meta?.urlPath ??
    puzzle?.meta?.urlPath ??
    profile?.meta?.urlPath ??
    forum?.meta?.urlPath ??
    queryFreeCanonicalPath(params.pathname);
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
  const dataBody = await dataRouteBody(
    params.pathname,
    locale,
    params.search,
    params.dataPages,
  ).catch(() => null);
  if (locale !== 'en' && (historical || puzzle || profile || bot || dataBody))
    html = html.replace('<html lang="en">', `<html lang="${locale}">`);
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
  if (canonicalPath && params.publicHost && !player?.meta && !spaMeta?.localeGroup) {
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
  const nofollow = isNoFollowRoute(params.pathname);
  if (noindex) {
    html = setRobotsMeta(html, nofollow ? 'noindex, nofollow' : 'noindex, follow');
  }
  if (links) html = html.replace('</head>', `${links}</head>`);
  // A client route that exists to answer a search (/bots) also carries its text
  // in the HTML, for a crawler that does not run the bundle. The client clears
  // the root on mount, so the two never show together.
  const body =
    player?.body ??
    historical?.body ??
    puzzle?.body ??
    profile?.body ??
    bot?.body ??
    (await practiceRouteBody(params.pathname, params.practiceStudies).catch(() => null)) ??
    dataBody ??
    STATIC_ROUTE_BODIES[params.pathname.replace(/\/+$/, '') || '/'] ??
    (await (params.routeBody ?? botsDirectoryBody)(params.pathname).catch(() => null));
  if (body) html = html.replace('<div id="app"></div>', crawlerCopyRoot(body));
  params.response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    ...(nofollow ? { 'x-robots-tag': 'noindex, nofollow' } : {}),
  });
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
  // An admin-only variant's study (#628) gets the bare shell: its meta and
  // card would publish it to crawlers, which are never admins.
  if (study && study.visibility === 'public' && !studyHasAdminOnlyChapter(study)) {
    const chapter = params.chapterId
      ? study.chapters.find((c) => c.id === params.chapterId)
      : undefined;
    const pathSuffix = chapter ? `/${encodeURIComponent(chapter.id)}` : '';
    // A chapter permalink carries the CHAPTER's title and prose. Without this,
    // every chapter of a 66-composition study serves the study's own meta and
    // the set reads as near-duplicates. Both builders extend a description
    // under the SEO floor with facts the page already shows.
    const meta = chapter
      ? chapterPageMeta({ study, chapter, locale })
      : studyPageMeta({ study, locale });
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
    // An unlisted study is shared by link (a teaching kit sent to the player
    // it is about), so the preview names it: title and description only, the
    // same words the page shows anyone holding the link. No canonical, crawler
    // copy or board card (og-image.ts serves none for a non-public study).
    if (study && study.visibility === 'unlisted' && !studyHasAdminOnlyChapter(study)) {
      const meta = studyPageMeta({ study, locale });
      html = injectPageMeta(html, {
        title: meta.title,
        description: meta.description,
        url: `${params.publicHost}${localePath}/study/${encodeURIComponent(params.studyId)}`,
      });
    }
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
  file: string;
  pathname?: string;
  practiceStudies?: typeof persistence.getPracticeStudiesBySlug;
}): Promise<void> {
  if (
    (SCHEDULE_DATED_PAGES.has(params.file) || params.file.startsWith('feed-')) &&
    prerenderedIndexIsStale(await readArticleSchedule(params.staticDir))
  ) {
    throw new Error(`${params.file} predates a scheduled entry that is now live`);
  }
  let html = await fs.readFile(resolve(params.staticDir, params.file), 'utf-8');
  const practice = await practiceRouteBody(params.pathname ?? '', params.practiceStudies).catch(
    () => null,
  );
  if (practice) {
    // Replace the hidden, baked sidebar with today's complete hidden shelf.
    // Keep the built head and all its stylesheet links intact.
    html = html.replace(
      /(<div id="app"[^>]*>)[\s\S]*(<\/div>)/,
      (_match, root, end) => `${root}<div class="crawler-copy">${practice}</div>${end}`,
    );
  }
  params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  params.response.end(html);
}

// The sitemap is an index of sections rather than one list, so Search
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
export const SITEMAP_SECTIONS = [
  'pages',
  'studies',
  'players',
  'broadcasts',
  'historical',
  'puzzles',
] as const;
export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

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
async function studySitemapEntries(): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = [];
  for (const summary of await listEveryPublicStudy()) {
    const study = await persistence.getStudyById(summary.id);
    if (study?.visibility !== 'public' || studyHasAdminOnlyChapter(study)) continue;
    const basePath = `/study/${encodeURIComponent(study.id)}`;
    const alternates = localeAlternates(basePath);
    const group: SitemapEntry[] = [];
    for (const [slug, locale] of Object.entries(STUDY_LOCALE_BY_SLUG)) {
      const localePath = slug === 'en' ? '' : `/${slug}`;
      const path = `${localePath}${basePath}`;
      const body = renderStudyBody({ study, locale, localePath });
      if (bodyMeetsSitemapFloor(path, body))
        group.push({ path, lastmod: isoDate(study.updatedAt), alternates });
    }
    // A page's head advertises the complete group; every member must have a body.
    if (group.length === 3) entries.push(...group);
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
      players: () => playerSectionEntries(params.staticDir),
      broadcasts: broadcastSectionEntries,
      historical: () => archiveSitemapEntries('historical', undefined, params.staticDir),
      puzzles: () => archiveSitemapEntries('puzzles', undefined, params.staticDir),
    };
    entries = await loaders[params.section]().catch(() => [] as SitemapEntry[]);
  }
  const xml = sitemapXml(
    entries.filter((entry) => sitemapPathIsTracked(entry.path)),
    params.publicHost,
  );
  params.response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
  params.response.end(xml);
}

// Absent persistence (in-memory dev) there is no archive and both are empty.
async function playerSectionEntries(staticDir: string): Promise<SitemapEntry[]> {
  if (!persistence.isInitialized()) return [];
  const entries: SitemapEntry[] = [];
  for (const entry of playerSitemapEntries(await cachedPlayers())) {
    if (!sitemapPathIsTracked(entry.path)) continue;
    const page = await livePlayerPage(entry.path, staticDir);
    if (page?.body && !page.noindex && bodyMeetsSitemapFloor(entry.path, page.body))
      entries.push(entry);
  }
  return entries;
}

async function broadcastSectionEntries(): Promise<SitemapEntry[]> {
  if (!persistence.isInitialized()) return [];
  const entries: SitemapEntry[] = [];
  for (const entry of broadcastSitemapEntries(await listBroadcastRoundDates())) {
    if (!sitemapPathIsTracked(entry.path)) continue;
    const page = await liveBroadcastPage(entry.path);
    if (page?.body && !page.noindex && bodyMeetsSitemapFloor(entry.path, page.body))
      entries.push(entry);
  }
  return entries;
}

export async function pageSitemapEntries(staticDir: string): Promise<SitemapEntry[]> {
  const baked = await fs
    .readFile(resolve(staticDir, 'prerender-sitemap.json'), 'utf8')
    .then((json) => JSON.parse(json) as Array<SitemapEntry & { contentChars?: number }>)
    .catch(() => []);
  const bakedPaths = new Set(baked.map((record) => record.path));
  const dates = await serverBodyDates().catch(() => new Map<string, string>());
  const staleIndex = prerenderedIndexIsStale(await readArticleSchedule(staticDir));
  const entries: SitemapEntry[] = SITEMAP_STATIC_ROUTES.flatMap((path) => {
    const record = baked.find((entry) => entry.path === path);
    const contract = sitemapContract(path)!;
    // Server-body routes use the build for dates and alternates, not body copy.
    if (
      contract.source === 'prerender' &&
      !contract.knownGap &&
      record?.contentChars !== undefined &&
      record.contentChars <
        Math.max(150, contract.minChars, Math.floor(contract.baselineChars * 0.6))
    )
      return [];
    // A build with no repository history records pages without dates; they stay
    // listed without <lastmod>. A route with neither a build record nor a server
    // body date has no evidence of a body and stays out.
    const lastmod = dates.get(path) ?? record?.lastmod;
    return record || lastmod ? [{ path, lastmod, alternates: record?.alternates }] : [];
  });
  for (const record of baked) {
    const article = /^\/(?:zh-han[st]\/)?(?:blog|rules)\/([^/]+)$/.exec(record.path);
    if (article && articleIsIndexable(decodeURIComponent(article[1]!))) entries.push(record);
  }
  return entries.filter(
    (entry) =>
      !(staleIndex && /^\/(?:zh-han[st]\/)?(?:blog|feed)(?:\/\d{4}-\d{2})?$/.test(entry.path)) &&
      sitemapPathIsTracked(entry.path) &&
      (entry.alternates ?? []).every(
        (alternate) =>
          sitemapPathIsTracked(alternate.path) &&
          (bakedPaths.has(alternate.path) || !!sitemapContract(alternate.path)?.knownGap),
      ),
  );
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

// Preserve the baked index and all its styles when a schedule advances. The
// supplement is replaced on client mount and never adds a first-paint panel.
export function articleIndexUpdates(
  schedule: ArticleSchedule,
  kind: 'article' | 'rules',
  locale: 'en' | 'zh-hans' | 'zh-hant',
  view: 'mistboard' | 'community' = 'mistboard',
  now: number = Date.now(),
): string {
  const items: string[] = [];
  for (const [slug, liveAt] of [...schedule.scheduled].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )) {
    if (liveAt <= schedule.builtAt || liveAt > now) continue;
    const entry = schedule.indexEntries.get(slug);
    if (entry === null) continue;
    const meta = ARTICLE_META[slug];
    if (
      entry
        ? entry.kind !== kind || (kind === 'article' && entry.publisher !== view)
        : !meta || !articleIsIndexable(slug) || meta.kind !== kind || view === 'community'
    )
      continue;
    // Older schedules have no card data. Their posts are Mistboard-authored;
    // reuse the generated title, never an English summary on a Chinese page.
    const copy =
      entry?.locales[locale] ??
      (meta
        ? {
            title: locale === 'en' ? meta.title : (meta.zhTitles?.[locale] ?? meta.title),
            summary: locale === 'en' && kind === 'article' ? meta.description : '',
            href: `${locale !== 'en' && meta.zhTitles ? `/${locale}` : ''}/${kind === 'rules' ? 'rules' : 'blog'}/${slug}`,
          }
        : null);
    if (!copy) continue;
    items.push(
      `<li><a href="${escapeHtml(copy.href)}">${escapeHtml(copy.title)}</a>${copy.summary ? `<p>${escapeHtml(copy.summary)}</p>` : ''}</li>`,
    );
  }
  return items.length
    ? `<div class="crawler-copy" data-article-index-updates><ul>${items.join('')}</ul></div>`
    : '';
}

async function supplementArticleIndex(
  html: string,
  staticDir: string,
  kind: 'article' | 'rules',
  locale: 'en' | 'zh-hans' | 'zh-hant',
  view: 'mistboard' | 'community' = 'mistboard',
): Promise<string> {
  const copy = articleIndexUpdates(await readArticleSchedule(staticDir), kind, locale, view);
  // A callback keeps literal dollar signs in catalog strings out of replace's
  // replacement syntax. Existing baked markup and head links stay intact.
  // These built templates end #app at the body's last div. Hide the whole
  // stale render together: a hidden list alone would reserve space above a
  // visible index and shift it when the app removes that list.
  return copy
    ? html.replace(
        /(<div id="app"[^>]*>)([\s\S]*)(<\/div>)/,
        (_match, root, body, end) =>
          `${root}<div class="crawler-copy" data-article-index-fallback>${copy}${body}</div>${end}`,
      )
    : html;
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

  {
    const file = params.view === 'community' ? 'blog/community.html' : 'blog.html';
    const bakedFile = langKey === 'en' ? file : `${langKey}/${file}`;
    const prerendered = await fs
      .readFile(resolve(params.staticDir, bakedFile), 'utf-8')
      .catch(() => null);
    if (prerendered !== null) {
      params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      params.response.end(
        await supplementArticleIndex(
          prerendered,
          params.staticDir,
          'article',
          langKey,
          params.view,
        ),
      );
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
  params.response.end(
    await supplementArticleIndex(html, params.staticDir, 'article', langKey, params.view),
  );
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
  // tile list keeps its baked content and gains newly live entries below.
  {
    const bakedFile = langKey === 'en' ? 'rules.html' : `${langKey}/rules.html`;
    const prerendered = await fs
      .readFile(resolve(params.staticDir, bakedFile), 'utf-8')
      .catch(() => null);
    if (prerendered !== null) {
      params.response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      params.response.end(
        await supplementArticleIndex(prerendered, params.staticDir, 'rules', langKey),
      );
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
  params.response.end(await supplementArticleIndex(html, params.staticDir, 'rules', langKey));
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
