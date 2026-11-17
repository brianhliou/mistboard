import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { FFQ_BANQI_SPEC_ID, gameSpecForId } from '@mistboard/game';
import {
  countedPublicGame,
  offPublicGameSpecIds,
  publicVariant,
} from './persistence-counted-games.js';
import { close, getPool, init } from './persistence-db.js';
import {
  countWatchSealedGames,
  gameAggregates,
  gameFacets,
  getGameFavoriteState,
  listFavoriteGames,
  listRecentEveGames,
  listRecentPublicGames,
  listShowcaseGames,
  listWatchUnlockedGames,
  queryGames,
  queryHeadToHeadGames,
  setGameFavorite,
  tallyHeadToHeadGames,
} from './persistence-games.js';
import {
  getUserGamesPage,
  getUserProfileByHandle,
  getUserRatingHistory,
} from './persistence-profiles.js';

function hiddenFixture(t: TestContext) {
  const spec = gameSpecForId(FFQ_BANQI_SPEC_ID);
  const surface = spec.publicSurface;
  spec.publicSurface = 'hidden';
  t.after(() => {
    spec.publicSurface = surface;
  });
}

test('FFQ public totals include correspondence only after launch', (t) => {
  hiddenFixture(t);
  const previous = process.env.MISTBOARD_FFQ_BANQI_ENABLED;
  process.env.MISTBOARD_FFQ_BANQI_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.MISTBOARD_FFQ_BANQI_ENABLED;
    else process.env.MISTBOARD_FFQ_BANQI_ENABLED = previous;
  });
  assert.ok(offPublicGameSpecIds().includes(FFQ_BANQI_SPEC_ID));
  assert.match(publicVariant('games'), /'ffq-banqi'/);
  assert.match(countedPublicGame('games'), /'ffq-banqi'/);
  const spec = gameSpecForId(FFQ_BANQI_SPEC_ID) as { publicSurface: string };
  const surface = spec.publicSurface;
  spec.publicSurface = 'casual';
  try {
    assert.ok(!offPublicGameSpecIds().includes(FFQ_BANQI_SPEC_ID));
    assert.doesNotMatch(publicVariant('games'), /variant NOT IN \('ffq-banqi'\)/);
    for (const sql of [publicVariant('games'), countedPublicGame('games')]) {
      assert.doesNotMatch(sql, /ffq-banqi|daysPerMove/);
    }
  } finally {
    spec.publicSurface = surface;
  }
});

test('FFQ SQL discovery filters run before ordering, pagination and window totals', async (t) => {
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(() => close());
  t.mock.method(getPool(), 'connect', () => assert.fail('unexpected database connection'));
  const queries: string[] = [];
  t.mock.method(getPool(), 'query', async (sql: string) => {
    queries.push(sql);
    if (sql.includes('FROM users') && sql.includes('lower(handle)')) {
      return {
        rows: [
          {
            id: 'admin',
            handle: 'admin',
            account_role: 'admin',
            profile_visibility: 'public',
            profile_links: [],
            created_at: new Date(0),
          },
        ],
      };
    }
    return { rows: [] };
  });
  const a = { subjectType: 'user', subjectId: 'admin' } as const;
  const b = { subjectType: 'user', subjectId: 'other-admin' } as const;
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['recent public games', () => listRecentPublicGames()],
    ['recent engines', () => listRecentEveGames()],
    ['showcase with explicit FFQ selector', () => listShowcaseGames({ variants: ['ffq-banqi'] })],
    ['unfiltered watch feed', () => listWatchUnlockedGames()],
    ['FFQ watch selector', () => listWatchUnlockedGames({ variants: ['ffq-banqi'] })],
    ['sealed watch total', () => countWatchSealedGames()],
    ['head-to-head history', () => queryHeadToHeadGames(a, b, FFQ_BANQI_SPEC_ID, 10)],
    ['head-to-head totals', () => tallyHeadToHeadGames(a, b, FFQ_BANQI_SPEC_ID)],
    ['favorite access', () => getGameFavoriteState('ffq_discovery', 'admin')],
    ['save favorite', () => setGameFavorite('ffq_discovery', 'admin', true)],
    ['favorite list and total', () => listFavoriteGames('admin')],
    ['public profile history and total', () => getUserGamesPage('admin', null, 0, 15)],
    ['owner profile history and total', () => getUserGamesPage('admin', 'admin', 0, 15)],
    ['initial profile and totals', () => getUserProfileByHandle('admin', null)],
    ['rating history', () => getUserRatingHistory('admin', null, 'banqi')],
    ['game list and totals', () => queryGames({ excludeFFQ: true, visibility: 'public' })],
    ['game aggregates', () => gameAggregates({ excludeFFQ: true, visibility: 'public' })],
    ['game facets', () => gameFacets(true)],
  ];
  const spec = gameSpecForId(FFQ_BANQI_SPEC_ID);
  const surface = spec.publicSurface;
  t.after(() => {
    spec.publicSurface = surface;
  });
  for (const launch of ['hidden', 'casual'] as const) {
    spec.publicSurface = launch;
    for (const [label, run] of cases) {
      await t.test(`${launch}: ${label}`, async () => {
        queries.length = 0;
        await run();
        const gameQueries = queries.filter((sql) => /(?:FROM|JOIN) games\b/.test(sql));
        assert.ok(gameQueries.length > 0, 'exercises a real persistence query');
        for (const sql of gameQueries) {
          if (launch === 'hidden') assert.match(sql, /games\.variant NOT IN \('ffq-banqi'\)/);
          else {
            assert.doesNotMatch(sql, /games\.variant NOT IN \('ffq-banqi'\)/);
            assert.doesNotMatch(sql, /games\.variant <> 'ffq-banqi' OR NOT EXISTS/);
            assert.doesNotMatch(sql, /\blc\./);
            if (sql.includes('WITH matching_games') || label.startsWith('game '))
              assert.doesNotMatch(sql, /daysPerMove/);
            // TV keeps its independent, all-variant correspondence exclusion.
            if (label.includes('showcase') || label.includes('watch'))
              assert.match(sql, /rc\.payload->'timeControl' \? 'daysPerMove'/);
          }
          if (label === 'public profile history and total') {
            assert.match(sql, /games\.visibility <> 'private'/);
            assert.match(sql, /game_participants\.visibility <> 'private'/);
          }
          if (label === 'owner profile history and total')
            assert.doesNotMatch(sql, /visibility <> 'private'/);
        }
      });
    }
  }
});

test('authorized FFQ profile pages and admin queries keep the variant before pagination', async (t) => {
  hiddenFixture(t);
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(() => close());
  const queries: string[] = [];
  t.mock.method(getPool(), 'query', async (sql: string) => {
    queries.push(sql);
    if (sql.includes('FROM users') && sql.includes('lower(handle)')) {
      return {
        rows: [
          {
            id: 'admin',
            handle: 'admin',
            account_role: 'admin',
            profile_visibility: 'public',
            profile_links: [],
            created_at: new Date(0),
          },
        ],
      };
    }
    return { rows: [] };
  });
  await getUserGamesPage('admin', 'admin', 0, 15, { includeFFQ: true });
  const profileQuery = queries.find((sql) => sql.includes('WITH matching_games'));
  assert.ok(profileQuery);
  assert.ok(!profileQuery.includes("games.variant NOT IN ('ffq-banqi')"));
  queries.length = 0;
  await queryGames({ variant: FFQ_BANQI_SPEC_ID, excludeFFQ: false });
  await gameAggregates({ variant: FFQ_BANQI_SPEC_ID, excludeFFQ: false });
  await gameFacets(false);
  assert.ok(queries.every((sql) => !sql.includes("games.variant NOT IN ('ffq-banqi')")));
  queries.length = 0;
  await queryGames({ excludeFFQ: true });
  await gameAggregates({ excludeFFQ: true });
  await gameFacets(true);
  assert.ok(queries.length >= 3);
  assert.ok(queries.every((sql) => sql.includes("games.variant NOT IN ('ffq-banqi')")));
});
