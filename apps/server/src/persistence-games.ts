import {
  BANQI_SPEC_ID,
  type Color,
  DARK_MINI_XIANGQI_SPEC_ID,
  DROP_MINI_XIANGQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  JIEQI_SPEC_ID,
  TIME_CONTROLS,
  type TimeClass,
  XIANGQI_SPEC_ID,
  type XiangqiColor,
} from '@mistboard/game';
import type { MahjongSeat } from '@mistboard/mahjong';
import { engineVersionDisplayName } from './engine-registry.js';
import { getPool, withTransaction } from './persistence-db.js';
import type {
  GameMode,
  GameReviewStatus,
  GameTermination,
  GameVisibility,
} from './persistence-game-lifecycle.js';
import type { XiangqiGameSort } from './persistence-historical-xiangqi.js';
import { bucketForGame } from './rating-buckets.js';
import {
  applyRatedGameResult,
  type RatedParticipantColor,
  type RatedResult,
} from './rating-store.js';

const MIN_TIMEOUT_SOURCE_PLY_COUNT = 10;
// Still used by listRecentPublicGames, which (unlike the watch feed) has no
// termination/last-event consistency guard, so the floor is its only filter
// against 1-ply / no-terminal-event noise. The watch feed itself no longer
// uses a ply floor (it relies on the consistency guard + seal-until-finished).
const MIN_TV_PVP_PLY_COUNT = 30;

// THE curation bar for the site's two flagship surfaces: the homepage viewer
// and the cross-variant Featured watch channel. A curated feed shows only
// games someone played to a real finish — no rage-quits (`abandonment`), no
// near-opening stubs. One constant on purpose: the two surfaces diverged once
// (2026-08-14) because only the homepage filtered, so the homepage froze on a
// game hours older than the one /watch led with, and the homepage widget's link
// landed the visitor on a different game than the board it was attached to.
// Raise or lower it in ONE place or they drift again.
//
// The floor dropped 30 → 20 on 2026-07-30: at Mistboard's liquidity a decisive
// 20-ply game someone actually played is real activity worth showing.
//
// The floor is the WHOLE bar since 2026-09-10. Until then the curated cut also
// dropped every abandonment, so a 26-ply jieqi game a human walked out of never
// fronted the homepage while a 20-ply resignation did, and the site's "latest
// game" lagged real activity by a day when the last four finishes were all
// walk-aways. Twenty plies in, a walk-away is a game someone actually played;
// the floor alone already drops the rage-quits the termination filter was
// doubling up on.
const CURATED_MIN_PLY = 20;

// Kept in lockstep with games_result_check (140). A value outside the
// constraint fails the whole recordGameEnd transaction, participants included.
// The four wind values are mahjong's: a hand has one winner, or nobody.
export type GameResult =
  | 'white-wins'
  | 'black-wins'
  | 'red-wins'
  | 'east-wins'
  | 'south-wins'
  | 'west-wins'
  | 'north-wins'
  | 'draw';
// Kept in lockstep with game_participants_color_check (140).
export type GameParticipantColor = Color | XiangqiColor | MahjongSeat;
export type GameParticipantSubjectType =
  | 'guest'
  | 'user'
  | 'bot'
  | 'engine-version'
  | 'manual'
  | 'imported';

export type GameParticipant = {
  color: GameParticipantColor;
  displayName: string;
  subjectType: GameParticipantSubjectType;
  subjectId: string | null;
  visibility: GameVisibility;
  // The account handle behind a `user` seat, so game-derived surfaces can link the
  // name to /@/<handle>. `subjectId` for a user is the internal user id, which the
  // profile route cannot address. Present ONLY when the seat is safe to link:
  // the account is open and its profile is not private. Null for every other
  // subject type, and for a linkable-in-principle user whose profile is closed or
  // private, so a client rule of "handle present => render a link" is fail-closed.
  handle?: string | null;
  // Engine build version for engine-version seats whose subject_id is version-less (the
  // variant-tenant UCI engines — jieqi/banqi, e.g. subject_id 'misty-banqi'),
  // so games are queryable by build. Null for humans and for engines that already encode
  // the version in subject_id (Misty/DMX). Optional + omitted-when-null to keep the
  // participant shape unchanged for the many constructors that don't set it.
  engineVersion?: string | null;
  // Rating before/after this game, for rated games only (null otherwise). Lets
  // the game page show the +/- delta. Optional so the many non-DB participant
  // constructors don't need to supply it.
  ratingBefore?: number | null;
  ratingAfter?: number | null;
};

export type GameSummary = {
  variant: string;
  mode?: GameMode;
  result: GameResult;
  termination: GameTermination;
  plyCount: number;
  startedAt: Date;
  endedAt: Date;
  whiteClient: string | null;
  blackClient: string | null;
  whiteName: string | null;
  blackName: string | null;
  corpusId: string | null;
  rated?: boolean;
  region?: string | null;
  reviewStatus?: GameReviewStatus;
  visibility?: GameVisibility;
  participants?: GameParticipant[];
  initialMs?: number | null;
  incrementMs?: number | null;
  hiddenDraft960?: boolean | null;
  // A terminal state the kernel finished but that must NOT be recorded as a
  // completed game with a winner. The only current case is an engine failure:
  // the kernel finishes the room as an abandonment so live clients see an end,
  // but a bot cannot abandon, so the ROW is an abort with no result.
  //
  // This rides recordGameEnd rather than abortRunningGame on purpose.
  // abortRunningGame is `UPDATE ... WHERE status = 'running'`, and most tenants
  // deliberately omit recordGameStart (fog xiangqi, xiangqi, jieqi, banqi,
  // jungle), so there is no running row for it to touch: it
  // returns false and changes nothing. recordGameEnd is also the only writer
  // that creates game_participants, so routing an engine failure away from it
  // would drop the game out of the database entirely instead of misfiling it.
  abortedAs?: {
    termination: Extract<GameTermination, 'engine-failure'>;
    abortedReason: string;
  };
};

export type GameRecord = {
  roomId: string;
  variant: string;
  mode: GameMode;
  result: string;
  termination: string;
  plyCount: number;
  startedAt: Date;
  endedAt: Date;
  whiteName: string | null;
  blackName: string | null;
  corpusId: string | null;
  rated: boolean;
  visibility: GameVisibility;
  participants: GameParticipant[];
};

export type ProfileGameRecord = GameRecord & {
  playerColor: GameParticipantColor;
  // Clock for this game (PvP/PvE store it on games.initial_ms / increment_ms;
  // null for clockless games). Drives the time-control badge on the profile row.
  initialMs: number | null;
  incrementMs: number | null;
};

export type RecentEveGameRecord = GameRecord & {
  jobId: string | null;
  gameIndex: number | null;
  whiteEngineId: string | null;
  blackEngineId: string | null;
  timeControl: Record<string, unknown> | null;
  initialMs: number | null;
  incrementMs: number | null;
  // Banqi only: the first-mover seat's bound ink, derived (not stored) and
  // attached by the watch feed so the client can label results by ink.
  firstColor?: 'red' | 'black' | null;
};

export type WatchUnlockedGameOptions = {
  // Apply the flagship curation bar (CURATED_MIN_PLY, any termination) — the
  // same filter the homepage showcase pool uses. Only the Featured channel
  // passes it: per-variant channels stay the full "seal until finished" feed,
  // because at Mistboard's liquidity the bar would empty the thin ones.
  curated?: boolean;
  limit?: number;
  modes?: readonly GameMode[];
  now?: Date;
  variants?: readonly string[];
};

export type WatchSealedGameOptions = {
  activeWindowMs?: number;
  modes?: readonly GameMode[];
  now?: Date;
  variants?: readonly string[];
};

// The game modes a watch channel surfaces. Default = the three "played" modes
// (imported/manual are never watch content). A variant/family channel passes
// ['pvp','pve'] so engine-vs-engine games don't pollute it (decision: EvE lives
// only in the Engines channel); the Engines channel passes ['eve'].
const WATCH_DEFAULT_MODES: readonly GameMode[] = ['pvp', 'pve', 'eve'];

function watchModeFilter(modes: readonly GameMode[] | undefined): GameMode[] {
  const source = modes && modes.length > 0 ? modes : WATCH_DEFAULT_MODES;
  return [...new Set(source)];
}

export type CompletedGameFilters = {
  endedFrom: Date;
  endedTo: Date;
  limit?: number;
  mode?: GameMode;
};

export type FavoriteGamePage = {
  games: RecentEveGameRecord[];
  total: number;
};

export type GameFavoriteState = {
  accessible: boolean;
  favorited: boolean;
};

// ── Game row types + mappers ──────────────────────────────────────────────
// Five list-style queries (listCorpusGames, listRecentEveGames,
// listRecentPublicGames, listCompletedGames, getGameSummary) all return rows
// that map 1:1 into GameRecord/RecentEveGameRecord. Define the row shape and
// the mapper once.

type GameRow = {
  room_id: string;
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
  rated: boolean;
  visibility: GameVisibility;
};

type RecentEveGameRow = GameRow & {
  job_id: string | null;
  game_index: number | null;
  white_engine_id: string | null;
  black_engine_id: string | null;
  time_control: Record<string, unknown> | null;
  initial_ms: number | null;
  increment_ms: number | null;
};

// `games.` prefix because every recent-eve query LEFT JOINs eve_games.
const RECENT_EVE_SELECT_COLUMNS = `games.room_id, games.variant, games.mode, games.result, games.termination,
            games.ply_count, games.started_at, games.ended_at,
            games.white_name, games.black_name, games.corpus_id,
            games.initial_ms, games.increment_ms,
            eve_games.job_id, eve_games.game_index,
            eve_games.white_engine_id, eve_games.black_engine_id,
            eve_games.time_control,
            COALESCE(games.rated, false) AS rated,
            games.visibility`;

function gameRecordFromRow(row: GameRow): GameRecord {
  return {
    roomId: row.room_id,
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
  };
}

function recentEveGameRecordFromRow(row: RecentEveGameRow): RecentEveGameRecord {
  return {
    ...gameRecordFromRow(row),
    jobId: row.job_id,
    gameIndex: row.game_index,
    whiteEngineId: row.white_engine_id,
    blackEngineId: row.black_engine_id,
    timeControl: row.time_control,
    initialMs: row.initial_ms,
    incrementMs: row.increment_ms,
  };
}

export async function listCorpusGames(corpusId: string, limit = 100): Promise<GameRecord[]> {
  const { rows } = await getPool().query<GameRow>(
    `SELECT room_id, variant, mode, result, termination, ply_count, started_at, ended_at,
            white_name, black_name, corpus_id, COALESCE(rated, false) AS rated, visibility
     FROM games
     WHERE corpus_id = $1
       AND status = 'completed'
       AND NOT (termination = 'timeout' AND ply_count < $2)
     ORDER BY room_id
     LIMIT $3`,
    [corpusId, MIN_TIMEOUT_SOURCE_PLY_COUNT, limit],
  );
  return attachGameParticipants(rows.map(gameRecordFromRow));
}

export type EngineVersionStats = {
  engineId: string;
  name: string | null;
  // vs-humans (headline) and vs other engines / bakeoff (secondary), per engine.
  pve: EngineModeRecord;
  eve: EngineModeRecord;
  totalGames: number;
  lastPlayedAt: string | null;
};

// Per-engine-version record across all completed games, split by mode. Sources
// from game_participants (subject_type 'engine-version') — the canonical engine
// attribution, written for every engine game (PvE and EvE) — so the roster stays
// consistent with the per-engine profile (the eve_games sidecar is not written
// by every path). Names come from the engine_versions registry (LEFT JOIN, so an
// id with no registry row still appears under its raw id).
export async function listEngineVersionStats(): Promise<EngineVersionStats[]> {
  const { rows } = await getPool().query<{
    engine_id: string;
    name: string | null;
    total_games: string;
    pve_games: string;
    pve_wins: string;
    pve_losses: string;
    pve_draws: string;
    eve_games: string;
    eve_wins: string;
    eve_losses: string;
    eve_draws: string;
    last_played_at: Date | null;
  }>(
    `SELECT game_participants.subject_id AS engine_id,
            engine_versions.name,
            COUNT(*) AS total_games,
            COUNT(*) FILTER (WHERE games.mode = 'pve') AS pve_games,
            COUNT(*) FILTER (WHERE games.mode = 'pve' AND (
              (game_participants.color = 'white' AND games.result = 'white-wins')
              OR (game_participants.color = 'red' AND games.result = 'red-wins')
              OR (game_participants.color = 'black' AND games.result = 'black-wins')
            )) AS pve_wins,
            COUNT(*) FILTER (WHERE games.mode = 'pve' AND (
              (game_participants.color = 'white' AND games.result = 'black-wins')
              OR (game_participants.color = 'red' AND games.result = 'black-wins')
              OR (game_participants.color = 'black' AND games.result = 'red-wins')
              OR (game_participants.color = 'black' AND games.result = 'white-wins')
            )) AS pve_losses,
            COUNT(*) FILTER (WHERE games.mode = 'pve' AND games.result = 'draw') AS pve_draws,
            COUNT(*) FILTER (WHERE games.mode = 'eve') AS eve_games,
            COUNT(*) FILTER (WHERE games.mode = 'eve' AND (
              (game_participants.color = 'white' AND games.result = 'white-wins')
              OR (game_participants.color = 'red' AND games.result = 'red-wins')
              OR (game_participants.color = 'black' AND games.result = 'black-wins')
            )) AS eve_wins,
            COUNT(*) FILTER (WHERE games.mode = 'eve' AND (
              (game_participants.color = 'white' AND games.result = 'black-wins')
              OR (game_participants.color = 'red' AND games.result = 'black-wins')
              OR (game_participants.color = 'black' AND games.result = 'red-wins')
              OR (game_participants.color = 'black' AND games.result = 'white-wins')
            )) AS eve_losses,
            COUNT(*) FILTER (WHERE games.mode = 'eve' AND games.result = 'draw') AS eve_draws,
            MAX(games.ended_at) AS last_played_at
     FROM game_participants
     JOIN games ON games.room_id = game_participants.game_id
     LEFT JOIN engine_versions ON engine_versions.id = game_participants.subject_id
     WHERE game_participants.subject_type = 'engine-version'
       AND game_participants.subject_id IS NOT NULL
       AND games.status = 'completed'
     GROUP BY game_participants.subject_id, engine_versions.name
     ORDER BY COUNT(*) DESC, game_participants.subject_id`,
  );
  return rows.map((row) => ({
    engineId: row.engine_id,
    name: row.name,
    pve: {
      games: Number(row.pve_games),
      wins: Number(row.pve_wins),
      losses: Number(row.pve_losses),
      draws: Number(row.pve_draws),
    },
    eve: {
      games: Number(row.eve_games),
      wins: Number(row.eve_wins),
      losses: Number(row.eve_losses),
      draws: Number(row.eve_draws),
    },
    totalGames: Number(row.total_games),
    lastPlayedAt: row.last_played_at ? row.last_played_at.toISOString() : null,
  }));
}

export type EngineModeRecord = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
};

export type EngineProfile = {
  engineId: string;
  name: string | null;
  // vs-humans record is the headline. EvE (vs other engines / bakeoff) is secondary.
  pve: EngineModeRecord;
  eve: EngineModeRecord;
  recentPveGames: ProfileGameRecord[];
};

const EMPTY_ENGINE_RECORD: EngineModeRecord = { games: 0, wins: 0, losses: 0, draws: 0 };

// Per-engine-version profile. Sources from game_participants (subject_type
// 'engine-version'), the same polymorphic seat model the user profile reads —
// so it works for PvE (one engine seat) and EvE (two) alike, split by mode.
// PvE is the meaningful competitive record; EvE is internal calibration.
export async function getEngineProfile(engineId: string): Promise<EngineProfile | null> {
  const pool = getPool();

  const nameResult = await pool.query<{ name: string | null }>(
    'SELECT name FROM engine_versions WHERE id = $1',
    [engineId],
  );

  // Per-mode W/L/D from the engine's own perspective (its seat colour vs result).
  const recordResult = await pool.query<{
    mode: GameMode;
    games: string;
    wins: string;
    losses: string;
    draws: string;
  }>(
    `SELECT games.mode,
            COUNT(*) AS games,
            COUNT(*) FILTER (
              WHERE (game_participants.color = 'white' AND games.result = 'white-wins')
                 OR (game_participants.color = 'red' AND games.result = 'red-wins')
                 OR (game_participants.color = 'black' AND games.result = 'black-wins')
            ) AS wins,
            COUNT(*) FILTER (
              WHERE (game_participants.color = 'white' AND games.result = 'black-wins')
                 OR (game_participants.color = 'red' AND games.result = 'black-wins')
                 OR (game_participants.color = 'black' AND games.result = 'red-wins')
                 OR (game_participants.color = 'black' AND games.result = 'white-wins')
            ) AS losses,
            COUNT(*) FILTER (WHERE games.result = 'draw') AS draws
     FROM game_participants
     JOIN games ON games.room_id = game_participants.game_id
     WHERE game_participants.subject_type = 'engine-version'
       AND game_participants.subject_id = $1
       AND games.status = 'completed'
     GROUP BY games.mode`,
    [engineId],
  );

  if (recordResult.rows.length === 0 && nameResult.rows.length === 0) return null;

  const byMode = new Map<string, EngineModeRecord>();
  for (const row of recordResult.rows) {
    byMode.set(row.mode, {
      games: Number(row.games),
      wins: Number(row.wins),
      losses: Number(row.losses),
      draws: Number(row.draws),
    });
  }

  const recentResult = await pool.query<RecentEngineGameRow>(
    `SELECT games.room_id, game_participants.color AS player_color,
            games.variant, games.mode, games.result, games.termination,
            games.ply_count, games.started_at, games.ended_at,
            games.white_name, games.black_name, games.corpus_id,
            games.initial_ms, games.increment_ms,
            COALESCE(games.rated, false) AS rated, games.visibility
     FROM game_participants
     JOIN games ON games.room_id = game_participants.game_id
     WHERE game_participants.subject_type = 'engine-version'
       AND game_participants.subject_id = $1
       AND games.mode = 'pve'
       AND games.status = 'completed'
     ORDER BY games.ended_at DESC, games.room_id DESC
     LIMIT 15`,
    [engineId],
  );
  const recentPveGames = await attachGameParticipants(
    recentResult.rows.map(engineProfileGameFromRow),
  );

  return {
    engineId,
    name: nameResult.rows[0]?.name ?? null,
    pve: byMode.get('pve') ?? EMPTY_ENGINE_RECORD,
    eve: byMode.get('eve') ?? EMPTY_ENGINE_RECORD,
    recentPveGames,
  };
}

type RecentEngineGameRow = {
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
};

function engineProfileGameFromRow(row: RecentEngineGameRow): ProfileGameRecord {
  return {
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
  };
}

export async function listRecentEveGames(limit = 12): Promise<RecentEveGameRecord[]> {
  const { rows } = await getPool().query<RecentEveGameRow>(
    `SELECT ${RECENT_EVE_SELECT_COLUMNS}
     FROM games
     LEFT JOIN eve_games ON eve_games.game_id = games.room_id
     WHERE games.mode = 'eve'
       AND games.status = 'completed'
       AND NOT (games.termination = 'timeout' AND games.ply_count < $1)
     ORDER BY games.ended_at DESC, games.room_id DESC
    LIMIT $2`,
    [MIN_TIMEOUT_SOURCE_PLY_COUNT, limit],
  );
  return attachGameParticipants(rows.map(recentEveGameRecordFromRow));
}

export async function listRecentPublicGames(limit = 10): Promise<RecentEveGameRecord[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const { rows } = await getPool().query<RecentEveGameRow>(
    `SELECT ${RECENT_EVE_SELECT_COLUMNS}
     FROM games
     LEFT JOIN eve_games ON eve_games.game_id = games.room_id
     WHERE games.status = 'completed'
       AND NOT (games.termination = 'timeout' AND games.ply_count < $1)
       AND NOT (games.mode = 'pvp' AND games.ply_count < $3)
       AND NOT (games.mode = 'pve' AND games.ply_count < 2)
       AND EXISTS (
         SELECT 1
         FROM events
         WHERE events.room_id = games.room_id
         LIMIT 1
       )
       AND (
         games.visibility = 'public'
         OR games.mode = 'eve'
         OR (games.mode = 'pve' AND games.visibility <> 'private')
       )
     ORDER BY games.ended_at DESC, games.room_id DESC
     LIMIT $2`,
    [MIN_TIMEOUT_SOURCE_PLY_COUNT, boundedLimit, MIN_TV_PVP_PLY_COUNT],
  );
  return attachGameParticipants(rows.map(recentEveGameRecordFromRow));
}

// Homepage showcase pool. Within a variant, order by tier: PvP (two humans, the
// strongest "alive" signal) → PvE (a real human vs the engine, the product's
// differentiator). Then ROUND-ROBIN across variants so the pool shows breadth
// ("not just dark chess") while volume sets the natural weighting. Both tiers use
// a watch-style filter (any finish, since people resign/flag/walk away far more
// than king-capture) and a ply floor, so a board never opens on a near-starting
// position.
//
// EvE (engine-vs-engine) was a third tier until 2026-08-08 and is now EXCLUDED:
// the homepage board is the site's "is anyone here" signal, and bakeoff self-play
// is synthetic volume that reads as activity without being any. A thin pool of
// real games (or an empty one, which freezes/holds the skeleton) is the honest
// state. EvE still reaches /watch and the game database; it just never fronts the
// homepage. Do not re-add it as a low-liquidity filler tier without deciding that
// tradeoff again.
//
// The ply floor is CURATED_MIN_PLY (see its comment): the same bar the Featured
// watch channel applies, so the homepage's frozen board and /watch?channel=top
// agree on the site's freshest game.
// Pool size. Anchored on "games take minutes to finish, low liquidity"; tune from
// traffic (see also the client poller).
const SHOWCASE_POOL_SIZE = 14;
// The homepage viewer defaults to the dark-chess stack (incl. the legacy 'fog'
// value) when no variant list is supplied; the /api/games/showcase route passes
// the full set of watchable variants so the pool spans every launched variant.
const DEFAULT_SHOWCASE_VARIANTS = ['dark-chess', 'fog'] as const;

export type ShowcaseOptions = {
  variants?: readonly string[];
  limit?: number;
};

export async function listShowcaseGames(
  options: ShowcaseOptions = {},
): Promise<RecentEveGameRecord[]> {
  const bounded = Math.max(1, Math.min(options.limit ?? SHOWCASE_POOL_SIZE, 24));
  const variants =
    options.variants && options.variants.length > 0 ? options.variants : DEFAULT_SHOWCASE_VARIANTS;
  // Over-fetch each tier so the cross-variant interleave has material from more
  // than just the highest-volume variant.
  const fetchLimit = bounded * 4;
  const [pvp, pve] = await Promise.all([
    queryShowcasePvp(fetchLimit, variants),
    queryShowcasePve(fetchLimit, variants),
  ]);
  const tiered = [...pvp, ...pve];
  return leadWithMostRecent(interleaveByVariant(tiered, bounded), tiered);
}

// Move the single most-recently-finished game to the front so the freshest real
// activity greets a first-time visitor, while the rest keeps the de-clustered
// breadth interleave (we deliberately do NOT recency-sort the whole pool — that
// would re-cluster bakeoff dumps the interleave exists to break up).
//
// `candidates` is the FULL tiered input the pool was interleaved from, and the
// lead is elected over it, not over the interleaved pool: the interleave
// truncates to poolSize (at 7 watchable variants x 2 slots it is exactly
// saturated) and PvE sorts after PvP within a variant, so the freshest game on
// the whole site can lose its variant's slot. Electing from survivors then led
// the homepage with a game hours older than the site's latest activity, which is
// the one thing this function exists to prevent. A lead injected this way can
// share a variant with the pool's next entry — the recency override deliberately
// outranks the interleave's no-repeat property.
export function leadWithMostRecent(
  pool: RecentEveGameRecord[],
  candidates: RecentEveGameRecord[] = pool,
): RecentEveGameRecord[] {
  let lead: RecentEveGameRecord | null = null;
  for (const candidate of candidates) {
    if (!lead || candidate.endedAt.getTime() > lead.endedAt.getTime()) lead = candidate;
  }
  if (!lead) return pool;
  const leadGame = lead;
  const at = pool.findIndex((game) => game.roomId === leadGame.roomId);
  if (at === 0) return pool;
  if (at > 0) return [pool[at], ...pool.slice(0, at), ...pool.slice(at + 1)];
  // The freshest game did not survive the breadth truncation: inject it and drop
  // the tail entry so the pool keeps its size.
  return [leadGame, ...pool.slice(0, Math.max(0, pool.length - 1))];
}

// Round-robin the tier-ordered games across their variants: one per variant per
// round, in input (tier-then-recency) order within each variant, skipping
// exhausted variants. Breadth at the front, volume in the tail; never two of the
// same variant back to back until the others run dry. Variant order = first
// appearance in the tiered input, so variants with recent human games lead.
// Exported for the DB-free interleave unit test.
export function interleaveByVariant(
  games: RecentEveGameRecord[],
  poolSize: number,
): RecentEveGameRecord[] {
  const queues = new Map<string, RecentEveGameRecord[]>();
  for (const game of games) {
    const queue = queues.get(game.variant);
    if (queue) queue.push(game);
    else queues.set(game.variant, [game]);
  }
  const order = [...queues.values()];
  const out: RecentEveGameRecord[] = [];
  let progressed = true;
  while (out.length < poolSize && progressed) {
    progressed = false;
    for (const queue of order) {
      const next = queue.shift();
      if (!next) continue;
      out.push(next);
      progressed = true;
      if (out.length >= poolSize) break;
    }
  }
  return out;
}

// Recent substantial PvP, watch-style: any finish past the ply floor.
async function queryShowcasePvp(
  limit: number,
  variants: readonly string[],
): Promise<RecentEveGameRecord[]> {
  const { rows } = await getPool().query<RecentEveGameRow>(
    `SELECT ${RECENT_EVE_SELECT_COLUMNS}
     FROM games
     LEFT JOIN eve_games ON eve_games.game_id = games.room_id
     WHERE games.status = 'completed'
       AND games.visibility = 'public'
       AND games.variant = ANY($3::text[])
       AND games.mode = 'pvp'
       AND games.ply_count >= $1
       AND EXISTS (
         SELECT 1 FROM events WHERE events.room_id = games.room_id LIMIT 1
       )
     ORDER BY games.ended_at DESC, games.room_id DESC
     LIMIT $2`,
    [CURATED_MIN_PLY, limit, variants],
  );
  return attachGameParticipants(rows.map(recentEveGameRecordFromRow));
}

// Recent human-vs-engine games — a real person playing the engine. Same
// watch-style "any finish past the ply floor" filter as PvP; PvE is
// public-by-default (visibility <> 'private') like the watch unlocked feed.
async function queryShowcasePve(
  limit: number,
  variants: readonly string[],
): Promise<RecentEveGameRecord[]> {
  const { rows } = await getPool().query<RecentEveGameRow>(
    `SELECT ${RECENT_EVE_SELECT_COLUMNS}
     FROM games
     LEFT JOIN eve_games ON eve_games.game_id = games.room_id
     WHERE games.status = 'completed'
       AND games.visibility <> 'private'
       AND games.variant = ANY($3::text[])
       AND games.mode = 'pve'
       AND games.ply_count >= $1
       AND EXISTS (
         SELECT 1 FROM events WHERE events.room_id = games.room_id LIMIT 1
       )
     ORDER BY games.ended_at DESC, games.room_id DESC
     LIMIT $2`,
    [CURATED_MIN_PLY, limit, variants],
  );
  return attachGameParticipants(rows.map(recentEveGameRecordFromRow));
}

export async function listWatchUnlockedGames(
  options: WatchUnlockedGameOptions = {},
): Promise<RecentEveGameRecord[]> {
  const boundedLimit = Math.max(1, Math.min(options.limit ?? 64, 64));
  const now = options.now ?? new Date();
  const variants = watchVariantFilter(options.variants);
  // Unified "seal until finished": sealed (uncountable, unviewable) while the
  // game is running, unlocked when it completes — no per-mode ply floor. A
  // completed non-aborted game already has both first moves (an earlier decisive
  // event aborts instead of completing), so the floors only hid real short
  // games while postgame review showed them. The termination/last-event
  // consistency check below still excludes reconnect noise.
  const values: unknown[] = [boundedLimit, now];
  let variantClause = '';
  if (variants) {
    values.push(variants);
    variantClause = `AND games.variant = ANY($${values.length}::text[])`;
  }
  values.push(watchModeFilter(options.modes));
  const modeClause = `AND games.mode = ANY($${values.length}::text[])`;
  // The curated (Featured) cut: same bar as the homepage showcase pool, so the
  // two flagship surfaces agree on the site's freshest game. Note this filters
  // the recency-ordered feed rather than re-ranking it — Top stays "newest
  // first", it just skips the stubs.
  let curatedClause = '';
  if (options.curated) {
    values.push(CURATED_MIN_PLY);
    curatedClause = `AND games.ply_count >= $${values.length}`;
  }
  const { rows } = await getPool().query<RecentEveGameRow>(
    `WITH last_events AS (
       SELECT DISTINCT ON (events.room_id)
              events.room_id,
              events.type
       FROM events
       JOIN games ON games.room_id = events.room_id
       WHERE games.status = 'completed'
         -- Match the last GAMEPLAY-terminal event, ignoring post-game noise such
         -- as seat-assigned from a reconnect (DMX appends these after the final
         -- move, which otherwise fails the termination/last-event consistency
         -- check below and hides the game from watch).
         AND events.type IN ('move-played', 'clock-expired', 'seat-resigned', 'seat-forfeited')
       ORDER BY events.room_id, events.seq DESC
     )
     SELECT ${RECENT_EVE_SELECT_COLUMNS}
     FROM games
     LEFT JOIN eve_games ON eve_games.game_id = games.room_id
     JOIN last_events ON last_events.room_id = games.room_id
     WHERE games.status = 'completed'
       ${variantClause}
       ${modeClause}
       ${curatedClause}
       AND games.ended_at <= $2
       AND (
         -- A move-decided ending always closes on a move-played event, whatever the
         -- variant calls it (checkmate, draw, king/general-captured, race/den-entered,
         -- no-legal-moves/pieces-captured, stalemate, progress-clock, repetition, ...).
         -- Match on the event being the terminal move rather than an explicit
         -- termination allowlist, which silently hid jungle/banqi/flip endings; the
         -- clock/resign/forfeit endings still pair with their own event type.
         (last_events.type = 'move-played'
            AND games.termination NOT IN ('timeout', 'resignation', 'abandonment'))
         OR (games.termination = 'timeout' AND last_events.type = 'clock-expired')
         OR (games.termination = 'resignation' AND last_events.type = 'seat-resigned')
         OR (games.termination = 'abandonment' AND last_events.type = 'seat-forfeited')
       )
       AND (
         games.visibility = 'public'
         OR (games.mode IN ('pve', 'eve') AND games.visibility <> 'private')
       )
     ORDER BY games.ended_at DESC, games.room_id DESC
     LIMIT $1`,
    values,
  );
  return attachGameParticipants(rows.map(recentEveGameRecordFromRow));
}

export async function countWatchSealedGames(options: WatchSealedGameOptions = {}): Promise<number> {
  const activeWindowMs = Math.max(1, options.activeWindowMs ?? 2 * 60 * 60 * 1000);
  const nowMs = (options.now ?? new Date()).getTime();
  const activeSinceMs = nowMs - activeWindowMs;
  const variants = watchVariantFilter(options.variants);
  const values: unknown[] = [activeSinceMs, nowMs];
  let variantClause = '';
  if (variants) {
    values.push(variants);
    variantClause = `AND games.variant = ANY($${values.length}::text[])`;
  }
  values.push(watchModeFilter(options.modes));
  const modeClause = `AND games.mode = ANY($${values.length}::text[])`;
  const { rows } = await getPool().query<{ count: number }>(
    `WITH last_events AS (
       SELECT DISTINCT ON (events.room_id)
              events.room_id,
              events.type,
              events.payload
       FROM events
       JOIN games ON games.room_id = events.room_id
       WHERE games.status = 'running'
       ORDER BY events.room_id, events.seq DESC
     )
     SELECT count(*)::int AS count
     FROM games
     JOIN last_events ON last_events.room_id = games.room_id
     WHERE games.status = 'running'
       ${variantClause}
       ${modeClause}
       AND games.visibility <> 'private'
       AND last_events.type IN ('clock-started', 'draft-start-resolved', 'move-played', 'resume')
       AND (last_events.payload->>'at')::bigint >= $1
       AND (last_events.payload->>'at')::bigint <= $2`,
    values,
  );
  return rows[0]?.count ?? 0;
}

function watchVariantFilter(variants: readonly string[] | undefined): string[] | null {
  if (!variants || variants.length === 0) return null;
  const unique = [...new Set(variants.filter((variant) => variant.length > 0))];
  return unique.length > 0 ? unique : null;
}

export async function listCompletedGames(
  filters: CompletedGameFilters,
): Promise<RecentEveGameRecord[]> {
  const limit = Math.max(1, Math.min(filters.limit ?? 100, 250));
  const values: unknown[] = [filters.endedFrom, filters.endedTo];
  const modeClause = filters.mode ? 'AND games.mode = $3' : '';
  if (filters.mode) values.push(filters.mode);
  values.push(limit);
  const limitParam = values.length;

  const { rows } = await getPool().query<RecentEveGameRow>(
    `SELECT ${RECENT_EVE_SELECT_COLUMNS}
     FROM games
     LEFT JOIN eve_games ON eve_games.game_id = games.room_id
     WHERE games.status = 'completed'
       AND games.ended_at >= $1
       AND games.ended_at < $2
       ${modeClause}
     ORDER BY games.ended_at DESC, games.room_id DESC
     LIMIT $${limitParam}`,
    values,
  );
  return attachGameParticipants(rows.map(recentEveGameRecordFromRow));
}

export async function getGameSummary(roomId: string): Promise<RecentEveGameRecord | null> {
  const { rows } = await getPool().query<RecentEveGameRow>(
    `SELECT ${RECENT_EVE_SELECT_COLUMNS}
     FROM games
     LEFT JOIN eve_games ON eve_games.game_id = games.room_id
     WHERE games.room_id = $1
       AND games.status = 'completed'
     LIMIT 1`,
    [roomId],
  );
  const row = rows[0];
  if (!row) return null;
  const [record] = await attachGameParticipants([recentEveGameRecordFromRow(row)]);
  return record ?? null;
}

// ── Head-to-head (crosstable) ────────────────────────────────────────────────
// The record of two subjects against each other in one variant, read straight
// off game_participants: one self-join, either seat order. "Public" here is the
// profile game list's rule (persistence-profiles.ts profileVisibilityClause):
// the game AND both seats are non-private, so a seat someone chose to hide never
// contributes to a record shown on a page it does not name. Subjects match on
// (subject_type, subject_id) exactly; an engine id that embeds its version only
// matches that version, a version-less one ('misty-banqi') matches every build.

export type HeadToHeadSubject = {
  subjectType: GameParticipantSubjectType;
  subjectId: string;
};

export type HeadToHeadGameRow = {
  roomId: string;
  variant: string;
  result: GameResult;
  endedAt: Date;
  // Subject a's persisted seat colour in that game ('red' for the xiangqi
  // family; see crosstable.ts for the seat mapping).
  aColor: GameParticipantColor;
};

export type HeadToHeadTally = {
  aColor: GameParticipantColor;
  result: GameResult;
  count: number;
};

// Bound params: $1 variant, $2/$3 subject a, $4/$5 subject b.
const HEAD_TO_HEAD_FROM_SQL = `FROM games
     JOIN game_participants a
       ON a.game_id = games.room_id
      AND a.subject_type = $2
      AND a.subject_id = $3
     JOIN game_participants b
       ON b.game_id = games.room_id
      AND b.subject_type = $4
      AND b.subject_id = $5
      AND b.color <> a.color
     WHERE games.variant = $1
       AND games.status = 'completed'
       AND games.visibility <> 'private'
       AND a.visibility <> 'private'
       AND b.visibility <> 'private'`;

function headToHeadParams(a: HeadToHeadSubject, b: HeadToHeadSubject, variant: string): unknown[] {
  return [variant, a.subjectType, a.subjectId, b.subjectType, b.subjectId];
}

// Newest first, capped. Rows carry a's colour so the caller can express each
// result from a's side.
export async function queryHeadToHeadGames(
  a: HeadToHeadSubject,
  b: HeadToHeadSubject,
  variant: string,
  limit: number,
): Promise<HeadToHeadGameRow[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const { rows } = await getPool().query<{
    room_id: string;
    variant: string;
    result: GameResult;
    ended_at: Date;
    a_color: GameParticipantColor;
  }>(
    `SELECT games.room_id, games.variant, games.result, games.ended_at, a.color AS a_color
     ${HEAD_TO_HEAD_FROM_SQL}
     ORDER BY games.ended_at DESC, games.room_id DESC
     LIMIT $6`,
    [...headToHeadParams(a, b, variant), boundedLimit],
  );
  return rows.map((row) => ({
    roomId: row.room_id,
    variant: row.variant,
    result: row.result,
    endedAt: row.ended_at,
    aColor: row.a_color,
  }));
}

// The whole record (not just the listed page), grouped by (a's colour, result)
// so the seat-relative outcome mapping stays in one place (crosstable.ts).
export async function tallyHeadToHeadGames(
  a: HeadToHeadSubject,
  b: HeadToHeadSubject,
  variant: string,
): Promise<HeadToHeadTally[]> {
  const { rows } = await getPool().query<{
    a_color: GameParticipantColor;
    result: GameResult;
    count: number;
  }>(
    `SELECT a.color AS a_color, games.result, count(*)::int AS count
     ${HEAD_TO_HEAD_FROM_SQL}
     GROUP BY a.color, games.result`,
    headToHeadParams(a, b, variant),
  );
  return rows.map((row) => ({ aColor: row.a_color, result: row.result, count: row.count }));
}

// A saved game never grants access. Non-private completed games are saveable by
// any signed-in account; private games are saveable only by an account recorded
// as a participant. Keeping this predicate beside every favorite query prevents
// a later visibility flip from leaking a stale bookmark through the saved list.
const FAVORITE_ACCESS_SQL = `games.status = 'completed'
       AND (
         games.visibility <> 'private'
         OR EXISTS (
           SELECT 1
           FROM game_participants viewer_participant
           WHERE viewer_participant.game_id = games.room_id
             AND viewer_participant.subject_type = 'user'
             AND viewer_participant.subject_id = $2
         )
       )`;

export async function getGameFavoriteState(
  roomId: string,
  userId: string,
): Promise<GameFavoriteState> {
  const { rows } = await getPool().query<{ accessible: boolean; favorited: boolean }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM games
         WHERE games.room_id = $1 AND ${FAVORITE_ACCESS_SQL}
       ) AS accessible,
       EXISTS (
         SELECT 1 FROM game_favorites
         WHERE game_id = $1 AND user_id = $2
       ) AS favorited`,
    [roomId, userId],
  );
  return rows[0] ?? { accessible: false, favorited: false };
}

export async function setGameFavorite(
  roomId: string,
  userId: string,
  favorited: boolean,
): Promise<GameFavoriteState> {
  if (favorited) {
    // INSERT ... SELECT makes the access check and write one statement, so a
    // guessed private/running game id cannot create a dangling bookmark.
    await getPool().query(
      `INSERT INTO game_favorites (game_id, user_id)
       SELECT games.room_id, $2
       FROM games
       WHERE games.room_id = $1 AND ${FAVORITE_ACCESS_SQL}
       ON CONFLICT (user_id, game_id) DO NOTHING`,
      [roomId, userId],
    );
  } else {
    await getPool().query(`DELETE FROM game_favorites WHERE game_id = $1 AND user_id = $2`, [
      roomId,
      userId,
    ]);
  }
  return getGameFavoriteState(roomId, userId);
}

export async function listFavoriteGames(
  userId: string,
  offset = 0,
  limit = 15,
): Promise<FavoriteGamePage> {
  const boundedOffset = Math.max(0, offset);
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const { rows } = await getPool().query<RecentEveGameRow & { total_count: string }>(
    `SELECT ${RECENT_EVE_SELECT_COLUMNS}, COUNT(*) OVER() AS total_count
     FROM game_favorites favorite
     JOIN games ON games.room_id = favorite.game_id
     LEFT JOIN eve_games ON eve_games.game_id = games.room_id
     WHERE favorite.user_id = $1
       AND games.status = 'completed'
       AND (
         games.visibility <> 'private'
         OR EXISTS (
           SELECT 1
           FROM game_participants viewer_participant
           WHERE viewer_participant.game_id = games.room_id
             AND viewer_participant.subject_type = 'user'
             AND viewer_participant.subject_id = $1
         )
       )
     ORDER BY favorite.created_at DESC, favorite.game_id DESC
     LIMIT $2 OFFSET $3`,
    [userId, boundedLimit, boundedOffset],
  );
  return {
    games: await attachGameParticipants(rows.map(recentEveGameRecordFromRow)),
    total: rows.length > 0 ? Number(rows[0]!.total_count) : 0,
  };
}

// ── Faceted game query + aggregates (powers the admin game browser) ─────────
// queryGames / gameAggregates share one WHERE builder so a filtered result page
// and its win-rate readout describe the exact same slice of completed games.

export type GameQueryFilters = {
  // Ordering. Only the /games union passes this; it must match the key that
  // union merges on, or a page is drawn from the wrong candidate set.
  sort?: XiangqiGameSort;
  variant?: string;
  mode?: GameMode;
  // Mode allowlist, for callers that want several modes but not all of them —
  // the public games DB takes 'pvp' and 'pve' and leaves engine-lab self-play
  // out. An empty array matches nothing rather than everything, so a caller
  // that computes its allowlist can never accidentally open the query up.
  modes?: GameMode[];
  visibility?: GameVisibility;
  // Substring match over the stored seat names / corpus label. Public callers
  // need these in SQL rather than as a post-filter on the fetched page: a page
  // filtered in JS cannot report an honest total, and it silently drops rows
  // that sit past the limit.
  player?: string;
  event?: string;
  result?: GameResult;
  termination?: GameTermination;
  rated?: boolean;
  timeClass?: TimeClass;
  plyMin?: number;
  plyMax?: number;
  endedFrom?: Date;
  endedTo?: Date;
  offset?: number;
  limit?: number;
};

export type GameQueryPage = {
  games: RecentEveGameRecord[];
  total: number;
};

export type GameAggregates = {
  total: number;
  results: { whiteWins: number; blackWins: number; redWins: number; draws: number };
  terminations: { termination: string; count: number }[];
  plyCount: { avg: number | null; min: number | null; max: number | null };
};

export type GameFacets = {
  variants: string[];
  modes: string[];
  terminations: string[];
  results: string[];
};

// Translate filters into a parameterized WHERE clause. Every value is bound as a
// query parameter ($n) — nothing is string-interpolated — so the filter set is
// injection-safe even though it is assembled dynamically. Exported for unit
// tests of the param indexing.
export function buildGameQueryWhere(filters: GameQueryFilters): {
  clause: string;
  values: unknown[];
} {
  const conditions: string[] = [`games.status = 'completed'`];
  const values: unknown[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.variant) conditions.push(`games.variant = ${bind(filters.variant)}`);
  if (filters.mode) conditions.push(`games.mode = ${bind(filters.mode)}`);
  if (filters.modes) {
    conditions.push(
      filters.modes.length > 0 ? `games.mode = ANY(${bind(filters.modes)})` : 'FALSE',
    );
  }
  if (filters.visibility) conditions.push(`games.visibility = ${bind(filters.visibility)}`);
  if (filters.player) {
    const like = `%${filters.player}%`;
    conditions.push(
      `(games.white_name ILIKE ${bind(like)} OR games.black_name ILIKE ${bind(like)}
        OR EXISTS (
          SELECT 1 FROM game_participants gp
          WHERE gp.game_id = games.room_id AND gp.display_name ILIKE ${bind(like)}
        ))`,
    );
  }
  if (filters.event) conditions.push(`games.corpus_id ILIKE ${bind(`%${filters.event}%`)}`);
  if (filters.result) conditions.push(`games.result = ${bind(filters.result)}`);
  if (filters.termination) conditions.push(`games.termination = ${bind(filters.termination)}`);
  if (typeof filters.rated === 'boolean') conditions.push(`games.rated = ${bind(filters.rated)}`);
  if (filters.timeClass) {
    const matches = TIME_CONTROLS.filter((tc) => tc.timeClass === filters.timeClass);
    const ors = matches.map(
      (tc) =>
        `(games.initial_ms = ${bind(tc.initialMs)} AND games.increment_ms = ${bind(tc.incrementMs)})`,
    );
    conditions.push(ors.length > 0 ? `(${ors.join(' OR ')})` : 'FALSE');
  }
  if (typeof filters.plyMin === 'number') {
    conditions.push(`games.ply_count >= ${bind(filters.plyMin)}`);
  }
  if (typeof filters.plyMax === 'number') {
    conditions.push(`games.ply_count <= ${bind(filters.plyMax)}`);
  }
  if (filters.endedFrom) conditions.push(`games.ended_at >= ${bind(filters.endedFrom)}`);
  if (filters.endedTo) conditions.push(`games.ended_at < ${bind(filters.endedTo)}`);
  return { clause: conditions.join('\n       AND '), values };
}

/** ORDER BY per sort for games played here. ended_at is what this lane reports
 *  as sortAt, so the union's comparator sees the same order it asked for. */
export function playedGamesOrderBy(sort: XiangqiGameSort | undefined): string {
  switch (sort) {
    case 'oldest':
      return 'games.ended_at ASC, games.room_id ASC';
    case 'longest':
      return 'games.ply_count DESC, games.room_id DESC';
    case 'shortest':
      return 'games.ply_count ASC, games.room_id ASC';
    default:
      return 'games.ended_at DESC, games.room_id DESC';
  }
}

export async function queryGames(filters: GameQueryFilters): Promise<GameQueryPage> {
  const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
  const offset = Math.max(0, filters.offset ?? 0);
  const { clause, values } = buildGameQueryWhere(filters);

  const countResult = await getPool().query<{ total: number }>(
    `SELECT count(*)::int AS total FROM games WHERE ${clause}`,
    values,
  );
  const total = countResult.rows[0]?.total ?? 0;
  if (total === 0) return { games: [], total: 0 };

  const pageValues = [...values, limit, offset];
  const { rows } = await getPool().query<RecentEveGameRow>(
    `SELECT ${RECENT_EVE_SELECT_COLUMNS}
     FROM games
     LEFT JOIN eve_games ON eve_games.game_id = games.room_id
     WHERE ${clause}
     ORDER BY ${playedGamesOrderBy(filters.sort)}
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  const games = await attachGameParticipants(rows.map(recentEveGameRecordFromRow));
  return { games, total };
}

export async function gameAggregates(filters: GameQueryFilters): Promise<GameAggregates> {
  const { clause, values } = buildGameQueryWhere(filters);
  const summary = await getPool().query<{
    total: number;
    white_wins: number;
    black_wins: number;
    red_wins: number;
    draws: number;
    avg_ply: string | null;
    min_ply: number | null;
    max_ply: number | null;
  }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE games.result = 'white-wins')::int AS white_wins,
            count(*) FILTER (WHERE games.result = 'black-wins')::int AS black_wins,
            count(*) FILTER (WHERE games.result = 'red-wins')::int AS red_wins,
            count(*) FILTER (WHERE games.result = 'draw')::int AS draws,
            avg(games.ply_count) AS avg_ply,
            min(games.ply_count)::int AS min_ply,
            max(games.ply_count)::int AS max_ply
     FROM games
     WHERE ${clause}`,
    values,
  );
  const terms = await getPool().query<{ termination: string; count: number }>(
    `SELECT games.termination, count(*)::int AS count
     FROM games
     WHERE ${clause}
     GROUP BY games.termination
     ORDER BY count DESC, games.termination ASC`,
    values,
  );
  const row = summary.rows[0];
  return {
    total: row?.total ?? 0,
    results: {
      whiteWins: row?.white_wins ?? 0,
      blackWins: row?.black_wins ?? 0,
      redWins: row?.red_wins ?? 0,
      draws: row?.draws ?? 0,
    },
    terminations: terms.rows.map((r) => ({ termination: r.termination, count: r.count })),
    plyCount: {
      avg: row?.avg_ply != null ? Math.round(Number(row.avg_ply)) : null,
      min: row?.min_ply ?? null,
      max: row?.max_ply ?? null,
    },
  };
}

// Distinct values present in completed games, for populating filter dropdowns
// from real data rather than a hardcoded list.
export async function gameFacets(): Promise<GameFacets> {
  const { rows } = await getPool().query<{
    variants: string[] | null;
    modes: string[] | null;
    terminations: string[] | null;
    results: string[] | null;
  }>(
    `SELECT array_agg(DISTINCT variant) AS variants,
            array_agg(DISTINCT mode) AS modes,
            array_agg(DISTINCT termination) AS terminations,
            array_agg(DISTINCT result) AS results
     FROM games
     WHERE status = 'completed'`,
  );
  const row = rows[0];
  const clean = (xs: string[] | null | undefined): string[] =>
    [...new Set((xs ?? []).filter((value): value is string => Boolean(value)))].sort();
  return {
    variants: clean(row?.variants),
    modes: clean(row?.modes),
    terminations: clean(row?.terminations),
    results: clean(row?.results),
  };
}

export async function recordGameEnd(roomId: string, summary: GameSummary): Promise<void> {
  const mode = summary.mode ?? (summary.corpusId ? 'imported' : 'pvp');
  const visibility = summary.visibility ?? 'public';
  // An aborted row carries no winner and states the real cause, not the
  // abandonment the kernel used to end the room.
  const result = summary.abortedAs ? null : summary.result;
  const termination = summary.abortedAs?.termination ?? summary.termination;
  await withTransaction(async (client) => {
    const rated = summary.rated ?? false;
    await client.query(
      `INSERT INTO games
         (room_id, variant, result, termination, ply_count, started_at, ended_at,
          white_client, black_client, white_name, black_name, corpus_id,
          mode, status, review_status, visibility, rated,
          initial_ms, increment_ms, hidden_draft960, region, aborted_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $21, $14, $15, $16, $17, $18, $19, $20, $22)
       ON CONFLICT (room_id) DO UPDATE SET
         variant = EXCLUDED.variant,
         result = EXCLUDED.result,
         termination = EXCLUDED.termination,
         ply_count = EXCLUDED.ply_count,
         started_at = EXCLUDED.started_at,
         ended_at = EXCLUDED.ended_at,
         white_client = EXCLUDED.white_client,
         black_client = EXCLUDED.black_client,
         white_name = EXCLUDED.white_name,
         black_name = EXCLUDED.black_name,
         corpus_id = EXCLUDED.corpus_id,
         mode = EXCLUDED.mode,
         status = $21,
         review_status = EXCLUDED.review_status,
         visibility = EXCLUDED.visibility,
         rated = EXCLUDED.rated,
         initial_ms = EXCLUDED.initial_ms,
         increment_ms = EXCLUDED.increment_ms,
         hidden_draft960 = EXCLUDED.hidden_draft960,
         region = EXCLUDED.region,
         aborted_reason = $22
       WHERE games.status = 'running'`,
      [
        roomId,
        summary.variant,
        result,
        termination,
        summary.plyCount,
        summary.startedAt,
        summary.endedAt,
        summary.whiteClient,
        summary.blackClient,
        summary.whiteName,
        summary.blackName,
        summary.corpusId,
        mode,
        summary.reviewStatus ?? 'unreviewed',
        visibility,
        rated,
        summary.initialMs ?? null,
        summary.incrementMs ?? null,
        summary.hiddenDraft960 ?? null,
        summary.region ?? 'global',
        summary.abortedAs ? 'aborted' : 'completed',
        summary.abortedAs?.abortedReason ?? null,
      ],
    );
    const participants =
      summary.participants ?? defaultParticipantsForSummary(summary, mode, visibility);
    for (const participant of participants) {
      await client.query(
        `INSERT INTO game_participants
           (game_id, color, subject_type, subject_id, display_name, visibility, engine_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (game_id, color) DO UPDATE SET
           subject_type = EXCLUDED.subject_type,
           subject_id = EXCLUDED.subject_id,
           display_name = EXCLUDED.display_name,
           visibility = EXCLUDED.visibility,
           engine_version = EXCLUDED.engine_version`,
        [
          roomId,
          participant.color,
          participant.subjectType,
          participant.subjectId,
          participant.displayName,
          participant.visibility,
          participant.engineVersion ?? null,
        ],
      );
    }
    // An aborted row has no result, so there is nothing to rate. Unreachable
    // today (engine failure is always mode 'pve', and PvE is never rated) but
    // stated here so the guard does not depend on that staying true.
    if (mode === 'pvp' && rated && !summary.abortedAs) {
      const bucket = bucketForGame({
        variant: summary.variant,
        initialMs: summary.initialMs,
        incrementMs: summary.incrementMs,
        hiddenDraft960: summary.hiddenDraft960,
      });
      const colors = ratedParticipantColorsForVariant(summary.variant);
      const whiteParticipant = participants.find((p) => p.color === colors.white);
      const blackParticipant = participants.find((p) => p.color === colors.black);
      if (
        bucket &&
        whiteParticipant?.subjectType === 'user' &&
        whiteParticipant.subjectId &&
        blackParticipant?.subjectType === 'user' &&
        blackParticipant.subjectId
      ) {
        await applyRatedGameResult(
          client,
          roomId,
          whiteParticipant.subjectId,
          blackParticipant.subjectId,
          ratedResultForGame(summary.result),
          bucket,
          colors,
        );
      }
    }
  });
}

function ratedParticipantColorsForVariant(variant: string): {
  white: RatedParticipantColor;
  black: RatedParticipantColor;
} {
  if (variant === DARK_MINI_XIANGQI_SPEC_ID || variant === DROP_MINI_XIANGQI_SPEC_ID)
    return { white: 'red', black: 'black' };
  // Jieqi + Banqi are red/black (red = first mover = the white rating slot, like
  // DMX/Drop Mini; banqi keys on the SEAT, not ink). The default result mapping
  // below then applies (red-wins -> white-wins, black-wins passthrough), so no result arm.
  if (variant === JIEQI_SPEC_ID || variant === BANQI_SPEC_ID)
    return { white: 'red', black: 'black' };
  // Standard + Fortress Xiangqi are red/black too. Missing here meant the
  // rating block found no 'white' participant and SILENTLY skipped: the #151
  // flip's first rated game recorded rated=true but moved nobody's rating.
  if (variant === XIANGQI_SPEC_ID || variant === FORTRESS_XIANGQI_SPEC_ID)
    return { white: 'red', black: 'black' };
  return { white: 'white', black: 'black' };
}

function ratedResultForGame(result: GameResult): RatedResult {
  if (result === 'red-wins') return 'white-wins';
  if (result === 'white-wins' || result === 'black-wins' || result === 'draw') return result;
  return 'draw';
}

export async function attachGameParticipants<T extends GameRecord>(records: T[]): Promise<T[]> {
  if (records.length === 0) return records;
  const participants = await loadGameParticipants(records.map((record) => record.roomId));
  return records.map((record) => {
    const recordParticipants = participants.get(record.roomId);
    return {
      ...record,
      participants:
        recordParticipants && recordParticipants.length > 0
          ? recordParticipants
          : fallbackParticipantsForRecord(record),
    };
  });
}

async function loadGameParticipants(roomIds: string[]): Promise<Map<string, GameParticipant[]>> {
  const { rows } = await getPool().query<{
    game_id: string;
    color: GameParticipantColor;
    subject_type: GameParticipantSubjectType;
    subject_id: string | null;
    display_name: string;
    visibility: GameVisibility;
    engine_version: string | null;
    elo_before: number | null;
    elo_after: number | null;
    handle: string | null;
  }>(
    // The users join resolves a `user` seat's linkable handle. It is filtered in
    // the JOIN rather than in a WHERE so a private/closed account still yields its
    // participant row (with a null handle) instead of dropping the seat entirely.
    `SELECT game_participants.game_id, game_participants.color,
            game_participants.subject_type, game_participants.subject_id,
            game_participants.display_name, game_participants.visibility,
            game_participants.engine_version, game_participants.elo_before,
            game_participants.elo_after, users.handle
     FROM game_participants
     LEFT JOIN users
       ON game_participants.subject_type = 'user'
      AND users.id = game_participants.subject_id
      AND users.closed_at IS NULL
      AND users.profile_visibility <> 'private'
     WHERE game_participants.game_id = ANY($1)
     ORDER BY game_participants.game_id,
              CASE game_participants.color WHEN 'white' THEN 0 WHEN 'red' THEN 0 ELSE 1 END`,
    [roomIds],
  );
  const byGame = new Map<string, GameParticipant[]>();
  for (const row of rows) {
    const participant: GameParticipant = {
      color: row.color,
      displayName: row.display_name,
      subjectType: row.subject_type,
      // A guest's subject id is the browser's device id (migration 137): an
      // aggregate key, never something to hand back to a browser, where it
      // would let one visitor's games be tied together by anyone reading the
      // API. Only the SQL aggregates see it.
      subjectId: row.subject_type === 'guest' ? null : row.subject_id,
      visibility: row.visibility,
      // Omitted-when-null so a non-user (or unlinkable) seat keeps the original
      // participant shape, same convention as the fields below.
      ...(row.handle != null ? { handle: row.handle } : {}),
      // Omitted-when-null so the participant shape is unchanged for games without a
      // recorded engine build (humans, pre-versioning rows, version-in-id engines).
      ...(row.engine_version != null ? { engineVersion: row.engine_version } : {}),
      // Only present for rated games; omitted (not null) for unrated so callers
      // and tests that don't care see the original participant shape.
      ...(row.elo_before != null ? { ratingBefore: row.elo_before } : {}),
      ...(row.elo_after != null ? { ratingAfter: row.elo_after } : {}),
    };
    byGame.set(row.game_id, [...(byGame.get(row.game_id) ?? []), participant]);
  }
  return byGame;
}

function defaultParticipantsForSummary(
  summary: GameSummary,
  mode: GameMode,
  visibility: GameVisibility,
): GameParticipant[] {
  return [
    defaultParticipantForColor('white', summary.whiteClient, summary.whiteName, mode, visibility),
    defaultParticipantForColor('black', summary.blackClient, summary.blackName, mode, visibility),
  ];
}

function fallbackParticipantsForRecord(record: GameRecord): GameParticipant[] {
  const eve = record as Partial<RecentEveGameRecord>;
  return [
    fallbackParticipantForColor(
      'white',
      record.whiteName,
      record.mode,
      record.visibility,
      eve.whiteEngineId ?? null,
    ),
    fallbackParticipantForColor(
      'black',
      record.blackName,
      record.mode,
      record.visibility,
      eve.blackEngineId ?? null,
    ),
  ];
}

function defaultParticipantForColor(
  color: Color,
  clientId: string | null,
  displayName: string | null,
  mode: GameMode,
  visibility: GameVisibility,
): GameParticipant {
  if (mode === 'imported' || mode === 'manual') {
    return {
      color,
      displayName: displayName ?? capitalizeColor(color),
      subjectType: mode,
      subjectId: null,
      visibility,
    };
  }
  if (clientId && isEngineIdentity(clientId)) {
    const engineVersionId = canonicalEngineVersionId(clientId);
    return {
      color,
      displayName: displayName ?? engineVersionDisplayName(engineVersionId),
      subjectType: 'engine-version',
      subjectId: engineVersionId,
      visibility,
    };
  }
  return {
    color,
    displayName: displayName ?? 'Guest',
    subjectType: 'guest',
    subjectId: null,
    visibility,
  };
}

function fallbackParticipantForColor(
  color: Color,
  displayName: string | null,
  mode: GameMode,
  visibility: GameVisibility,
  engineVersionId: string | null,
): GameParticipant {
  if (engineVersionId) {
    return {
      color,
      displayName: displayName ?? engineVersionDisplayName(engineVersionId),
      subjectType: 'engine-version',
      subjectId: engineVersionId,
      visibility,
    };
  }
  if (mode === 'imported' || mode === 'manual') {
    return {
      color,
      displayName: displayName ?? capitalizeColor(color),
      subjectType: mode,
      subjectId: null,
      visibility,
    };
  }
  return {
    color,
    displayName: displayName ?? 'Guest',
    subjectType: 'guest',
    subjectId: null,
    visibility,
  };
}

function isEngineIdentity(clientId: string): boolean {
  return (
    clientId === 'random-engine' ||
    clientId === 'engine:white' ||
    clientId === 'engine:black' ||
    clientId.startsWith('engine:') ||
    clientId.startsWith('builtin-') ||
    clientId.startsWith('python-')
  );
}

function canonicalEngineVersionId(clientId: string): string {
  if (clientId === 'random-engine') return 'builtin-random-legal';
  return clientId;
}

function capitalizeColor(color: Color): string {
  return color === 'white' ? 'White' : 'Black';
}
