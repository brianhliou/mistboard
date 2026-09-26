import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildDiscoveryManifestSources,
  buildStatedRoundManifestSources,
  type DiscoveredBoard,
  type DiscoverySource,
  NOTHING_NEW_MESSAGE,
  roundNumberFromRoundId,
  type StoredBoardRef,
} from './xiangqi-broadcast-discovery.js';
import {
  archiveBoardUrl,
  dpxqTourDiscoveryProvider,
  parseDpxqTourGameList,
  tourGameListUrl,
} from './xiangqi-broadcast-discovery-dpxq-tour.js';
import { roundPageUrl } from './xiangqi-broadcast-dpxq-pairings.js';

// Shaped after the real /hldcg/movelist_12656.html (the 2026 甲级联赛 qualifier):
// one row per game, round label first, then the 台 number, then the two sides
// written in mirrored order, then the record link.
const GAME_LIST = `
<table>
<tr><td>第01轮</td><td>1</td><td>浙江民泰银行象棋队 王家瑞</td><td>2 + 0</td><td>朱鑫垚 天津市滨海新区象棋协会</td><td><a href="/hldcg/search/view_m_142519.html">谱</a></td></tr>
<tr><td>第01轮</td><td>2</td><td>天津市滨海新区象棋协会 焦伟宸</td><td>1 = 1</td><td>徐崇峰 浙江民泰银行象棋队</td><td><a href="/hldcg/search/view_m_142518.html">谱</a></td></tr>
<tr><td>第02轮</td><td>1</td><td>杭州市棋类协会 戴晨</td><td>2 + 0</td><td>张嘉禾 聚顺磨料象棋队</td><td><a href="/hldcg/search/view_m_142499.html">谱</a></td></tr>
<tr><td>合计</td><td colspan="5">61 局</td></tr>
</table>`;

function providerInput(pages: Record<string, string>) {
  return {
    config: new URLSearchParams({ tour: '12656' }),
    timeoutMs: 1000,
    fetchImpl: async (url: string) => {
      const body = pages[url];
      if (body === undefined) return new Response('missing', { status: 404 });
      return new Response(body, { status: 200 });
    },
  };
}

function discoverySource(overrides: Partial<DiscoverySource> = {}): DiscoverySource {
  return {
    provider: dpxqTourDiscoveryProvider,
    config: new URLSearchParams(),
    tourSlug: '2026-league',
    minViewers: 1,
    maxBoards: 32,
    ...overrides,
  };
}

test('a tour game list yields one board per game, with its stated round and table', () => {
  const games = parseDpxqTourGameList(GAME_LIST);
  assert.deepEqual(games, [
    { id: '142519', roundNumber: 1, table: 1 },
    { id: '142518', roundNumber: 1, table: 2 },
    { id: '142499', roundNumber: 2, table: 1 },
  ]);
});

test('a row without a game link is not a game', () => {
  // The totals row at the foot of the real page has no record link.
  assert.equal(parseDpxqTourGameList('<tr><td>合计</td><td>61 局</td></tr>').length, 0);
});

test('the provider reads the tour list and points at archive pages', async () => {
  const result = await dpxqTourDiscoveryProvider.discover(
    providerInput({ [tourGameListUrl('12656')]: GAME_LIST }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.boards.length, 3);
  assert.equal(result.boards[0]!.url, archiveBoardUrl('142519'));
  assert.equal(result.boards[0]!.roundNumber, 1);
});

test('a tour with no uploaded records fails rather than importing nothing silently', async () => {
  const result = await dpxqTourDiscoveryProvider.discover(
    providerInput({ [tourGameListUrl('12656')]: '<table></table>' }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /lists no game records/);
  assert.equal(result.quiet, true, 'an empty list is expected, not a fault');
});

test('discovery rejects a non-numeric tour id instead of fetching it', async () => {
  const input = providerInput({});
  input.config = new URLSearchParams({ tour: '../evil' });
  const result = await dpxqTourDiscoveryProvider.discover(input);
  assert.equal(result.ok, false);
});

test('roundNumberFromRoundId reads the seeded round id shape', () => {
  assert.equal(roundNumberFromRoundId('2026-league-r07'), 7);
  assert.equal(roundNumberFromRoundId('2026-league-r18'), 18);
  assert.equal(roundNumberFromRoundId('2026-league-final'), undefined);
});

test('a whole tour game list is filtered down to the scheduled round', () => {
  const boards: DiscoveredBoard[] = [
    { url: archiveBoardUrl('1'), roundNumber: 1 },
    { url: archiveBoardUrl('2'), roundNumber: 1 },
    { url: archiveBoardUrl('3'), roundNumber: 2 },
  ];
  const built = buildDiscoveryManifestSources({
    source: discoverySource(),
    boards,
    round: { roundId: '2026-league-r01', roundName: 'Round 1' },
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.sources.length, 2);
  // Board numbers run 1..N within the round, in game-list order, so a team
  // match's boards stay adjacent.
  assert.deepEqual(
    built.sources.map((source) => source.boardNumber),
    [1, 2],
  );
  assert.ok(built.sources.every((source) => source.roundId === '2026-league-r01'));
});

test('a round with no games in the list fails closed', () => {
  const built = buildDiscoveryManifestSources({
    source: discoverySource(),
    boards: [{ url: archiveBoardUrl('1'), roundNumber: 1 }],
    round: { roundId: '2026-league-r09' },
  });
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.match(built.message, /round 9/);
});

test('stated rounds against an unnumbered scheduled round fail rather than guessing', () => {
  // Importing a whole tournament's game list into whichever round happens to be
  // open is the failure this guards.
  const built = buildDiscoveryManifestSources({
    source: discoverySource(),
    boards: [{ url: archiveBoardUrl('1'), roundNumber: 1 }],
    round: { roundId: '2026-league-opening' },
  });
  assert.equal(built.ok, false);
});

test('boards without a stated round keep the existing behaviour', () => {
  const built = buildDiscoveryManifestSources({
    source: discoverySource(),
    boards: [{ url: archiveBoardUrl('1') }, { url: archiveBoardUrl('2') }],
    round: { roundId: '2026-league-r01' },
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.sources.length, 2);
});

// The 2024 Asian individual championship, men (dpxq tour 9503): round pages
// list every table; the game list has 13 records, here those of rounds 1 and 7.
function dpxqFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/dpxq/${name}`, import.meta.url)), 'utf-8');
}
const ASIAN_R07 = dpxqFixture('round_9503-asian-2024-men-r07.html');
const ASIAN_R01 = dpxqFixture('round_9503_1-asian-2024-men-r01.html');
const ASIAN_GAME_LIST = dpxqFixture('movelist_9503-asian-2024-men-r01-r07.html');

function asianInput(settledRounds?: Set<number>) {
  const fetched: string[] = [];
  const pages: Record<string, string> = {
    [roundPageUrl('9503')]: ASIAN_R07,
    [roundPageUrl('9503', 1)]: ASIAN_R01,
    [tourGameListUrl('9503')]: ASIAN_GAME_LIST,
  };
  return {
    fetched,
    input: {
      config: new URLSearchParams({ tour: '9503' }),
      timeoutMs: 1000,
      ...(settledRounds ? { settledRounds } : {}),
      fetchImpl: async (url: string) => {
        fetched.push(url);
        const body = pages[url];
        if (body === undefined) return new Response('missing', { status: 404 });
        return new Response(body, { status: 200 });
      },
    },
  };
}

test('the provider reads every round page after the latest and returns their pairings', async () => {
  const { input, fetched } = asianInput();
  const result = await dpxqTourDiscoveryProvider.discover(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Round 7 (16: the final table's two games) and round 1 (15); rounds 2-6
  // answer 404 here and add nothing.
  assert.equal(result.pairings?.length, 31);
  assert.equal(result.boards.length, 4);
  assert.ok(result.pairings?.every((pairing) => pairing.pageUrl.includes('round_9503_')));
  assert.deepEqual(
    fetched.filter((url) => url.includes('round_')),
    [roundPageUrl('9503'), ...[1, 2, 3, 4, 5, 6].map((round) => roundPageUrl('9503', round))],
  );
});

test('settled rounds are not fetched again; the latest always is', async () => {
  const { input, fetched } = asianInput(new Set([1, 2, 3, 4, 5, 6, 7]));
  const result = await dpxqTourDiscoveryProvider.discover(input);
  assert.equal(result.ok, true);
  assert.deepEqual(
    fetched.filter((url) => url.includes('round_')),
    [roundPageUrl('9503')],
  );
});

test('pairings=0 reads the game list only', async () => {
  const { input, fetched } = asianInput();
  input.config.set('pairings', '0');
  const result = await dpxqTourDiscoveryProvider.discover(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pairings, undefined);
  assert.ok(!fetched.some((url) => url.includes('round_')));
});

test('a tour with pairings and no records yet still discovers its boards', async () => {
  const { input } = asianInput();
  const pages = input.fetchImpl;
  input.fetchImpl = async (url: string) =>
    url === tourGameListUrl('9503') ? new Response('<table></table>') : pages(url);
  const result = await dpxqTourDiscoveryProvider.discover(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.boards.length, 0);
  assert.equal(result.pairings?.length, 31);
});

async function asianBuild(stored: StoredBoardRef[] = [], completeUrls: Set<string> = new Set()) {
  const { input } = asianInput();
  const discovered = await dpxqTourDiscoveryProvider.discover(input);
  assert.equal(discovered.ok, true);
  if (!discovered.ok) throw new Error('unreachable');
  return buildStatedRoundManifestSources({
    source: discoverySource({ tourSlug: 'asian-2024-men', tourName: '亚洲个人赛 男子组' }),
    boards: discovered.boards,
    rounds: [],
    completeUrls,
    ...(discovered.pairings ? { pairings: discovered.pairings } : {}),
    stored,
  });
}

test('a pairing and its record are one board: the record takes the pairing id', async () => {
  const built = await asianBuild();
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const records = built.sources.filter((source) => !source.resultsOnly);
  const resultsOnly = built.sources.filter((source) => source.resultsOnly);
  // The final's two games are linked from their rows; round 1 tables 13 and
  // 15 are not linked there and match by the game list's table.
  assert.deepEqual(
    records.map((source) => [source.url.match(/view_m_(\d+)/)?.[1], source.sourceBoardId]),
    [
      ['131470', 'r01t13'],
      ['131471', 'r01t15'],
      ['128342', 'r07t01g1'],
      ['128343', 'r07t01g2'],
    ],
  );
  assert.deepEqual(
    records.map((source) => source.boardNumber),
    [13, 15, 1, 1],
  );
  // Every table gets a results-only board, the matched ones under the same id
  // as their record and ahead of it: a record fetch that fails still leaves
  // the table with its result, and one that lands extends it.
  assert.equal(resultsOnly.length, 31);
  const ids = resultsOnly.map((source) => source.resultsOnly!.sourceBoardId);
  assert.ok(ids.includes('r01t13') && ids.includes('r07t01g1'));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(
    built.sources.findIndex((source) => source.resultsOnly?.sourceBoardId === 'r01t13') <
      built.sources.findIndex((source) => source.sourceBoardId === 'r01t13'),
  );
  const t02 = resultsOnly.find((source) => source.resultsOnly!.sourceBoardId === 'r07t02')!;
  assert.equal(t02.resultsOnly!.id, 'asian-2024-men-asian-2024-men-r07-r07t02');
  assert.equal(t02.resultsOnly!.status, 'complete');
  assert.equal(t02.resultsOnly!.result, '1-0');
  assert.equal(t02.resultsOnly!.moves.length, 0);
  assert.equal(t02.url, roundPageUrl('9503', 7));
  assert.equal(t02.tourName, '亚洲个人赛 男子组');
  assert.deepEqual(built.roundsAdded, [1, 7]);
});

function storedRef(overrides: Partial<StoredBoardRef> & { id: string }): StoredBoardRef {
  return {
    red: { name: '红' },
    black: { name: '黑' },
    status: 'complete',
    result: '1-0',
    plies: 0,
    ...overrides,
  };
}

test('a record stored before pairings were read keeps its id and covers its pairing', async () => {
  const legacyUrl = archiveBoardUrl('131470');
  const built = await asianBuild([
    storedRef({
      id: 'asian-2024-men-asian-2024-men-r01-bxyz',
      roundNumber: 1,
      sourceUrl: legacyUrl,
      red: { name: '胡敬斌' },
      black: { name: '杨世哲' },
      plies: 146,
    }),
  ]);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const record = built.sources.find((source) => source.url === legacyUrl)!;
  assert.equal(record.sourceBoardId, undefined);
  assert.ok(
    !built.sources.some((source) => source.resultsOnly?.sourceBoardId === 'r01t13'),
    'no results-only twin beside the stored record',
  );
});

test("a stored game between the pairing's two players covers it, even unlinked", async () => {
  const built = await asianBuild([
    storedRef({
      id: 'asian-2024-men-asian-2024-men-r01-bother',
      roundNumber: 1,
      sourceUrl: archiveBoardUrl('999'),
      red: { name: '郑彦隆' },
      black: { name: '苏俊豪' },
      plies: 80,
    }),
  ]);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.ok(!built.sources.some((source) => source.resultsOnly?.sourceBoardId === 'r01t02'));
});

test('an unchanged results-only board is not re-applied; a changed one is', async () => {
  const first = await asianBuild();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const stored = first.sources.flatMap((source) =>
    source.resultsOnly
      ? [
          storedRef({
            id: source.resultsOnly.id,
            roundNumber: source.resultsOnly.sourceBoardId.startsWith('r01') ? 1 : 7,
            sourceUrl: source.url,
            red: source.resultsOnly.red,
            black: source.resultsOnly.black,
            status: source.resultsOnly.status,
            result: source.resultsOnly.result,
            ...(source.resultsOnly.details ? { details: source.resultsOnly.details } : {}),
          }),
        ]
      : [],
  );
  // The records stored complete too: nothing is left to do.
  const complete = new Set(
    first.sources.filter((source) => !source.resultsOnly).map((source) => source.url),
  );
  const again = await asianBuild(stored, complete);
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.message, NOTHING_NEW_MESSAGE);
  assert.equal(again.quiet, true);

  // dpxq corrects a result: that one board is applied again.
  const corrected = stored.map((row) =>
    row.id.endsWith('-r07t02') ? { ...row, result: '1/2-1/2' } : row,
  );
  const fixed = await asianBuild(corrected, complete);
  assert.equal(fixed.ok, true);
  if (!fixed.ok) return;
  assert.deepEqual(
    fixed.sources.map((source) => source.resultsOnly?.sourceBoardId),
    ['r07t02'],
  );
});

test('a results-only board that has since gained moves is left to its record', async () => {
  const built = await asianBuild([
    storedRef({
      id: 'asian-2024-men-asian-2024-men-r07-r07t03',
      roundNumber: 7,
      red: { name: '阮明日光' },
      black: { name: '庄宏明' },
      plies: 90,
    }),
  ]);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.ok(!built.sources.some((source) => source.resultsOnly?.sourceBoardId === 'r07t03'));
});
