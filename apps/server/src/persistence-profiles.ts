// Profile persistence: profile writes (handle/display-name with cooldown +
// reservation, public details), the preference setters, DM policy, and the
// profile-gated reads (public profile, games pager, rating history). All of
// these share the loadProfileUser + profileVisibilityClause privacy gate.
// Split out of persistence-accounts.ts; the shared users-row plumbing
// (USER_COLUMNS, userFromRow) stays there.
import type { FlairKey } from './flair.js';
import { PROVISIONAL_RD } from './glicko.js';
import {
  type AccountLocale,
  type AccountPreferenceKey,
  type AccountRole,
  type DmPolicy,
  isUniqueViolation,
  type PieceAnimationPreference,
  type ProfileVisibility,
  USER_COLUMNS,
  type UserAccount,
  type UserRow,
  userFromRow,
} from './persistence-accounts.js';
import { getPool, withTransaction } from './persistence-db.js';
import type { GameMode, GameTermination, GameVisibility } from './persistence-game-lifecycle.js';
import type { GameParticipantColor, GameResult, ProfileGameRecord } from './persistence-games.js';
import { attachGameParticipants } from './persistence-games.js';
import type { PlayerTitle } from './persistence-titles.js';
import {
  bucketForGame,
  PUBLIC_RATING_TIME_CLASS,
  PUBLIC_RATING_TIME_CLASSES,
  type RatingTimeClass,
  type RatingVariant,
} from './rating-buckets.js';

// Maps a stored `games.variant` to its rating pool, IN SQL. Extracted so the
// profile's per-variant game COUNT (the rating rail) and its per-variant game
// LIST (the Games tab filter) are the same expression: if they disagreed, a rail
// row would advertise "3 games" over a list that showed a different set.
//
// It has to be SQL rather than the TS ratingPoolForSpec because the mapping
// depends on columns, not just the id: a dark-chess row with hidden_draft960 is
// a fog_draft960 game. It also absorbs pre-rename variant strings ('fog',
// 'draft960') that never became GameSpecAliasIds.
const RATING_POOL_FROM_GAME_SQL = `CASE
         WHEN games.variant = 'dark-mini-xiangqi' THEN 'dark_mini_xiangqi'
         WHEN games.variant = 'drop-mini-xiangqi' THEN 'drop_mini_xiangqi'
         WHEN games.variant = 'dark-xiangqi' THEN 'dark_xiangqi'
         WHEN games.variant = 'jieqi' THEN 'jieqi'
         WHEN games.variant = 'banqi' THEN 'banqi'
         WHEN games.variant = 'reveal-chess' THEN 'reveal_chess'
         WHEN games.variant = 'dark-crazyhouse' THEN 'dark_crazyhouse'
         WHEN games.variant = 'kriegspiel' THEN 'kriegspiel'
         WHEN games.variant = 'jungle' THEN 'jungle'
         WHEN games.variant = 'jungle-flip' THEN 'jungle_flip'
         WHEN games.variant = 'xiangqi' THEN 'xiangqi'
         WHEN games.variant = 'fortress-xiangqi' THEN 'fortress_xiangqi'
         WHEN games.variant = 'duck-xiangqi' THEN 'duck_xiangqi'
         WHEN games.variant IN ('draft960', 'dark-draft960', 'fog-draft960')
              OR COALESCE(games.hidden_draft960, false) THEN 'fog_draft960'
         ELSE 'fog'
       END`;

// The stored variant strings the pool mapping above is defined over. Anything
// outside this set has no pool, so it is excluded rather than falling into the
// CASE's 'fog' default.
const RATED_POOL_VARIANTS_SQL = `games.variant IN ('dark-chess', 'fog', 'draft960', 'dark-draft960', 'fog-draft960', 'dark-mini-xiangqi', 'drop-mini-xiangqi', 'dark-xiangqi', 'xiangqi', 'jieqi', 'banqi', 'reveal-chess', 'dark-crazyhouse', 'kriegspiel', 'jungle', 'jungle-flip', 'fortress-xiangqi', 'duck-xiangqi')`;

export type UpdateUserProfileResult =
  | { ok: true; user: UserAccount }
  | { ok: false; error: 'handle_taken' | 'handle_change_cooldown'; availableAt?: Date };

export type PublicProfileUser = {
  handle: string;
  displayName: string;
  bio: string;
  location: string;
  profileLinks: string[];
  profileVisibility: UserAccount['profileVisibility'];
  accountRole: AccountRole;
  // Verified player title; drives the title badge (flair) on the public
  // profile and user card. NULL = untitled.
  title: PlayerTitle | null;
  // Self-chosen cosmetic icon key (122). Distinct from `title`, which is
  // earned and verified: flair is decoration the account picks for itself and
  // carries no claim about the player.
  flair: FlairKey | null;
  // Set while a donation is active; drives the cosmetic Patron badge on the
  // public profile. NULL = not a patron.
  patronSince: Date | null;
  createdAt: Date;
};

export type ProfileBucketRating = {
  variant: RatingVariant;
  timeClass: RatingTimeClass;
  eloRating: number | null;
  // Count of rated games only. user_ratings.games_played is incremented per
  // rated game; casual games are not counted here. Activity in casual buckets
  // is reflected by the row existing (see UserProfile.ratings filtering).
  ratedGamesPlayed: number;
  // Count of all completed games (rated + casual). Used to decide whether
  // a row should appear for a variant; not surfaced as a number in the UI.
  totalGamesPlayed: number;
  // Rating not yet settled (RD above threshold). Client shows a "?"; RD itself
  // is intentionally not exposed (confusing to players).
  provisional: boolean;
};

// One variant's puzzle rating (Glicko-2 pool, schema in migration 073). Shown on
// the profile alongside game ratings. Only variants the user has attempted appear.
export type ProfilePuzzleRating = {
  // The puzzle variant's GameSpecId (e.g. 'xiangqi', 'fortress-xiangqi', 'jungle').
  variant: string;
  rating: number;
  provisional: boolean;
  solved: number;
  attempts: number;
};

export type UserProfile = {
  user: PublicProfileUser;
  ratings: ProfileBucketRating[];
  // Per-variant puzzle ratings (empty when the user has attempted no puzzles).
  puzzleRatings: ProfilePuzzleRating[];
  // First page of games (newest first). Older pages load via getUserGamesPage.
  games: ProfileGameRecord[];
  // Total completed games visible to the viewer, so the client can show an
  // accurate count and decide whether to offer "Load more".
  gamesTotal: number;
};

export type ProfileRatingHistoryPoint = {
  roomId: string;
  endedAt: Date;
  ratingBefore: number;
  ratingAfter: number;
};

export type ProfileRatingHistory = {
  variant: RatingVariant;
  timeClass: RatingTimeClass;
  points: ProfileRatingHistoryPoint[];
};

export async function updateUserProfile(
  userId: string,
  updates: { handle: string; displayName: string },
  at: Date,
): Promise<UpdateUserProfileResult> {
  const handleCooldownMs = 30 * 24 * 60 * 60 * 1000;
  const handleReservationMs = 90 * 24 * 60 * 60 * 1000;
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query<UserRow>(
        `SELECT ${USER_COLUMNS}
       FROM users
       WHERE id = $1
       FOR UPDATE`,
        [userId],
      );
      const current = rows[0] ? userFromRow(rows[0]) : null;
      if (!current) throw new Error(`missing user ${userId}`);

      const nextHandle = updates.handle;
      const nextDisplayName = updates.displayName;
      const handleChanged = nextHandle !== current.handle;
      const displayNameChanged = nextDisplayName !== current.displayName;

      if (handleChanged) {
        if (
          current.handleChangedAt &&
          at.getTime() - current.handleChangedAt.getTime() < handleCooldownMs
        ) {
          return {
            ok: false,
            error: 'handle_change_cooldown',
            availableAt: new Date(current.handleChangedAt.getTime() + handleCooldownMs),
          };
        }
        const { rows: conflicts } = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
           SELECT 1 FROM users WHERE lower(handle) = lower($1) AND id <> $2
           UNION ALL
           SELECT 1 FROM user_handle_reservations
           WHERE lower(handle) = lower($1)
             AND user_id <> $2
             AND expires_at > $3
         ) AS exists`,
          [nextHandle, userId, at],
        );
        if (conflicts[0]?.exists) {
          return { ok: false, error: 'handle_taken' };
        }
        await client.query(
          `INSERT INTO user_handle_reservations (handle, user_id, reserved_at, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (handle) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             reserved_at = EXCLUDED.reserved_at,
             expires_at = EXCLUDED.expires_at`,
          [current.handle, userId, at, new Date(at.getTime() + handleReservationMs)],
        );
      }

      const { rows: updatedRows } = await client.query<UserRow>(
        `UPDATE users
       SET handle = $2,
           handle_changed_at = CASE WHEN $4 THEN $6 ELSE handle_changed_at END,
           display_name = $3,
           display_name_changed_at = CASE WHEN $5 THEN $6 ELSE display_name_changed_at END,
           updated_at = $6
       WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
        [userId, nextHandle, nextDisplayName, handleChanged, displayNameChanged, at],
      );
      return { ok: true, user: userFromRow(updatedRows[0]!) };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'handle_taken' };
    throw err;
  }
}

export async function updateUserPublicProfileDetails(
  userId: string,
  details: { bio: string; location: string; profileLinks: string[]; flair: FlairKey | null },
  at: Date,
): Promise<UserAccount | null> {
  const { rows } = await getPool().query<UserRow>(
    `UPDATE users
     SET bio = $2,
         location = $3,
         profile_links = $4,
         flair = $5,
         updated_at = $6
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, details.bio, details.location, details.profileLinks, details.flair, at],
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function updateUserPieceAnimationPreference(
  userId: string,
  pieceAnimation: PieceAnimationPreference,
  at: Date,
): Promise<UserAccount | null> {
  const { rows } = await getPool().query<UserRow>(
    `UPDATE users
     SET display_preferences = jsonb_set(
           display_preferences,
           '{pieceAnimation}',
           to_jsonb($2::text),
           true
         ),
         updated_at = $3
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, pieceAnimation, at],
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function updateUserAccountPreference(
  userId: string,
  key: AccountPreferenceKey,
  value: string | boolean,
  at: Date,
): Promise<UserAccount | null> {
  const { rows } = await getPool().query<UserRow>(
    `UPDATE users
     SET account_preferences = jsonb_set(
           account_preferences,
           ARRAY[$2::text],
           $3::jsonb,
           true
         ),
         updated_at = $4
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, key, JSON.stringify(value), at],
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function updateUserLocale(
  userId: string,
  locale: AccountLocale | null,
  at: Date,
): Promise<UserAccount | null> {
  const { rows } = await getPool().query<UserRow>(
    `UPDATE users
     SET locale = $2,
         updated_at = $3
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, locale, at],
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function updateUserProfileVisibility(
  userId: string,
  profileVisibility: ProfileVisibility,
  at: Date,
): Promise<UserAccount | null> {
  const { rows } = await getPool().query<UserRow>(
    `UPDATE users
     SET profile_visibility = $2,
         updated_at = $3
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, profileVisibility, at],
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function updateUserDmPolicy(
  userId: string,
  dmPolicy: DmPolicy,
  at: Date,
): Promise<UserAccount | null> {
  const { rows } = await getPool().query<UserRow>(
    `UPDATE users
     SET dm_policy = $2,
         updated_at = $3
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, dmPolicy, at],
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

// The inbox send guard's read: the target's policy by id, defaulting closed
// to 'never' if the row vanished mid-request.
export async function getUserDmPolicy(userId: string): Promise<DmPolicy> {
  const { rows } = await getPool().query<{ dm_policy: DmPolicy }>(
    `SELECT dm_policy FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.dm_policy ?? 'never';
}

// Default page size for the profile games list. The first page ships with the
// profile payload; the rest load lazily via getUserGamesPage.
const PROFILE_GAMES_PAGE = 15;

// Resolve a public profile user by handle (case-insensitive). Null when the
// handle doesn't exist.
async function loadProfileUser(handle: string): Promise<UserAccount | null> {
  const { rows } = await getPool().query<UserRow>(
    `SELECT ${USER_COLUMNS}
     FROM users
     WHERE lower(handle) = lower($1)
     LIMIT 1`,
    [handle],
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

// Build the visibility filter for a profile's game queries. A viewer sees their
// own private games; everyone else is restricted to non-private rows.
function profileVisibilityClause(isViewer: boolean): string {
  return isViewer
    ? ''
    : `AND games.visibility <> 'private'
       AND game_participants.visibility <> 'private'`;
}

// One page of a user's completed games, newest first. total_count is a window
// aggregate (COUNT(*) OVER()) so the caller learns the full match count in the
// same round-trip — used to drive the profile "Load more" pager.
async function queryUserGames(
  userId: string,
  isViewer: boolean,
  offset: number,
  limit: number,
  // Rating pool to scope the history to, or null for every variant. Compared
  // against the stored spec ids AND their legacy aliases, so a pool's older
  // rows ('fog-draft960') are not silently dropped from its own history.
  ratingVariant: RatingVariant | null = null,
): Promise<{ games: ProfileGameRecord[]; total: number }> {
  const { rows } = await getPool().query<{
    room_id: string;
    player_color: GameParticipantColor;
    variant: string;
    mode: GameMode;
    result: string;
    termination: string;
    ply_count: number;
    started_at: Date;
    ended_at: Date;
    white_name: string | null;
    black_name: string | null;
    corpus_id: string | null;
    initial_ms: number | null;
    increment_ms: number | null;
    rated: boolean;
    visibility: GameVisibility;
    total_count: string;
  }>(
    `SELECT games.room_id, game_participants.color AS player_color,
            games.variant, games.mode, games.result, games.termination,
            games.ply_count, games.started_at, games.ended_at,
            games.white_name, games.black_name, games.corpus_id,
            games.initial_ms, games.increment_ms,
            COALESCE(games.rated, false) AS rated, games.visibility,
            COUNT(*) OVER() AS total_count
     FROM game_participants
     JOIN games ON games.room_id = game_participants.game_id
     WHERE game_participants.subject_type = 'user'
       AND game_participants.subject_id = $1
       AND games.status = 'completed'
       ${ratingVariant ? `AND ${RATED_POOL_VARIANTS_SQL} AND ${RATING_POOL_FROM_GAME_SQL} = $4` : ''}
       ${profileVisibilityClause(isViewer)}
     ORDER BY games.ended_at DESC, games.room_id DESC
     LIMIT $2 OFFSET $3`,
    // COUNT(*) OVER() sits inside the same WHERE, so `total` is the FILTERED
    // total -- which is what the Games tab count and the "Load more" exhaustion
    // check both need once a pool is selected.
    ratingVariant ? [userId, limit, offset, ratingVariant] : [userId, limit, offset],
  );
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const games = rows.map(
    (row): ProfileGameRecord => ({
      roomId: row.room_id,
      playerColor: row.player_color,
      variant: row.variant,
      mode: row.mode,
      result: row.result as GameResult,
      termination: row.termination as GameTermination,
      plyCount: row.ply_count,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      whiteName: row.white_name,
      blackName: row.black_name,
      corpusId: row.corpus_id,
      initialMs: row.initial_ms,
      incrementMs: row.increment_ms,
      rated: row.rated,
      visibility: row.visibility,
      participants: [],
    }),
  );
  return { games: await attachGameParticipants(games), total };
}

// First page of a profile: identity, bucketed ratings, and the newest games.
// Older game pages load lazily via getUserGamesPage.
export async function getUserProfileByHandle(
  handle: string,
  viewerUserId: string | null,
): Promise<UserProfile | null> {
  const user = await loadProfileUser(handle);
  if (!user) return null;

  const isViewer = viewerUserId === user.id;
  if (user.profileVisibility === 'private' && !isViewer) return null;

  const { games, total: gamesTotal } = await queryUserGames(
    user.id,
    isViewer,
    0,
    PROFILE_GAMES_PAGE,
  );

  const visibilityClause = profileVisibilityClause(isViewer);
  // Every rated time class, not just the default one: each rated live pace has
  // its own ladder, so a player's bullet rating must be reachable from their
  // profile rather than silently existing in the database.
  const { rows: ratingRows } = await getPool().query<{
    variant: RatingVariant;
    time_class: RatingTimeClass;
    elo_rating: number;
    rating_deviation: number;
    games_played: number;
  }>(
    `SELECT variant, time_class, elo_rating, rating_deviation, games_played
     FROM user_ratings
     WHERE user_id = $1`,
    [user.id],
  );
  const ratingsByVariant = new Map<
    RatingVariant,
    Map<RatingTimeClass, { eloRating: number; gamesPlayed: number; ratingDeviation: number }>
  >();
  for (const row of ratingRows) {
    let byClass = ratingsByVariant.get(row.variant);
    if (!byClass) {
      byClass = new Map();
      ratingsByVariant.set(row.variant, byClass);
    }
    byClass.set(row.time_class, {
      eloRating: row.elo_rating,
      gamesPlayed: row.games_played,
      ratingDeviation: row.rating_deviation,
    });
  }

  // Public ratings are one pool per variant. Count all completed visible games
  // in that variant so pre-rated activity still earns a profile row.
  const { rows: variantCountRows } = await getPool().query<{
    variant: RatingVariant;
    games_played: string;
  }>(
    `SELECT
       ${RATING_POOL_FROM_GAME_SQL} AS variant,
       COUNT(*)::text AS games_played
     FROM game_participants
     JOIN games ON games.room_id = game_participants.game_id
     WHERE game_participants.subject_type = 'user'
       AND game_participants.subject_id = $1
       AND games.status = 'completed'
       AND ${RATED_POOL_VARIANTS_SQL}
       ${visibilityClause}
     GROUP BY 1`,
    [user.id],
  );
  const variantGameCounts = new Map<RatingVariant, number>();
  for (const row of variantCountRows) {
    variantGameCounts.set(row.variant, Number(row.games_played));
  }

  // One row per rated (variant, time class) the player actually has, plus a
  // single activity row per variant with no rated games at all — that row is
  // what lets casual-only and correspondence play still show up on a profile,
  // and its game count is variant-wide (paces are not comparable, but the
  // "N games played" line was never a per-pace number).
  const variantKeys = new Set<RatingVariant>([
    ...ratingsByVariant.keys(),
    ...variantGameCounts.keys(),
  ]);
  const ratings: ProfileBucketRating[] = [];
  for (const variant of variantKeys) {
    const totalGames = variantGameCounts.get(variant) ?? 0;
    const byClass = ratingsByVariant.get(variant);
    const ratedClasses = PUBLIC_RATING_TIME_CLASSES.filter(
      (timeClass) => (byClass?.get(timeClass)?.gamesPlayed ?? 0) > 0,
    );
    if (ratedClasses.length === 0) {
      if (totalGames === 0) continue;
      ratings.push({
        variant,
        timeClass: PUBLIC_RATING_TIME_CLASS,
        eloRating: null,
        ratedGamesPlayed: 0,
        totalGamesPlayed: totalGames,
        provisional: false,
      });
      continue;
    }
    for (const timeClass of ratedClasses) {
      const rating = byClass?.get(timeClass);
      ratings.push({
        variant,
        timeClass,
        eloRating: rating?.eloRating ?? null,
        ratedGamesPlayed: rating?.gamesPlayed ?? 0,
        totalGamesPlayed: totalGames,
        provisional: rating ? rating.ratingDeviation > PROVISIONAL_RD : false,
      });
    }
  }

  // Puzzle ratings (separate Glicko-2 pool). Show only variants the user has
  // actually attempted, so an untouched pool never renders a default 1500.
  const { rows: puzzleRatingRows } = await getPool().query<{
    variant: string;
    rating: number;
    rating_deviation: number;
    solved: number;
    attempts: number;
  }>(
    `SELECT variant, rating, rating_deviation, solved, attempts
       FROM user_puzzle_ratings
       WHERE user_id = $1 AND attempts > 0
       ORDER BY attempts DESC`,
    [user.id],
  );
  const puzzleRatings: ProfilePuzzleRating[] = puzzleRatingRows.map((row) => ({
    variant: row.variant,
    rating: Math.round(row.rating),
    provisional: row.rating_deviation > PROVISIONAL_RD,
    solved: row.solved,
    attempts: row.attempts,
  }));

  return {
    user: {
      handle: user.handle,
      displayName: user.displayName,
      bio: user.bio,
      location: user.location,
      profileLinks: user.profileLinks,
      profileVisibility: user.profileVisibility,
      accountRole: user.accountRole,
      title: user.title,
      flair: user.flair,
      patronSince: user.patronSince,
      createdAt: user.createdAt,
    },
    ratings,
    puzzleRatings,
    games,
    gamesTotal,
  };
}

// A page of a user's games for the profile "Load more" pager. Returns null when
// the profile is missing or private to a non-viewer (same gate as the full
// profile), so the endpoint can 404 without leaking existence.
export async function getUserGamesPage(
  handle: string,
  viewerUserId: string | null,
  offset: number,
  limit: number,
  ratingVariant: RatingVariant | null = null,
): Promise<{ games: ProfileGameRecord[]; total: number } | null> {
  const user = await loadProfileUser(handle);
  if (!user) return null;
  const isViewer = viewerUserId === user.id;
  if (user.profileVisibility === 'private' && !isViewer) return null;
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const boundedOffset = Math.max(0, offset);
  return queryUserGames(user.id, isViewer, boundedOffset, boundedLimit, ratingVariant);
}

export async function getUserRatingHistory(
  handle: string,
  viewerUserId: string | null,
  variant: RatingVariant,
  timeClass: RatingTimeClass = PUBLIC_RATING_TIME_CLASS,
): Promise<ProfileRatingHistory | null> {
  const user = await loadProfileUser(handle);
  if (!user) return null;
  const isViewer = viewerUserId === user.id;
  if (user.profileVisibility === 'private' && !isViewer) return null;

  const { rows } = await getPool().query<{
    room_id: string;
    variant: string;
    hidden_draft960: boolean | null;
    initial_ms: number | null;
    increment_ms: number | null;
    ended_at: Date;
    elo_before: number;
    elo_after: number;
  }>(
    `SELECT games.room_id, games.variant, games.hidden_draft960,
            games.initial_ms, games.increment_ms, games.ended_at,
            game_participants.elo_before, game_participants.elo_after
     FROM game_participants
     JOIN games ON games.room_id = game_participants.game_id
     WHERE game_participants.subject_type = 'user'
       AND game_participants.subject_id = $1
       AND games.status = 'completed'
       AND games.mode = 'pvp'
       AND COALESCE(games.rated, false) = true
       AND game_participants.elo_before IS NOT NULL
       AND game_participants.elo_after IS NOT NULL
       ${profileVisibilityClause(isViewer)}
     ORDER BY games.ended_at ASC, games.room_id ASC`,
    [user.id],
  );

  const points = rows
    .filter((row) => {
      const bucket = bucketForGame({
        variant: row.variant,
        initialMs: row.initial_ms,
        incrementMs: row.increment_ms,
        hiddenDraft960: row.hidden_draft960,
      });
      return bucket?.variant === variant && bucket.timeClass === timeClass;
    })
    .map(
      (row): ProfileRatingHistoryPoint => ({
        roomId: row.room_id,
        endedAt: row.ended_at,
        ratingBefore: row.elo_before,
        ratingAfter: row.elo_after,
      }),
    );

  return { variant, timeClass, points };
}
