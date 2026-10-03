import { defaultEngineTimeControl } from '@mistboard/game';
import { PROVISIONAL_RD } from './glicko.js';
import { getPool } from './persistence-db.js';
import type { GameMode, GameTermination, GameVisibility } from './persistence-game-lifecycle.js';
import type { GameParticipantColor, GameResult, ProfileGameRecord } from './persistence-games.js';
import { attachGameParticipants } from './persistence-games.js';
import type { RatingTimeClass } from './rating-buckets.js';

export type BotOwnerType = 'system' | 'user';
export type BotRatingSource = 'manual' | 'eve-anchor' | 'import';

export type BotRatingSnapshot = {
  gameSpecId: string;
  timeClass: RatingTimeClass;
  rating: number;
  ratingDeviation: number | null;
  games: number;
  source: BotRatingSource;
  sourceRef: string | null;
  createdAt: Date;
  provisional: boolean;
};

export type BotProfile = {
  id: string;
  displayName: string;
  bio: string;
  ownerType: BotOwnerType;
  ownerUserId: string | null;
  activeEngineId: string;
  defaultGameSpecId: string;
  supportedGameSpecIds: string[];
  play: {
    mode: 'pve';
    gameSpecId: string;
    engineId: string;
    timeControl: {
      initialMs: number;
      incrementMs: number;
    };
    preferredColor: 'random';
  };
  rating: BotRatingSnapshot | null;
  ratings: BotRatingSnapshot[];
  visibility: Extract<GameVisibility, 'private' | 'unlisted' | 'public'>;
  createdAt: Date;
  updatedAt: Date;
};

export type BotModeRecord = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
};

export type BotDirectoryEntry = BotProfile & {
  gamesTotal: number;
  record: BotModeRecord;
};

export type BotProfilePage = BotDirectoryEntry & {
  games: ProfileGameRecord[];
  // Per-variant play record, keyed by game spec id. `record`/`gamesTotal` above
  // stay LIFETIME totals across every variant (the /bots directory card wants
  // those); these are what a profile showing one selected variant reads. Every
  // id in `supportedGameSpecIds` is present, including variants the bot has
  // never played: a missing key and a real 0-0-0 are different claims, and the
  // profile has to be able to say "no games yet" rather than render nothing.
  recordsByGameSpecId: Record<string, BotModeRecord>;
  // Recent games per variant, newest first, capped per variant. Partitioned on
  // the SERVER because the row cap has to be applied after the variant split: a
  // flat "most recent N across all variants" list can be 100% one variant, so
  // filtering it client-side shows an empty list for the others while real games
  // exist (pikafish's 15 most recent were all jieqi, hiding ~64 xiangqi games).
  gamesByGameSpecId: Record<string, ProfileGameRecord[]>;
};

export type BotPlayProfile = Pick<
  BotProfile,
  'activeEngineId' | 'defaultGameSpecId' | 'id' | 'play' | 'supportedGameSpecIds' | 'visibility'
>;

type BotProfileRow = {
  id: string;
  display_name: string;
  bio: string;
  owner_type: BotOwnerType;
  owner_user_id: string | null;
  active_engine_id: string;
  default_game_spec_id: string;
  supported_game_spec_ids: string[];
  play_initial_ms: number;
  play_increment_ms: number;
  visibility: BotProfile['visibility'];
  created_at: Date;
  updated_at: Date;
  rating_game_spec_id: string | null;
  rating_time_class: RatingTimeClass | null;
  rating_value: number | null;
  rating_deviation: number | null;
  rating_games: number | null;
  rating_source: BotRatingSource | null;
  rating_source_ref: string | null;
  rating_created_at: Date | null;
};

type BotDirectoryRow = BotProfileRow & {
  games_total: string;
  wins: string;
  losses: string;
  draws: string;
};

const BOT_GAMES_PAGE = 15;
// Per-variant cap for the profile's recent-games list. Smaller than the flat
// page because the payload now carries one list per supported variant.
const BOT_VARIANT_GAMES_PAGE = 10;

// "The bot's seat won this game", as a SQL predicate over a game_participants
// row joined to its game. Shared by the lifetime and per-variant aggregates so
// the two can never disagree about what a win is.
const BOT_SEAT_WON = `games.room_id IS NOT NULL
                AND (
                  (game_participants.color = 'white' AND games.result = 'white-wins')
                  OR (game_participants.color = 'black' AND games.result = 'black-wins')
                  OR (game_participants.color = 'red' AND games.result = 'red-wins')
                )`;

type BotGameRow = {
  room_id: string;
  player_color: GameParticipantColor;
  variant: string;
  mode: GameMode;
  result: GameResult;
  termination: GameTermination;
  ply_count: number;
  started_at: Date;
  ended_at: Date;
  white_name: string | null;
  black_name: string | null;
  corpus_id: string | null;
  rated: boolean;
  visibility: GameVisibility;
  initial_ms: number | null;
  increment_ms: number | null;
};

function botGameFromRow(row: BotGameRow): ProfileGameRecord {
  return {
    roomId: row.room_id,
    playerColor: row.player_color,
    variant: row.variant,
    mode: row.mode,
    result: row.result,
    termination: row.termination,
    plyCount: row.ply_count,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    whiteName: row.white_name,
    blackName: row.black_name,
    corpusId: row.corpus_id,
    rated: row.rated,
    visibility: row.visibility,
    participants: [],
    initialMs: row.initial_ms,
    incrementMs: row.increment_ms,
  };
}
const RATING_TIME_CLASS_ORDER: Record<RatingTimeClass, number> = {
  bullet: 0,
  blitz: 1,
  rapid: 2,
  // No bot plays correspondence (bot_rating_snapshots' CHECK stays live-only);
  // present only so the order is total over the user pool's time classes.
  correspondence: 3,
};

export async function getPublicBotForPlay(botId: string): Promise<BotPlayProfile | null> {
  const { rows } = await getPool().query<{
    active_engine_id: string;
    default_game_spec_id: string;
    id: string;
    play_increment_ms: number;
    play_initial_ms: number;
    supported_game_spec_ids: string[];
    visibility: BotProfile['visibility'];
  }>(
    `SELECT id,
            active_engine_id,
            default_game_spec_id,
            supported_game_spec_ids,
            play_initial_ms,
            play_increment_ms,
            visibility
       FROM bot_profiles
      WHERE id = $1
        AND visibility = 'public'
      LIMIT 1`,
    [botId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    activeEngineId: row.active_engine_id,
    defaultGameSpecId: row.default_game_spec_id,
    supportedGameSpecIds: row.supported_game_spec_ids,
    play: {
      mode: 'pve',
      gameSpecId: row.default_game_spec_id,
      engineId: row.active_engine_id,
      timeControl: botPlayTimeControl(row),
      preferredColor: 'random',
    },
    visibility: row.visibility,
  };
}

// The pace a "play this bot" click actually starts, for the bot's default game
// spec. NOT bot_profiles.play_initial_ms/play_increment_ms: those columns hold
// one pace per bot (all still at the house 3+2) where the pace belongs to the
// variant, so the stored value would advertise 3+2 while routes/rooms.ts armed
// the variant default. The columns stay as the create route's last-resort
// fallback; nothing user-facing reads them.
function botPlayTimeControl(row: {
  default_game_spec_id: string;
  play_initial_ms: number;
  play_increment_ms: number;
}): { initialMs: number; incrementMs: number } {
  const resolved = defaultEngineTimeControl(row.default_game_spec_id);
  return { initialMs: resolved.initialMs, incrementMs: resolved.incrementMs };
}

export async function listPublicBots(): Promise<BotDirectoryEntry[]> {
  const { rows } = await getPool().query<BotDirectoryRow>(
    `SELECT bot_profiles.*,
            rating.game_spec_id AS rating_game_spec_id,
            rating.time_class AS rating_time_class,
            rating.rating AS rating_value,
            rating.rating_deviation,
            rating.games AS rating_games,
            rating.source AS rating_source,
            rating.source_ref AS rating_source_ref,
            rating.created_at AS rating_created_at,
            COUNT(games.room_id)::text AS games_total,
            COUNT(*) FILTER (
              WHERE games.result = 'draw'
            )::text AS draws,
            COUNT(*) FILTER (
              WHERE ${BOT_SEAT_WON}
            )::text AS wins,
            COUNT(*) FILTER (
              WHERE games.room_id IS NOT NULL
                AND games.result <> 'draw'
                AND NOT (${BOT_SEAT_WON})
            )::text AS losses
       FROM bot_profiles
       LEFT JOIN game_participants
         ON game_participants.subject_type = 'bot'
        AND game_participants.subject_id = bot_profiles.id
        AND game_participants.visibility = 'public'
       LEFT JOIN games
         ON games.room_id = game_participants.game_id
        AND games.status = 'completed'
        AND games.visibility = 'public'
       LEFT JOIN LATERAL (
         SELECT game_spec_id, time_class, rating, rating_deviation, games, source, source_ref, created_at
           FROM bot_rating_snapshots
          WHERE bot_rating_snapshots.bot_id = bot_profiles.id
            AND bot_rating_snapshots.game_spec_id = bot_profiles.default_game_spec_id
            AND bot_rating_snapshots.time_class = 'blitz'
            AND bot_rating_snapshots.published = true
          ORDER BY bot_rating_snapshots.published_at DESC NULLS LAST,
                   bot_rating_snapshots.created_at DESC,
                   bot_rating_snapshots.id DESC
          LIMIT 1
       ) rating ON true
      WHERE bot_profiles.visibility = 'public'
      GROUP BY bot_profiles.id, rating.game_spec_id, rating.time_class, rating.rating,
               rating.rating_deviation, rating.games, rating.source, rating.source_ref,
               rating.created_at
      ORDER BY bot_profiles.display_name`,
  );
  const bots = rows.map((row) => ({
    ...botFromRow(row),
    gamesTotal: Number(row.games_total),
    record: recordFromRow(row),
  }));
  return attachLatestRatings(bots);
}

export async function getPublicBotProfile(botId: string): Promise<BotProfilePage | null> {
  const { rows } = await getPool().query<BotDirectoryRow>(
    `SELECT bot_profiles.*,
            rating.game_spec_id AS rating_game_spec_id,
            rating.time_class AS rating_time_class,
            rating.rating AS rating_value,
            rating.rating_deviation,
            rating.games AS rating_games,
            rating.source AS rating_source,
            rating.source_ref AS rating_source_ref,
            rating.created_at AS rating_created_at,
            COUNT(games.room_id)::text AS games_total,
            COUNT(*) FILTER (
              WHERE games.result = 'draw'
            )::text AS draws,
            COUNT(*) FILTER (
              WHERE ${BOT_SEAT_WON}
            )::text AS wins,
            COUNT(*) FILTER (
              WHERE games.room_id IS NOT NULL
                AND games.result <> 'draw'
                AND NOT (${BOT_SEAT_WON})
            )::text AS losses
       FROM bot_profiles
       LEFT JOIN game_participants
         ON game_participants.subject_type = 'bot'
        AND game_participants.subject_id = bot_profiles.id
        AND game_participants.visibility = 'public'
       LEFT JOIN games
         ON games.room_id = game_participants.game_id
        AND games.status = 'completed'
        AND games.visibility = 'public'
       LEFT JOIN LATERAL (
         SELECT game_spec_id, time_class, rating, rating_deviation, games, source, source_ref, created_at
           FROM bot_rating_snapshots
          WHERE bot_rating_snapshots.bot_id = bot_profiles.id
            AND bot_rating_snapshots.game_spec_id = bot_profiles.default_game_spec_id
            AND bot_rating_snapshots.time_class = 'blitz'
            AND bot_rating_snapshots.published = true
          ORDER BY bot_rating_snapshots.published_at DESC NULLS LAST,
                   bot_rating_snapshots.created_at DESC,
                   bot_rating_snapshots.id DESC
          LIMIT 1
       ) rating ON true
      WHERE bot_profiles.id = $1
        AND bot_profiles.visibility = 'public'
      GROUP BY bot_profiles.id, rating.game_spec_id, rating.time_class, rating.rating,
               rating.rating_deviation, rating.games, rating.source, rating.source_ref,
               rating.created_at
      LIMIT 1`,
    [botId],
  );
  const row = rows[0];
  if (!row) return null;

  const base = botFromRow(row);
  const [games, recordsByGameSpecId, gamesByGameSpecId] = await Promise.all([
    queryBotGames(botId, BOT_GAMES_PAGE),
    queryBotRecordsByGameSpecId(botId, base.supportedGameSpecIds),
    queryBotGamesByGameSpecId(botId, base.supportedGameSpecIds, BOT_VARIANT_GAMES_PAGE),
  ]);
  const [profile] = await attachLatestRatings([
    {
      ...base,
      gamesTotal: Number(row.games_total),
      record: recordFromRow(row),
      games,
      recordsByGameSpecId,
      gamesByGameSpecId,
    },
  ]);
  return profile ?? null;
}

// Per-variant play record. Deliberately a SECOND aggregate rather than a
// regrouping of the one above: the directory card and the profile header still
// want the lifetime totals, so both shapes have to survive. Seeded with an
// explicit 0-0-0 for every supported variant so a bot that has never played one
// reports "no games" instead of a missing key the caller has to guess about.
async function queryBotRecordsByGameSpecId(
  botId: string,
  supportedGameSpecIds: readonly string[],
): Promise<Record<string, BotModeRecord>> {
  const records: Record<string, BotModeRecord> = {};
  for (const gameSpecId of supportedGameSpecIds) {
    records[gameSpecId] = { games: 0, wins: 0, losses: 0, draws: 0 };
  }
  const { rows } = await getPool().query<{
    variant: string;
    games_total: string;
    wins: string;
    losses: string;
    draws: string;
  }>(
    `SELECT games.variant,
            COUNT(games.room_id)::text AS games_total,
            COUNT(*) FILTER (WHERE games.result = 'draw')::text AS draws,
            COUNT(*) FILTER (
              WHERE ${BOT_SEAT_WON}
            )::text AS wins,
            COUNT(*) FILTER (
              WHERE games.result <> 'draw' AND NOT (${BOT_SEAT_WON})
            )::text AS losses
       FROM game_participants
       JOIN games ON games.room_id = game_participants.game_id
      WHERE game_participants.subject_type = 'bot'
        AND game_participants.subject_id = $1
        AND game_participants.visibility = 'public'
        AND games.status = 'completed'
        AND games.visibility = 'public'
      GROUP BY games.variant`,
    [botId],
  );
  for (const row of rows) {
    records[row.variant] = {
      games: Number(row.games_total),
      wins: Number(row.wins),
      losses: Number(row.losses),
      draws: Number(row.draws),
    };
  }
  return records;
}

// The most recent `perVariant` games for each supported variant. One round trip
// via a window function; ranking inside the partition is what makes the cap
// per-variant rather than global.
async function queryBotGamesByGameSpecId(
  botId: string,
  supportedGameSpecIds: readonly string[],
  perVariant: number,
): Promise<Record<string, ProfileGameRecord[]>> {
  const byGameSpecId: Record<string, ProfileGameRecord[]> = {};
  for (const gameSpecId of supportedGameSpecIds) byGameSpecId[gameSpecId] = [];
  const { rows } = await getPool().query<BotGameRow>(
    `SELECT * FROM (
       SELECT games.room_id,
              game_participants.color AS player_color,
              games.variant,
              games.mode,
              games.result,
              games.termination,
              games.ply_count,
              games.started_at,
              games.ended_at,
              games.white_name,
              games.black_name,
              games.corpus_id,
              COALESCE(games.rated, false) AS rated,
              games.visibility,
              games.initial_ms,
              games.increment_ms,
              ROW_NUMBER() OVER (
                PARTITION BY games.variant
                ORDER BY games.ended_at DESC, games.room_id DESC
              ) AS variant_rank
         FROM game_participants
         JOIN games ON games.room_id = game_participants.game_id
        WHERE game_participants.subject_type = 'bot'
          AND game_participants.subject_id = $1
          AND games.status = 'completed'
          AND games.visibility = 'public'
          AND game_participants.visibility = 'public'
     ) ranked
      WHERE ranked.variant_rank <= $2
      ORDER BY ranked.variant, ranked.ended_at DESC, ranked.room_id DESC`,
    [botId, Math.max(1, Math.min(perVariant, 50))],
  );
  const records = await attachGameParticipants(rows.map(botGameFromRow));
  for (const record of records) {
    // A variant the bot has played but no longer lists as supported still has
    // rows here; keep them rather than dropping history on a registry change.
    const bucket = byGameSpecId[record.variant];
    if (bucket) bucket.push(record);
    else byGameSpecId[record.variant] = [record];
  }
  return byGameSpecId;
}

async function attachLatestRatings<T extends BotProfile>(bots: readonly T[]): Promise<T[]> {
  const ratingsByBotId = await queryLatestPublishedRatings(bots.map((bot) => bot.id));
  return bots.map((bot) => {
    const ratings = ratingsByBotId.get(bot.id) ?? [];
    const primaryRating =
      ratings.find(
        (rating) => rating.gameSpecId === bot.defaultGameSpecId && rating.timeClass === 'blitz',
      ) ??
      bot.rating ??
      ratings[0] ??
      null;
    return {
      ...bot,
      rating: primaryRating,
      ratings,
    };
  });
}

async function queryLatestPublishedRatings(
  botIds: readonly string[],
): Promise<Map<string, BotRatingSnapshot[]>> {
  const uniqueBotIds = [...new Set(botIds)];
  if (uniqueBotIds.length === 0) return new Map();

  const { rows } = await getPool().query<{
    bot_id: string;
    game_spec_id: string;
    time_class: RatingTimeClass;
    rating: number;
    rating_deviation: number | null;
    games: number;
    source: BotRatingSource;
    source_ref: string | null;
    created_at: Date;
  }>(
    `SELECT bot_id,
            game_spec_id,
            time_class,
            rating,
            rating_deviation,
            games,
            source,
            source_ref,
            created_at
       FROM (
         SELECT bot_rating_snapshots.*,
                ROW_NUMBER() OVER (
                  PARTITION BY bot_id, game_spec_id, time_class
                  ORDER BY published_at DESC NULLS LAST,
                           created_at DESC,
                           id DESC
                ) AS snapshot_rank
           FROM bot_rating_snapshots
          WHERE bot_id = ANY($1::text[])
            AND published = true
       ) ranked
      WHERE snapshot_rank = 1`,
    [uniqueBotIds],
  );

  const ratingsByBotId = new Map<string, BotRatingSnapshot[]>();
  for (const row of rows) {
    const ratings = ratingsByBotId.get(row.bot_id) ?? [];
    ratings.push(ratingFromSnapshotRow(row));
    ratingsByBotId.set(row.bot_id, ratings);
  }
  for (const ratings of ratingsByBotId.values()) {
    ratings.sort(
      (left, right) =>
        left.gameSpecId.localeCompare(right.gameSpecId) ||
        RATING_TIME_CLASS_ORDER[left.timeClass] - RATING_TIME_CLASS_ORDER[right.timeClass],
    );
  }
  return ratingsByBotId;
}

async function queryBotGames(botId: string, limit: number): Promise<ProfileGameRecord[]> {
  const { rows } = await getPool().query<BotGameRow>(
    `SELECT games.room_id,
            game_participants.color AS player_color,
            games.variant,
            games.mode,
            games.result,
            games.termination,
            games.ply_count,
            games.started_at,
            games.ended_at,
            games.white_name,
            games.black_name,
            games.corpus_id,
            COALESCE(games.rated, false) AS rated,
            games.visibility,
            games.initial_ms,
            games.increment_ms
       FROM game_participants
       JOIN games ON games.room_id = game_participants.game_id
      WHERE game_participants.subject_type = 'bot'
        AND game_participants.subject_id = $1
        AND games.status = 'completed'
        AND games.visibility = 'public'
        AND game_participants.visibility = 'public'
      ORDER BY games.ended_at DESC, games.room_id DESC
      LIMIT $2`,
    [botId, Math.max(1, Math.min(limit, 50))],
  );
  return attachGameParticipants(rows.map(botGameFromRow));
}

function botFromRow(row: BotProfileRow): BotProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    bio: row.bio,
    ownerType: row.owner_type,
    ownerUserId: row.owner_user_id,
    activeEngineId: row.active_engine_id,
    defaultGameSpecId: row.default_game_spec_id,
    supportedGameSpecIds: row.supported_game_spec_ids,
    play: {
      mode: 'pve',
      gameSpecId: row.default_game_spec_id,
      engineId: row.active_engine_id,
      timeControl: botPlayTimeControl(row),
      preferredColor: 'random',
    },
    rating: ratingFromRow(row),
    ratings: [],
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ratingFromSnapshotRow(row: {
  game_spec_id: string;
  time_class: RatingTimeClass;
  rating: number;
  rating_deviation: number | null;
  games: number;
  source: BotRatingSource;
  source_ref: string | null;
  created_at: Date;
}): BotRatingSnapshot {
  return {
    gameSpecId: row.game_spec_id,
    timeClass: row.time_class,
    rating: row.rating,
    ratingDeviation: row.rating_deviation,
    games: row.games,
    source: row.source,
    sourceRef: row.source_ref,
    createdAt: row.created_at,
    provisional: row.rating_deviation != null ? row.rating_deviation > PROVISIONAL_RD : false,
  };
}

function ratingFromRow(row: BotProfileRow): BotRatingSnapshot | null {
  if (
    row.rating_value == null ||
    row.rating_game_spec_id == null ||
    row.rating_time_class == null
  ) {
    return null;
  }
  return {
    gameSpecId: row.rating_game_spec_id,
    timeClass: row.rating_time_class,
    rating: row.rating_value,
    ratingDeviation: row.rating_deviation,
    games: row.rating_games ?? 0,
    source: row.rating_source ?? 'import',
    sourceRef: row.rating_source_ref,
    createdAt: row.rating_created_at ?? new Date(0),
    provisional: row.rating_deviation != null ? row.rating_deviation > PROVISIONAL_RD : false,
  };
}

function recordFromRow(row: BotDirectoryRow): BotModeRecord {
  return {
    games: Number(row.games_total),
    wins: Number(row.wins),
    losses: Number(row.losses),
    draws: Number(row.draws),
  };
}
