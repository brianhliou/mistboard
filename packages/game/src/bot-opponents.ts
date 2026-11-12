// Opponent identities: how the /bots directory and the /data bot filter group
// the site's first-party bots. A ladder of levels is one opponent you pick a
// level of, not eight bots. Grouping is presentation only: every bot keeps its
// own id, configuration, rating pool and /bot/:id page, and a game is still
// played against, and attributed to, one member bot.
//
// The map is explicit on purpose. Bots are never grouped by a name or id
// prefix: General Blunder runs on Fairy-Stockfish and is its own opponent, and
// Pikafish (the bot that plays full-strength xiangqi and jieqi) is level 8 of
// the jieqi Pikafish ladder. The server test (bot-opponents.test.ts in
// apps/server) fails when a first-party bot is missing here or a member id is
// not a first-party bot.

export type BotOpponentMember = {
  botId: string;
  /** The member's level within the opponent; null for a one-bot opponent. */
  level: number | null;
};

export type BotOpponent = {
  /** Stable key: the /data ?opponent= value and the file path segment. */
  id: string;
  /** The engine or bot name, shown in English on every locale. */
  name: string;
  /** Weakest first. */
  members: readonly BotOpponentMember[];
};

function ladder(levels: readonly number[], botIdFor: (level: number) => string) {
  return levels.map((level) => ({ botId: botIdFor(level), level }));
}

const ONE_TO_EIGHT = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Display order on /bots and in the /data selector. */
export const BOT_OPPONENTS: readonly BotOpponent[] = [
  {
    id: 'general-blunder',
    name: 'General Blunder',
    members: [{ botId: 'general-blunder', level: null }],
  },
  {
    id: 'fairy-stockfish',
    name: 'Fairy-Stockfish',
    members: ladder(ONE_TO_EIGHT, (level) => `fairy-stockfish-level-${level}`),
  },
  {
    id: 'pikafish',
    name: 'Pikafish',
    // Levels 1-7 play jieqi only; level 8 is the full-strength bot, which also
    // plays xiangqi (where it is the only member, so no level is shown).
    members: ladder(ONE_TO_EIGHT, (level) =>
      level === 8 ? 'pikafish' : `pikafish-level-${level}`,
    ),
  },
  { id: 'jqe', name: 'jqe', members: [{ botId: 'jqe', level: null }] },
  { id: 'ab-jchess', name: 'AB-JChess', members: [{ botId: 'ab-jchess', level: null }] },
  {
    id: 'rapfi',
    name: 'Rapfi',
    members: ladder(ONE_TO_EIGHT, (level) => `rapfi-level-${level}`),
  },
  { id: 'misty', name: 'Misty', members: [{ botId: 'misty', level: null }] },
  { id: 'katago', name: 'KataGo', members: [{ botId: 'katago', level: null }] },
];

const opponentById = new Map(BOT_OPPONENTS.map((opponent) => [opponent.id, opponent]));
const opponentByBotId = new Map(
  BOT_OPPONENTS.flatMap((opponent) =>
    opponent.members.map((member) => [member.botId, { opponent, member }] as const),
  ),
);

export function botOpponentById(id: string): BotOpponent | null {
  return opponentById.get(id) ?? null;
}

/** The opponent a bot belongs to and its level there; null for a bot outside
 *  the map (a community bot is its own opponent). */
export function botOpponentForBotId(
  botId: string,
): { opponent: BotOpponent; member: BotOpponentMember } | null {
  return opponentByBotId.get(botId) ?? null;
}
