import assert from 'node:assert/strict';
import test from 'node:test';
import { FFQ_BANQI_SPEC_ID, gameSpecForId } from '@mistboard/game';
import {
  countedPublicGame,
  offPublicGameSpecIds,
  publicVariant,
} from './persistence-counted-games.js';
import { close, getPool, init } from './persistence-db.js';
import {
  countWatchSealedGames,
  getGameFavoriteState,
  listFavoriteGames,
  listRecentEveGames,
  listRecentPublicGames,
  listShowcaseGames,
  listWatchUnlockedGames,
  queryHeadToHeadGames,
  setGameFavorite,
  tallyHeadToHeadGames,
} from './persistence-games.js';
import {
  getUserGamesPage,
  getUserProfileByHandle,
  getUserRatingHistory,
} from './persistence-profiles.js';

test('FFQ is permanently excluded from public totals independently of the flag and surface', (t) => {
  const previous = process.env.MISTBOARD_FFQ_BANQI_ENABLED;
  process.env.MISTBOARD_FFQ_BANQI_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.MISTBOARD_FFQ_BANQI_ENABLED;
    else process.env.MISTBOARD_FFQ_BANQI_ENABLED = previous;
  });
  assert.ok(offPublicGameSpecIds([]).includes(FFQ_BANQI_SPEC_ID));
  assert.match(publicVariant('games'), /'ffq-banqi'/);
  assert.match(countedPublicGame('games'), /'ffq-banqi'/);
  const spec = gameSpecForId(FFQ_BANQI_SPEC_ID) as { publicSurface: string };
  const surface = spec.publicSurface;
  spec.publicSurface = 'casual';
  try {
    assert.ok(offPublicGameSpecIds([]).includes(FFQ_BANQI_SPEC_ID));
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
  ];
  for (const [label, run] of cases) {
    await t.test(label, async () => {
      queries.length = 0;
      await run();
      const gameQueries = queries.filter((sql) => /(?:FROM|JOIN) games\b/.test(sql));
      assert.ok(gameQueries.length > 0, 'exercises a real persistence query');
      for (const sql of gameQueries) {
        assert.match(
          sql,
          /games\.variant NOT IN \('ffq-banqi'\)/,
          `${label}: exclusion must be in SQL, before LIMIT and COUNT(*) OVER()`,
        );
      }
    });
  }
});
