import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import {
  attemptStandardXiangqiPuzzleLine,
  getStandardXiangqiLegalMoves,
  type JunglePuzzle,
  puzzleShortCode,
  XIANGQI_MOTIFS,
  XIANGQI_TRAINING_TAGS,
  type XiangqiMotifId,
  type XiangqiPuzzle,
  xiangqiPuzzleTrainingTags,
} from '@mistboard/game';
import { loadSeedPuzzleRegistry, seedPuzzleContentHash } from '@mistboard/game/puzzle-seed';
import { close, getPool, init } from './persistence-db.js';
import { puzzleServingRating } from './puzzle-rating.js';
import { getPuzzleStore, resetPuzzleStoreForTests } from './puzzle-store.js';
import { loadPuzzleStorm, startPuzzleStorm } from './puzzle-storm.js';
import { loadPuzzleStreak, savePuzzleStreak, startPuzzleStreak } from './puzzle-streak.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle } from './routes/puzzles.js';

// These tests run persistence-off, so the routes serve the puzzle store's
// seed-backed snapshot. Assertions therefore compare against the SEED corpus
// (the served source of truth since #183), not the small in-package fixture
// arrays.
const JUNGLE_PUZZLES = loadSeedPuzzleRegistry('jungle') as readonly JunglePuzzle[];
const XIANGQI_PUZZLES = loadSeedPuzzleRegistry('xiangqi') as readonly XiangqiPuzzle[];

type ResponseCapture = { body: string; headers: Record<string, string>; status: number | null };

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {} as Record<string, string>,
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}

function request(method = 'GET', body?: unknown): IncomingMessage {
  const socket = { remoteAddress: '127.0.0.1' };
  if (body === undefined) return { method, headers: {}, socket } as unknown as IncomingMessage;
  const raw = Buffer.from(JSON.stringify(body));
  return {
    method,
    headers: { 'content-type': 'application/json' },
    socket,
    async *[Symbol.asyncIterator]() {
      yield raw;
    },
  } as unknown as IncomingMessage;
}

async function route(path: string, method = 'GET', body?: unknown): Promise<ResponseCapture> {
  const response = captureResponse();
  const handled = await tryHandle(
    {} as HttpApiContext,
    request(method, body),
    response,
    new URL(path, 'http://localhost').pathname,
    new URL(path, 'http://localhost'),
  );
  assert.equal(handled, true);
  return response;
}

test('storm preloads only the next two solution-hidden details and restores accepted progress', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const first = XIANGQI_PUZZLES.find((p) => p.solution.length >= 3)!;
  const rest = XIANGQI_PUZZLES.filter((p) => p.id !== first.id).slice(0, 3);
  const run = await startPuzzleStorm([first.id, ...rest.map((p) => p.id)], null);
  const resume = async () => {
    const response = await route('/api/puzzles/storm', 'POST', { action: 'resume', runId: run.id });
    assert.equal(response.status, 200);
    // Check the entire wire payload, including preloads and restored progress.
    assert.doesNotMatch(response.body, /"(?:solution|expected|nextMove)":/);
    return JSON.parse(response.body);
  };
  const started = await resume();
  assert.equal(started.puzzle.id, first.id);
  assert.deepEqual(
    started.upcoming.map((p: { id: string }) => p.id),
    rest.slice(0, 2).map((p) => p.id),
  );
  for (const detail of started.upcoming) {
    assert.deepEqual(detail, JSON.parse((await route(`/api/puzzles/${detail.id}`)).body).puzzle);
  }
  assert.equal(started.progress, null);
  const moved = JSON.parse(
    (
      await route('/api/puzzles/storm', 'POST', {
        action: 'move',
        runId: run.id,
        version: 0,
        puzzleId: first.id,
        move: first.solution[0],
      })
    ).body,
  );
  const partial = await resume();
  assert.deepEqual(partial.progress, moved.attempt);
  assert.deepEqual(partial.progress.solverMoves, [first.solution[0]]);
  assert.deepEqual(partial.progress.playedMoves, first.solution.slice(0, 2));
  assert.deepEqual(partial.upcoming, started.upcoming);
  let version = partial.version;
  let next = partial;
  for (const move of first.solution.filter((_, i) => i % 2 === 0).slice(1)) {
    next = JSON.parse(
      (
        await route('/api/puzzles/storm', 'POST', {
          action: 'move',
          runId: run.id,
          version,
          puzzleId: first.id,
          move,
        })
      ).body,
    );
    version = next.version;
  }
  assert.deepEqual(next.puzzle, started.upcoming[0]);
  assert.deepEqual(
    next.upcoming.map((p: { id: string }) => p.id),
    rest.slice(1).map((p) => p.id),
  );
  assert.equal(next.progress, null);
  t.mock.timers.tick(next.remainingMs);
  const expired = await resume();
  assert.equal(expired.finished, true);
  assert.equal(expired.puzzle, null);
  assert.deepEqual(expired.upcoming, []);
  assert.equal(expired.progress, null);

  const empty = await startPuzzleStorm([], null);
  const ended = JSON.parse(
    (
      await route('/api/puzzles/storm', 'POST', {
        action: 'resume',
        runId: empty.id,
      })
    ).body,
  );
  assert.deepEqual(ended.upcoming, []);
  assert.equal(ended.progress, null);
});

test('storm validates moves, rejects replayed submits, penalizes misses and expires on server time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const started = await route('/api/puzzles/storm', 'POST', { action: 'start', score: 999 });
  assert.equal(started.status, 200);
  let run = JSON.parse(started.body);
  assert.equal(run.score, 0);
  assert.equal(run.combo, 0);
  assert.equal(run.remainingMs, 180_000);
  assert.equal(run.best, null);
  assert.equal(run.dailyBest, null);
  assert.equal(run.version, 0);
  assert.equal(run.upcoming.length, 2);
  assert.equal(JSON.stringify(run).includes('"solution":'), false);
  assert.equal(run.startedAt, null);
  assert.equal(run.deadlineAt, null);
  t.mock.timers.tick(240_000);
  const idle = await route('/api/puzzles/storm', 'POST', {
    action: 'resume',
    runId: run.runId,
  });
  assert.equal(idle.status, 200);
  assert.deepEqual(JSON.parse(idle.body), run);
  const firstMoveAt = Date.now();
  const puzzle = XIANGQI_PUZZLES.find((p) => p.id === run.puzzle.id)!;
  const firstSubmit = {
    action: 'move',
    runId: run.runId,
    puzzleId: puzzle.id,
    version: run.version,
    move: puzzle.solution[0],
  };
  const [first, duplicate] = await Promise.all([
    route('/api/puzzles/storm', 'POST', firstSubmit),
    route('/api/puzzles/storm', 'POST', firstSubmit),
  ]);
  assert.deepEqual([first.status, duplicate.status].sort(), [200, 409]);
  run = JSON.parse((first.status === 200 ? first : duplicate).body);
  assert.equal(run.combo, 1);
  assert.equal(run.startedAt, firstMoveAt);
  assert.equal(run.deadlineAt, firstMoveAt + 180_000);
  assert.equal(run.remainingMs, 180_000);

  const resumed = await route('/api/puzzles/storm', 'POST', {
    action: 'resume',
    runId: run.runId,
  });
  assert.equal(resumed.status, 200);
  assert.deepEqual(JSON.parse(resumed.body).moves, run.moves);
  assert.equal(JSON.parse(resumed.body).combo, 1);
  assert.equal(JSON.parse(resumed.body).deadlineAt, run.deadlineAt);
  for (const move of puzzle.solution.filter((_, i) => i % 2 === 0).slice(1)) {
    const response = await route('/api/puzzles/storm', 'POST', {
      action: 'move',
      runId: run.runId,
      puzzleId: puzzle.id,
      version: run.version,
      move,
    });
    assert.equal(response.status, 200);
    run = JSON.parse(response.body);
  }
  assert.equal(run.score, 1);
  assert.equal(run.results[0].outcome, 'solved');
  assert.equal((await route('/api/puzzles/storm', 'POST', firstSubmit)).status, 409);
  const next = XIANGQI_PUZZLES.find((p) => p.id === run.puzzle.id)!;
  const malformed = await route('/api/puzzles/storm', 'POST', {
    action: 'move',
    runId: run.runId,
    puzzleId: next.id,
    version: run.version,
    move: null,
  });
  assert.equal(malformed.status, 400);
  const beforePenalty = run.remainingMs;
  const wrong = getStandardXiangqiLegalMoves(next.initial).find((move) => {
    const attempt = attemptStandardXiangqiPuzzleLine(next, [move]);
    return !attempt.ok && attempt.code === 'incorrect-move';
  });
  assert.ok(wrong);
  const missed = await route('/api/puzzles/storm', 'POST', {
    action: 'move',
    runId: run.runId,
    puzzleId: next.id,
    version: run.version,
    move: wrong,
  });
  assert.equal(missed.status, 200);
  run = JSON.parse(missed.body);
  assert.equal(run.remainingMs, beforePenalty - 10_000);
  assert.equal(run.combo, 0);
  assert.equal(run.score, 1);
  assert.equal(run.finished, false);
  assert.equal(run.results[1].outcome, 'failed');
  assert.notEqual(run.puzzle.id, next.id);
  assert.equal(JSON.stringify(run).includes('"solution":'), false);
  t.mock.timers.tick(run.remainingMs);
  const late = await route('/api/puzzles/storm', 'POST', {
    action: 'move',
    runId: run.runId,
    puzzleId: run.puzzle.id,
    version: run.version,
    move: XIANGQI_PUZZLES.find((p) => p.id === run.puzzle.id)!.solution[0],
  });
  assert.equal(late.status, 200);
  const ended = JSON.parse(late.body);
  assert.equal(ended.remainingMs, 0);
  assert.equal(ended.finished, true);
  assert.equal(ended.score, 1);
  assert.equal(ended.puzzle, null);
  const again = await route('/api/puzzles/storm', 'POST', { action: 'resume', runId: run.runId });
  assert.deepEqual(JSON.parse(again.body), ended);
});

test('streak ramp is ordered, unique, solution-hidden and rejects unknown variants', async () => {
  const response = await route('/api/puzzles/ramp?variant=xiangqi');
  assert.equal(response.status, 200);
  const { puzzles } = JSON.parse(response.body);
  assert.ok(puzzles.length > 2);
  assert.equal(new Set(puzzles.map((p: { id: string }) => p.id)).size, puzzles.length);
  for (let i = 0; i < puzzles.length; i++) {
    assert.equal(puzzles[i].variant, 'xiangqi');
    assert.equal(puzzles[i].solution, undefined);
    assert.equal(puzzles[i].initial, undefined);
    if (i > 0) assert.ok(puzzles[i].rating >= puzzles[i - 1].rating);
  }
  assert.equal((await route('/api/puzzles/ramp?variant=unknown')).status, 400);
  assert.equal((await route('/api/puzzles/ramp?variant=jungle')).status, 200);
});

test('storm uses the shared fresh ramp and protects run ownership and move versions', async () => {
  const first = JSON.parse((await route('/api/puzzles/storm', 'POST', { action: 'start' })).body);
  const ids = (await loadPuzzleStorm(first.runId))!.state.ids;
  const step = Math.max(3, Math.ceil(ids.length / 10));
  const second = JSON.parse(
    (
      await route('/api/puzzles/storm', 'POST', {
        action: 'start',
        recent: ids.slice(0, step),
      })
    ).body,
  );
  const fresh = (await loadPuzzleStorm(second.runId))!.state.ids;
  assert.deepEqual([...fresh].sort(), [...ids].sort());
  assert.ok(fresh.slice(0, step).every((id) => !ids.slice(0, step).includes(id)));
  const owned = await startPuzzleStorm([ids[0]!], 'other-owner');
  assert.equal(
    (
      await route('/api/puzzles/storm', 'POST', {
        action: 'resume',
        runId: owned.id,
      })
    ).status,
    404,
  );
  assert.equal((await route('/api/puzzles/storm', 'GET')).status, 405);
  for (const body of [
    { action: 'skip', runId: first.runId },
    { action: 'resume', runId: 'invalid' },
    { action: 'move', runId: first.runId, puzzleId: first.puzzle.id },
    { action: 'move', runId: first.runId, version: -1 },
  ])
    assert.equal((await route('/api/puzzles/storm', 'POST', body)).status, 400);
  assert.equal(
    (
      await route('/api/puzzles/storm', 'POST', {
        action: 'move',
        runId: first.runId,
        version: 1,
        puzzleId: first.puzzle.id,
      })
    ).status,
    409,
  );
});

test('storm resume retains a partial line and its moves cannot earn a second combo increment', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const puzzle = XIANGQI_PUZZLES.find((p) => p.solution.length >= 3)!;
  const run = await startPuzzleStorm([puzzle.id], null);
  const submit = {
    action: 'move',
    runId: run.id,
    puzzleId: puzzle.id,
    version: 0,
    move: puzzle.solution[0],
  };
  assert.equal((await route('/api/puzzles/storm', 'POST', submit)).status, 200);
  const resumed = JSON.parse(
    (
      await route('/api/puzzles/storm', 'POST', {
        action: 'resume',
        runId: run.id,
      })
    ).body,
  );
  assert.equal(resumed.combo, 1);
  assert.equal(resumed.score, 0);
  assert.equal(resumed.version, 1);
  assert.deepEqual(resumed.moves, [puzzle.solution[0]]);
  assert.equal((await route('/api/puzzles/storm', 'POST', submit)).status, 409);
  assert.equal((await loadPuzzleStorm(run.id))!.state.combo, 1);
});

for (const code of ['illegal-move', 'line-too-long'] as const) {
  test(`storm ${code} checker error preserves the clock, combo and run`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const puzzle = XIANGQI_PUZZLES[0]!;
    const run = await startPuzzleStorm([puzzle.id, XIANGQI_PUZZLES[1]!.id], null);
    const before = await loadPuzzleStorm(run.id);
    const store = await getPuzzleStore();
    const originalGet = store.byId.get.bind(store.byId);
    const move = { from: 'a1', to: 'a1' } as const;
    const brokenPuzzle = { ...puzzle, solution: code === 'illegal-move' ? [move] : [] };
    const lookup = t.mock.method(store.byId, 'get', (id: string) =>
      id === puzzle.id ? brokenPuzzle : originalGet(id),
    );
    const response = await route('/api/puzzles/storm', 'POST', {
      action: 'move',
      runId: run.id,
      puzzleId: puzzle.id,
      version: 0,
      move,
    });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).attempt.code, code);
    assert.deepEqual(await loadPuzzleStorm(run.id), before);
    lookup.mock.restore();
    const retry = await route('/api/puzzles/storm', 'POST', {
      action: 'move',
      runId: run.id,
      puzzleId: puzzle.id,
      version: 0,
      move: puzzle.solution[0],
    });
    assert.equal(retry.status, 200);
    assert.equal(JSON.parse(retry.body).attempt.ok, true);
  });
}

test('anonymous streak counts solves, allows one skip, and locks the run on a miss', async () => {
  const started = await route('/api/puzzles/streak', 'POST', { action: 'start' });
  assert.equal(started.status, 200);
  let run = JSON.parse(started.body);
  assert.equal(run.score, 0);
  assert.equal(run.best, null);
  assert.equal(run.skipUsed, false);
  assert.equal(run.finished, false);
  assert.equal(JSON.stringify(run).includes('"solution":'), false);
  const first = XIANGQI_PUZZLES.find((p) => p.id === run.puzzle.id)!;
  for (const move of first.solution.filter((_, i) => i % 2 === 0)) {
    const response = await route('/api/puzzles/streak', 'POST', {
      action: 'move',
      runId: run.runId,
      puzzleId: first.id,
      move,
    });
    assert.equal(response.status, 200);
    run = JSON.parse(response.body);
  }
  assert.equal(run.score, 1);
  assert.equal(run.results[0].outcome, 'solved');
  assert.equal(run.solution, undefined);
  const duplicate = await route('/api/puzzles/streak', 'POST', {
    action: 'move',
    runId: run.runId,
    puzzleId: first.id,
    move: first.solution[0],
  });
  assert.equal(duplicate.status, 409);
  run = JSON.parse(
    (
      await route('/api/puzzles/streak', 'POST', {
        action: 'skip',
        runId: run.runId,
        puzzleId: run.puzzle.id,
      })
    ).body,
  );
  assert.equal(run.skipUsed, true);
  assert.equal(run.score, 1);
  assert.equal(run.results[1].outcome, 'skipped');
  const secondSkip = await route('/api/puzzles/streak', 'POST', {
    action: 'skip',
    runId: run.runId,
    puzzleId: run.puzzle.id,
  });
  assert.equal(secondSkip.status, 409);
  // A malformed action is rejected without ending the run.
  assert.equal(
    (
      await route('/api/puzzles/streak', 'POST', {
        action: 'move',
        runId: run.runId,
        puzzleId: run.puzzle.id,
        move: null,
      })
    ).status,
    400,
  );
  const missedId = run.puzzle.id;
  const missedPuzzle = XIANGQI_PUZZLES.find((p) => p.id === missedId)!;
  const wrongMove = getStandardXiangqiLegalMoves(missedPuzzle.initial).find((move) => {
    const attempt = attemptStandardXiangqiPuzzleLine(missedPuzzle, [move]);
    return !attempt.ok && attempt.code === 'incorrect-move';
  });
  assert.ok(wrongMove, 'the miss must be a legal wrong answer');
  run = JSON.parse(
    (
      await route('/api/puzzles/streak', 'POST', {
        action: 'move',
        runId: run.runId,
        puzzleId: missedId,
        move: wrongMove,
      })
    ).body,
  );
  assert.equal(run.attempt.ok, false);
  assert.equal(run.attempt.code, 'incorrect-move');
  assert.equal(run.finished, true);
  assert.equal(run.score, 1);
  assert.equal(run.results[2].outcome, 'failed');
  // The finishing miss carries the line so the end screen can play it out.
  assert.deepEqual(run.solution, missedPuzzle.solution);
  assert.equal(
    (
      await route('/api/puzzles/streak', 'POST', {
        action: 'move',
        runId: run.runId,
        puzzleId: missedId,
        move: first.solution[0],
      })
    ).status,
    409,
  );
});

test('a second streak run does not replay the first one', async () => {
  const N = 5;
  const firstRun = JSON.parse(
    (await route('/api/puzzles/streak', 'POST', { action: 'start' })).body,
  );
  const first = (await loadPuzzleStreak(firstRun.runId))!.state.ids;
  assert.ok(first.length > N * 2, 'the pool must be larger than the compared prefix');
  // The browser lists the puzzles the player met in the first run.
  const secondRun = JSON.parse(
    (
      await route('/api/puzzles/streak', 'POST', {
        action: 'start',
        recent: first.slice(0, N),
      })
    ).body,
  );
  const second = (await loadPuzzleStreak(secondRun.runId))!.state.ids;
  assert.notDeepEqual(second.slice(0, N), first.slice(0, N));
  // It opens on a puzzle the player has not met.
  assert.equal(first.slice(0, N).includes(second[0]!), false);
});

test('resume picks the open run up at the start of its puzzle and refuses an ended one', async () => {
  const puzzle = XIANGQI_PUZZLES.find((p) => p.solution.length >= 3)!;
  const run = await startPuzzleStreak(
    [puzzle.id, XIANGQI_PUZZLES.find((p) => p !== puzzle)!.id],
    null,
  );
  const played = await route('/api/puzzles/streak', 'POST', {
    action: 'move',
    runId: run.id,
    puzzleId: puzzle.id,
    move: puzzle.solution[0],
  });
  assert.equal(JSON.parse(played.body).attempt.ok, true);
  const resumed = await route('/api/puzzles/streak', 'POST', { action: 'resume', runId: run.id });
  assert.equal(resumed.status, 200);
  const body = JSON.parse(resumed.body);
  assert.equal(body.runId, run.id);
  assert.equal(body.puzzle.id, puzzle.id);
  assert.equal(JSON.stringify(body).includes('"solution":'), false);
  assert.deepEqual((await loadPuzzleStreak(run.id))!.state.moves, []);
  // The line is played again from its first move.
  const again = await route('/api/puzzles/streak', 'POST', {
    action: 'move',
    runId: run.id,
    puzzleId: puzzle.id,
    move: puzzle.solution[0],
  });
  assert.equal(JSON.parse(again.body).attempt.ok, true);

  const ended = await startPuzzleStreak([puzzle.id], null);
  ended.state.finished = true;
  assert.equal(await savePuzzleStreak(ended), true);
  assert.equal(
    (await route('/api/puzzles/streak', 'POST', { action: 'resume', runId: ended.id })).status,
    409,
  );
  assert.equal(
    (await route('/api/puzzles/streak', 'POST', { action: 'resume', runId: 'nope' })).status,
    400,
  );
  assert.equal(
    (
      await route('/api/puzzles/streak', 'POST', {
        action: 'resume',
        runId: 'a85ef43f-73b3-4ef0-bdc2-d1e907c1ff35',
      })
    ).status,
    404,
  );
});

for (const code of ['illegal-move', 'line-too-long'] as const) {
  test(`streak ${code} rejection preserves the run and allows a correct retry`, async (t) => {
    const puzzle = XIANGQI_PUZZLES[0]!;
    const run = await startPuzzleStreak([puzzle.id, XIANGQI_PUZZLES[1]!.id], null);
    const before = await loadPuzzleStreak(run.id);
    const store = await getPuzzleStore();
    const originalGet = store.byId.get.bind(store.byId);
    const move = { from: 'a1', to: 'a1' } as const;
    // These checker errors require a broken stored line: arbitrary guesses,
    // including illegal ones, are classified as incorrect-move first.
    const brokenPuzzle = { ...puzzle, solution: code === 'illegal-move' ? [move] : [] };
    const lookup = t.mock.method(store.byId, 'get', (id: string) =>
      id === puzzle.id ? brokenPuzzle : originalGet(id),
    );
    const response = await route('/api/puzzles/streak', 'POST', {
      action: 'move',
      runId: run.id,
      puzzleId: puzzle.id,
      move,
      qualitySessionId: 'a85ef43f-73b3-4ef0-bdc2-d1e907c1ff35',
    });
    assert.equal(response.status, 200);
    const rejected = JSON.parse(response.body);
    assert.equal(rejected.attempt.ok, false);
    assert.equal(rejected.attempt.code, code);
    assert.equal(rejected.finished, false);
    assert.equal(rejected.score, 0);
    assert.equal(rejected.skipUsed, false);
    assert.deepEqual(rejected.results, []);
    assert.deepEqual(await loadPuzzleStreak(run.id), before);

    lookup.mock.restore();
    const retried = await route('/api/puzzles/streak', 'POST', {
      action: 'move',
      runId: run.id,
      puzzleId: puzzle.id,
      move: puzzle.solution[0],
    });
    assert.equal(retried.status, 200);
    assert.equal(JSON.parse(retried.body).attempt.ok, true);
  });
}

test('puzzle list returns surfaced summaries without solutions', async () => {
  const response = await route('/api/puzzles');
  const body = JSON.parse(response.body) as {
    puzzles: Array<{
      id: string;
      variant: string;
      solution?: unknown;
      solutionPlyCount: number;
      rating: number;
      ratingProvisional: boolean;
      goal: { type: string };
    }>;
  };

  assert.equal(response.status, 200);
  // Jungle is hidden from the discoverable pool while its puzzle surface is
  // parked; Mini, Drop Mini and Fortress are retired variants
  // (docs-private/variant-retirement-plan.md, #396). The unfiltered list is
  // standard xiangqi alone.
  assert.equal(body.puzzles.length, XIANGQI_PUZZLES.length);
  assert.equal(
    body.puzzles.every((puzzle) => puzzle.variant === 'xiangqi'),
    true,
  );
  assert.equal(
    body.puzzles.every((puzzle) => puzzle.solution === undefined),
    true,
  );
  assert.equal(
    body.puzzles.every((puzzle) => Number.isFinite(puzzle.rating)),
    true,
  );
  assert.equal(
    body.puzzles.every((puzzle) => puzzle.ratingProvisional),
    true,
  );
});

test('puzzle list serves each puzzle on its rating folded with solution length (#712)', async () => {
  const response = await route('/api/puzzles');
  const body = JSON.parse(response.body) as {
    puzzles: Array<{ solutionPlyCount: number; rating: number; servingRating?: number }>;
  };
  assert.equal(response.status, 200);
  for (const puzzle of body.puzzles) {
    // No persistence here, so no outcomes: the length-folded prior.
    assert.equal(
      puzzle.servingRating,
      puzzleServingRating({ prior: puzzle.rating, solutionPlyCount: puzzle.solutionPlyCount }),
    );
  }
});

test('puzzle list filters by variant, and a retired variant filters to nothing', async () => {
  const xiangqi = await route('/api/puzzles?variant=xiangqi');
  assert.equal(xiangqi.status, 200);
  const xiangqiBody = JSON.parse(xiangqi.body) as { puzzles: Array<{ variant: string }> };
  assert.equal(xiangqiBody.puzzles.length, XIANGQI_PUZZLES.length);

  // A retired variant is not a variant the route knows: 400, not an empty list.
  const retired = await route('/api/puzzles?variant=mini-xiangqi');
  assert.equal(retired.status, 400);
});

test('player puzzle listing matches exact provenance, intersects filters and withholds hidden rows', async (t) => {
  const seedStore = await getPuzzleStore();
  const seed = XIANGQI_PUZZLES.find((puzzle) => seedStore.motifsById.has(puzzle.id))!;
  const motif = seedStore.motifsById.get(seed.id)![0]!;
  const theme = xiangqiPuzzleTrainingTags(seed)[0]!;
  const makePuzzle = (id: string, tags: string[]) => ({ ...seed, id, sourceGame: undefined, tags });
  const matching = makePuzzle('player-match', ['player:fixture-player', 'player:fixture-opponent']);
  const other = makePuzzle('other-player', ['player:fixture-player-two']);
  const untagged = makePuzzle('untagged', []);
  const hidden = makePuzzle('withheld-player', ['player:fixture-player']);
  const rows = [matching, other, untagged, hidden].map((data) => ({
    data,
    hidden: data.id === hidden.id,
    position_only: false,
  }));
  resetPuzzleStoreForTests();
  init('postgres://unused@127.0.0.1:9/never');
  t.after(async () => {
    await close();
    resetPuzzleStoreForTests();
  });
  t.mock.method(getPool(), 'query', async (sql: string) => {
    if (sql.includes('SELECT seed_hash')) return { rows: [{ seed_hash: seedPuzzleContentHash() }] };
    if (sql.includes('SELECT data, position_only FROM puzzles')) {
      assert.match(sql, /WHERE hidden_reason IS NULL/);
      return { rows: rows.filter((row) => !row.hidden) };
    }
    assert.match(sql, /FROM puzzle_ratings|FROM puzzle_quality_sessions/);
    return { rows: [] };
  });
  const all = JSON.parse((await route('/api/puzzles')).body);
  const filtered = await route('/api/puzzles?player=fixture-player');
  assert.equal(filtered.status, 200);
  const body = JSON.parse(filtered.body);
  assert.deepEqual(
    body.puzzles.map((p: { id: string }) => p.id),
    [matching.id],
  );
  assert.deepEqual(
    body.puzzles,
    all.puzzles.filter((p: { id: string }) => p.id === matching.id),
  );
  assert.deepEqual(body.tagCounts, all.tagCounts);
  assert.deepEqual(body.themes, all.themes);
  assert.ok(body.puzzles[0].tags.includes('player:fixture-player'));
  assert.ok(body.puzzles[0].tags.includes(theme));
  assert.doesNotMatch(filtered.body, /"(?:initial|solution|sourceGame)":/);
  const detail = JSON.parse((await route(`/api/puzzles/${matching.id}`)).body);
  assert.deepEqual(detail.puzzle.tags, body.puzzles[0].tags);
  const withheld = await route(`/api/puzzles/${hidden.id}`);
  assert.equal(withheld.status, 404);
  for (const query of [
    'player=fixture-opponent',
    `player=fixture-player&variant=xiangqi&motif=${motif}&theme=${theme}`,
  ]) {
    assert.deepEqual(JSON.parse((await route(`/api/puzzles?${query}`)).body).puzzles, body.puzzles);
  }
  for (const query of [
    'player=unknown-player',
    'player=fixture',
    'player=FIXTURE-PLAYER',
    'player=fixture-player&variant=jungle',
    'player=fixture-player&theme=winning',
    `player=fixture-player&motif=${XIANGQI_MOTIFS.find((m) => !seedStore.motifsById.get(seed.id)!.includes(m.id))!.id}`,
  ]) {
    const response = await route(`/api/puzzles?${query}`);
    assert.equal(response.status, 200, query);
    assert.deepEqual(JSON.parse(response.body).puzzles, [], query);
  }
  assert.deepEqual(JSON.parse((await route('/api/puzzles?player=')).body), all);
  assert.equal((await route('/api/puzzles?player=fixture-player&theme=unknown')).status, 400);
});

test('puzzle list filters by every registered motif without changing summary order or fields', async () => {
  const unfiltered = await route('/api/puzzles');
  assert.equal(unfiltered.status, 200);
  const all = JSON.parse(unfiltered.body) as {
    puzzles: Array<{ id: string; motifs: XiangqiMotifId[] }>;
    attemptedIds: string[];
  };
  let hasNonemptySubset = false;

  for (const { id } of XIANGQI_MOTIFS) {
    const response = await route(`/api/puzzles?motif=${id}`);
    assert.equal(response.status, 200, id);
    const body = JSON.parse(response.body) as typeof all;
    const expected = all.puzzles.filter((puzzle) => puzzle.motifs.includes(id));
    hasNonemptySubset ||= expected.length > 0 && expected.length < all.puzzles.length;
    assert.equal(body.puzzles.length, expected.length, id);
    assert.deepEqual(body.puzzles, expected, id);
    assert.deepEqual(body.attemptedIds, all.attemptedIds, id);
  }
  assert.ok(hasNonemptySubset, 'the corpus must exercise a motif with matches and exclusions');
});

test('puzzle list filters by any trainer tag through theme=, and counts every tag', async () => {
  const all = JSON.parse((await route('/api/puzzles')).body) as {
    puzzles: Array<{ id: string; variant: string; motifs: string[]; tags: string[] }>;
    tagCounts: Record<string, number>;
  };
  // Every tag is counted, zeros included, so the page can hide what is empty.
  const ids = [...XIANGQI_MOTIFS.map((m) => m.id), ...XIANGQI_TRAINING_TAGS.map((t) => t.id)];
  assert.deepEqual(Object.keys(all.tagCounts).sort(), [...ids].sort());

  let exercised = 0;
  for (const id of ids) {
    const response = await route(`/api/puzzles?theme=${id}`);
    assert.equal(response.status, 200, id);
    const body = JSON.parse(response.body) as typeof all;
    const expected = all.puzzles.filter((puzzle) => puzzle.tags.includes(id));
    assert.deepEqual(body.puzzles, expected, id);
    assert.equal(all.tagCounts[id], expected.length, id);
    // The counts describe the pool before the filter.
    assert.deepEqual(body.tagCounts, all.tagCounts, id);
    if (expected.length > 0 && expected.length < all.puzzles.length) exercised += 1;
  }
  assert.ok(exercised >= 5, 'the corpus must exercise several tags with matches and exclusions');
});

test('trainer tags are derived at load, not read from the mined themes', async () => {
  const all = JSON.parse((await route('/api/puzzles?variant=xiangqi')).body) as {
    puzzles: Array<{ id: string; motifs: string[]; tags: string[] }>;
  };
  const byId = new Map(XIANGQI_PUZZLES.map((puzzle) => [puzzle.id, puzzle]));
  for (const summary of all.puzzles) {
    const puzzle = byId.get(summary.id);
    assert.ok(puzzle, summary.id);
    assert.deepEqual(summary.tags, [...summary.motifs, ...xiangqiPuzzleTrainingTags(puzzle)]);
  }
});

test('theme= intersects motif= and rejects unknown tags', async () => {
  const both = await route('/api/puzzles?motif=ma-hou-pao&theme=matein1');
  assert.equal(both.status, 200);
  const body = JSON.parse(both.body) as { puzzles: Array<{ tags: string[] }> };
  for (const puzzle of body.puzzles) {
    assert.ok(puzzle.tags.includes('ma-hou-pao') && puzzle.tags.includes('matein1'));
  }
  for (const theme of ['crushing', 'winning-material', 'MATEIN1', '__proto__', 'toString']) {
    const response = await route(`/api/puzzles?theme=${encodeURIComponent(theme)}`);
    assert.equal(response.status, 400, theme);
    assert.deepEqual(JSON.parse(response.body), { error: 'invalid_theme' }, theme);
  }
  const empty = await route('/api/puzzles?theme=');
  assert.deepEqual(JSON.parse(empty.body), JSON.parse((await route('/api/puzzles')).body));
});

test('puzzle list treats an empty motif like an omitted motif', async () => {
  const unfiltered = await route('/api/puzzles');
  const empty = await route('/api/puzzles?motif=');
  assert.equal(empty.status, 200);
  assert.deepEqual(JSON.parse(empty.body), JSON.parse(unfiltered.body));
});

test('puzzle list rejects unknown or malformed motif ids', async () => {
  for (const motif of [
    'not-a-motif',
    'MA-HOU-PAO',
    ' ma-hou-pao',
    'ma-hou-pao ',
    'ma-hou-pao,men-sha',
    '__proto__',
    'toString',
  ]) {
    const response = await route(`/api/puzzles?motif=${encodeURIComponent(motif)}`);
    assert.equal(response.status, 400, motif);
    assert.deepEqual(JSON.parse(response.body), { error: 'invalid_motif' }, motif);
  }
});

test('puzzle list combines motif and variant filters while keeping parked puzzles hidden', async () => {
  const motif = await route('/api/puzzles?motif=ma-hou-pao');
  const xiangqi = await route('/api/puzzles?variant=xiangqi&motif=ma-hou-pao');
  assert.equal(motif.status, 200);
  assert.equal(xiangqi.status, 200);
  assert.deepEqual(JSON.parse(xiangqi.body), JSON.parse(motif.body));

  const jungle = await route('/api/puzzles?variant=jungle&motif=ma-hou-pao');
  assert.equal(jungle.status, 200);
  // `themes` and `tagCounts` (#376) carry the variant pool's counts; their own tests cover them.
  const { themes: _themes, tagCounts: _tagCounts, ...jungleList } = JSON.parse(jungle.body);
  assert.deepEqual(jungleList, { puzzles: [], attemptedIds: [] });

  const invalidMotif = await route('/api/puzzles?variant=jungle&motif=not-a-motif');
  assert.equal(invalidMotif.status, 400);
  assert.deepEqual(JSON.parse(invalidMotif.body), { error: 'invalid_motif' });

  const retired = await route('/api/puzzles?variant=fortress-xiangqi&motif=ma-hou-pao');
  assert.equal(retired.status, 400);
  assert.deepEqual(JSON.parse(retired.body), { error: 'invalid_variant' });
});

// Fortress Xiangqi was retired on 2026-10-11 and its puzzle registry deleted.
// Old links (a bookmarked /puzzles/<id>, a rating chip, a cached daily) must
// meet a clean not-found, never a 500 or a throw from a missing adapter.
const DELETED_FORTRESS_PUZZLE_ID = 'fortress-xiangqi-mined-v2-001';

test('a deleted Fortress puzzle id is not found on every puzzle route', async () => {
  const detail = await route(`/api/puzzles/${DELETED_FORTRESS_PUZZLE_ID}`);
  assert.equal(detail.status, 404);
  assert.deepEqual(JSON.parse(detail.body), { error: 'not_found' });

  // Its short code resolves to nothing either.
  const short = await route(`/api/puzzles/${puzzleShortCode(DELETED_FORTRESS_PUZZLE_ID)}`);
  assert.equal(short.status, 404);

  const attempt = await route(`/api/puzzles/${DELETED_FORTRESS_PUZZLE_ID}/attempt`, 'POST', {
    moves: [{ from: 'e1', to: 'e2' }],
  });
  assert.equal(attempt.status, 404);
  assert.deepEqual(JSON.parse(attempt.body), { error: 'not_found' });

  const reveal = await route(`/api/puzzles/${DELETED_FORTRESS_PUZZLE_ID}/reveal`, 'POST', {
    mode: 'solution',
  });
  assert.equal(reveal.status, 404);
  assert.deepEqual(JSON.parse(reveal.body), { error: 'not_found' });

  const quality = await route(`/api/puzzles/${DELETED_FORTRESS_PUZZLE_ID}/quality`, 'POST', {
    sessionId: 'a85ef43f-73b3-4ef0-bdc2-d1e907c1ff35',
    event: 'view',
  });
  assert.equal(quality.status, 404);
});

test('the Fortress Xiangqi variant is no longer a puzzle filter', async () => {
  const list = await route('/api/puzzles?variant=fortress-xiangqi');
  assert.equal(list.status, 400);
  assert.deepEqual(JSON.parse(list.body), { error: 'invalid_variant' });

  const rating = await route('/api/puzzles/rating?variant=fortress-xiangqi');
  assert.equal(rating.status, 400);
  assert.deepEqual(JSON.parse(rating.body), { error: 'invalid_variant' });
});

test('puzzle list hides Jungle puzzles while the surface is parked', async () => {
  const response = await route('/api/puzzles?variant=jungle');
  const body = JSON.parse(response.body) as {
    puzzles: Array<{ variant: string; solution?: unknown }>;
  };

  assert.equal(response.status, 200);
  assert.equal(body.puzzles.length, 0);
});

test('puzzle list rejects unsupported variants', async () => {
  const response = await route('/api/puzzles?variant=banqi');

  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(response.body), { error: 'invalid_variant' });
});

test('puzzle theme filter matches classified motifs and returns unfiltered theme counts', async () => {
  const all = JSON.parse((await route('/api/puzzles')).body);
  assert.deepEqual(
    all.themes.map((motif: { id: string }) => motif.id),
    XIANGQI_MOTIFS.map((motif) => motif.id),
  );
  for (const motif of all.themes) {
    assert.equal(
      motif.count,
      all.puzzles.filter((puzzle: { motifs: string[] }) => puzzle.motifs.includes(motif.id)).length,
    );
    assert.ok(motif.literal && motif.gloss && motif.pinyin && motif.hanzi);
  }
  const theme = 'ma-hou-pao';
  const expected = all.puzzles.filter((puzzle: { motifs: string[] }) =>
    puzzle.motifs.includes(theme),
  );
  assert.ok(expected.length > 0 && expected.length < all.puzzles.length);
  const response = await route(`/api/puzzles?variant=xiangqi&motif=${theme}`);
  assert.equal(response.status, 200);
  const filtered = JSON.parse(response.body);
  assert.deepEqual(filtered.puzzles, expected);
  assert.deepEqual(filtered.themes, all.themes);
  const entry = filtered.themes.find((item: { id: string }) => item.id === theme);
  assert.equal(entry.count, expected.length);
  assert.equal(entry.hanzi, '马后炮');
  assert.ok(entry.pinyin && entry.literal && entry.gloss);
  assert.equal(JSON.stringify(filtered).includes('"solution":'), false);
});

test('puzzle themes reject unknown ids and intersect variant discovery', async () => {
  // An empty motif is no filter (main's #637 contract); only unknown ids are refused.
  for (const theme of ['unknown', 'toString', 'mate']) {
    const response = await route(`/api/puzzles?motif=${theme}`);
    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.body), { error: 'invalid_motif' });
  }
  const jungle = JSON.parse((await route('/api/puzzles?variant=jungle&motif=ma-hou-pao')).body);
  assert.deepEqual(jungle.puzzles, []);
  assert.ok(jungle.themes.every((theme: { count: number }) => theme.count === 0));
});

// Standard xiangqi serving wiring: the variant filter round-trips even while
// the mined registry is still empty (assert the wiring, not the content).
test('puzzle list filters to standard Xiangqi puzzles', async () => {
  const response = await route('/api/puzzles?variant=xiangqi');
  const body = JSON.parse(response.body) as {
    puzzles: Array<{ variant: string; solution?: unknown }>;
  };

  assert.equal(response.status, 200);
  assert.equal(body.puzzles.length, XIANGQI_PUZZLES.length);
  assert.equal(
    body.puzzles.every((puzzle) => puzzle.variant === 'xiangqi'),
    true,
  );
  assert.equal(
    body.puzzles.every((puzzle) => puzzle.solution === undefined),
    true,
  );
});

test('puzzle detail resolves a lichess-style short code to the full puzzle', async () => {
  const target = XIANGQI_PUZZLES[0]!;
  const code = puzzleShortCode(target.id);
  const response = await route(`/api/puzzles/${code}`);
  const body = JSON.parse(response.body) as { puzzle: { id: string } };

  assert.equal(response.status, 200);
  // The short-code request resolves to the canonical full-id puzzle.
  assert.equal(body.puzzle.id, target.id);
});

test('puzzle detail still 404s for an unknown short code', async () => {
  // Well-formed code shape, but no puzzle hashes to it.
  const response = await route('/api/puzzles/zzzzz');
  assert.equal(response.status, 404);
  assert.deepEqual(JSON.parse(response.body), { error: 'not_found' });
});

test('puzzle rating route accepts the standard xiangqi variant', async () => {
  const response = await route('/api/puzzles/rating?variant=xiangqi');

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { rating: null });
});

test('puzzle quality route accepts a per-view UUID and rejects malformed ids', async () => {
  const puzzle = XIANGQI_PUZZLES[0]!;
  const accepted = await route(`/api/puzzles/${puzzle.id}/quality`, 'POST', {
    sessionId: 'a85ef43f-73b3-4ef0-bdc2-d1e907c1ff35',
    event: 'view',
  });
  assert.equal(accepted.status, 204);

  const rejected = await route(`/api/puzzles/${puzzle.id}/quality`, 'POST', {
    sessionId: 'cross-puzzle-browser-id',
    event: 'view',
  });
  assert.equal(rejected.status, 400);
  assert.deepEqual(JSON.parse(rejected.body), { error: 'invalid_quality_session' });
});

test('attempt and reveal routes accept a quality session without exposing the solution', async () => {
  const puzzle = XIANGQI_PUZZLES[0]!;
  const qualitySessionId = 'f75cdffd-6cae-4052-a5cf-5fdd72155bed';
  const attempt = await route(`/api/puzzles/${puzzle.id}/attempt`, 'POST', {
    moves: [puzzle.solution[0]],
    qualitySessionId,
  });
  assert.equal(attempt.status, 200);
  assert.equal(JSON.parse(attempt.body).attempt.solution, undefined);

  const reveal = await route(`/api/puzzles/${puzzle.id}/reveal`, 'POST', {
    mode: 'hint',
    playedPlyCount: 0,
    qualitySessionId,
  });
  assert.equal(reveal.status, 200);
  assert.deepEqual(JSON.parse(reveal.body).move, puzzle.solution[0]);
});

test('Jungle puzzle attempts solve the mined forced win and stay solution-hidden', async () => {
  // Derive from the corpus so the test tracks regeneration. Submit only the solver
  // moves (even indices); the server auto-applies the scripted defender replies.
  const puzzle = JUNGLE_PUZZLES.find((p) => p.goal.type === 'win');
  assert.ok(puzzle, 'expected at least one forced-win Jungle puzzle');
  const solverMoves = puzzle.solution.filter((_, index) => index % 2 === 0);
  const response = await route(`/api/puzzles/${puzzle.id}/attempt`, 'POST', {
    moves: solverMoves,
  });
  const body = JSON.parse(response.body) as {
    attempt: {
      ok: boolean;
      complete: boolean;
      state: { status: { type: string; winner?: string; reason?: string } };
      solution?: unknown;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.attempt.ok, true);
  assert.equal(body.attempt.complete, true);
  assert.equal(body.attempt.state.status.type, 'finished');
  assert.equal(body.attempt.state.status.winner, puzzle.goal.winner);
  assert.equal(body.attempt.solution, undefined);
});

test('daily puzzle route returns a public persisted-assignment shape without solutions', async () => {
  const response = await route('/api/puzzles/daily');
  const body = JSON.parse(response.body) as {
    daily: {
      day: string;
      persisted: boolean;
      selectedAt: string | null;
      slot: string;
      source: string;
    };
    puzzle: {
      id: string;
      initial: unknown;
      solution?: unknown;
      variant: string;
    };
  };

  assert.equal(response.status, 200);
  assert.match(body.daily.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(body.daily.slot, 'homepage');
  assert.equal(body.daily.persisted, false);
  assert.equal(body.daily.source, 'ephemeral');
  assert.equal(body.daily.selectedAt, null);
  assert.equal(typeof body.puzzle.id, 'string');
  // The daily rotation draws from standard xiangqi.
  assert.equal(body.puzzle.variant, 'xiangqi');
  assert.notEqual(body.puzzle.initial, undefined);
  assert.equal(body.puzzle.solution, undefined);
});

test('daily puzzle route rejects unsupported slots', async () => {
  const response = await route('/api/puzzles/daily?slot=fortress-training');

  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(response.body), { error: 'invalid_slot' });
});

test('puzzle detail returns the starting position but not the solution', async () => {
  const puzzle = XIANGQI_PUZZLES[0]!;
  const response = await route(`/api/puzzles/${puzzle.id}`);
  const body = JSON.parse(response.body) as {
    puzzle: {
      id: string;
      initial: { board: Record<string, { color: string; role: string }> };
      solution?: unknown;
      sideToMove: string;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.puzzle.id, puzzle.id);
  assert.equal(
    body.puzzle.sideToMove,
    puzzle.initial.status.type === 'playing' ? puzzle.initial.status.turn : null,
  );
  assert.deepEqual(body.puzzle.initial.board, puzzle.initial.board);
  assert.equal(body.puzzle.solution, undefined);
  // Persistence off: no stored source game, so no setup move (the client then
  // shows `initial` at once, as before #664).
  assert.equal((body.puzzle as { setupMove?: unknown }).setupMove, undefined);
});

test('puzzle detail 404s unknown puzzle ids', async () => {
  const response = await route('/api/puzzles/not-a-real-puzzle');

  assert.equal(response.status, 404);
  assert.deepEqual(JSON.parse(response.body), { error: 'not_found' });
});

// A mined mate-in-one and a three-ply line, so the attempt tests below read the
// scripted moves from the seed instead of pinning squares.
const ONE_PLY = XIANGQI_PUZZLES.find((puzzle) => puzzle.solution.length === 1)!;
const THREE_PLY = XIANGQI_PUZZLES.find((puzzle) => puzzle.solution.length === 3)!;

test('puzzle attempts advance correct moves without exposing the solution list', async () => {
  const response = await route(`/api/puzzles/${ONE_PLY.id}/attempt`, 'POST', {
    moves: [ONE_PLY.solution[0]],
  });
  const body = JSON.parse(response.body) as {
    attempt: {
      ok: boolean;
      complete: boolean;
      state: { status: { type: string; reason?: string } };
      solution?: unknown;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.attempt.ok, true);
  assert.equal(body.attempt.complete, true);
  assert.equal(body.attempt.solution, undefined);
});

test('puzzle attempts auto-apply opponent replies for multi-ply lines', async () => {
  const [first, reply, last] = THREE_PLY.solution;
  const response = await route(`/api/puzzles/${THREE_PLY.id}/attempt`, 'POST', {
    moves: [first],
  });
  const body = JSON.parse(response.body) as {
    attempt: {
      ok: boolean;
      complete: boolean;
      playedMoves: unknown[];
      solverMoves: unknown[];
      state: { status: { type: string; turn?: string } };
      solution?: unknown;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.attempt.ok, true);
  assert.equal(body.attempt.complete, false);
  assert.deepEqual(body.attempt.playedMoves, [first, reply]);
  assert.deepEqual(body.attempt.solverMoves, [first]);
  assert.equal(body.attempt.state.status.type, 'playing');
  assert.equal(body.attempt.solution, undefined);
  // The solver's next move is not leaked ahead of time.
  assert.equal(response.body.includes(JSON.stringify(last)), false);
});

test('puzzle attempts reject wrong moves without returning the right move', async () => {
  const wrong = { from: ONE_PLY.solution[0]!.from, to: ONE_PLY.solution[0]!.from };
  const response = await route(`/api/puzzles/${ONE_PLY.id}/attempt`, 'POST', {
    moves: [wrong],
  });
  const body = JSON.parse(response.body) as {
    attempt: {
      ok: boolean;
      puzzleId: string;
      variant: string;
      code: string;
      ply: number;
      move: unknown;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.attempt.ok, false);
  assert.equal(body.attempt.puzzleId, ONE_PLY.id);
  assert.equal(body.attempt.variant, 'xiangqi');
  assert.equal(body.attempt.ply, 0);
  assert.deepEqual(body.attempt.move, wrong);
  assert.equal(response.body.includes(JSON.stringify(ONE_PLY.solution[0])), false);
});

test('puzzle attempts reject malformed move bodies', async () => {
  const response = await route(`/api/puzzles/${ONE_PLY.id}/attempt`, 'POST', {
    moves: [{ to: 'e5' }],
  });

  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(response.body), { error: 'invalid_moves' });
});

test('puzzle rating route requires a variant', async () => {
  const response = await route('/api/puzzles/rating');

  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(response.body), { error: 'invalid_variant' });
});

test('puzzle rating route returns null for an anonymous or unrated user', async () => {
  const response = await route('/api/puzzles/rating?variant=jungle');

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { rating: null });
});

test('attempts omit rating info when there is no rated session', async () => {
  // Rating omission is variant-agnostic, so any shipped puzzle proves it.
  const jungle = JUNGLE_PUZZLES[0];
  assert.ok(jungle, 'expected a jungle puzzle');
  const response = await route(`/api/puzzles/${jungle.id}/attempt`, 'POST', {
    moves: [jungle.solution[0]],
  });
  const body = JSON.parse(response.body) as { attempt: { ok: boolean }; rating?: unknown };

  assert.equal(response.status, 200);
  assert.equal(body.attempt.ok, true);
  assert.equal(body.rating, undefined);
});

test('puzzle routes reject non-GET methods', async () => {
  const response = await route('/api/puzzles', 'POST');

  assert.equal(response.status, 405);
  assert.deepEqual(JSON.parse(response.body), { error: 'method_not_allowed' });
});

// ── Solution reveal / hint ───────────────────────────────────────────────────
// The reveal endpoint is the ONLY route that returns solution move data; the
// detail (and list/attempt) routes must stay count-only. These tests pin that
// invariant plus the new hint/solution payload shapes. Standard xiangqi is the
// priority variant, so it leads.

test('reveal endpoint returns the full solution line, and it is the only leak path', async () => {
  const puzzle = XIANGQI_PUZZLES[0];
  assert.ok(puzzle, 'expected a mined standard-xiangqi puzzle');

  // Detail route stays solution-hidden: count only, no move data.
  const detail = await route(`/api/puzzles/${puzzle.id}`);
  const detailBody = JSON.parse(detail.body) as {
    puzzle: { solution?: unknown; solutionPlyCount: number };
  };
  assert.equal(detail.status, 200);
  assert.equal(detailBody.puzzle.solution, undefined);
  assert.equal(detailBody.puzzle.solutionPlyCount, puzzle.solution.length);

  // Reveal route is the one place the line is exposed.
  const reveal = await route(`/api/puzzles/${puzzle.id}/reveal`, 'POST', { mode: 'solution' });
  const revealBody = JSON.parse(reveal.body) as { solution: unknown[]; rating?: unknown };
  assert.equal(reveal.status, 200);
  assert.deepEqual(revealBody.solution, puzzle.solution);
  // Anonymous caller: no rating booked.
  assert.equal(revealBody.rating, undefined);
});

test('reveal endpoint in hint mode returns only the next move, never the full line', async () => {
  const puzzle = XIANGQI_PUZZLES[0];
  assert.ok(puzzle, 'expected a mined standard-xiangqi puzzle');

  // Fresh puzzle (0 plies played): the hint is the solver's first move.
  const first = await route(`/api/puzzles/${puzzle.id}/reveal`, 'POST', {
    mode: 'hint',
    playedPlyCount: 0,
  });
  const firstBody = JSON.parse(first.body) as { move: unknown; solution?: unknown };
  assert.equal(first.status, 200);
  assert.deepEqual(firstBody.move, puzzle.solution[0]);
  // Hint mode must not leak the rest of the line.
  assert.equal(firstBody.solution, undefined);

  // After the solver move + scripted reply (2 plies), the hint is solution[2].
  if (puzzle.solution.length > 2) {
    const next = await route(`/api/puzzles/${puzzle.id}/reveal`, 'POST', {
      mode: 'hint',
      playedPlyCount: 2,
    });
    const nextBody = JSON.parse(next.body) as { move: unknown };
    assert.deepEqual(nextBody.move, puzzle.solution[2]);
  }

  // A missing/out-of-range ply count falls back to the first move, not a crash.
  const fallback = await route(`/api/puzzles/${puzzle.id}/reveal`, 'POST', { mode: 'hint' });
  const fallbackBody = JSON.parse(fallback.body) as { move: unknown };
  assert.equal(fallback.status, 200);
  assert.deepEqual(fallbackBody.move, puzzle.solution[0]);
});

test('reveal endpoint reads the solution generically across variants', async () => {
  for (const puzzle of [JUNGLE_PUZZLES[0], XIANGQI_PUZZLES[0]]) {
    assert.ok(puzzle, 'expected a puzzle in each variant registry');
    const reveal = await route(`/api/puzzles/${puzzle.id}/reveal`, 'POST', { mode: 'solution' });
    const body = JSON.parse(reveal.body) as { solution: unknown[] };
    assert.equal(reveal.status, 200, puzzle.id);
    assert.deepEqual(body.solution, puzzle.solution, puzzle.id);
  }
});

test('reveal endpoint 404s unknown puzzle ids', async () => {
  const response = await route('/api/puzzles/not-a-real-puzzle/reveal', 'POST', {
    mode: 'solution',
  });

  assert.equal(response.status, 404);
  assert.deepEqual(JSON.parse(response.body), { error: 'not_found' });
});

test('reveal endpoint rejects non-POST methods', async () => {
  const puzzle = XIANGQI_PUZZLES[0];
  assert.ok(puzzle, 'expected a mined standard-xiangqi puzzle');
  const response = await route(`/api/puzzles/${puzzle.id}/reveal`, 'GET');

  assert.equal(response.status, 405);
  assert.deepEqual(JSON.parse(response.body), { error: 'method_not_allowed' });
});

test('puzzle list carries attemptedIds, empty without a session', async () => {
  // Anonymous visitors have no server-side history, so the field must still be
  // present and empty rather than absent: the client merges it into its
  // seen-set unconditionally, and a missing field would silently disable
  // cross-device rotation for everyone if this ever regressed.
  const response = await route('/api/puzzles');
  const body = JSON.parse(response.body) as { attemptedIds?: unknown };

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.attemptedIds), 'attemptedIds should always be an array');
  assert.deepEqual(body.attemptedIds, []);
});

test('mined xiangqi puzzles are seeded from the derived prior, not four depth buckets', async () => {
  // seedPuzzleRating on mate depth alone yields four values corpus-wide, and
  // 943 of 1,605 production puzzles land on the same one. Selection scores on
  // |rating - target|, so hundreds of identical ratings make ranking a coin
  // flip. Assert the SPREAD, not any single number: the point is that puzzles
  // of equal mate depth are no longer indistinguishable.
  const response = await route('/api/puzzles?variant=xiangqi');
  const body = JSON.parse(response.body) as {
    puzzles: Array<{ id: string; rating: number; solutionPlyCount: number }>;
  };
  assert.equal(response.status, 200);

  const byDepth = new Map<number, Set<number>>();
  for (const puzzle of body.puzzles) {
    const set = byDepth.get(puzzle.solutionPlyCount) ?? new Set<number>();
    set.add(puzzle.rating);
    byDepth.set(puzzle.solutionPlyCount, set);
  }

  // At least one depth group must carry more than one rating. With the
  // depth-only seed every group collapses to exactly one.
  const spread = [...byDepth.entries()].filter(([, ratings]) => ratings.size > 1);
  assert.ok(
    spread.length > 0,
    `expected at least one mate-depth group to hold several ratings, got ${JSON.stringify(
      [...byDepth.entries()].map(([depth, ratings]) => [depth, ratings.size]),
    )}`,
  );

  // Ratings must stay inside the difficulty range the derivation clamps to.
  for (const puzzle of body.puzzles) {
    assert.ok(
      puzzle.rating >= 1000 && puzzle.rating <= 2600,
      `puzzle ${puzzle.id} rated ${puzzle.rating} outside the derived range`,
    );
  }
});
