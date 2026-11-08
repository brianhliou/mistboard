import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSeedPuzzleRegistry } from '@mistboard/game/puzzle-seed';
import { CRAWLER_HISTORICAL_GAME } from './crawler-content-fixtures.js';
import { crawlerDataPageSources } from './data-page-fixtures.js';
import { close, getPool, init } from './persistence-db.js';
import {
  type HistoricalXiangqiGame,
  listHistoricalSitemapGames,
} from './persistence-historical-xiangqi.js';
import { getPuzzleStore } from './puzzle-store.js';
import {
  type ArchiveSitemapSources,
  archiveSitemapEntries,
  bodyMeetsSitemapFloor,
  dataListingLastmod,
  datedServerBodies,
  puzzleContentDate,
} from './sitemap-records.js';

test('server-body dates require an actual body above its contract floor', async () => {
  const date = new Date('2026-10-01');
  const dates = await datedServerBodies(
    [
      { path: '/coach', lastmod: date },
      { path: '/forum', lastmod: date },
      { path: '/stats', lastmod: null },
      { path: '/about', lastmod: date },
    ],
    async (path) =>
      path === '/forum'
        ? '<main><h1>Forum</h1></main>'
        : `<main><h1>Coaches</h1><p>Find a coach to study with. Every coach listed here holds a verified xiangqi or chess title.</p><p>${'Real public record. '.repeat(70)}</p></main>`,
  );
  assert.deepEqual([...dates], [['/coach', '2026-10-01']]);
  assert.equal(bodyMeetsSitemapFloor('/coach', `<p>${'long '.repeat(200)}</p>`), false); // Planted missing heading.
  assert.equal(bodyMeetsSitemapFloor('/coach', '<h1>Short</h1>'), false); // Planted sparse directory.
});

function game(
  id: string,
  visibility: HistoricalXiangqiGame['visibility'] = 'public',
): HistoricalXiangqiGame {
  return {
    ...CRAWLER_HISTORICAL_GAME,
    id,
    visibility,
    contentSha256: 'fixture',
    redPlayerId: null,
    blackPlayerId: null,
    plyCount: CRAWLER_HISTORICAL_GAME.moves.length,
    moves: [...CRAWLER_HISTORICAL_GAME.moves],
    tags: {},
    qualityFlags: [],
    indexedAt: null,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-10-01'),
  };
}

test('historical archive pages use record lastmod and exclude planted private and sparse records', async () => {
  const seen: string[] = [];
  const sources: ArchiveSitemapSources = {
    historical: async (afterId) => {
      seen.push(afterId);
      return afterId
        ? []
        : [
            game('a'),
            game('b', 'private'),
            game('c', 'unlisted'),
            {
              ...game('d'),
              redNameRaw: '',
              blackNameRaw: '',
              eventName: null,
              playedOn: null,
              moves: [],
            },
          ];
    },
    puzzleDates: async () => new Map(),
    puzzles: getPuzzleStore,
  };
  assert.deepEqual(await archiveSitemapEntries('historical', sources), [
    { path: '/historical-xiangqi/game/a', lastmod: '2026-10-01' },
  ]);
  assert.deepEqual(seen, ['', 'd']);
  await assert.rejects(
    archiveSitemapEntries('historical', { ...sources, historical: async () => [game('a')] }),
    /cursor did not advance/,
  );
});

test('puzzle archive uses the discoverable serving set and omits undated or withheld records', async () => {
  const store = await getPuzzleStore();
  const puzzle = loadSeedPuzzleRegistry('xiangqi')[0]!;
  const jungle = loadSeedPuzzleRegistry('jungle')[0]!;
  const sources: ArchiveSitemapSources = {
    historical: async () => [],
    puzzles: async () => store,
    puzzleDates: async () =>
      new Map([
        [puzzle.id, new Date('2026-10-03')],
        [jungle.id, new Date('2026-10-04')],
        ['withheld-not-in-store', new Date('2026-10-05')],
      ]),
  };
  assert.deepEqual(await archiveSitemapEntries('puzzles', sources), [
    { path: `/puzzles/${puzzle.id}`, lastmod: '2026-10-03' },
  ]);
  assert.deepEqual(
    await archiveSitemapEntries('puzzles', { ...sources, puzzleDates: async () => new Map() }),
    [],
  );
});

test('historical sitemap reads only public rows in bounded cursor pages without sockets', async (t) => {
  init('postgres://unused:unused@127.0.0.1/unused');
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  t.mock.method(getPool(), 'query', async (sql: string, values: unknown[]) => {
    queries.push({ sql, values });
    return { rows: [] };
  });
  try {
    assert.deepEqual(await listHistoricalSitemapGames('after', 9000), []);
    assert.match(queries[0]!.sql, /WHERE visibility = 'public' AND id > \$1 ORDER BY id LIMIT \$2/);
    assert.deepEqual(queries[0]!.values, ['after', 500]);
    assert.deepEqual(await listHistoricalSitemapGames('', -1), []);
    assert.deepEqual(queries[1]!.values, ['', 1]);
    assert.deepEqual(await archiveSitemapEntries('historical', undefined, 'cache-fixture'), []);
    assert.deepEqual(await archiveSitemapEntries('historical', undefined, 'cache-fixture'), []);
    assert.equal(queries.length, 3, 'repeat requests share the archive read');
  } finally {
    await close();
  }
});

test('seed puzzle dates follow source content changes and mined dates follow the record', () => {
  const created = new Date('2026-10-01');
  assert.equal(
    puzzleContentDate('seed', created, '2026-10-04')?.toISOString().slice(0, 10),
    '2026-10-04',
  );
  assert.equal(
    puzzleContentDate('seed', created, '2026-09-01')?.toISOString().slice(0, 10),
    '2026-10-01',
  );
  assert.equal(puzzleContentDate('seed', created), null);
  assert.equal(puzzleContentDate('seed', created, 'deploy-now'), null);
  assert.equal(puzzleContentDate('mined', created), created);
});

test('data dates include the displayed collections and built file records', async () => {
  const listing = await crawlerDataPageSources().data();
  assert.equal(
    dataListingLastmod({ ...listing, months: [], engineMonths: [], collections: [] }, null),
    null,
  );
  const old = new Date('2000-01-01');
  const first = listing.collections[0]!;
  const changed = {
    ...listing,
    months: [],
    engineMonths: [],
    collections: [
      {
        ...first,
        lastEndedAt: '2026-11-01T00:00:00Z',
        files: [] as (typeof listing.collections)[number]['files'],
      },
    ],
  };
  assert.equal(dataListingLastmod(changed, old)?.toISOString().slice(0, 10), '2026-11-01');
  const file = listing.months[0]!.files[0]!;
  changed.collections[0]!.files.push({
    ...file,
    built: { bytes: 12, sha256: 'fixture', builtAt: '2026-11-03T00:00:00Z' },
  });
  assert.equal(dataListingLastmod(changed, old)?.toISOString().slice(0, 10), '2026-11-03');
});
