import type { IncomingMessage, ServerResponse } from 'node:http';
import { maybeGameSpecForId } from '@mistboard/game';
import { isBotSpecPlayable, parsePublicBotId } from '../bot-profile-policy.js';
import { firstPartyBotForId } from '../first-party-bots.js';
import { abJchessAvailable, JIEQI_ABJCHESS_ENGINE_ID } from '../jieqi-engine.js';
import { KATAGO_JUNGLE_ENGINE_ID, katagoJungleAvailable } from '../jungle-katago-engine.js';
import * as persistence from '../persistence.js';
import type { BotProfile, BotProfilePage } from '../persistence-bots.js';
import type { ProfileGameRecord } from '../persistence-games.js';
import { markUnavailableGames } from '../replayable-games.js';
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
    // An engine the box cannot run is unplayable, not missing: AB-JChess and KataGo
    // need their binary and net (jieqi-engine.ts, jungle-katago-engine.ts), which a
    // dev box usually lacks.
    const serveable =
      engineId === JIEQI_ABJCHESS_ENGINE_ID
        ? abJchessAvailable()
        : engineId === KATAGO_JUNGLE_ENGINE_ID
          ? katagoJungleAvailable()
          : true;
    options.push({ gameSpecId, engineId, playable: isBotSpecPlayable(gameSpecId) && serveable });
  }
  return options;
}

// A spec on no public surface (publicSurface 'hidden', the admin playtests) is
// left off every public bot response: the bot may play it for an admin, but a
// visitor's bot profile must not name it, count it, or list its games.
function isHiddenSpec(gameSpecId: string): boolean {
  return maybeGameSpecForId(gameSpecId)?.publicSurface === 'hidden';
}

function pickVisibleSpecs<V>(byGameSpecId: Record<string, V>): Record<string, V> {
  return Object.fromEntries(Object.entries(byGameSpecId).filter(([id]) => !isHiddenSpec(id)));
}

export function withoutHiddenSpecs<T extends BotProfile>(bot: T): T {
  const visible: T = {
    ...bot,
    supportedGameSpecIds: bot.supportedGameSpecIds.filter((id) => !isHiddenSpec(id)),
  };
  const page = visible as T & Partial<BotProfilePage>;
  if (page.games) page.games = page.games.filter((game) => !isHiddenSpec(game.variant));
  if (page.recordsByGameSpecId)
    page.recordsByGameSpecId = pickVisibleSpecs(page.recordsByGameSpecId);
  if (page.gamesByGameSpecId) page.gamesByGameSpecId = pickVisibleSpecs(page.gamesByGameSpecId);
  return visible;
}

function withPlayOptions<T extends BotProfile>(bot: T): T & { playOptions: BotPlayOption[] } {
  const visible = withoutHiddenSpecs(bot);
  return { ...visible, playOptions: botPlayOptions(visible) };
}

// A bot's record is that bot's history: a game it cannot open (old rules, a
// variant with no game page) stays listed, marked (replayable-games.ts).
async function withUnavailableGamesMarked<T extends BotProfilePage>(bot: T): Promise<T> {
  // One pass over every row the page carries (the flat list and the
  // per-variant lists overlap), so each game is checked once.
  const all = [bot.games, ...Object.values(bot.gamesByGameSpecId)].flat();
  const unique = [...new Map(all.map((game) => [game.roomId, game])).values()];
  const reasons = new Map(
    (await markUnavailableGames(unique)).flatMap((game) =>
      game.unavailable ? [[game.roomId, game.unavailable] as const] : [],
    ),
  );
  const mark = (rows: readonly ProfileGameRecord[]): ProfileGameRecord[] =>
    rows.map((game) => {
      const unavailable = reasons.get(game.roomId);
      return unavailable ? { ...game, unavailable } : game;
    });
  return {
    ...bot,
    games: mark(bot.games),
    gamesByGameSpecId: Object.fromEntries(
      Object.entries(bot.gamesByGameSpecId).map(([id, rows]) => [id, mark(rows)]),
    ),
  };
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
    writeJson(response, 200, { bot: await withUnavailableGamesMarked(withPlayOptions(bot)) });
    return true;
  }

  return false;
}
