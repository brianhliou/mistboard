import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ARBITER_ADJUDICATED_DRAWS,
  replayXiangqiBroadcastBoard,
  validateXiangqiBroadcastBoard,
  validateXiangqiBroadcastBoards,
  validateXiangqiBroadcastRound,
  validateXiangqiBroadcastTape,
  validateXiangqiBroadcastTour,
  xiangqiBroadcastVariant,
} from './index.js';

const fixtureRoot = new URL('../fixtures/xiangqi-broadcast/2025-wxc-sample/', import.meta.url);

function loadJson(path: URL): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('xiangqi broadcast fixture pack validates', () => {
  const tour = validateXiangqiBroadcastTour(loadJson(new URL('tour.json', fixtureRoot)));
  assert.equal(tour.ok, true, tour.ok ? undefined : tour.errors.join('\n'));

  const roundsRaw = loadJson(new URL('rounds.json', fixtureRoot));
  assert.ok(Array.isArray(roundsRaw));
  const rounds = roundsRaw.map((round) => validateXiangqiBroadcastRound(round));
  for (const round of rounds) {
    assert.equal(round.ok, true, round.ok ? undefined : round.errors.join('\n'));
  }

  const boards = validateXiangqiBroadcastBoards(loadJson(new URL('boards.json', fixtureRoot)));
  assert.equal(boards.ok, true, boards.ok ? undefined : boards.errors.join('\n'));
  assert.equal(boards.ok ? boards.value.length : 0, 2);
  assert.equal(xiangqiBroadcastVariant(), 'xiangqi');
});

test('valid xiangqi broadcast game fixtures replay through the standard rules engine', () => {
  const gamesRoot = new URL('games/', fixtureRoot);
  const files = readdirSync(gamesRoot)
    .filter((file) => file.endsWith('.json') && !file.includes('invalid'))
    .sort();

  assert.deepEqual(files, ['men-r1-b01.json', 'men-r1-b02-live.json']);
  for (const file of files) {
    const parsed = validateXiangqiBroadcastBoard(loadJson(new URL(file, gamesRoot)));
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errors.join('\n'));
    if (!parsed.ok) continue;

    const replay = replayXiangqiBroadcastBoard(parsed.value);
    assert.equal(replay.ok, true, replay.ok ? undefined : `${replay.boardId} ${replay.reason}`);
    assert.equal(replay.ok ? replay.plies : 0, parsed.value.moves.length);
  }
});

test('xiangqi broadcast tape fixture validates for local live simulation', () => {
  const tape = validateXiangqiBroadcastTape(loadJson(new URL('tape.json', fixtureRoot)));
  assert.equal(tape.ok, true, tape.ok ? undefined : tape.errors.join('\n'));
  if (!tape.ok) return;

  assert.equal(tape.value.tourSlug, '2025-wxc-sample');
  assert.equal(tape.value.events.length, 9);
  assert.equal(tape.value.events[0]?.atMs, 0);
  assert.equal(tape.value.events.at(-1)?.atMs, 17000);
});

test('invalid xiangqi broadcast game fixtures fail with board and ply diagnostics', () => {
  const parsed = validateXiangqiBroadcastBoard(
    loadJson(new URL('games/men-r1-b03-invalid.json', fixtureRoot)),
  );
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errors.join('\n'));
  if (!parsed.ok) return;

  const replay = replayXiangqiBroadcastBoard(parsed.value);
  assert.equal(replay.ok, false);
  if (replay.ok) return;
  assert.equal(replay.boardId, '2025-wxc-sample-men-r1-b03-invalid');
  assert.equal(replay.ply, 1);
  assert.equal(replay.reason, 'illegal move at ply 1: a7a6');
});

test('xiangqi broadcast runtime validation rejects malformed payloads before replay', () => {
  const parsed = validateXiangqiBroadcastBoard({
    schema: 'mistboard.xiangqi.broadcast.v1',
    id: 'bad-board',
    tourSlug: '2025-wxc-sample',
    roundId: 'men-r1',
    sourceBoardId: 'bad',
    boardNumber: 1,
    red: { name: 'Red' },
    black: { name: 'Black' },
    status: 'complete',
    result: '*',
    moves: [{ from: 'j1', to: 'a1' }],
  });

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.deepEqual(parsed.errors, [
    'board.result must be decided when board.status is complete',
    'board.moves[0].from must be a valid square',
  ]);
});

test('xiangqi broadcast tape validation rejects ambiguous and unordered events', () => {
  const parsed = validateXiangqiBroadcastTape({
    schema: 'mistboard.xiangqi.broadcast-tape.v1',
    tourSlug: '2025-wxc-sample',
    events: [
      { atMs: 10, boardId: 'b1', moves: [], append: [] },
      { atMs: 5, boardId: '', result: '1-0', status: 'live' },
    ],
  });

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.deepEqual(parsed.errors, [
    'tape.events[0] cannot include both moves and append',
    'tape.events[1].atMs must be ordered ascending',
    'tape.events[1].boardId must be a non-empty string',
    'tape.events[1].result must be * until status is complete',
  ]);
});

// A record of a finished game is not live play. Our kernel auto-draws on
// repetition and on the progress clock; a real tournament game runs past both
// because an arbiter applies the perpetual-check/chase rules instead. Before
// this option existed, our own auto-draw made every later move read as illegal
// and ingestion DROPPED the board -- 15 of 90 games in a national-championship
// sample. Both fixtures below are real games from that sample.
const adjudicatedRoot = new URL(
  '../fixtures/xiangqi-broadcast/arbiter-adjudicated/',
  import.meta.url,
);

test('the adjudicated-draw table is exactly the arbiter-decided reasons', () => {
  // Asserting the table, not one member of it: checkmate and stalemate must
  // never become resumable, or the option turns into a rubber stamp.
  assert.deepEqual([...ARBITER_ADJUDICATED_DRAWS].sort(), ['progress-clock', 'repetition']);
  for (const terminal of ['checkmate', 'stalemate', 'resignation', 'timeout'] as const) {
    assert.equal(ARBITER_ADJUDICATED_DRAWS.has(terminal), false, `${terminal} must stay terminal`);
  }
});

for (const [file, reason, plies] of [
  ['repetition.json', 'repetition', 135],
  ['progress-clock.json', 'progress-clock', 281],
] as const) {
  test(`real game continuing past ${reason} replays only with the ingest option`, () => {
    const parsed = validateXiangqiBroadcastBoard(loadJson(new URL(file, adjudicatedRoot)));
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errors.join('\n'));
    if (!parsed.ok) return;
    assert.equal(parsed.value.moves.length, plies);

    // Without the option the kernel's own auto-draw rejects a legitimate game.
    const strict = replayXiangqiBroadcastBoard(parsed.value);
    assert.equal(strict.ok, false, 'live-play replay should still stop at the auto-draw');

    const ingest = replayXiangqiBroadcastBoard(parsed.value, {
      continuePastAdjudicatedDraw: true,
    });
    assert.equal(ingest.ok, true, ingest.ok ? undefined : ingest.reason);
    if (!ingest.ok) return;
    assert.equal(ingest.plies, plies);
    assert.ok(ingest.adjudications.length > 0, 'should record where the kernel called it over');
    assert.equal(ingest.adjudications[0]?.reason, reason);
    assert.ok(
      (strict.ok ? 0 : strict.ply) <= ingest.adjudications[0]!.ply,
      'adjudication should be at or before the ply strict replay stopped on',
    );
  });
}

test('the ingest option does not rescue a genuinely illegal move', () => {
  const parsed = validateXiangqiBroadcastBoard(
    loadJson(new URL('games/men-r1-b03-invalid.json', fixtureRoot)),
  );
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errors.join('\n'));
  if (!parsed.ok) return;

  const replay = replayXiangqiBroadcastBoard(parsed.value, { continuePastAdjudicatedDraw: true });
  assert.equal(replay.ok, false);
  if (replay.ok) return;
  assert.equal(replay.ply, 1);
});

test('a clean game records no adjudications', () => {
  const parsed = validateXiangqiBroadcastBoard(
    loadJson(new URL('games/men-r1-b01.json', fixtureRoot)),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const replay = replayXiangqiBroadcastBoard(parsed.value, { continuePastAdjudicatedDraw: true });
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.ok ? replay.adjudications : null, []);
});

import { broadcastSourcePageHref } from './xiangqi-broadcast.js';

test('a tour polled through dpxq-tour discovery links to the dpxq tour page, not the poll target', () => {
  assert.equal(
    broadcastSourcePageHref('mistboard-discover://dpxq-tour?tour=12524&tourSlug=2026-shanghai-cup'),
    'http://www.dpxq.com/hldcg/movelist_12524.html',
  );
  assert.equal(
    broadcastSourcePageHref('http://www.dpxq.com/hldcg/search/view_m_1.html'),
    'http://www.dpxq.com/hldcg/search/view_m_1.html',
  );
  assert.equal(broadcastSourcePageHref('mistboard-discover://dpxq-live?tourSlug=x'), undefined);
  assert.equal(broadcastSourcePageHref('mistboard-discover://dpxq-tour?tour=abc'), undefined);
  assert.equal(broadcastSourcePageHref('not a url'), undefined);
  assert.equal(broadcastSourcePageHref(undefined), undefined);
});
