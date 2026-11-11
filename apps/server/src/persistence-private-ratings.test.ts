import assert from 'node:assert/strict';
import test from 'node:test';
import { close, getPool, init } from './persistence-db.js';
import {
  getBestRatings,
  getBestRatingsAnyTimeClass,
  getLeaderboardSummary,
} from './persistence-leaderboards.js';
import { getUserProfileByHandle } from './persistence-profiles.js';
import { PRIVATE_RATING_POOLS, type RatingVariant } from './rating-buckets.js';

test('hidden Gomoku is excluded by every cross-pool leaderboard SQL read', async (t) => {
  const pools = PRIVATE_RATING_POOLS as RatingVariant[];
  const originalPools = [...pools];
  pools.splice(0, pools.length, 'gomoku');
  t.after(() => {
    pools.splice(0, pools.length, ...originalPools);
  });
  init('postgres://localhost/unused-private-rating-test');
  t.after(close);
  const query = t.mock.method(getPool(), 'query', async () => ({ rows: [] }));
  await getLeaderboardSummary({ timeClass: 'blitz' });
  await getBestRatings(['fixture'], 'blitz');
  await getBestRatingsAnyTimeClass(['fixture']);
  const sql = query.mock.calls.map((call) => String(call.arguments[0]));
  assert.match(sql[0]!, /r\.variant NOT IN \('gomoku'\)/);
  for (const statement of sql.slice(1)) assert.match(statement, /variant NOT IN \('gomoku'\)/);
});

test('hidden Gomoku profile ratings are filtered in SQL and dropped from returned activity rows', async (t) => {
  const pools = PRIVATE_RATING_POOLS as RatingVariant[];
  const originalPools = [...pools];
  pools.splice(0, pools.length, 'gomoku');
  t.after(() => {
    pools.splice(0, pools.length, ...originalPools);
  });
  init('postgres://localhost/unused-private-rating-test');
  t.after(close);
  const sql: string[] = [];
  t.mock.method(getPool(), 'query', async (statement: string) => {
    sql.push(statement);
    if (statement.includes('FROM users')) {
      return {
        rows: [
          {
            id: 'fixture',
            handle: 'fixture',
            display_name: 'Test fixture',
            profile_visibility: 'public',
            profile_links: [],
            created_at: new Date(),
          },
        ],
      };
    }
    if (statement.includes('FROM user_ratings')) {
      // Deliberately return the excluded row too, to exercise the output guard.
      return {
        rows: [
          {
            variant: 'gomoku',
            time_class: 'blitz',
            elo_rating: 1500,
            rating_deviation: 350,
            games_played: 1,
          },
        ],
      };
    }
    if (statement.includes('GROUP BY 1'))
      return { rows: [{ variant: 'gomoku', games_played: '1' }] };
    return { rows: [] };
  });
  const profile = await getUserProfileByHandle('fixture', null);
  assert.ok(profile);
  assert.deepEqual(profile.ratings, []);
  assert.match(
    sql.find((statement) => statement.includes('FROM user_ratings'))!,
    /variant NOT IN \('gomoku'\)/,
  );
});
