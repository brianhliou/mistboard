// Read-side cross-user analytics: leaderboards, most-active ladder, best-rating
// lookups for the online-players and Friends surfaces, and completed-game
// totals. Pure reads over user_ratings/games; no users-row plumbing. Split out
// of persistence-accounts.ts.
import { PROVISIONAL_RD } from './glicko.js';
import { COUNTED_USER } from './persistence-counted-games.js';
import { getPool } from './persistence-db.js';
import type { PlayerTitle } from './persistence-titles.js';
import type { RatingTimeClass, RatingVariant } from './rating-buckets.js';

export type LeaderboardEntry = {
  rank: number;
  handle: string;
  displayName: string;
  // Verified player title (088), null for everyone else. Additive: the ladder
  // renders a badge beside the name where one is held.
  title: PlayerTitle | null;
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
    // keeps them out of the top until they settle. Only never-played rows hide.
    `SELECT RANK() OVER (ORDER BY (r.elo_rating - 2 * r.rating_deviation) DESC) AS rank,
            u.handle, u.display_name, u.title, r.elo_rating, r.rating_deviation, r.games_played
     FROM user_ratings r
     JOIN users u ON u.id = r.user_id
     WHERE r.variant = $1 AND r.time_class = $2
       AND u.profile_visibility IN ('public', 'unlisted')
       AND r.games_played > 0
       AND u.${COUNTED_USER}
     ORDER BY (r.elo_rating - 2 * r.rating_deviation) DESC
     LIMIT $3`,
    [query.variant, query.timeClass, bounded],
  );
  return rows.map((row) => ({
    rank: Number(row.rank),
    handle: row.handle,
    displayName: row.display_name,
    title: row.title,
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
// getLeaderboard: conservative-rating order, visible profiles, played rows
// only. RANK carries the displayed rank (ties share it); ROW_NUMBER bounds
// the panel so a tie at the cutoff can't overflow it. Ladders with no rated
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
                ORDER BY (r.elo_rating - 2 * r.rating_deviation) DESC
              ) AS row_number,
              u.handle, u.display_name, u.title, r.elo_rating, r.rating_deviation, r.games_played
       FROM user_ratings r
       JOIN users u ON u.id = r.user_id
       WHERE r.time_class = $1
         AND u.profile_visibility IN ('public', 'unlisted')
         AND r.games_played > 0
         -- Stats-excluded accounts (the operator, QA) rate mostly test games.
         AND u.${COUNTED_USER}
     ) ranked
     WHERE row_number <= $2
     ORDER BY variant, row_number`,
    [query.timeClass, bounded],
  );
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
// rating ladders are still empty.
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
     WHERE p.subject_type = 'user'
       AND g.status = 'completed'
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
    `SELECT DISTINCT ON (user_id) user_id, variant, elo_rating, rating_deviation
     FROM user_ratings
     WHERE user_id = ANY($1) AND time_class = $2 AND games_played > 0
     ORDER BY user_id, elo_rating DESC`,
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
    `SELECT DISTINCT ON (user_id) user_id, variant, elo_rating, rating_deviation
     FROM user_ratings
     WHERE user_id = ANY($1) AND games_played > 0
     ORDER BY user_id, elo_rating DESC`,
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
