import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareSearchItems,
  pageAcrossLanes,
  parseHistoricalXiangqiGameQuery,
  publicTags,
  SEARCH_WINDOW,
} from './historical-xiangqi-games.js';

function parse(query: string) {
  return parseHistoricalXiangqiGameQuery(new URLSearchParams(query));
}

test('historical xiangqi game query parser accepts search filters', () => {
  const parsed = parse(
    'source=classic&player=Hu%20Ronghua&event=river&result=1-0&from=1982-04-03&to=1982-04-03&plyMin=20&plyMax=100&offset=50&limit=25',
  );
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.filters, {
    sourceSlug: 'classic',
    player: 'Hu Ronghua',
    event: 'river',
    result: '1-0',
    playedFrom: '1982-04-03',
    playedTo: '1982-04-04',
    plyMin: 20,
    plyMax: 100,
    offset: 50,
    limit: 25,
  });
});

test('historical xiangqi game query parser rejects malformed filters', () => {
  assert.deepEqual(parse('result=red-wins'), { ok: false, error: 'invalid_result' });
  assert.deepEqual(parse('from=1982-4-3'), { ok: false, error: 'invalid_from' });
  assert.deepEqual(parse('to=1982-02-31'), { ok: false, error: 'invalid_to' });
  assert.deepEqual(parse('plyMin=-1'), { ok: false, error: 'invalid_ply_min' });
  assert.deepEqual(parse('limit=0'), { ok: false, error: 'invalid_limit' });
});

test('the detail response serves only the allowlisted tags', () => {
  // The stored row is the source's own, kept verbatim so the import stays
  // lossless. What we SERVE is a different decision: ElephantChess rows carry
  // pseudonymous player keys that join a player's games together, and their
  // internal CSV filename. Neither is ours to publish.
  const served = publicTags({
    timeControl: '600+5',
    timeControlCategory: 'RAPID',
    ratingMode: 'rated',
    redEloBefore: 999,
    redEloAfter: 991,
    blackEloBefore: 1009,
    blackEloAfter: 1017,
    redPlayerId: 'lfU8hpd9bBzo',
    blackPlayerId: 'Tx4n1aG5r9gE',
    sourceFile: 'pvp_game_moves_xiangqi_009.csv',
    rawOutcome: 'BLACK_WINS',
    gameStatus: 'CHECKMATED',
    cplPlies: 0,
  });
  assert.deepEqual(Object.keys(served).sort(), [
    'blackEloAfter',
    'blackEloBefore',
    'ratingMode',
    'redEloAfter',
    'redEloBefore',
    'timeControl',
    'timeControlCategory',
  ]);
  assert.equal(served.redPlayerId, undefined);
  assert.equal(served.sourceFile, undefined);
});

test('an unreviewed tag from a future source is withheld by default', () => {
  // Allowlist, not denylist: a new source's tags arrive unreviewed, so anything
  // unrecognised must stay out rather than ride along.
  assert.deepEqual(publicTags({ somethingNewNobodyVetted: 'x' }), {});
});

// --- sort -------------------------------------------------------------------
// The union fetches a page per lane, each ordered server-side, then merges. The
// merge key must match what the lanes pushed down, so these pin both halves.

test('sort defaults to recent and is omitted from the filters', () => {
  const parsed = parse('');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.filters.sort, undefined);
});

test('sort accepts the four known keys', () => {
  for (const sort of ['recent', 'oldest', 'longest', 'shortest']) {
    const parsed = parse(`sort=${sort}`);
    assert.equal(parsed.ok, true, sort);
    if (!parsed.ok) continue;
    assert.equal(parsed.filters.sort, sort);
  }
});

test('an unknown sort is rejected rather than silently ignored', () => {
  // Fail-closed: falling back to the default would answer 200 with a page
  // ordered differently from what the caller asked for.
  const parsed = parse('sort=rating');
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.error, 'invalid_sort');
});

type Lane = Parameters<typeof pageAcrossLanes>[0][number];
type Item = Parameters<typeof compareSearchItems>[0];

function fakeLane(kind: string, count: number, reads: number[]): { items: Item[]; read: Lane } {
  const items = Array.from({ length: count }, (_, i) => {
    const day = String(1 + (i % 28)).padStart(2, '0');
    return {
      id: `${kind}-${String(i).padStart(5, '0')}`,
      sortAt: `2026-09-${day}T00:00:00.000Z`,
      plyCount: i % 97,
    } as Item;
  }).sort((a, b) => compareSearchItems(a, b, undefined));
  const read: Lane = async (offset, limit) => {
    reads.push(limit);
    return { games: items.slice(offset, offset + limit), total: items.length };
  };
  return { items, read };
}

// The lane counts are the live corpus on 2026-09-30, when every page past the
// sixth came back empty: each lane was read once, 200 rows deep.
test('every page of the merged search is the same slice a full sort would give', async () => {
  const reads: number[] = [];
  const lanes = [fakeLane('mb', 100, reads), fakeLane('bc', 1569, reads), fakeLane('hx', 1, reads)];
  const everything = lanes
    .flatMap((lane) => lane.items)
    .sort((a, b) => compareSearchItems(a, b, undefined));
  for (let offset = 0; offset < everything.length; offset += 50) {
    const page = await pageAcrossLanes(
      lanes.map((lane) => lane.read),
      offset,
      50,
      undefined,
    );
    assert.equal(page.total, 1670);
    assert.deepEqual(
      page.games.map((game) => game.id),
      everything.slice(offset, offset + 50).map((game) => game.id),
      `page at offset ${offset}`,
    );
  }
  assert.ok(
    Math.max(...reads) <= 200,
    'no single lane read asks for more than the persistence cap',
  );
});

test('a page past the search window is empty rather than wrong', async () => {
  const lane = fakeLane('bc', SEARCH_WINDOW + 100, []);
  const page = await pageAcrossLanes([lane.read], SEARCH_WINDOW, 50, undefined);
  assert.deepEqual(page.games, []);
  assert.equal(page.total, SEARCH_WINDOW + 100);
});
