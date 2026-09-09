// First-party bot identities: the player-facing personas that front the
// executable engines. Identity and engine are deliberately decoupled — one bot
// can play several variants through a different engine per variant, and keeps
// its history when an engine version is retired.
//
// Consolidated roster (2026-07-21):
//   - Misty            — the house player: every hidden-info / house-built
//                        variant (fog chess, fog xiangqi, banqi, jungle, flip
//                        jungle) under one identity.
//   - Pikafish         — the boss: full-strength Pikafish for xiangqi + jieqi.
//   - Fairy-Stockfish Level 1..8 — the ladder, one bot per level, each playing
//                        xiangqi, fortress xiangqi, and duck xiangqi.
// Retired rosters (crossroads / drop-mini / mini families, pre-merge Misty and
// Pikafish tiers) stay resolvable through `legacyBotIds` and
// `attributionEngineIds` so old rooms, replays, and game attribution keep their
// names; migration 111 remaps persisted attribution to the merged ids.

export type FirstPartyBotProfile = {
  id: string;
  displayName: string;
  /** gameSpecId -> engine id currently fronted for that variant. */
  engines: Readonly<Record<string, string>>;
  defaultGameSpecId: string;
  /** Retired engine ids whose games attribute to this bot. */
  attributionEngineIds?: readonly string[];
  /** Pre-consolidation bot ids that must keep resolving (old rooms' pveBotId,
   *  bookmarked /bot/<id> URLs, replayed roomCreated events). */
  legacyBotIds?: readonly string[];
};

export const MISTY_DARK_CHESS_ACTIVE_ENGINE_ID = 'python-v2-v1.6';

const FAIRY_STOCKFISH_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

// The three retired fortress tiers were absorbed into the matching ladder
// levels by ordinal position (the migration-056/075 convention): amateur ->
// Level 2, strong -> Level 5, strongest -> Level 8.
const FORTRESS_LEGACY_BY_LEVEL: Readonly<
  Partial<Record<number, { botId: string; engineId: string }>>
> = {
  2: {
    botId: 'fairy-stockfish-fortress-xiangqi-amateur',
    engineId: 'fairy-stockfish-fortress-xiangqi-amateur',
  },
  5: {
    botId: 'fairy-stockfish-fortress-xiangqi',
    engineId: 'fairy-stockfish-fortress-xiangqi-strong',
  },
  8: {
    botId: 'fairy-stockfish-fortress-xiangqi-strongest',
    engineId: 'fairy-stockfish-fortress-xiangqi-very-strong',
  },
};

function fairyStockfishLevelProfile(level: number): FirstPartyBotProfile {
  const legacy = FORTRESS_LEGACY_BY_LEVEL[level];
  return {
    id: `fairy-stockfish-level-${level}`,
    displayName: `Fairy-Stockfish Level ${level}`,
    engines: {
      xiangqi: `fairy-stockfish-xiangqi-level-${level}`,
      'fortress-xiangqi': `fairy-stockfish-fortress-xiangqi-level-${level}`,
      'duck-xiangqi': `fairy-stockfish-duck-xiangqi-level-${level}`,
    },
    defaultGameSpecId: 'xiangqi',
    legacyBotIds: [`fairy-stockfish-xiangqi-level-${level}`, ...(legacy ? [legacy.botId] : [])],
    ...(legacy ? { attributionEngineIds: [legacy.engineId] } : {}),
  };
}

export const FIRST_PARTY_BOT_PROFILES: readonly FirstPartyBotProfile[] = [
  {
    id: 'misty',
    displayName: 'Misty',
    engines: {
      'dark-chess': MISTY_DARK_CHESS_ACTIVE_ENGINE_ID,
      'dark-draft960': MISTY_DARK_CHESS_ACTIVE_ENGINE_ID,
      'dark-xiangqi': 'python-fdx-v1.2',
      banqi: 'misty-banqi',
      jungle: 'misty-jungle-level-2',
      'jungle-flip': 'misty-jungle-flip',
    },
    defaultGameSpecId: 'dark-chess',
    attributionEngineIds: [
      'python-v2-v1.0',
      'python-v2-v1.1',
      'python-v2-v1.2',
      'python-v2-v1.3',
      'python-v2-v1.4',
      'python-v2-v1.5',
      'python-dmx-v1.0',
      // Earlier fog-xiangqi builds. Misty is the only bot that has ever fronted
      // a dark-xiangqi engine, so a room on any of them still attributes to her.
      'python-fdx-v1.0',
      'python-fdx-v1.1',
      'misty-jungle-level-1',
      'misty-jungle-level-3',
    ],
    legacyBotIds: ['misty-dark-chess', 'misty-dmx', 'misty-banqi'],
  },
  {
    id: 'pikafish',
    displayName: 'Pikafish',
    engines: {
      xiangqi: 'pikafish-xiangqi-level-8',
      jieqi: 'pikafish-jieqi-strongest',
    },
    defaultGameSpecId: 'xiangqi',
    attributionEngineIds: [
      'pikafish-xiangqi-level-1',
      'pikafish-xiangqi-level-2',
      'pikafish-xiangqi-level-3',
      'pikafish-xiangqi-level-4',
      'pikafish-xiangqi-level-5',
      'pikafish-xiangqi-level-6',
      'pikafish-xiangqi-level-7',
      'pikafish-xiangqi-amateur',
      'pikafish-xiangqi-strong',
      'pikafish-xiangqi-strongest',
      'pikafish-jieqi-amateur',
      'pikafish-jieqi-strong',
    ],
    legacyBotIds: [
      'pikafish-xiangqi-level-1',
      'pikafish-xiangqi-amateur',
      'pikafish-xiangqi-level-3',
      'pikafish-xiangqi-level-4',
      'pikafish-xiangqi',
      'pikafish-xiangqi-level-6',
      'pikafish-xiangqi-level-7',
      'pikafish-xiangqi-strongest',
      'pika-jieqi',
      'pika-jieqi-amateur',
      'pika-jieqi-strongest',
    ],
  },
  ...FAIRY_STOCKFISH_LEVELS.map(fairyStockfishLevelProfile),
  // Retired rosters below: their variants are flag-gated off; the profiles stay
  // so historical games and old rooms keep their display names.
  {
    id: 'fairy-stockfish-crossroads-amateur',
    displayName: 'Fairy Stockfish - Amateur',
    engines: { 'crossroads-chess': 'fairy-stockfish-crossroads-amateur' },
    defaultGameSpecId: 'crossroads-chess',
  },
  {
    id: 'fairy-stockfish-crossroads',
    displayName: 'Fairy Stockfish - Strong',
    engines: { 'crossroads-chess': 'fairy-stockfish-crossroads-strong' },
    defaultGameSpecId: 'crossroads-chess',
  },
  {
    id: 'fairy-stockfish-crossroads-strongest',
    displayName: 'Fairy Stockfish - Strongest',
    engines: { 'crossroads-chess': 'fairy-stockfish-crossroads-very-strong' },
    defaultGameSpecId: 'crossroads-chess',
  },
  {
    id: 'fairy-stockfish-drop-mini-xiangqi-amateur',
    displayName: 'Fairy Stockfish - Amateur',
    engines: { 'drop-mini-xiangqi': 'fairy-stockfish-drop-mini-xiangqi-amateur' },
    defaultGameSpecId: 'drop-mini-xiangqi',
  },
  {
    id: 'fairy-stockfish-drop-mini-xiangqi',
    displayName: 'Fairy Stockfish - Strong',
    engines: { 'drop-mini-xiangqi': 'fairy-stockfish-drop-mini-xiangqi-strong' },
    defaultGameSpecId: 'drop-mini-xiangqi',
  },
  {
    id: 'fairy-stockfish-drop-mini-xiangqi-strongest',
    displayName: 'Fairy Stockfish - Strongest',
    engines: { 'drop-mini-xiangqi': 'fairy-stockfish-drop-mini-xiangqi-very-strong' },
    defaultGameSpecId: 'drop-mini-xiangqi',
  },
  {
    id: 'fairy-stockfish-mini-xiangqi-amateur',
    displayName: 'Fairy Stockfish - Amateur',
    engines: { 'mini-xiangqi': 'fairy-stockfish-mini-xiangqi-amateur' },
    defaultGameSpecId: 'mini-xiangqi',
  },
  {
    id: 'fairy-stockfish-mini-xiangqi',
    displayName: 'Fairy Stockfish - Strong',
    engines: { 'mini-xiangqi': 'fairy-stockfish-mini-xiangqi-strong' },
    defaultGameSpecId: 'mini-xiangqi',
  },
  {
    id: 'fairy-stockfish-mini-xiangqi-strongest',
    displayName: 'Fairy Stockfish - Strongest',
    engines: { 'mini-xiangqi': 'fairy-stockfish-mini-xiangqi-very-strong' },
    defaultGameSpecId: 'mini-xiangqi',
  },
];

const botByEngineId = new Map<string, FirstPartyBotProfile>();
const botById = new Map<string, FirstPartyBotProfile>();
for (const bot of FIRST_PARTY_BOT_PROFILES) {
  botById.set(bot.id, bot);
  for (const engineId of Object.values(bot.engines)) {
    botByEngineId.set(engineId, bot);
  }
  for (const engineId of bot.attributionEngineIds ?? []) {
    botByEngineId.set(engineId, bot);
  }
}
// Legacy bot ids resolve to the merged profile, but never shadow a canonical id.
for (const bot of FIRST_PARTY_BOT_PROFILES) {
  for (const legacyId of bot.legacyBotIds ?? []) {
    if (!botById.has(legacyId)) botById.set(legacyId, bot);
  }
}

export function firstPartyBotForId(botId: string): FirstPartyBotProfile | null {
  return botById.get(botId) ?? null;
}

export function firstPartyBotForEngine(engineId: string): FirstPartyBotProfile | null {
  return botByEngineId.get(engineId) ?? null;
}

/**
 * The linkable profile identity behind a live seat, as the `handle`/`botId`
 * fields the live feeds carry (LiveTvPlayer, CurrentGamePlayer). At most one is
 * ever set.
 *
 * An engine seat resolves through the first-party bot table, so a raw engine
 * version with no bot in front of it stays unlinked: /bot/:id would 404 for it,
 * and /engine/:id is an admin surface. Shared by the two live feeds so a seat
 * cannot be linkable on /watch and plain on /games.
 */
export type LiveSeatProfile = { handle?: string; botId?: string };

export function liveSeatProfileIdentity(
  engineClientId: string | null,
  userHandle: string | null,
): LiveSeatProfile {
  if (engineClientId) {
    const bot = firstPartyBotForEngine(engineClientId);
    return bot ? { botId: bot.id } : {};
  }
  return userHandle ? { handle: userHandle } : {};
}

/** The engine a first-party bot currently fronts for a variant, or null when it
 *  does not play that variant (or the bot is not first-party). */
export function firstPartyBotEngineFor(botId: string, gameSpecId: string): string | null {
  return firstPartyBotForId(botId)?.engines[gameSpecId] ?? null;
}
