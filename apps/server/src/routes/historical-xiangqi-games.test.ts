import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_VARIANT_ORDER,
  GAMES_SEARCH_DEFAULT_MIN_PLIES,
  type GameSpecId,
} from '@mistboard/game';
// The searchable variants derive from the tenant registry (via the watch
// channels), so the registrations must be populated, as index.ts does.
import '../variant-tenant/register-tenants.js';
import { crosstableReviewUrl } from '../crosstable.js';
import {
  compareSearchItems,
  type GameSearchFilters,
  mistboardResults,
  pageAcrossLanes,
  parseHistoricalXiangqiGameQuery,
  playedPlyFloor,
  playedPlyMin,
  publicTags,
  SEARCH_WINDOW,
  searchableVariants,
  searchLanes,
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

// --- variants ---------------------------------------------------------------

const LAUNCHED: GameSpecId[] = ['xiangqi', 'jieqi', 'dark-chess'];

function parseWith(query: string, launched: readonly GameSpecId[] = LAUNCHED) {
  return parseHistoricalXiangqiGameQuery(new URLSearchParams(query), launched);
}

test('a launched variant passes the parser as its own spec id', () => {
  const parsed = parseWith('variant=jieqi&event=AB-JChess');
  assert.ok(parsed.ok);
  assert.equal(parsed.filters.variant, 'jieqi');
  assert.equal(parsed.filters.event, 'AB-JChess');
  // Blank is "every variant", not an error.
  const blank = parseWith('variant=');
  assert.ok(blank.ok);
  assert.equal(blank.filters.variant, undefined);
});

test('a variant outside the launched list is a 400, never a default', () => {
  // Retired, hidden, unlaunched, aliased and mis-cased ids all fail closed.
  for (const variant of ['mini-xiangqi', 'mahjong', 'banqi', 'fog', 'JIEQI', 'chess', 'x']) {
    assert.deepEqual(parseWith(`variant=${variant}`), { ok: false, error: 'invalid_variant' });
  }
});

test('searchable variants are the launched channels in the canonical shelf order', () => {
  const flags = [
    'XIANGQI',
    'JIEQI',
    'BANQI',
    'ATOMIC_XIANGQI',
    'DARK_XIANGQI',
    'DUCK_XIANGQI',
    'FORTRESS_XIANGQI',
    'CRAZYHOUSE_XIANGQI',
    'JUNGLE',
    'JUNGLE_FLIP',
    'MAHJONG',
  ];
  const saved = flags.map((flag) => process.env[`MISTBOARD_${flag}_ENABLED`]);
  try {
    for (const flag of flags) process.env[`MISTBOARD_${flag}_ENABLED`] = 'true';
    const ids = searchableVariants().map((variant) => variant.id);
    // Every shelf variant, in shelf order; mahjong has no watch surface and
    // stays out even with its flag on.
    assert.deepEqual(ids, [...CANONICAL_VARIANT_ORDER]);
    assert.ok(!ids.includes('mahjong' as GameSpecId));
    // Every searchable variant routes its rows to its own game page.
    for (const variant of searchableVariants()) {
      for (const stored of variant.storedVariants) {
        const url = crosstableReviewUrl('room1', stored);
        assert.ok(url, `${variant.id}: no review URL for stored variant ${stored}`);
      }
    }
    // A flag turned off takes its variant out of the search with it.
    process.env.MISTBOARD_JIEQI_ENABLED = 'false';
    assert.ok(!searchableVariants().some((variant) => variant.id === 'jieqi'));
  } finally {
    flags.forEach((flag, i) => {
      const value = saved[i];
      if (value === undefined) delete process.env[`MISTBOARD_${flag}_ENABLED`];
      else process.env[`MISTBOARD_${flag}_ENABLED`] = value;
    });
  }
});

test('lanes per variant: broadcasts and the archive are xiangqi only', () => {
  const lanes = (filters: GameSearchFilters) => searchLanes(filters);
  assert.deepEqual(lanes({}), ['played', 'broadcast', 'archive']);
  assert.deepEqual(lanes({ variant: 'xiangqi' }), ['played', 'broadcast', 'archive']);
  assert.deepEqual(lanes({ variant: 'jieqi' }), ['played']);
  assert.deepEqual(lanes({ variant: 'dark-chess' }), ['played']);
  assert.deepEqual(lanes({ sourceSlug: 'mistboard', variant: 'jieqi' }), ['played']);
  assert.deepEqual(lanes({ sourceSlug: 'broadcast' }), ['broadcast']);
  assert.deepEqual(lanes({ sourceSlug: 'broadcast', variant: 'jieqi' }), []);
  assert.deepEqual(lanes({ sourceSlug: 'archive' }), ['archive']);
  assert.deepEqual(lanes({ sourceSlug: 'xqbase' }), ['archive']);
  assert.deepEqual(lanes({ sourceSlug: 'xqbase', variant: 'jieqi' }), []);
});

test('engine matches stay out of the feed until a search asks for them', () => {
  // The unfiltered feed never reads them: one 400-game import would bury it.
  assert.ok(!searchLanes({}).includes('engine-match'));
  assert.ok(!searchLanes({ variant: 'jieqi', result: '1-0' }).includes('engine-match'));
  // Named by source, or found by event or player name.
  assert.deepEqual(searchLanes({ sourceSlug: 'engine-match' }), ['engine-match']);
  assert.deepEqual(searchLanes({ sourceSlug: 'engine-match', variant: 'jieqi' }), ['engine-match']);
  assert.deepEqual(searchLanes({ variant: 'jieqi', event: 'AB-JChess' }), [
    'played',
    'engine-match',
  ]);
  assert.ok(searchLanes({ player: 'PikaJieQi' }).includes('engine-match'));
  // Another source named explicitly keeps them out.
  assert.ok(!searchLanes({ sourceSlug: 'mistboard', event: 'x' }).includes('engine-match'));
});

test('engine games (the bots, on a schedule) stay out of the feed until a search asks', () => {
  assert.ok(!searchLanes({}).includes('engine-game'));
  assert.ok(!searchLanes({ variant: 'jieqi' }).includes('engine-game'));
  assert.ok(!searchLanes({ sourceSlug: 'mistboard' }).includes('engine-game'));
  assert.ok(!searchLanes({ sourceSlug: 'engine-match' }).includes('engine-game'));
  // Named by source (any variant: they are played here), or found by a bot's name.
  assert.deepEqual(searchLanes({ sourceSlug: 'engine-game' }), ['engine-game']);
  assert.deepEqual(searchLanes({ sourceSlug: 'engine-game', variant: 'jieqi' }), ['engine-game']);
  assert.ok(searchLanes({ player: 'Pikafish' }).includes('engine-game'));
  // They have no event, so an event search does not read them.
  assert.ok(!searchLanes({ event: 'AB-JChess' }).includes('engine-game'));
  // Like engine matches they keep no default length floor.
  assert.deepEqual(playedPlyMin({}, 'engine-game'), {});
  assert.equal(playedPlyFloor({ sourceSlug: 'engine-game' }), null);
});

test('a seat-keyed result filter spans the red and white first seats', () => {
  assert.deepEqual(mistboardResults('1-0'), ['red-wins', 'white-wins']);
  assert.deepEqual(mistboardResults('0-1'), ['black-wins']);
  assert.deepEqual(mistboardResults('1/2-1/2'), ['draw']);
  assert.deepEqual(mistboardResults('*'), []);
  assert.deepEqual(mistboardResults(undefined), []);
});

// The default floor hides games abandoned in the opening, which are most of
// the short rows and nearly all guest-vs-bot. It applies to games played here
// only when the search sets no minimum: broadcasts and the archive have no
// games that short, and their shortest real games (agreed draws) must stay.
test('the default minimum length applies to games played here only, and only by default', () => {
  assert.deepEqual(playedPlyMin({}, 'played'), { plyMin: GAMES_SEARCH_DEFAULT_MIN_PLIES });
  assert.deepEqual(playedPlyMin({}, 'engine-match'), {});
  // Any minimum the search sets wins, 0 (no minimum) included.
  assert.deepEqual(playedPlyMin({ plyMin: 0 }, 'played'), { plyMin: 0 });
  assert.deepEqual(playedPlyMin({ plyMin: 30 }, 'engine-match'), { plyMin: 30 });
  // The response names the floor it applied, so the page can say what is hidden.
  assert.equal(playedPlyFloor({}), GAMES_SEARCH_DEFAULT_MIN_PLIES);
  assert.equal(playedPlyFloor({ plyMin: 0 }), null);
  assert.equal(playedPlyFloor({ sourceSlug: 'broadcast' }), null);
  assert.equal(playedPlyFloor({ sourceSlug: 'archive' }), null);
  assert.equal(playedPlyFloor({ sourceSlug: 'mistboard' }), GAMES_SEARCH_DEFAULT_MIN_PLIES);
  assert.equal(GAMES_SEARCH_DEFAULT_MIN_PLIES, 10);
});

test('an omitted plyMin stays omitted, so the default floor can tell it from 0', () => {
  const omitted = parse('');
  assert.ok(omitted.ok && omitted.filters.plyMin === undefined);
  const zero = parse('plyMin=0');
  assert.ok(zero.ok && zero.filters.plyMin === 0);
});
