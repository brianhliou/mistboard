import type { IncomingMessage, ServerResponse } from 'node:http';
import { isBotSpecPlayable, parsePublicBotId } from '../bot-profile-policy.js';
import { firstPartyBotForId } from '../first-party-bots.js';
import * as persistence from '../persistence.js';
import type { BotProfile } from '../persistence-bots.js';
import { requireMethod, requirePersistence, writeJson } from './lib.js';

// Per-variant play descriptor for a bot. `playable` reflects the variant's
// launch flag right now; unplayable variants still list (the profile shows the
// full roster) but the web disables their play affordances.
type BotPlayOption = {
  gameSpecId: string;
  engineId: string;
  playable: boolean;
};

export function botPlayOptions(bot: BotProfile): BotPlayOption[] {
  const specIds =
    bot.supportedGameSpecIds.length > 0 ? bot.supportedGameSpecIds : [bot.defaultGameSpecId];
  const firstParty = firstPartyBotForId(bot.id);
  const options: BotPlayOption[] = [];
  for (const gameSpecId of specIds) {
    const engineId =
      firstParty?.engines[gameSpecId] ??
      (gameSpecId === bot.defaultGameSpecId ? bot.activeEngineId : null);
    if (!engineId) continue;
    options.push({ gameSpecId, engineId, playable: isBotSpecPlayable(gameSpecId) });
  }
  return options;
}

function withPlayOptions<T extends BotProfile>(bot: T): T & { playOptions: BotPlayOption[] } {
  return { ...bot, playOptions: botPlayOptions(bot) };
}

function isAnySpecPlayable(bot: BotProfile): boolean {
  return botPlayOptions(bot).some((option) => option.playable);
}

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/api/bots') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const bots = (await persistence.listPublicBots())
      .filter(isAnySpecPlayable)
      .map(withPlayOptions);
    writeJson(response, 200, { bots });
    return true;
  }

  const profileMatch = pathname.match(/^\/api\/bots\/([^/]+)$/);
  if (profileMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const requestedBotId = parsePublicBotId(decodeURIComponent(profileMatch[1] ?? ''));
    if (!requestedBotId) {
      writeJson(response, 400, { error: 'invalid_bot_id' });
      return true;
    }
    // Pre-consolidation ids resolve to the merged profile (old /bot/<id> URLs).
    const botId = firstPartyBotForId(requestedBotId)?.id ?? requestedBotId;
    const bot = await persistence.getPublicBotProfile(botId);
    if (!bot || !isAnySpecPlayable(bot)) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, { bot: withPlayOptions(bot) });
    return true;
  }

  return false;
}
