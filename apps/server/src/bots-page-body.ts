// Server-rendered body for /bots, /zh-hans/bots and /zh-hant/bots, the page for
// "play xiangqi against the computer" (象棋人机对战). The route is a client page,
// so a crawler that does not run the bundle saw only the title and description;
// this puts the heading, the level ladder and the links in the HTML itself. The
// client replaces it wholesale on boot (mountBots clears the root), so it never
// coexists with the rendered page.
//
// The copy mirrors the web catalog's bots.* keys (community.ts and its zh
// twins). The server has no catalog of its own, the same arrangement as the
// study body's LABELS.

import * as persistence from './persistence.js';
import type { BotDirectoryEntry } from './persistence-bots.js';
import { botPlayOptions } from './routes/bots.js';
import { escapeHtml } from './study-page-body.js';

type BotsPageLocale = 'en' | 'zh-Hans' | 'zh-Hant';

const LOCALE_BY_PATH: Record<string, BotsPageLocale> = {
  '/bots': 'en',
  '/zh-hans/bots': 'zh-Hans',
  '/zh-hant/bots': 'zh-Hant',
};

const COPY: Record<
  BotsPageLocale,
  {
    heading: string;
    sub: string;
    ladderTitle: string;
    ladderIntro: string;
    level: (level: number) => string;
    rating: (rating: string) => string;
    startHere: string;
    strongest: string;
    pikafish: string;
    otherTitle: string;
    misty: string;
  }
> = {
  en: {
    heading: 'Play xiangqi against the computer',
    sub: 'Eight levels from beginner to strong, with Pikafish at the top. Free, in the browser, no account needed.',
    ladderTitle: 'Xiangqi, level by level',
    ladderIntro: 'New to xiangqi? Start at level 2. Win a few games, then move up a level.',
    level: (level) => `Level ${level}`,
    rating: (rating) => `xiangqi engine rating ${rating}`,
    startHere: 'start here',
    strongest: 'strongest',
    pikafish: 'The strongest open-source xiangqi engine, at full strength. It plays jieqi too.',
    otherTitle: 'Other games',
    misty:
      "Mistboard's own engine for fog chess, fog xiangqi, banqi, jungle chess and flip jungle.",
  },
  'zh-Hans': {
    heading: '和电脑下象棋',
    sub: '八个难度等级，从入门到很强，最强的对手是皮卡鱼。免费，打开浏览器就能下，无需注册。',
    ladderTitle: '象棋：按等级挑选',
    ladderIntro: '刚开始下象棋？从第 2 级开始。赢几盘之后，再往上挑战一级。',
    level: (level) => `第 ${level} 级`,
    rating: (rating) => `象棋引擎等级分 ${rating}`,
    startHere: '从这里开始',
    strongest: '最强',
    pikafish: '最强的开源象棋引擎，全力出手。也可以下揭棋。',
    otherTitle: '其他棋类',
    misty: 'Mistboard 自研引擎，下迷雾国际象棋、迷雾象棋、暗棋、斗兽棋和翻翻棋。',
  },
  'zh-Hant': {
    heading: '和電腦下象棋',
    sub: '八個難度等級，從入門到很強，最強的對手是皮卡魚。免費，打開瀏覽器就能下，無需註冊。',
    ladderTitle: '象棋：按等級挑選',
    ladderIntro: '剛開始下象棋？從第 2 級開始。贏幾盤之後，再往上挑戰一級。',
    level: (level) => `第 ${level} 級`,
    rating: (rating) => `象棋引擎等級分 ${rating}`,
    startHere: '從這裡開始',
    strongest: '最強',
    pikafish: '最強的開源象棋引擎，全力出手。也可以下揭棋。',
    otherTitle: '其他棋類',
    misty: 'Mistboard 自研引擎，下迷霧國際象棋、迷霧象棋、暗棋、鬥獸棋和翻翻棋。',
  },
};

const LADDER_PREFIX = 'fairy-stockfish-level-';
// The level a first-timer is given (web landing-bot-policy XIANGQI_FIRST_GAME_LEVEL).
const FIRST_GAME_LEVEL = 2;

export async function botsDirectoryBody(
  pathname: string,
  loadBots: () => Promise<BotDirectoryEntry[]> = loadPublicBots,
): Promise<string | null> {
  const locale = LOCALE_BY_PATH[pathname];
  if (!locale) return null;
  const bots = await loadBots();
  if (bots.length === 0) return null;
  const copy = COPY[locale];
  const botHref = (id: string) => `/bot/${encodeURIComponent(id)}`;
  const xiangqiRating = (bot: BotDirectoryEntry): string | null => {
    const rating = bot.ratings.find((candidate) => candidate.gameSpecId === 'xiangqi');
    return rating ? new Intl.NumberFormat('en-US').format(rating.rating) : null;
  };
  const playsXiangqi = (bot: BotDirectoryEntry) =>
    botPlayOptions(bot).some((option) => option.gameSpecId === 'xiangqi' && option.playable);

  const system = bots.filter((bot) => bot.ownerType === 'system');
  const ladder = system
    .filter((bot) => bot.id.startsWith(LADDER_PREFIX))
    .map((bot) => ({ bot, level: Number.parseInt(bot.id.slice(LADDER_PREFIX.length), 10) }))
    .filter(({ level }) => Number.isFinite(level))
    .sort((a, b) => a.level - b.level);
  const others = system.filter((bot) => !bot.id.startsWith(LADDER_PREFIX));

  const rungs = ladder.map(({ bot, level }) => {
    const rating = xiangqiRating(bot);
    const notes = [
      level === FIRST_GAME_LEVEL ? copy.startHere : null,
      rating ? copy.rating(rating) : null,
    ].filter((note): note is string => note !== null);
    return `<li><a href="${botHref(bot.id)}">${escapeHtml(copy.level(level))}</a>${notes.length ? ` · ${escapeHtml(notes.join(' · '))}` : ''}</li>`;
  });
  for (const bot of others.filter(playsXiangqi)) {
    const blurb = bot.id === 'pikafish' ? copy.pikafish : bot.bio;
    rungs.push(
      `<li><a href="${botHref(bot.id)}">${escapeHtml(bot.displayName)}</a> · ${escapeHtml(copy.strongest)}. ${escapeHtml(blurb)}</li>`,
    );
  }
  const otherGames = others
    .filter((bot) => !playsXiangqi(bot))
    .map((bot) => {
      const blurb = bot.id === 'misty' ? copy.misty : bot.bio;
      return `<li><a href="${botHref(bot.id)}">${escapeHtml(bot.displayName)}</a>. ${escapeHtml(blurb)}</li>`;
    });

  const parts = [
    `<h1>${escapeHtml(copy.heading)}</h1>`,
    `<p>${escapeHtml(copy.sub)}</p>`,
    `<h2>${escapeHtml(copy.ladderTitle)}</h2>`,
    `<p>${escapeHtml(copy.ladderIntro)}</p>`,
    `<ul>${rungs.join('')}</ul>`,
  ];
  if (otherGames.length > 0) {
    parts.push(`<h2>${escapeHtml(copy.otherTitle)}</h2>`, `<ul>${otherGames.join('')}</ul>`);
  }
  return `<main>${parts.join('')}</main>`;
}

async function loadPublicBots(): Promise<BotDirectoryEntry[]> {
  if (!persistence.isInitialized()) return [];
  const bots = await persistence.listPublicBots();
  return bots.filter((bot) => botPlayOptions(bot).some((option) => option.playable));
}
