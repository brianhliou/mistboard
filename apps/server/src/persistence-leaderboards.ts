// Read-side cross-user analytics: leaderboards, most-active ladder, best-rating
// lookups for the online-players and Friends surfaces, and completed-game
// totals. Pure reads over user_ratings/games; no users-row plumbing. Split out
// of persistence-accounts.ts.
import { RATED_POOL_BASES } from '@mistboard/game';
import { PROVISIONAL_RD } from './glicko.js';
import { COUNTED_USER, countedAccountSeat, fairPlayEligible } from './persistence-counted-games.js';
import { getPool } from './persistence-db.js';
import type { PlayerTitle } from './persistence-titles.js';
import {
  PUBLIC_RATING_TIME_CLASSES,
  publicRatingPoolSql,
  type RatingBucket,
  type RatingTimeClass,
  type RatingVariant,
} from './rating-buckets.js';

// Shared by the ladders and champion selection. NULL last_rated_at fails the
// comparison, so an undated rating is inactive. Profiles keep all their ratings.
function activeLadderEligibilitySql(): string {
  return `
  ${publicRatingPoolSql('r.variant')}
  AND u.profile_visibility IN ('public', 'unlisted')
  AND r.games_played > 0
  AND r.last_rated_at >= CURRENT_TIMESTAMP - INTERVAL '90 days'
  AND u.${COUNTED_USER}
  AND ${fairPlayEligible('u')}`;
}

export type Champion = RatingBucket;
export type LadderChampion = Champion & { userId: string; handle: string };

const CHAMPIONS_CACHE_MS = 30_000;
type ChampionCache = {
  value?: LadderChampion[];
  expiresAt: number;
  inFlight?: Promise<LadderChampion[]>;
};
let championCaches = new WeakMap<ReturnType<typeof getPool>, ChampionCache>();

export function clearChampionsCache(): void {
  championCaches = new WeakMap();
}

// One shared read for every public surface, across every rated ladder. Nothing
// is stored on the account: an overtake, exclusion or activity expiry appears
// on the next refresh, at most 30 seconds later. Pool identity isolates DBs.
export async function getChampions(): Promise<LadderChampion[]> {
  const pool = getPool();
  const now = Date.now();
  let cache = championCaches.get(pool);
  if (!cache) {
    cache = { expiresAt: 0 };
    championCaches.set(pool, cache);
  }
  if (cache.value && now < cache.expiresAt) return cache.value.map((entry) => ({ ...entry }));
  let inFlight = cache.inFlight;
  if (!inFlight) {
    const target = cache;
    inFlight = pool
      .query<{
        user_id: string;
        handle: string;
        variant: RatingVariant;
        time_class: RatingTimeClass;
      }>(
        `SELECT user_id, handle, variant, time_class
         FROM (
           SELECT r.user_id, u.handle, r.variant, r.time_class,
                  COUNT(*) OVER (PARTITION BY r.variant, r.time_class) AS eligible_count,
                  ROW_NUMBER() OVER (
                    PARTITION BY r.variant, r.time_class
                    ORDER BY (r.elo_rating - 2 * r.rating_deviation) DESC, u.handle
                  ) AS champion_row_number
           FROM user_ratings r
           JOIN users u ON u.id = r.user_id
           WHERE ${activeLadderEligibilitySql()}
             AND r.rating_deviation <= $1
             AND r.variant = ANY($2)
             AND r.time_class = ANY($3)
         ) established
         WHERE eligible_count >= 5 AND champion_row_number = 1
         ORDER BY variant, time_class`,
        [PROVISIONAL_RD, RATED_POOL_BASES, PUBLIC_RATING_TIME_CLASSES],
      )
      .then(({ rows }) => {
        const value = rows.map((row) => ({
          userId: row.user_id,
          handle: row.handle,
          variant: row.variant,
          timeClass: row.time_class,
        }));
        target.value = value;
        target.expiresAt = now + CHAMPIONS_CACHE_MS;
        return value;
      })
      .finally(() => {
        target.inFlight = undefined;
      });
    target.inFlight = inFlight;
  }
  return (await inFlight).map((entry) => ({ ...entry }));
}

function championsForHandle(champions: LadderChampion[], handle: string): Champion[] {
  return champions
    .filter((entry) => entry.handle === handle)
    .map(({ variant, timeClass }) => ({ variant, timeClass }));
}

export type LeaderboardEntry = {
  rank: number;
  handle: string;
  displayName: string;
  // Verified player title (088), null for everyone else. Additive: the ladder
  // renders a badge beside the name where one is held.
  title: PlayerTitle | null;
  champions: Champion[];
  eloRating: number;
  gamesPlayed: number;
  // RD still above the provisional threshold — rating not yet settled. Shown on
  // the leaderboard with a "?" marker; ranked by conservative rating so it sorts
  // low until it settles.
  provisional: boolean;
};

export type LeaderboardQuery = {
  variant: RatingVariant;
  timeClass: RatingTimeClass;
  limit?: number;
};

export async function getLeaderboard(query: LeaderboardQuery): Promise<LeaderboardEntry[]> {
  const bounded = Math.max(1, Math.min(query.limit ?? 100, 500));
  const { rows } = await getPool().query<{
    rank: string;
    handle: string;
    display_name: string;
    title: PlayerTitle | null;
    elo_rating: number;
    rating_deviation: number;
    games_played: number;
  }>(
    // Rank by conservative rating (rating - 2*RD): a high-uncertainty player
    // can't top the board on noise, so a one-game fluke sorts low. Provisional
    // players (RD above threshold) are shown — marked with "?" client-side — so
    // the board isn't barren at low liquidity; their low conservative rating
    // keeps them out of the top until they settle. Inactive rows hide.
    `SELECT RANK() OVER (ORDER BY (r.elo_rating - 2 * r.rating_deviation) DESC) AS rank,
            u.handle, u.display_name, u.title, r.elo_rating, r.rating_deviation, r.games_played
     FROM user_ratings r
     JOIN users u ON u.id = r.user_id
     WHERE r.variant = $1 AND r.time_class = $2
       AND ${activeLadderEligibilitySql()}
     ORDER BY (r.elo_rating - 2 * r.rating_deviation) DESC, u.handle
     LIMIT $3`,
    [query.variant, query.timeClass, bounded],
  );
  const champions = rows.length ? await getChampions() : [];
  return rows.map((row) => ({
    rank: Number(row.rank),
    handle: row.handle,
    displayName: row.display_name,
    title: row.title,
    champions: championsForHandle(champions, row.handle),
    eloRating: row.elo_rating,
    gamesPlayed: row.games_played,
    provisional: row.rating_deviation > PROVISIONAL_RD,
  }));
}

export type LeaderboardSummaryLadder = {
  variant: string;
  leaderboard: LeaderboardEntry[];
};

// Top-N of every ladder in one round trip, for the public leaderboard page
// (which otherwise fans out one query per variant). Same semantics as
// getLeaderboard: conservative-rating order, visible profiles, active played
// rows only. RANK carries the displayed rank (ties share it); ROW_NUMBER bounds
// the panel so a tie at the cutoff can't overflow it. Ladders with no active rated
// games simply don't appear; the client renders those as empty.
export async function getLeaderboardSummary(query: {
  timeClass: RatingTimeClass;
  limitPerVariant?: number;
}): Promise<LeaderboardSummaryLadder[]> {
  const bounded = Math.max(1, Math.min(query.limitPerVariant ?? 10, 50));
  const { rows } = await getPool().query<{
    variant: string;
    rank: string;
    handle: string;
    display_name: string;
    title: PlayerTitle | null;
    elo_rating: number;
    rating_deviation: number;
    games_played: number;
  }>(
    `SELECT variant, rank, handle, display_name, title, elo_rating, rating_deviation, games_played
     FROM (
       SELECT r.variant,
              RANK() OVER (
                PARTITION BY r.variant
                ORDER BY (r.elo_rating - 2 * r.rating_deviation) DESC
              ) AS rank,
              ROW_NUMBER() OVER (
                PARTITION BY r.variant
                ORDER BY (r.elo_rating - 2 * r.rating_deviation) DESC, u.handle
              ) AS row_number,
              u.handle, u.display_name, u.title, r.elo_rating, r.rating_deviation, r.games_played
       FROM user_ratings r
       JOIN users u ON u.id = r.user_id
       WHERE r.time_class = $1
         AND ${activeLadderEligibilitySql()}
     ) ranked
     WHERE row_number <= $2
     ORDER BY variant, row_number`,
    [query.timeClass, bounded],
  );
  const champions = rows.length ? await getChampions() : [];
  const ladders = new Map<string, LeaderboardEntry[]>();
  for (const row of rows) {
    let entries = ladders.get(row.variant);
    if (!entries) {
      entries = [];
      ladders.set(row.variant, entries);
    }
    entries.push({
      rank: Number(row.rank),
      handle: row.handle,
      displayName: row.display_name,
      title: row.title,
      champions: championsForHandle(champions, row.handle),
      eloRating: row.elo_rating,
      gamesPlayed: row.games_played,
      provisional: row.rating_deviation > PROVISIONAL_RD,
    });
  }
  return [...ladders.entries()].map(([variant, leaderboard]) => ({ variant, leaderboard }));
}

export type ActivePlayerEntry = {
  rank: number;
  handle: string;
  displayName: string;
  title: PlayerTitle | null;
  gamesPlayed: number;
};

// Most-active ladder: completed human games per account, any variant, rated or
// casual. At low liquidity this fills the leaderboard's first panel while the
// rating ladders are still empty. Stats-excluded accounts (the operator's own,
// QA) are left off through countedAccountSeat, like every other public figure;
// their opponents keep the games they played against them.
export async function getMostActivePlayers(limit = 10): Promise<ActivePlayerEntry[]> {
  const bounded = Math.max(1, Math.min(limit, 50));
  const { rows } = await getPool().query<{
    handle: string;
    display_name: string;
    title: PlayerTitle | null;
    games_played: string;
  }>(
    `SELECT u.handle, u.display_name, u.title, COUNT(*) AS games_played
     FROM game_participants p
     JOIN games g ON g.room_id = p.game_id
     JOIN users u ON u.id = p.subject_id
     WHERE ${countedAccountSeat('p')}
       AND g.status = 'completed'
       AND ${fairPlayEligible('u')}
       AND u.profile_visibility IN ('public', 'unlisted')
     GROUP BY u.id, u.handle, u.display_name, u.title
     ORDER BY COUNT(*) DESC, u.handle
     LIMIT $1`,
    [bounded],
  );
  return rows.map((row, index) => ({
    rank: index + 1,
    handle: row.handle,
    displayName: row.display_name,
    title: row.title,
    gamesPlayed: Number(row.games_played),
  }));
}

export type BestRatingEntry = {
  variant: string;
  eloRating: number;
  provisional: boolean;
};

// Highest current rating per user across all pools of one time class, for the
// online-players list (one representative figure per player, playstrategy
// style). DISTINCT ON + the elo DESC sort keeps exactly the best row per user.
export async function getBestRatings(
  userIds: string[],
  timeClass: RatingTimeClass,
): Promise<Map<string, BestRatingEntry>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await getPool().query<{
    user_id: string;
    variant: string;
    elo_rating: number;
    rating_deviation: number;
  }>(
    `SELECT DISTINCT ON (r.user_id) r.user_id, r.variant, r.elo_rating, r.rating_deviation
     FROM user_ratings r
     JOIN users u ON u.id = r.user_id
     WHERE r.user_id = ANY($1) AND r.time_class = $2 AND games_played > 0
       AND ${publicRatingPoolSql('r.variant')}
       AND ${fairPlayEligible('u')}
     ORDER BY r.user_id, r.elo_rating DESC`,
    [userIds, timeClass],
  );
  const best = new Map<string, BestRatingEntry>();
  for (const row of rows) {
    best.set(row.user_id, {
      variant: row.variant,
      eloRating: row.elo_rating,
      provisional: row.rating_deviation > PROVISIONAL_RD,
    });
  }
  return best;
}

// Highest current rating per user across ALL pools and time classes, for the
// Friends page (one representative "best rating" per followed player). A
// deliberate sibling of getBestRatings above, which stays scoped to one time
// class for the online-players surfaces; existing callers keep their behavior.
export async function getBestRatingsAnyTimeClass(
  userIds: string[],
): Promise<Map<string, BestRatingEntry>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await getPool().query<{
    user_id: string;
    variant: string;
    elo_rating: number;
    rating_deviation: number;
  }>(
    `SELECT DISTINCT ON (r.user_id) r.user_id, r.variant, r.elo_rating, r.rating_deviation
     FROM user_ratings r
     JOIN users u ON u.id = r.user_id
     WHERE r.user_id = ANY($1) AND r.games_played > 0
       AND ${publicRatingPoolSql('r.variant')}
       AND ${fairPlayEligible('u')}
     ORDER BY r.user_id, r.elo_rating DESC`,
    [userIds],
  );
  const best = new Map<string, BestRatingEntry>();
  for (const row of rows) {
    best.set(row.user_id, {
      variant: row.variant,
      eloRating: row.elo_rating,
      provisional: row.rating_deviation > PROVISIONAL_RD,
    });
  }
  return best;
}

// Completed-game totals for a set of users in one query (the Friends page rows).
// Matches the public-profile gamesTotal semantics for a non-viewer: completed
// games only, private games excluded, so the number here equals what the viewer
// would see on that player's profile. Users with zero games simply have no map
// entry; callers default to 0.
export async function getGamesTotals(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await getPool().query<{ user_id: string; games_total: string }>(
    `SELECT game_participants.subject_id AS user_id, COUNT(*) AS games_total
     FROM game_participants
     JOIN games ON games.room_id = game_participants.game_id
     WHERE game_participants.subject_type = 'user'
       AND game_participants.subject_id = ANY($1)
       AND games.status = 'completed'
       AND games.visibility <> 'private'
       AND game_participants.visibility <> 'private'
     GROUP BY game_participants.subject_id`,
    [userIds],
  );
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.user_id, Number(row.games_total));
  return totals;
}
