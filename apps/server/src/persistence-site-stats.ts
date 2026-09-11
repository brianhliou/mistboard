import { countedHumanGame } from './persistence-counted-games.js';
import { getPool } from './persistence-db.js';
import type { GameMode } from './persistence-game-lifecycle.js';

export interface SiteStats {
  accounts: number;
  accountsLast7d: number;
  accountsLast30d: number;
  games: number;
  publicGames: number;
  last7dGames: number;
  gamesByResult: Record<string, number>;
  gamesByVariant: Record<string, number>;
}

export type PublicStatsMode = Extract<GameMode, 'pvp' | 'pve' | 'eve'>;

export interface PublicStatsDay {
  date: string;
  completedGames: number;
  cumulativeGames: number;
}

export interface PublicVariantSeries {
  variant: string;
  total: number;
  // Cumulative completed games for this variant on the SAME date axis as
  // {@link PublicSiteStats.dailyCompletedGames}, so every series lines up when
  // the client switches the chart between them.
  days: PublicStatsDay[];
}

export interface PublicSiteStats {
  generatedAt: string;
  totalCompletedGames: number;
  last30dCompletedGames: number;
  publicGames: number;
  modeTotals: Record<PublicStatsMode, number>;
  // Completed pvp/pve games by variant id, most-played first. Aggregate counts,
  // safe for the public /stats surface.
  variantTotals: Array<{ variant: string; count: number }>;
  dailyCompletedGames: PublicStatsDay[];
  // Per-variant cumulative daily series (most-played first) for the filterable
  // stats chart. Same public/aggregate scope as variantTotals; the client
  // decides which variants to surface.
  variantDaily: PublicVariantSeries[];
}

export type PublicSiteStatsOptions = {
  now?: Date;
};

// Canonical site totals from Postgres (durable, unlike the in-memory
// /api/live-stats). Admin-gated; see routes/meta.ts. count(*)::int is safe at
// our scale (well under 2^31).
export async function getSiteStats(): Promise<SiteStats> {
  const pool = getPool();
  const scalar = await pool.query<{
    accounts: number;
    accounts_last7d: number;
    accounts_last30d: number;
    games: number;
    public_games: number;
    last7d_games: number;
  }>(
    `SELECT
       (SELECT count(*) FROM users)::int AS accounts,
       (SELECT count(*) FROM users WHERE created_at > now() - INTERVAL '7 days')::int AS accounts_last7d,
       (SELECT count(*) FROM users WHERE created_at > now() - INTERVAL '30 days')::int AS accounts_last30d,
       (SELECT count(*) FROM games)::int AS games,
       (SELECT count(*) FROM games WHERE visibility = 'public')::int AS public_games,
       (SELECT count(*) FROM games WHERE ended_at > now() - INTERVAL '7 days')::int AS last7d_games`,
  );
  const byResult = await pool.query<{ result: string; n: number }>(
    `SELECT result, count(*)::int AS n FROM games GROUP BY result ORDER BY n DESC`,
  );
  const byVariant = await pool.query<{ variant: string; n: number }>(
    `SELECT variant, count(*)::int AS n FROM games GROUP BY variant ORDER BY n DESC`,
  );
  const row = scalar.rows[0];
  return {
    accounts: row?.accounts ?? 0,
    accountsLast7d: row?.accounts_last7d ?? 0,
    accountsLast30d: row?.accounts_last30d ?? 0,
    games: row?.games ?? 0,
    publicGames: row?.public_games ?? 0,
    last7dGames: row?.last7d_games ?? 0,
    gamesByResult: Object.fromEntries(byResult.rows.map((r) => [r.result, r.n])),
    gamesByVariant: Object.fromEntries(byVariant.rows.map((r) => [r.variant, r.n])),
  };
}

// Every query below is over `games g` with the shared counted-game filter:
// completed pvp/pve, no stats-excluded seat. The by-mode split keeps its eve
// row (an admin-only figure the client hides on the public page) but applies
// the same seat exclusion to the human rows.
const COUNTED = countedHumanGame('g');

export async function getPublicSiteStats(
  options: PublicSiteStatsOptions = {},
): Promise<PublicSiteStats> {
  const now = options.now ?? new Date();
  const pool = getPool();
  const scalar = await pool.query<{
    total_completed_games: number;
    last30d_completed_games: number;
    public_games: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE ${COUNTED})::int AS total_completed_games,
       count(*) FILTER (
         WHERE ${COUNTED}
           AND g.ended_at > $1::timestamptz - INTERVAL '30 days'
       )::int AS last30d_completed_games,
       count(*) FILTER (
         WHERE ${COUNTED}
           AND g.visibility = 'public'
       )::int AS public_games
     FROM games g`,
    [now],
  );

  const byMode = await pool.query<{ mode: PublicStatsMode; n: number }>(
    `SELECT g.mode, count(*)::int AS n
     FROM games g
     WHERE (${COUNTED}) OR (g.status = 'completed' AND g.mode = 'eve')
     GROUP BY g.mode`,
  );

  const byVariant = await pool.query<{ variant: string; n: number }>(
    `SELECT g.variant, count(*)::int AS n
     FROM games g
     WHERE ${COUNTED}
     GROUP BY g.variant
     ORDER BY n DESC, g.variant ASC`,
  );

  const daily = await pool.query<{ day: Date | string; n: number }>(
    `WITH bounds AS (
       SELECT
         min(g.ended_at)::date AS first_day,
         $1::timestamptz::date AS today
       FROM games g
       WHERE ${COUNTED}
     ),
     days AS (
       SELECT generate_series(bounds.first_day, bounds.today, INTERVAL '1 day')::date AS day
       FROM bounds
       WHERE bounds.first_day IS NOT NULL
     ),
     completed AS (
       SELECT g.ended_at::date AS day, count(*)::int AS n
       FROM games g
       WHERE ${COUNTED}
       GROUP BY day
     )
     SELECT days.day, COALESCE(completed.n, 0)::int AS n
     FROM days
     LEFT JOIN completed ON completed.day = days.day
     ORDER BY days.day ASC`,
    [now],
  );

  let cumulativeGames = 0;
  const dailyCompletedGames = daily.rows.map((row) => {
    cumulativeGames += row.n;
    return {
      date: isoDate(row.day),
      completedGames: row.n,
      cumulativeGames,
    };
  });

  // Per-(day, variant) completed counts, projected onto the same date axis as
  // dailyCompletedGames so each variant series is directly comparable.
  const dailyByVariant = await pool.query<{ day: Date | string; variant: string; n: number }>(
    `SELECT g.ended_at::date AS day, g.variant, count(*)::int AS n
     FROM games g
     WHERE ${COUNTED}
     GROUP BY day, g.variant`,
  );
  const perVariantByDate = new Map<string, Map<string, number>>();
  for (const r of dailyByVariant.rows) {
    const dateKey = isoDate(r.day);
    let byDate = perVariantByDate.get(r.variant);
    if (!byDate) {
      byDate = new Map();
      perVariantByDate.set(r.variant, byDate);
    }
    byDate.set(dateKey, r.n);
  }
  const axis = dailyCompletedGames.map((d) => d.date);
  const variantDaily = byVariant.rows.map((r) => {
    const byDate = perVariantByDate.get(r.variant);
    let cumulative = 0;
    const days = axis.map((date) => {
      const completedGames = byDate?.get(date) ?? 0;
      cumulative += completedGames;
      return { date, completedGames, cumulativeGames: cumulative };
    });
    return { variant: r.variant, total: r.n, days };
  });

  const row = scalar.rows[0];
  return {
    generatedAt: now.toISOString(),
    totalCompletedGames: row?.total_completed_games ?? 0,
    last30dCompletedGames: row?.last30d_completed_games ?? 0,
    publicGames: row?.public_games ?? 0,
    modeTotals: {
      pvp: 0,
      pve: 0,
      eve: 0,
      ...Object.fromEntries(byMode.rows.map((r) => [r.mode, r.n])),
    },
    variantTotals: byVariant.rows.map((r) => ({ variant: r.variant, count: r.n })),
    dailyCompletedGames,
    variantDaily,
  };
}

function isoDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}
