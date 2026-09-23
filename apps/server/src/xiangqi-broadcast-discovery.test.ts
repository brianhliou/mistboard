import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isXiangqiBroadcastDiscoveryUrl,
  parseXiangqiBroadcastDiscoverySource,
  registerXiangqiBroadcastDiscoveryProvider,
  resetXiangqiBroadcastDiscoveryProviders,
  resolveScheduledRound,
  type ScheduledRound,
} from './xiangqi-broadcast-discovery.js';

const MAX_BOARDS = 32;

function withFakeProvider(): void {
  resetXiangqiBroadcastDiscoveryProviders();
  registerXiangqiBroadcastDiscoveryProvider({
    name: 'fake-live',
    discover: async () => ({ ok: true, boards: [] }),
  });
}

test('discovery URLs are told apart from ordinary sources', () => {
  assert.equal(isXiangqiBroadcastDiscoveryUrl('mistboard-discover://fake-live?tourSlug=t'), true);
  assert.equal(isXiangqiBroadcastDiscoveryUrl('https://example.org/manifest.json'), false);
  assert.equal(isXiangqiBroadcastDiscoveryUrl('http://www.dpxq.com/x.html'), false);
});

test('a discovery source parses provider, tour and limits', () => {
  withFakeProvider();
  const parsed = parseXiangqiBroadcastDiscoverySource(
    'mistboard-discover://fake-live?tourSlug=2026-league&tourName=League&event=%E7%94%B2%E7%BA%A7&minViewers=3&maxBoards=8',
    MAX_BOARDS,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.source.provider.name, 'fake-live');
  assert.equal(parsed.source.tourSlug, '2026-league');
  assert.equal(parsed.source.tourName, 'League');
  assert.equal(parsed.source.event, '甲级');
  assert.equal(parsed.source.minViewers, 3);
  assert.equal(parsed.source.maxBoards, 8);
});

// Fail-closed, same rule as variant dispatch: an unrecognised member is
// rejected, never mapped onto a neighbour or retried as a plain http fetch.
test('an unknown provider is rejected rather than treated as an http source', () => {
  withFakeProvider();
  const parsed = parseXiangqiBroadcastDiscoverySource(
    'mistboard-discover://nope?tourSlug=t',
    MAX_BOARDS,
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.message, /unknown discovery provider "nope"/);
});

test('an ordinary https URL is not a discovery source', () => {
  withFakeProvider();
  const parsed = parseXiangqiBroadcastDiscoverySource('https://example.org/x.json', MAX_BOARDS);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.message, 'not a discovery source');
});

test('a discovery source without a tourSlug is rejected', () => {
  withFakeProvider();
  const parsed = parseXiangqiBroadcastDiscoverySource('mistboard-discover://fake-live', MAX_BOARDS);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.message, /requires a tourSlug/);
});

test('maxBoards may not exceed the manifest ceiling', () => {
  withFakeProvider();
  const parsed = parseXiangqiBroadcastDiscoverySource(
    `mistboard-discover://fake-live?tourSlug=t&maxBoards=${MAX_BOARDS + 1}`,
    MAX_BOARDS,
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.message, /maxBoards must be an integer between 1 and 32/);
});

const SCHEDULE: ScheduledRound[] = [
  { id: 'r01', name: 'Round 1', startsAt: new Date('2026-10-08T14:30:00+08:00') },
  { id: 'r02', name: 'Round 2', startsAt: new Date('2026-10-08T19:30:00+08:00') },
  { id: 'r03', name: 'Round 3', startsAt: new Date('2026-10-09T14:30:00+08:00') },
];

// The gap case first: it is the one that silently files round 3's games under
// round 2 if resolution falls back to "most recent".
test('a poll between rounds resolves to no round at all', () => {
  const resolved = resolveScheduledRound(
    SCHEDULE,
    new Date('2026-10-09T12:00:00+08:00'),
    4 * 60 * 60 * 1000,
  );
  assert.equal(resolved.ok, false);
  if (resolved.ok) return;
  assert.equal(resolved.message, 'no scheduled round is active');
});

test('a poll before the first round resolves to no round', () => {
  const resolved = resolveScheduledRound(SCHEDULE, new Date('2026-10-08T09:00:00+08:00'));
  assert.equal(resolved.ok, false);
});

test('a poll inside a round window resolves to that round', () => {
  const resolved = resolveScheduledRound(SCHEDULE, new Date('2026-10-09T15:10:00+08:00'));
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.roundId, 'r03');
  assert.equal(resolved.roundName, 'Round 3');
});

test('overlapping windows resolve to the latest started round', () => {
  const resolved = resolveScheduledRound(SCHEDULE, new Date('2026-10-08T20:00:00+08:00'));
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.roundId, 'r02');
});

test('a poll long after the last round resolves to no round', () => {
  const resolved = resolveScheduledRound(SCHEDULE, new Date('2026-10-20T14:30:00+08:00'));
  assert.equal(resolved.ok, false);
});

import {
  buildDiscoveryManifestSources,
  type DiscoveredBoard,
} from './xiangqi-broadcast-discovery.js';

function parsed(url: string) {
  withFakeProvider();
  const result = parseXiangqiBroadcastDiscoverySource(url, MAX_BOARDS);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.source;
}

const ROUND = { roundId: 'r07', roundName: 'Round 7' };

function board(id: string, event: string, plies = 10): DiscoveredBoard {
  return { url: `http://www.dpxq.com/x?id=${id}`, event, plies, red: 'R', black: 'B' };
}

test('the event filter keeps only boards whose event tag matches', () => {
  const built = buildDiscoveryManifestSources({
    source: parsed(
      'mistboard-discover://fake-live?tourSlug=t&event=%E7%94%B2%E7%BA%A7%E8%81%94%E8%B5%9B',
    ),
    boards: [
      board('1', '2026年全国象棋男子甲级联赛'),
      board('2', '适情雅趣'),
      board('3', '2026年甲级联赛第二阶段'),
    ],
    round: ROUND,
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(
    built.sources.map((s) => s.url),
    ['http://www.dpxq.com/x?id=1', 'http://www.dpxq.com/x?id=3'],
  );
});

// Board numbers come from the ranking, because dpxq serves one game per page
// and the converter's positional fallback would number every board 1.
test('entries pin tour, round and an incrementing board number', () => {
  const built = buildDiscoveryManifestSources({
    source: parsed('mistboard-discover://fake-live?tourSlug=2026-league&tourName=League'),
    boards: [board('1', 'e'), board('2', 'e'), board('3', 'e')],
    round: ROUND,
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(
    built.sources.map((s) => [s.tourSlug, s.tourName, s.roundId, s.roundName, s.boardNumber]),
    [
      ['2026-league', 'League', 'r07', 'Round 7', 1],
      ['2026-league', 'League', 'r07', 'Round 7', 2],
      ['2026-league', 'League', 'r07', 'Round 7', 3],
    ],
  );
});

test('no matching board yields a failure, never an empty manifest', () => {
  const built = buildDiscoveryManifestSources({
    source: parsed('mistboard-discover://fake-live?tourSlug=t&event=nothing-matches'),
    boards: [board('1', '适情雅趣')],
    round: ROUND,
  });
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.match(built.message, /no live boards matched event/);
});

test('boards past the cap are dropped and counted, not silently truncated', () => {
  const boards = Array.from({ length: 5 }, (_, index) => board(String(index), 'e'));
  const built = buildDiscoveryManifestSources({
    source: parsed('mistboard-discover://fake-live?tourSlug=t&maxBoards=3'),
    boards,
    round: ROUND,
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.sources.length, 3);
  assert.equal(built.droppedForCap, 2);
});

import { NO_ACTIVE_ROUND_MESSAGE } from './xiangqi-broadcast-discovery.js';

// The poller keys its quiet path off this exact message, so a reworded string
// would silently restore a sync log per tick: tens of thousands of rows across
// an eleven-day event, and a permanently red source-health indicator.
test('the between-rounds message is the one the poller stays quiet on', () => {
  const resolved = resolveScheduledRound(SCHEDULE, new Date('2026-10-09T12:00:00+08:00'), 60_000);
  assert.equal(resolved.ok, false);
  if (resolved.ok) return;
  assert.equal(resolved.message, NO_ACTIVE_ROUND_MESSAGE);
});

import {
  buildStatedRoundManifestSources,
  NOTHING_NEW_MESSAGE,
} from './xiangqi-broadcast-discovery.js';

const SEEDED = [
  { id: 'cup-r01', name: 'Round 1' },
  { id: 'cup-r02', name: 'Round 2' },
];

function stated(id: string, roundNumber: number): DiscoveredBoard {
  return { url: `http://www.dpxq.com/hldcg/search/view_m_${id}.html`, roundNumber };
}

test('stated rounds file each board under the seeded round with that number', () => {
  const built = buildStatedRoundManifestSources({
    source: parsed('mistboard-discover://fake-live?tourSlug=cup&tourName=Cup'),
    boards: [stated('1', 1), stated('2', 2), stated('3', 1)],
    rounds: SEEDED,
    completeUrls: new Set(),
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(
    built.sources.map((s) => [s.roundId, s.roundName, s.boardNumber]),
    [
      ['cup-r01', 'Round 1', 1],
      ['cup-r02', 'Round 2', 1],
      ['cup-r01', 'Round 1', 2],
    ],
  );
  assert.equal(built.sources[0]?.tourName, 'Cup');
  assert.equal(built.skippedComplete, 0);
  assert.deepEqual(built.roundsAdded, []);
});

// Records arrive on dpxq days after the round, so a schedule window would have
// closed already; the stated round is what files them, never the clock.
test('stated rounds are never time-gated', () => {
  const built = buildStatedRoundManifestSources({
    source: parsed('mistboard-discover://fake-live?tourSlug=cup'),
    boards: [stated('1', 1)],
    rounds: SEEDED,
    completeUrls: new Set(),
  });
  assert.equal(built.ok, true);
});

test('boards already stored complete leave the manifest but keep their rank', () => {
  const built = buildStatedRoundManifestSources({
    source: parsed('mistboard-discover://fake-live?tourSlug=cup'),
    boards: [stated('1', 1), stated('2', 1), stated('3', 1)],
    rounds: SEEDED,
    completeUrls: new Set([stated('1', 1).url, stated('2', 1).url]),
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(
    built.sources.map((s) => s.boardNumber),
    [3],
  );
  assert.equal(built.skippedComplete, 2);
});

test('a list with nothing new is quiet, not an error', () => {
  const built = buildStatedRoundManifestSources({
    source: parsed('mistboard-discover://fake-live?tourSlug=cup'),
    boards: [stated('1', 1)],
    rounds: SEEDED,
    completeUrls: new Set([stated('1', 1).url]),
  });
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.message, NOTHING_NEW_MESSAGE);
  assert.equal(built.quiet, true);
});

test('a stated round the schedule never seeded is created, not dropped', () => {
  // The 2026 men's league was seeded rounds 1-5; stage two's rounds arrive
  // stated (第09轮) and must land without a hand re-seed.
  const built = buildStatedRoundManifestSources({
    source: parsed('mistboard-discover://fake-live?tourSlug=cup'),
    boards: [stated('1', 1), stated('9', 9), stated('10', 9)],
    rounds: SEEDED,
    completeUrls: new Set(),
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(
    built.sources.map((s) => [s.roundId, s.roundName, s.boardNumber]),
    [
      ['cup-r01', 'Round 1', 1],
      ['cup-r09', 'Round 9', 1],
      ['cup-r09', 'Round 9', 2],
    ],
  );
  assert.deepEqual(built.roundsAdded, [9]);
});

test('a board that states no round fails the whole build closed', () => {
  const built = buildStatedRoundManifestSources({
    source: parsed('mistboard-discover://fake-live?tourSlug=cup'),
    boards: [stated('1', 1), board('x', 'e')],
    rounds: SEEDED,
    completeUrls: new Set(),
  });
  assert.equal(built.ok, false);
});

test('the cap defers new boards to the next poll and counts them', () => {
  const built = buildStatedRoundManifestSources({
    source: parsed('mistboard-discover://fake-live?tourSlug=cup&maxBoards=2'),
    boards: [stated('1', 1), stated('2', 1), stated('3', 1)],
    rounds: SEEDED,
    completeUrls: new Set(),
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.sources.length, 2);
  assert.equal(built.droppedForCap, 1);
});
