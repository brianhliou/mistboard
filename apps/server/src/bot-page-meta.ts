// Server-side <head> for /bot/:id, the bot profile page.
//
// The page is a client route, so until now a crawler (and every share card)
// saw the homepage title and description for it. It is also the primary
// call-to-action target of /blog/pikafish (growth lane 0): the page a
// 皮卡鱼在线 searcher lands on links here, and the link carried the wrong
// title. Same slot as the finished-game meta in serveSpaShellWithRoutePreloads:
// resolved from persistence when it is up, generic shell otherwise.

import type { TenantGamePageMeta } from './og-game-tenant.js';
import * as persistence from './persistence.js';

const BOT_PATH = /^\/bot\/([a-z0-9-]+)$/;

// gameSpecId -> how the game is named in a title. Only the specs a bot can
// front today; anything else falls back to the id.
const GAME_NAMES: Record<string, string> = {
  xiangqi: 'xiangqi',
  jieqi: 'jieqi',
  banqi: 'banqi',
  'dark-chess': 'fog chess',
  'dark-xiangqi': 'fog xiangqi',
  jungle: 'jungle chess',
  'jungle-flip': 'flip jungle',
  'fortress-xiangqi': 'fortress xiangqi',
  'duck-xiangqi': 'duck xiangqi',
  'atomic-xiangqi': 'atomic xiangqi',
};

function gameList(specIds: readonly string[]): string {
  const names = specIds.map((id) => GAME_NAMES[id] ?? id);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export type BotPageSource = {
  id: string;
  displayName: string;
  bio: string;
  supportedGameSpecIds: readonly string[];
};

async function lookupBot(botId: string): Promise<BotPageSource | null> {
  if (!persistence.isInitialized()) return null;
  return persistence.getPublicBotProfile(botId).catch(() => null);
}

export async function botPageMeta(
  pathname: string,
  lookup: (botId: string) => Promise<BotPageSource | null> = lookupBot,
): Promise<TenantGamePageMeta | null> {
  const match = BOT_PATH.exec(pathname);
  if (!match) return null;
  const bot = await lookup(match[1]!);
  if (!bot) return null;
  const games = gameList(bot.supportedGameSpecIds);
  const bio = bot.bio.trim();
  return {
    title: `Play ${bot.displayName} · ${games} bot | Mistboard`,
    description: bio
      ? `${bio} Free, in the browser, no account needed.`
      : `Play ${games} against ${bot.displayName} on Mistboard. Free, in the browser, no account needed.`,
    urlPath: `/bot/${bot.id}`,
    // No card of its own yet; the site card is what a share shows.
    imagePath: '/og-image.png',
  };
}
