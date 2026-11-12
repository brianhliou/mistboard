import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { tsImport } from 'tsx/esm/api';
import {
  assertLocalDatabase,
  buildFinishedGame,
  DEFAULT_FILE,
  parseAndReplay,
  parseEngineMove,
  persistFinishedGame,
  replayEngineGame,
} from './seed-ffq-engine-games.mjs';

// First two ffq-scaling-20261104 games, retaining only the replay contract.
// Timings/search diagnostics are omitted so this test also runs without the
// separate, private engine checkout. The source pin below checks that copy.
const fixture = await readFile(
  new URL('./fixtures/ffq-engine-games.jsonl', import.meta.url),
  'utf8',
);
const traces = fixture.trim().split('\n').map(JSON.parse);

test('parse and replay the first two engine games through every FEN and result', () => {
  const games = parseAndReplay(fixture, 2);
  assert.deepEqual(
    games.map((game) => game.trace.game),
    [0, 1],
  );
  assert.deepEqual(
    games.map((game) => game.moves.length),
    [34, 32],
  );
  for (const game of games) {
    assert.equal(game.state.status.type, 'finished');
    assert.deepEqual(game.state.status, game.trace.result);
  }
  assert.deepEqual(parseEngineMove('d0d0'), { from: 3, to: 3 });
  assert.deepEqual(parseEngineMove('a7d0'), { from: 28, to: 3 });
});

test('the original first two games match the portable replay fixture', async (t) => {
  let source;
  try {
    source = await readFile(DEFAULT_FILE, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('private engine run is absent; the portable first-two-game test still runs');
    return;
  }
  const games = parseAndReplay(source, 2);
  const copied = parseAndReplay(fixture, 2);
  for (let index = 0; index < 2; index += 1) {
    assert.deepEqual(games[index].state, copied[index].state);
    assert.deepEqual(games[index].moves, copied[index].moves);
    assert.equal(games[index].roomId, copied[index].roomId, 'timings do not affect idempotency');
  }
});

test('a planted corrupted move fails with its game and ply', () => {
  const corrupted = structuredClone(traces[0]);
  corrupted.plies[0].move = 'a0d7';
  assert.throws(() => replayEngineGame(corrupted), /game 0, ply 1: illegal move a0d7/);
});

test('legal move corruption and public-FEN/result mismatches cannot silently import', () => {
  const changedMove = structuredClone(traces[0]);
  changedMove.plies[0].move = 'a0a0';
  assert.throws(() => replayEngineGame(changedMove), /game 0, ply 2: public FEN mismatch/);
  const changedFen = structuredClone(traces[0]);
  changedFen.plies[1].fen += ' corrupted';
  assert.throws(() => replayEngineGame(changedFen), /game 0, ply 2: public FEN mismatch/);
  const changedFinal = structuredClone(traces[0]);
  changedFinal.finalFen += ' corrupted';
  assert.throws(() => replayEngineGame(changedFinal), /game 0: final public FEN mismatch/);
  const changedResult = structuredClone(traces[0]);
  changedResult.result.winner = 'red';
  assert.throws(() => replayEngineGame(changedResult), /game 0: result mismatch/);
});

test('parser rejects malformed JSON, duplicate games, empty input and invalid limits', () => {
  assert.equal(parseAndReplay(fixture, 1).length, 1);
  assert.throws(() => parseAndReplay('{'), /line 1: invalid JSON/);
  assert.throws(() => parseAndReplay(`${fixture}${fixture}`), /duplicate game 0/);
  assert.throws(() => parseAndReplay(''), /no games/);
  for (const limit of [0, -1, 1.5, NaN]) {
    assert.throws(() => parseAndReplay(fixture, limit), /positive integer/);
  }
});

test('write guard accepts loopback only, including pg query-string host overrides', () => {
  for (const url of ['postgres://localhost/local', 'postgresql://127.0.0.1:5435/local']) {
    assert.doesNotThrow(() => assertLocalDatabase(url));
  }
  for (const url of [
    undefined,
    '',
    'invalid',
    'postgres://remote.example/local',
    'postgres://localhost.remote.example/local',
    'https://localhost/local',
    'postgres://localhost/local?host=remote.example',
    'postgres://localhost/local?host=/tmp',
  ]) {
    assert.throws(() => assertLocalDatabase(url), /Refusing write/);
  }
});

test('tenant-built event logs and summaries open through the real finished replay API', async () => {
  const { ffqBanqiPostgameForApi } = await tsImport(
    '../apps/server/src/routes/ffq-banqi-games.ts',
    import.meta.url,
  );
  const { getFFQBanqiPlayerView } = await tsImport(
    '../packages/game/src/variants-ffq-banqi.ts',
    import.meta.url,
  );
  const accounts = {
    red: { id: 'local-high', handle: 'ffq-engine-50k', displayName: 'ffq-engine-50k' },
    black: { id: 'local-low', handle: 'ffq-engine-2k', displayName: 'ffq-engine-2k' },
  };
  for (const game of parseAndReplay(fixture, 2)) {
    const seats =
      game.trace.highColor === 'red' ? accounts : { red: accounts.black, black: accounts.red };
    const { events, summary } = await buildFinishedGame(game, seats, 1000);
    assert.equal(summary.variant, 'ffq-banqi');
    assert.equal(summary.mode, 'pvp', 'same account-seat mapping as a finished live FFQ game');
    assert.equal(summary.result, 'black-wins');
    assert.equal(summary.termination, 'points');
    assert.equal(summary.rated, false);
    assert.equal(summary.plyCount, game.moves.length);
    assert.deepEqual(
      summary.participants.map((p) => [p.color, p.subjectType, p.subjectId]),
      [
        ['red', 'user', seats.red.id],
        ['black', 'user', seats.black.id],
      ],
    );
    const payload = await ffqBanqiPostgameForApi(game.roomId, {
      getGameSummary: async () => ({ ...summary, roomId: game.roomId }),
      loadRoomEvents: async () => events,
    });
    assert.ok(payload, 'normal postgame reader accepts the imported game');
    assert.equal(payload.history.truth.length, game.moves.length + 1);
    assert.equal(payload.timeline.length, game.moves.length);
    assert.deepEqual(payload.view, getFFQBanqiPlayerView(game.state, 'observer'));
    assert.equal(payload.history.truth.at(-1).fen, game.trace.finalFen);
    // Serialize the WHOLE API response. No secret deal or on-board covered
    // identity may escape via nested history, game summaries or metadata.
    const wire = JSON.parse(JSON.stringify(payload));
    assert.doesNotMatch(JSON.stringify(wire), /"(?:setup|deal|dealSeed)":/);
    for (const view of [wire.view, ...wire.history.truth.map((frame) => frame.view)]) {
      for (const piece of view.board) {
        if (piece?.faceDown) assert.deepEqual(piece, { faceDown: true });
      }
    }
  }
});

test('reruns skip completed games and resume partial logs without duplicate events', async () => {
  const game = parseAndReplay(fixture, 1)[0];
  const accounts = {
    red: { id: 'high', handle: 'ffq-engine-50k', displayName: 'ffq-engine-50k' },
    black: { id: 'low', handle: 'ffq-engine-2k', displayName: 'ffq-engine-2k' },
  };
  const events = [];
  let summary = null;
  let failAt = 8;
  let completions = 0;
  const store = {
    loadRoomEvents: async () => structuredClone(events),
    getGameSummary: async () => summary,
    appendRoomEvent: async (roomId, seq, event) => {
      assert.equal(roomId, game.roomId);
      assert.equal(seq, events.length);
      if (seq === failAt) throw new Error('interrupted write');
      events.push(structuredClone(event));
    },
    recordGameEnd: async (_roomId, value) => {
      summary = value;
      completions += 1;
    },
  };
  await assert.rejects(persistFinishedGame(game, accounts, store, 100000), /interrupted write/);
  assert.equal(events.length, 8);
  assert.equal(summary, null);
  failAt = -1;
  assert.equal(await persistFinishedGame(game, accounts, store, 200000), true);
  const completed = structuredClone(events);
  assert.equal(await persistFinishedGame(game, accounts, store, 300000), false);
  assert.deepEqual(events, completed);
  assert.equal(events.length, game.moves.length + 3);
  assert.equal(completions, 1);
  events[3].move = { from: 0, to: 31 };
  await assert.rejects(persistFinishedGame(game, accounts, store), /existing event log differs/);
  assert.equal(completions, 1);
});
