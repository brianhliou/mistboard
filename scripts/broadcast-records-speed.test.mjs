import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { recordObservation, sample, summarizeObservations } from './broadcast-records-speed.mjs';

const board = {
  id: 'wxf-table-1',
  status: 'complete',
  result: '1-0',
  moves: [{ from: 'h3', to: 'e3' }],
};
function observation(source, observedAt, boards = [board], round = 1) {
  return recordObservation({ event: 'example', round, source, observedAt, boards });
}

test('one completed mainline matches across source ids; results-only and live boards do not count', () => {
  const rows = [
    observation('wxf', '2026-11-10T09:10:00Z', [
      board,
      { ...board, id: 'no-moves', moves: [] },
      { ...board, id: 'live', status: 'live' },
    ]),
    observation('dpxq', '2026-11-10T09:30:00Z', [{ ...board, id: 'different-id' }]),
    observation('mistboard', '2026-11-10T09:35:00Z'),
  ];
  const report = summarizeObservations(rows, '2026-11-10T09:00:00Z');
  assert.equal(report.games.length, 1);
  assert.equal(report.games[0].ambiguous, false);
  assert.deepEqual(report.games[0].minutesAfterRoundEnd, { wxf: 10, dpxq: 30, mistboard: 35 });
});

test('appending after a restart retains the earliest sighting and marks a pre-existing record', () => {
  const rows = [
    observation('wxf', '2026-11-10T09:10:00Z'),
    observation('wxf', '2026-11-10T09:00:00Z', []),
    observation('wxf', '2026-11-10T09:15:00Z'),
    observation('dpxq', '2026-11-10T09:20:00Z'),
  ];
  const restored = JSON.parse(JSON.stringify(rows));
  const game = summarizeObservations(restored).games[0];
  assert.equal(game.firstSeen.wxf, '2026-11-10T09:10:00Z');
  assert.deepEqual(game.presentAtFirstSample, { wxf: false, dpxq: true });
  assert.equal(game.minutesAfterRoundEnd, null);
});

test('a fetch failure remains missing evidence; the same line in another round is a different game', () => {
  const failure = { event: 'example', round: 1, source: 'wxf', ok: false, error: 'timeout' };
  const report = summarizeObservations([
    failure,
    observation('wxf', '2026-11-10T09:10:00Z'),
    observation('wxf', '2026-11-10T14:10:00Z', [board], 2),
  ]);
  assert.deepEqual(report.failures, [failure]);
  assert.equal(report.games.length, 2);
  assert.equal(report.games[0].presentAtFirstSample.wxf, true);
});

test('identical mainlines in two boards are ambiguous and do not produce a latency comparison', () => {
  const report = summarizeObservations(
    [observation('wxf', '2026-11-10T09:10:00Z', [board, { ...board, id: 'another-game' }])],
    '2026-11-10T09:00:00Z',
  );
  assert.equal(report.games[0].ambiguous, true);
  assert.equal(report.games[0].minutesAfterRoundEnd, null);
});

test('conflicting results are flagged; a different mainline never matches by player or table', () => {
  const report = summarizeObservations([
    observation('wxf', '2026-11-10T09:10:00Z'),
    observation('dpxq', '2026-11-10T09:20:00Z', [{ ...board, result: '0-1' }]),
    observation('mistboard', '2026-11-10T09:30:00Z', [
      { ...board, moves: [{ from: 'h3', to: 'h4' }] },
    ]),
  ]);
  assert.equal(report.games.length, 2);
  assert.equal(report.games[0].resultConflict, true);
  assert.equal(report.games[0].firstSeen.mistboard, undefined);
});

test('the sampler uses the real WXF discovery and legality adapter on a saved round', async () => {
  const requested = [];
  const result = await sample(
    {
      source: 'wxf',
      tour: '2025-wxc-men',
      round: '1',
      url: 'mistboard-discover://wxf-category?catid=415&tourSlug=2025-wxc-men',
    },
    async (url) => {
      requested.push(url.toString());
      const fixture =
        url.searchParams.get('view') === 'category' ? 'category-415.html' : 'article-1844.html';
      return new Response(
        await readFile(
          new URL(`../apps/server/fixtures/wxf-dhtmlxq/2025-wxc-men/${fixture}`, import.meta.url),
        ),
        { status: 200 },
      );
    },
  );
  assert.equal(requested.length, 2);
  assert.equal(new URL(requested[1]).searchParams.get('id'), '1844');
  assert.equal(result.ok, true);
  assert.equal(result.games.length, 24);
  assert.equal(result.conversionIssues, 1); // Forfeit without moves, not an imported game.
});

test('pending dpxq automation permission is enforced before any network request', async () => {
  await assert.rejects(
    sample({ source: 'dpxq', tour: 'example', round: '1' }, () => {
      assert.fail('No dpxq fetch is authorised');
    }),
    /automation permission is pending/,
  );
});
