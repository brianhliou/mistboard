import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { GAME_SPECS, gameSpecForId, RATED_POOL_BASES, ratingPoolForSpec } from '@mistboard/game';
import { close, getPool, init } from './persistence-db.js';
import { GAME_VARIANTS_BY_RATING_POOL } from './persistence-profiles.js';
import { tryHandle } from './routes/users.js';

// The profile rail counts a player's games per rating pool with a SQL CASE built
// from GAME_VARIANTS_BY_RATING_POOL. A rated spec whose stored variant is not
// listed under its own pool counts as Fog Chess (the CASE's default).
test('every rated spec counts its profile games in its own pool', () => {
  for (const spec of GAME_SPECS) {
    const pool = spec.rated ? ratingPoolForSpec(spec.id) : null;
    if (!pool) continue;
    const variants: readonly string[] = GAME_VARIANTS_BY_RATING_POOL[pool];
    assert.ok(variants.includes(spec.id), `${spec.id}: not counted in pool ${pool}`);
  }
  assert.deepEqual(GAME_VARIANTS_BY_RATING_POOL.gomoku, ['gomoku']);
  assert.deepEqual(GAME_VARIANTS_BY_RATING_POOL.xiangqi_mahjong, ['xiangqi-mahjong']);
});

test('no stored variant is counted in two pools', () => {
  const seen = new Map<string, string>();
  for (const [pool, variants] of Object.entries(GAME_VARIANTS_BY_RATING_POOL)) {
    for (const variant of variants) {
      assert.equal(seen.get(variant), undefined, `${variant}: in ${seen.get(variant)} and ${pool}`);
      seen.set(variant, pool);
    }
  }
});

test('public Fanfanqi profile activity counts all visible games without a rating or hidden data', async (t) => {
  init('postgres://localhost/profile_activity_test');
  t.after(close);
  const spec = gameSpecForId('ffq-banqi');
  const surface = spec.publicSurface;
  const previousFlag = process.env.MISTBOARD_FFQ_BANQI_ENABLED;
  process.env.MISTBOARD_FFQ_BANQI_ENABLED = 'true';
  t.after(() => {
    spec.publicSurface = surface;
    if (previousFlag === undefined) delete process.env.MISTBOARD_FFQ_BANQI_ENABLED;
    else process.env.MISTBOARD_FFQ_BANQI_ENABLED = previousFlag;
  });
  let activityReads = 0;
  let gamesSql = '';
  let gamesParams: unknown[] = [];
  t.mock.method(getPool(), 'query', async (sql: string, params: unknown[]) => {
    if (sql.includes('lower(handle) = lower($1)'))
      return {
        rows: [
          {
            id: 'alice-id',
            handle: 'alice',
            display_name: 'Alice',
            profile_visibility: 'public',
            created_at: new Date(0),
          },
        ],
      };
    if (sql.includes('AS wins')) {
      activityReads++;
      assert.match(sql, /games.status = 'completed'/);
      assert.match(sql, /games.variant = ANY\(\$2::text\[\]\)/);
      assert.deepEqual(params, ['alice-id', ['ffq-banqi']]);
      assert.match(sql, /games.visibility <> 'private'/);
      assert.match(sql, /game_participants.visibility <> 'private'/);
      assert.match(sql, /FILTER \(WHERE .*games.result = 'draw'/s);
      assert.doesNotMatch(sql, /SELECT\s+payload|board|deal|setup/);
      return {
        rows: [
          {
            variant: 'ffq-banqi',
            games_played: '23',
            wins: '12',
            draws: '3',
            losses: '8',
            deal: 'secret-deal',
          },
        ],
      };
    }
    if (sql.includes('WITH matching_games')) {
      gamesSql = sql;
      gamesParams = params;
    }
    return { rows: [] };
  });
  async function request(path: string) {
    let status = 0;
    let body = '';
    const response = {
      setHeader() {},
      writeHead(code: number) {
        status = code;
      },
      end(chunk: string) {
        body += chunk;
      },
    } as unknown as ServerResponse;
    const url = new URL(path, 'http://localhost');
    assert.equal(
      await tryHandle(
        {},
        { method: 'GET', headers: {} } as IncomingMessage,
        response,
        url.pathname,
        url,
      ),
      true,
    );
    assert.equal(status, 200);
    return JSON.parse(body);
  }
  const publicProfile = await request('/api/users/alice/profile');
  assert.deepEqual(publicProfile.profile.activity, [
    {
      variant: 'ffq-banqi',
      totalGamesPlayed: 23,
      wins: 12,
      draws: 3,
      losses: 8,
    },
  ]);
  assert.deepEqual(publicProfile.profile.ratings, []);
  assert.deepEqual(publicProfile.profile.user.champions, []);
  assert.doesNotMatch(
    JSON.stringify(publicProfile),
    /secret-deal|"deal"|"setup"|"board"|"position"/,
  );
  await request('/api/users/alice/games?variant=ffq-banqi&result=win');
  assert.ok(gamesParams.includes('ffq-banqi'));
  assert.match(gamesSql, /AND games.variant = \$4/);
  assert.match(gamesSql, /games.variant <> 'ffq-banqi'/, 'held correspondence stays excluded');
  spec.publicSurface = 'hidden';
  const hiddenProfile = await request('/api/users/alice/profile');
  assert.deepEqual(hiddenProfile.profile.activity, []);
  assert.equal(activityReads, 1, 'hidden activity is not queried');
  assert.equal(ratingPoolForSpec('ffq-banqi'), null);
  assert.ok(!RATED_POOL_BASES.some((pool: string) => pool === 'ffq_banqi'));
});
