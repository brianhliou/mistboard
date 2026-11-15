import type pg from 'pg';
import { reportingArticles } from './article-meta.js';
import {
  botSeat,
  COUNTED_USER,
  countedAuthor,
  countedHumanGame,
  countedPlayerSeat,
  countedPuzzlePlayerRow,
  puzzlePlayerId,
  puzzlePlayerKind,
} from './persistence-counted-games.js';
import { publicStudyFilter } from './persistence-studies.js';
import { LISTED_BROADCAST_TOUR } from './persistence-xiangqi-broadcasts.js';
import { SERVED_PUZZLE_FILTER } from './puzzle-store.js';
import type {
  MilestoneMetric,
  MilestoneObservation,
  ReadoutMilestones,
} from './readout-milestones.js';
import { dpxqEventGroup } from './xiangqi-broadcast-groups.js';

type Queryable = Pick<pg.Pool, 'query'>;
const DAY_MS = 86_400_000;

/** Each independent metric fails closed without failing generation or its siblings. */
export async function collectReadoutMilestones(
  db: Queryable,
  now: Date,
): Promise<ReadoutMilestones> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  // Every source yields one timestamp per counted entity. Pace counts only
  // entities first added in the trailing 30 days, not repeat players/solves.
  const count = async (source: string): Promise<MilestoneObservation> => {
    const { rows } = await db.query<MilestoneObservation>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE at >= $2)::int AS "last30Days"
       FROM (${source}) milestone_entities WHERE at < $1`,
      [now, since],
    );
    if (!rows[0]) throw new Error('missing milestone count');
    return rows[0];
  };
  const gameSource = `SELECT g.ended_at AS at FROM games g WHERE ${countedHumanGame('g')}`;
  const pvpSource = `${gameSource} AND g.mode = 'pvp'
    AND NOT EXISTS (SELECT 1 FROM game_participants bp
                    WHERE bp.game_id = g.room_id AND ${botSeat('bp')})`;
  const collectors = {
    completedGames: () => count(gameSource),
    players: () =>
      count(`SELECT min(g.ended_at) AS at FROM game_participants p
      JOIN games g ON g.room_id = p.game_id
      WHERE ${countedPlayerSeat('p')} AND ${countedHumanGame('g')}
      GROUP BY p.subject_type, p.subject_id`),
    accounts: () => count(`SELECT created_at AS at FROM users WHERE ${COUNTED_USER}`),
    pvpGames: () => count(pvpSource),
    ratedGames: () => count(`${pvpSource} AND g.rated`),
    // Quality sessions record guest browser identities from migration 177.
    // Union the older signed-in first-attempt history, then dedupe successes
    // by player + puzzle across visits and across the two sources.
    puzzlesSolved: () =>
      count(`SELECT min(at) AS at FROM (
      SELECT 'user' AS kind, a.user_id AS id, a.puzzle_id, a.created_at AS at
      FROM puzzle_attempts a WHERE a.solved AND ${countedAuthor('a.user_id')}
      UNION ALL
      SELECT ${puzzlePlayerKind('q')} AS kind, ${puzzlePlayerId('q')} AS id,
             q.puzzle_id, q.completed_at AS at
      FROM puzzle_quality_sessions q
      WHERE q.outcome = 'solved' AND ${countedPuzzlePlayerRow('q')}
    ) solves GROUP BY kind, id, puzzle_id`),
    puzzlesOffered: () =>
      count(`SELECT created_at AS at FROM puzzles WHERE ${SERVED_PUZZLE_FILTER}`),
    broadcasts: async () => {
      const { rows } = await db.query<{ name: string; created_at: Date }>(
        `SELECT name, created_at FROM xiangqi_broadcast_tours
         WHERE ${LISTED_BROADCAST_TOUR} AND created_at < $1`,
        [now],
      );
      // A published event can have several tours for its men's/women's/etc
      // groups. The shared source normalizer gives those one event identity;
      // duplicate imports of the same event also count once.
      const events = new Map<string, number>();
      for (const tour of rows) {
        const event = dpxqEventGroup(tour.name).event;
        events.set(event, Math.min(events.get(event) ?? Infinity, tour.created_at.getTime()));
      }
      return {
        total: events.size,
        last30Days: [...events.values()].filter((at) => at >= since.getTime()).length,
      };
    },
    articles: async () => {
      const articles = reportingArticles(now);
      return {
        total: articles.length,
        last30Days: articles.filter((a) => a.liveAt !== null && a.liveAt >= since.getTime()).length,
      };
    },
    studies: () =>
      count(`SELECT s.created_at AS at FROM studies s
      JOIN users u ON u.id = s.owner_id WHERE ${publicStudyFilter()}`),
  } satisfies Record<MilestoneMetric, () => Promise<MilestoneObservation>>;
  const entries = await Promise.all(
    (Object.keys(collectors) as MilestoneMetric[]).map(async (metric) => {
      try {
        return [metric, await collectors[metric]()] as const;
      } catch {
        return [metric, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
