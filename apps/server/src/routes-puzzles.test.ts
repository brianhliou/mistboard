import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import {
  type FortressXiangqiPuzzle,
  type JunglePuzzle,
  type MiniXiangqiPuzzle,
  puzzleShortCode,
  type XiangqiPuzzle,
} from '@mistboard/game';
import { loadSeedPuzzleRegistry } from '@mistboard/game/puzzle-seed';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle } from './routes/puzzles.js';

// These tests run persistence-off, so the routes serve the puzzle store's
// seed-backed snapshot. Assertions therefore compare against the SEED corpus
// (the served source of truth since #183), not the small in-package fixture
// arrays.
const MINI_XIANGQI_PUZZLES = loadSeedPuzzleRegistry('mini-xiangqi') as readonly MiniXiangqiPuzzle[];
const FORTRESS_XIANGQI_PUZZLES = loadSeedPuzzleRegistry(
  'fortress-xiangqi',
) as readonly FortressXiangqiPuzzle[];
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
  // Fortress and Jungle are hidden from the discoverable pool while their
  // puzzle surfaces are parked; Mini and Drop Mini are retired variants
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

  for (const variant of ['mini-xiangqi']) {
    const response = await route(`/api/puzzles?variant=${variant}`);
    assert.equal(response.status, 200, variant);
    const body = JSON.parse(response.body) as { puzzles: unknown[] };
    assert.equal(body.puzzles.length, 0, variant);
  }
});

test('puzzle list hides Fortress Xiangqi puzzles while the variant is demoted', async () => {
  // Fortress is omitted from the discoverable pool pending a re-mine with the
  // per-ply uniqueness gate; the list returns nothing even for an explicit
  // variant filter. Individual fortress puzzles stay resolvable by id (below).
  const response = await route('/api/puzzles?variant=fortress-xiangqi');
  const body = JSON.parse(response.body) as { puzzles: unknown[] };

  assert.equal(response.status, 200);
  assert.equal(body.puzzles.length, 0);
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

// REMOVED 2026-09-03: 'Fortress puzzle attempts solve the mined mate and stay
// solution-hidden'. It drove fortress-xiangqi-mined-v2-001, and Fortress ships no
// puzzles now (see the banner in puzzles-fortress-xiangqi-fixtures.ts). The attempt
// flow it covered is still exercised by the jungle and mini-xiangqi cases here.
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
  // The daily rotation draws from the Fortress and standard xiangqi providers.
  assert.equal(['fortress-xiangqi', 'xiangqi'].includes(body.puzzle.variant), true);
  assert.notEqual(body.puzzle.initial, undefined);
  assert.equal(body.puzzle.solution, undefined);
});

test('daily puzzle route rejects unsupported slots', async () => {
  const response = await route('/api/puzzles/daily?slot=fortress-training');

  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(response.body), { error: 'invalid_slot' });
});

test('puzzle detail returns the starting position but not the solution', async () => {
  const response = await route('/api/puzzles/mini-xiangqi-red-back-rank-net-1');
  const body = JSON.parse(response.body) as {
    puzzle: {
      id: string;
      initial: { board: Record<string, { color: string; role: string }> };
      solution?: unknown;
      sideToMove: string;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.puzzle.id, 'mini-xiangqi-red-back-rank-net-1');
  assert.equal(body.puzzle.sideToMove, 'red');
  assert.deepEqual(body.puzzle.initial.board.c4, { color: 'red', role: 'chariot' });
  assert.equal(body.puzzle.solution, undefined);
});

test('puzzle detail 404s unknown puzzle ids', async () => {
  const response = await route('/api/puzzles/not-a-real-puzzle');

  assert.equal(response.status, 404);
  assert.deepEqual(JSON.parse(response.body), { error: 'not_found' });
});

test('puzzle attempts advance correct moves without exposing the solution list', async () => {
  const response = await route('/api/puzzles/mini-xiangqi-red-back-rank-net-1/attempt', 'POST', {
    moves: [{ from: 'c4', to: 'd4' }],
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
  assert.deepEqual(body.attempt.state.status, {
    type: 'finished',
    winner: 'red',
    reason: 'checkmate',
  });
  assert.equal(body.attempt.solution, undefined);
});

test('puzzle attempts auto-apply opponent replies for multi-ply lines', async () => {
  const response = await route(
    '/api/puzzles/mini-xiangqi-black-two-step-file-net-1/attempt',
    'POST',
    {
      moves: [{ from: 'c5', to: 'd5' }],
    },
  );
  const body = JSON.parse(response.body) as {
    attempt: {
      ok: boolean;
      complete: boolean;
      playedMoves: unknown[];
      solverMoves: unknown[];
      state: { board: Record<string, unknown>; status: { type: string; turn?: string } };
      solution?: unknown;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.attempt.ok, true);
  assert.equal(body.attempt.complete, false);
  assert.deepEqual(body.attempt.playedMoves, [
    { from: 'c5', to: 'd5' },
    { from: 'e2', to: 'e3' },
  ]);
  assert.deepEqual(body.attempt.solverMoves, [{ from: 'c5', to: 'd5' }]);
  assert.deepEqual(body.attempt.state.status, { type: 'playing', turn: 'black' });
  assert.deepEqual(body.attempt.state.board.d5, { color: 'black', role: 'general' });
  assert.deepEqual(body.attempt.state.board.e3, { color: 'red', role: 'general' });
  assert.equal(body.attempt.solution, undefined);
  assert.equal(response.body.includes('"from":"f1","to":"e1"'), false);
});

test('puzzle attempts reject wrong moves without returning the right move', async () => {
  const response = await route('/api/puzzles/mini-xiangqi-red-back-rank-net-1/attempt', 'POST', {
    moves: [{ from: 'c4', to: 'c5' }],
  });
  const body = JSON.parse(response.body) as {
    attempt: {
      ok: boolean;
      puzzleId: string;
      variant: string;
      code: string;
      ply: number;
      state: {
        board: Record<string, { color: string; role: string }>;
        status: { type: string; turn?: string };
      };
      move: unknown;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.attempt.ok, false);
  assert.equal(body.attempt.puzzleId, 'mini-xiangqi-red-back-rank-net-1');
  assert.equal(body.attempt.variant, 'mini-xiangqi');
  assert.equal(body.attempt.code, 'incorrect-move');
  assert.equal(body.attempt.ply, 0);
  assert.deepEqual(body.attempt.move, { from: 'c4', to: 'c5' });
  assert.deepEqual(body.attempt.state.status, { type: 'playing', turn: 'red' });
  assert.deepEqual(body.attempt.state.board.c4, { color: 'red', role: 'chariot' });
  assert.equal(response.body.includes('"to":"d4"'), false);
});

test('puzzle attempts reject malformed move bodies', async () => {
  const response = await route('/api/puzzles/mini-xiangqi-red-back-rank-net-1/attempt', 'POST', {
    moves: [{ to: 'd4' }],
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
  const response = await route('/api/puzzles/rating?variant=fortress-xiangqi');

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { rating: null });
});

test('attempts omit rating info when there is no rated session', async () => {
  // Retargeted off Fortress on 2026-09-03: it ships no puzzles. Rating omission
  // is variant-agnostic, so any shipped puzzle proves it.
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
  // Fortress left this list on 2026-09-03 when it stopped shipping puzzles.
  for (const puzzle of [JUNGLE_PUZZLES[0], MINI_XIANGQI_PUZZLES[0]]) {
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
