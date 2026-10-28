import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import {
  attemptStandardXiangqiPuzzleLine,
  getStandardXiangqiLegalMoves,
  type JunglePuzzle,
  puzzleShortCode,
  XIANGQI_MOTIFS,
  type XiangqiMotifId,
  type XiangqiPuzzle,
} from '@mistboard/game';
import { loadSeedPuzzleRegistry } from '@mistboard/game/puzzle-seed';
import { getPuzzleStore } from './puzzle-store.js';
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

test('puzzle list filters by variant, and a retired variant filters to nothing', async () => {
  const xiangqi = await route('/api/puzzles?variant=xiangqi');
  assert.equal(xiangqi.status, 200);
  const xiangqiBody = JSON.parse(xiangqi.body) as { puzzles: Array<{ variant: string }> };
  assert.equal(xiangqiBody.puzzles.length, XIANGQI_PUZZLES.length);

  // A retired variant is not a variant the route knows: 400, not an empty list.
  const retired = await route('/api/puzzles?variant=mini-xiangqi');
  assert.equal(retired.status, 400);
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
  assert.deepEqual(JSON.parse(jungle.body), { puzzles: [], attemptedIds: [] });

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
