import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildStatedRoundManifestSources,
  completeSourceUrls,
  parseXiangqiBroadcastDiscoverySource,
} from './xiangqi-broadcast-discovery.js';
import { registerDefaultXiangqiBroadcastDiscoveryProviders } from './xiangqi-broadcast-discovery-dpxq.js';
import {
  parseWxfCategoryListing,
  wxfArticleUrl,
  wxfCategoryDiscoveryProvider,
  wxfCategoryUrl,
  wxfTitleRoundNumber,
} from './xiangqi-broadcast-discovery-wxf.js';
import { convertWxfDhtmlXqPageToSnapshot } from './xiangqi-broadcast-wxf-dhtmlxq.js';

// Trimmed copies of the live 2025 World Championship men's results category
// (catid 415) and its round 1 article (id 1844), fetched 2026-10-14.
function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../fixtures/wxf-dhtmlxq/2025-wxc-men/${name}`, import.meta.url)),
    'utf-8',
  );
}

const CATEGORY_URL = wxfCategoryUrl('415');

function providerInput(pages: Record<string, string>, config: Record<string, string> = {}) {
  const requested: string[] = [];
  return {
    requested,
    input: {
      config: new URLSearchParams({ catid: '415', ...config }),
      timeoutMs: 1000,
      fetchImpl: async (url: string) => {
        requested.push(url);
        const body = pages[url];
        if (body === undefined) return new Response('missing', { status: 404 });
        return new Response(body, { status: 200 });
      },
    },
  };
}

test('a WXF results category lists its round articles, not the menu links around them', () => {
  const articles = parseWxfCategoryListing(fixture('category-415.html'), '415');
  assert.deepEqual(
    articles.map((article) => [article.id, article.roundNumber]),
    [
      ['1857', 9],
      ['1856', 8],
      ['1855', 7],
      ['1854', 6],
      ['1853', 5],
      ['1852', 4],
      ['1851', 3],
      ['1850', 2],
      ['1844', 1],
    ],
  );
  assert.equal(articles.at(-1)?.title, '2025 世界象棋锦标赛 赛谱 男子组 第1轮');
  // The page's menus link the federation's own articles (ids 275, 2025).
  assert.equal(
    articles.some((article) => article.id === '275' || article.id === '2025'),
    false,
  );
  // A listing link that names another category is not this event's.
  assert.deepEqual(parseWxfCategoryListing(fixture('category-415.html'), '416'), []);
});

test('an article title states its round in any of the forms WXF has used', () => {
  assert.equal(wxfTitleRoundNumber('2025 世界象棋锦标赛 赛谱 男子组 第1轮'), 1);
  assert.equal(wxfTitleRoundNumber('2026 世界象棋公开赛 第 12 轮'), 12);
  assert.equal(wxfTitleRoundNumber('第十轮'), 10);
  assert.equal(wxfTitleRoundNumber('第二十三轮'), 23);
  assert.equal(wxfTitleRoundNumber('2019 World Xiangqi Championship Men Round 01a'), 1);
  assert.equal(wxfTitleRoundNumber('2025 世界象棋锦标赛 对阵表'), undefined);
});

test('wxf-category discovery files each round article under its stated round', async () => {
  const { input, requested } = providerInput({ [CATEGORY_URL]: fixture('category-415.html') });
  const discovered = await wxfCategoryDiscoveryProvider.discover(input);
  assert.equal(discovered.ok, true);
  if (!discovered.ok) return;
  // One fetch: the articles are read by the leaf, not twice.
  assert.deepEqual(requested, [CATEGORY_URL]);
  assert.equal(discovered.boards.length, 9);
  const round1 = discovered.boards.find((board) => board.roundNumber === 1);
  // The canonical address, without the alias and menu item the listing adds,
  // so the stored source URL does not move if the site retitles the article.
  assert.equal(
    round1?.url,
    'https://www.wxf-xiangqi.org/index.php?option=com_content&view=article&id=1844&lang=cn',
  );
  assert.equal(round1?.url, wxfArticleUrl('1844'));
});

test('wxf-category discovery: a missing catid fails loudly, an empty category quietly', async () => {
  const noCat = await wxfCategoryDiscoveryProvider.discover({
    ...providerInput({}).input,
    config: new URLSearchParams({ tourSlug: 'x' }),
  });
  assert.equal(noCat.ok, false);
  assert.equal(!noCat.ok && noCat.quiet, undefined);

  const empty = await wxfCategoryDiscoveryProvider.discover(
    providerInput({
      [CATEGORY_URL]: '<table class="category table"><tbody></tbody></table>',
    }).input,
  );
  assert.equal(empty.ok, false);
  assert.equal(!empty.ok && empty.quiet, true);

  const unreachable = await wxfCategoryDiscoveryProvider.discover(providerInput({}).input);
  assert.equal(unreachable.ok, false);
  assert.equal(!unreachable.ok && unreachable.quiet, undefined);
  assert.match(!unreachable.ok ? unreachable.message : '', /404/);
});

test('the default providers include wxf-category', () => {
  registerDefaultXiangqiBroadcastDiscoveryProviders();
  const parsed = parseXiangqiBroadcastDiscoverySource(
    'mistboard-discover://wxf-category?catid=415&tourSlug=2025-wxc-men-wxf',
    32,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.source.provider.name, 'wxf-category');
  assert.equal(parsed.source.provider.statesRounds, true);
  assert.equal(parsed.source.config.get('catid'), '415');
});

test('round 1 of the 2025 WXF men lands as 24 table-numbered boards in the tour round', async () => {
  const { input } = providerInput({ [CATEGORY_URL]: fixture('category-415.html') });
  const discovered = await wxfCategoryDiscoveryProvider.discover(input);
  assert.equal(discovered.ok, true);
  if (!discovered.ok) return;

  registerDefaultXiangqiBroadcastDiscoveryProviders();
  const parsed = parseXiangqiBroadcastDiscoverySource(
    'mistboard-discover://wxf-category?catid=415&tourSlug=2025-wxc-men-wxf&tourName=2025%20WXF%20Men',
    32,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const built = buildStatedRoundManifestSources({
    source: parsed.source,
    boards: discovered.boards,
    rounds: [],
    completeUrls: new Set(),
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(built.roundsAdded, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const entry = built.sources.find((source) => source.url === wxfArticleUrl('1844'));
  assert.ok(entry);
  assert.equal(entry.roundId, '2025-wxc-men-wxf-r01');
  assert.equal(entry.roundName, 'Round 1');

  const converted = convertWxfDhtmlXqPageToSnapshot(fixture('article-1844.html'), {
    tourSlug: entry.tourSlug,
    ...(entry.tourName ? { tourName: entry.tourName } : {}),
    roundId: entry.roundId,
    ...(entry.roundName ? { roundName: entry.roundName } : {}),
    boardNumber: entry.boardNumber,
    sourceUrl: entry.url,
  });
  assert.equal(converted.ok, true);
  if (!converted.ok) return;
  const { snapshot } = converted;
  assert.equal(snapshot.tour.slug, '2025-wxc-men-wxf');
  assert.equal(snapshot.tour.name, '2025 WXF Men');
  assert.equal(snapshot.boards.length, 24);
  assert.ok(snapshot.boards.every((board) => board.roundId === '2025-wxc-men-wxf-r01'));
  // Board ids come from the "1-<table>" token in each frame title, so they
  // stay put across polls and read as the table, not a hash of the pairing.
  const tables = [...Array.from({ length: 25 }, (_, i) => i + 1)].filter((t) => t !== 20);
  assert.deepEqual(
    snapshot.boards.map((board) => board.sourceBoardId),
    tables.map((t) => `r01t${String(t).padStart(2, '0')}`),
  );
  assert.deepEqual(
    snapshot.boards.map((board) => board.boardNumber),
    tables,
  );
  assert.equal(snapshot.boards[0]?.id, '2025-wxc-men-wxf-2025-wxc-men-wxf-r01-r01t01');
  assert.equal(snapshot.boards[0]?.red.name, '陈峻');
  assert.ok(snapshot.boards.every((board) => board.moves.length > 0));
});

test('a WXF board with no movelist (a forfeit) is skipped with one issue, not a failed page', () => {
  // 2025 round 1 table 20: red arrived late and lost by forfeit; the frame
  // carries the players and an empty movelist.
  const converted = convertWxfDhtmlXqPageToSnapshot(fixture('article-1844.html'), {
    tourSlug: '2025-wxc-men-wxf',
    roundId: '2025-wxc-men-wxf-r01',
    sourceUrl: wxfArticleUrl('1844'),
  });
  assert.equal(converted.ok, true);
  if (!converted.ok) return;
  assert.deepEqual(converted.issues, [
    {
      kind: 'missing_required_tag',
      message: 'DhtmlXQ frame is missing movelist',
      sourceBoardId: 'r01t20',
    },
  ]);
  assert.equal(
    converted.snapshot.boards.some((board) => board.sourceBoardId === 'r01t20'),
    false,
  );
});

test('a source page counts as complete only when every board read from it is', () => {
  const article = wxfArticleUrl('1844');
  const record = 'http://www.dpxq.com/hldcg/search/view_m_1.html';
  const finished = { status: 'complete', details: {}, plies: 80 };
  // One finished game on a round page must not stop the live ones updating.
  assert.deepEqual(
    [
      ...completeSourceUrls([
        { sourceUrl: article, ...finished },
        { sourceUrl: article, status: 'live', details: {}, plies: 40 },
        { sourceUrl: record, ...finished },
      ]),
    ],
    [record],
  );
  assert.deepEqual(
    [
      ...completeSourceUrls([
        { sourceUrl: article, ...finished },
        { sourceUrl: article, ...finished },
        // Read before details existed: once more.
        { sourceUrl: record, status: 'complete', plies: 80 },
        // Results only: nothing to read, never complete.
        { sourceUrl: 'https://example.test/p', status: 'complete', details: {}, plies: 0 },
      ]),
    ],
    [article],
  );
});
