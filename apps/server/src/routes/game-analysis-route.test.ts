import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { reportAnalysisJobProgress } from '../analysis-job-progress.js';
import { getAnalysisJob } from '../game-analysis-jobs.js';
import { VacuousAnalysisError } from '../game-analysis-sweep.js';
import { createGameAnalysisRoutes, type GameAnalysisRoutesConfig } from './game-analysis-route.js';

// Focused unit test for the generic analysis/decisions route section factory
// (the same style as rooms-route-factory.test.ts): a capture response double +
// a config whose loaders/resolvers are spies, so every gate, the async enqueue
// contract (#208), and the poll envelope are exercised without a database or an
// engine. The in-memory job queue is the real one; each test uses its own
// routeId/roomId/account so the process-global queue never cross-talks.

type Capture = { body: string; status: number | null };

function captureResponse(): ServerResponse & Capture {
  const capture = {
    body: '',
    status: null as number | null,
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & Capture;
}

function request(method: string): IncomingMessage {
  return {
    method,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

function json(response: Capture): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

// Poll the real job queue until the job settles (runs are near-instant here).
async function waitJob(jobId: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const job = getAnalysisJob(jobId);
    if (job && job.status !== 'pending') return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`job ${jobId} never settled`);
}

type Inputs = { moves: string[] };
type Analysis = { engineId: string; depth: number; plies: number[] };
type Decisions = { engineId: string; depth: number; decisions: number[] };

type Overrides = Partial<GameAnalysisRoutesConfig<Inputs, Analysis, Decisions>>;

let routeSeq = 0;

function makeRoutes(
  overrides: Overrides = {},
  deps: {
    user?: { id: string } | null;
    limiterAllows?: boolean;
  } = {},
) {
  routeSeq += 1;
  const routeId = overrides.routeId ?? `testvariant${routeSeq}`;
  const calls: { analysis: boolean[]; decisions: boolean[] } = { analysis: [], decisions: [] };
  // Default resolver: computeIfMissing=false is always a miss; true computes.
  const handler = createGameAnalysisRoutes<Inputs, Analysis, Decisions>(
    {
      logPrefix: routeId,
      variantLabel: 'Testvariant',
      enabled: () => true,
      requiresPersistence: false,
      loadInputs: async () => ({ moves: ['a', 'b'] }),
      countPlies: (inputs) => inputs.moves.length,
      resolveAnalysis: async (_roomId, _inputs, computeIfMissing) => {
        calls.analysis.push(computeIfMissing);
        return computeIfMissing ? { engineId: 'e@1', depth: 12, plies: [1, 2] } : null;
      },
      ...overrides,
      routeId,
    },
    {
      currentUser: async () => (deps.user !== undefined ? deps.user : { id: `acct-${routeSeq}` }),
      enqueueLimiter: { check: () => deps.limiterAllows ?? true },
    },
  );
  const path = (roomId: string, endpoint: string) => `/api/${routeId}/games/${roomId}/${endpoint}`;
  return { handler, calls, routeId, path };
}

test('analysis route: non-matching paths fall through (return false)', async () => {
  const { handler, path, routeId } = makeRoutes();
  for (const p of [
    '/api/othervariant/games/room-1/analysis',
    `/api/${routeId}/games/room-1`,
    path('room-1', 'other'),
    `/api/${routeId}/games/`,
    `/api/${routeId}/games//analysis`,
    path('room-1', 'analysis/other/j1'),
    path('room-1', 'analysis/jobs/'),
  ]) {
    assert.equal(await handler(request('GET'), captureResponse(), p), false, p);
  }
});

test('analysis route: decisions paths fall through when no resolveDecisions is configured', async () => {
  const { handler, path } = makeRoutes();
  assert.equal(
    await handler(request('GET'), captureResponse(), path('room-1', 'decisions')),
    false,
  );
  assert.equal(
    await handler(request('GET'), captureResponse(), path('room-1', 'decisions/jobs/j1')),
    false,
  );
});

test('analysis route: 405 for non-GET/POST methods', async () => {
  const { handler, path } = makeRoutes();
  const response = captureResponse();
  assert.equal(await handler(request('DELETE'), response, path('room-1', 'analysis')), true);
  assert.equal(response.status, 405);
  assert.equal(json(response).error, 'method_not_allowed');
});

test('analysis route: 404 when the launch flag is off', async () => {
  const { handler, path } = makeRoutes({ enabled: () => false });
  const response = captureResponse();
  assert.equal(await handler(request('GET'), response, path('room-1', 'analysis')), true);
  assert.equal(response.status, 404);
});

test('analysis route: POST is account-gated (401 when signed out)', async () => {
  const { handler, calls, path } = makeRoutes({}, { user: null });
  const response = captureResponse();
  assert.equal(await handler(request('POST'), response, path('room-1', 'analysis')), true);
  assert.equal(response.status, 401);
  assert.equal(json(response).error, 'not_signed_in');
  assert.equal(calls.analysis.length, 0);
});

test('analysis route: POST fails closed (503) when the engine binary is missing', async () => {
  const { handler, calls, path } = makeRoutes({
    engineBinary: { available: () => false, label: 'test binary' },
  });
  const response = captureResponse();
  assert.equal(await handler(request('POST'), response, path('room-1', 'analysis')), true);
  assert.equal(response.status, 503);
  assert.equal(json(response).error, 'analysis_engine_unavailable');
  assert.equal(calls.analysis.length, 0);
});

test('analysis route: GET never runs the engine-binary gate', async () => {
  const { handler, path } = makeRoutes({
    engineBinary: { available: () => false, label: 'test binary' },
  });
  const response = captureResponse();
  assert.equal(await handler(request('GET'), response, path('room-1', 'analysis')), true);
  // GET is the pure cache read: a miss is 204, not 503 — the binary is not needed.
  assert.equal(response.status, 204);
});

test('analysis route: 503 persistence_disabled when required and not initialized', async () => {
  // Unit tests run without Postgres, so persistence.isInitialized() is false and
  // the shared requirePersistence guard writes the 503.
  const { handler, calls, path } = makeRoutes({ requiresPersistence: true });
  const response = captureResponse();
  assert.equal(await handler(request('GET'), response, path('room-1', 'analysis')), true);
  assert.equal(response.status, 503);
  assert.equal(json(response).error, 'persistence_disabled');
  assert.equal(calls.analysis.length, 0);
});

test('analysis route: 404 when the inputs loader finds no finished game', async () => {
  const { handler, path } = makeRoutes({ loadInputs: async () => null });
  const response = captureResponse();
  assert.equal(await handler(request('GET'), response, path('room-1', 'analysis')), true);
  assert.equal(response.status, 404);
});

test('analysis route: GET is a pure cache read (computeIfMissing=false) and 204s on a miss', async () => {
  const { handler, calls, path } = makeRoutes();
  const response = captureResponse();
  assert.equal(await handler(request('GET'), response, path('room-1', 'analysis')), true);
  assert.equal(response.status, 204);
  assert.deepEqual(calls.analysis, [false]);
});

test('analysis route: cached game answers 200 immediately on GET and POST (fast path unchanged)', async () => {
  const { handler, path } = makeRoutes({
    resolveAnalysis: async () => ({ engineId: 'e@1', depth: 12, plies: [1, 2] }),
    analysisExtras: (inputs) => ({ chancePlies: inputs.moves.map((_, i) => i + 1) }),
  });
  for (const method of ['GET', 'POST']) {
    const response = captureResponse();
    assert.equal(await handler(request(method), response, path('room-1', 'analysis')), true);
    assert.equal(response.status, 200, method);
    const body = json(response);
    assert.equal(body.engineId, 'e@1');
    assert.deepEqual(body.chancePlies, [1, 2]);
  }
});

test('analysis route: POST on a miss enqueues (202 + jobId) and the job computes + polls done', async () => {
  const { handler, calls, path } = makeRoutes();
  const response = captureResponse();
  assert.equal(await handler(request('POST'), response, path('room-1', 'analysis')), true);
  assert.equal(response.status, 202);
  const jobId = json(response).jobId as string;
  assert.ok(jobId);
  await waitJob(jobId);
  // Request path did the cache read (false); the job did the compute (true).
  assert.deepEqual(calls.analysis, [false, true]);

  const poll = captureResponse();
  assert.equal(await handler(request('GET'), poll, path('room-1', `analysis/jobs/${jobId}`)), true);
  assert.equal(poll.status, 200);
  const body = json(poll);
  assert.equal(body.status, 'done');
  const result = body.result as Record<string, unknown>;
  assert.equal(result.engineId, 'e@1');
  assert.deepEqual(result.plies, [1, 2]);
});

test('analysis route: repeat POSTs coalesce onto the pending job (same jobId)', async () => {
  let releaseRun!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  const { handler, path } = makeRoutes({
    resolveAnalysis: async (_roomId, _inputs, computeIfMissing) => {
      if (!computeIfMissing) return null;
      await gate;
      return { engineId: 'e@1', depth: 12, plies: [1] };
    },
  });
  const first = captureResponse();
  await handler(request('POST'), first, path('room-1', 'analysis'));
  const second = captureResponse();
  await handler(request('POST'), second, path('room-1', 'analysis'));
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(json(second).jobId, json(first).jobId);
  releaseRun();
  await waitJob(json(first).jobId as string);
});

test('analysis route: a too-long game is rejected explicitly (422 rejected_too_long)', async () => {
  const { handler, path } = makeRoutes({
    loadInputs: async () => ({ moves: Array.from({ length: 301 }, () => 'm') }),
  });
  const response = captureResponse();
  assert.equal(await handler(request('POST'), response, path('room-1', 'analysis')), true);
  assert.equal(response.status, 422);
  assert.equal(json(response).error, 'rejected_too_long');
});

test('analysis route: per-IP enqueue rate limit answers 429 rate_limited', async () => {
  const { handler, path } = makeRoutes({}, { limiterAllows: false });
  const response = captureResponse();
  assert.equal(await handler(request('POST'), response, path('room-1', 'analysis')), true);
  assert.equal(response.status, 429);
  assert.equal(json(response).error, 'rate_limited');
});

test('analysis route: per-account pending cap answers 429 too_many_pending_analyses', async () => {
  let releaseRuns!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseRuns = resolve;
  });
  const { handler, path } = makeRoutes({
    resolveAnalysis: async (_roomId, _inputs, computeIfMissing) => {
      if (!computeIfMissing) return null;
      await gate;
      return { engineId: 'e@1', depth: 12, plies: [1] };
    },
  });
  const jobIds: string[] = [];
  try {
    for (const room of ['room-1', 'room-2']) {
      const response = captureResponse();
      await handler(request('POST'), response, path(room, 'analysis'));
      assert.equal(response.status, 202, room);
      jobIds.push(json(response).jobId as string);
    }
    const third = captureResponse();
    await handler(request('POST'), third, path('room-3', 'analysis'));
    assert.equal(third.status, 429);
    assert.equal(json(third).error, 'too_many_pending_analyses');
  } finally {
    releaseRuns();
    for (const id of jobIds) await waitJob(id);
  }
});

test('analysis route: a failed job polls as failed with the mapped error code', async () => {
  const { handler, path } = makeRoutes({
    resolveAnalysis: async (_roomId, _inputs, computeIfMissing) => {
      if (!computeIfMissing) return null;
      throw new VacuousAnalysisError('testvariant');
    },
  });
  const response = captureResponse();
  await handler(request('POST'), response, path('room-1', 'analysis'));
  assert.equal(response.status, 202);
  const jobId = json(response).jobId as string;
  await waitJob(jobId);
  const poll = captureResponse();
  await handler(request('GET'), poll, path('room-1', `analysis/jobs/${jobId}`));
  assert.equal(poll.status, 200);
  assert.deepEqual(json(poll), { status: 'failed', error: 'analysis_engine_unavailable' });
});

test('analysis route: poll 404s for unknown jobs and mismatched room/kind', async () => {
  const { handler, path } = makeRoutes({
    resolveDecisions: async () => null,
  });
  const response = captureResponse();
  await handler(request('POST'), response, path('room-1', 'analysis'));
  const jobId = json(response).jobId as string;
  await waitJob(jobId);
  for (const p of [
    path('room-1', 'analysis/jobs/nope'),
    path('room-OTHER', `analysis/jobs/${jobId}`),
    path('room-1', `decisions/jobs/${jobId}`),
  ]) {
    const poll = captureResponse();
    assert.equal(await handler(request('GET'), poll, p), true, p);
    assert.equal(poll.status, 404, p);
  }
});

test('analysis route: poll is GET-only (405 on POST)', async () => {
  const { handler, path } = makeRoutes();
  const response = captureResponse();
  assert.equal(await handler(request('POST'), response, path('room-1', 'analysis/jobs/j1')), true);
  assert.equal(response.status, 405);
});

test('decisions route: 204 when the basic analysis is not cached yet (readiness gate)', async () => {
  const { handler, calls, path } = makeRoutes({
    resolveAnalysis: async (_roomId, _inputs, computeIfMissing) => {
      calls.analysis.push(computeIfMissing);
      return null; // basic analysis miss
    },
    resolveDecisions: async (_roomId, _inputs, computeIfMissing) => {
      calls.decisions.push(computeIfMissing);
      return { engineId: 'd@1', depth: 10, decisions: [7] };
    },
  });
  const response = captureResponse();
  assert.equal(await handler(request('GET'), response, path('room-1', 'decisions')), true);
  assert.equal(response.status, 204);
  assert.deepEqual(calls.analysis, [false]);
  assert.deepEqual(calls.decisions, [], 'decisions must not resolve before the readiness gate');
});

test('decisions route: cached decomposition answers 200 on GET and POST', async () => {
  const { handler, path } = makeRoutes({
    resolveAnalysis: async () => ({ engineId: 'e@1', depth: 12, plies: [1] }),
    resolveDecisions: async () => ({ engineId: 'd@1', depth: 10, decisions: [7] }),
  });
  for (const method of ['GET', 'POST']) {
    const response = captureResponse();
    assert.equal(await handler(request(method), response, path('room-1', 'decisions')), true);
    assert.equal(response.status, 200, method);
    assert.deepEqual(json(response).decisions, [7]);
  }
});

test('decisions route: POST on a miss enqueues a job that computes both tiers', async () => {
  const { handler, calls, path } = makeRoutes({
    resolveDecisions: async (_roomId, _inputs, computeIfMissing) => {
      calls.decisions.push(computeIfMissing);
      return computeIfMissing ? { engineId: 'd@1', depth: 10, decisions: [7] } : null;
    },
  });
  const response = captureResponse();
  assert.equal(await handler(request('POST'), response, path('room-1', 'decisions')), true);
  assert.equal(response.status, 202);
  const jobId = json(response).jobId as string;
  await waitJob(jobId);
  // Request path: analysis cache read (false). Job: analysis compute (true, the
  // readiness dependency) then the decomposition compute (true).
  assert.deepEqual(calls.analysis, [false, true]);
  assert.deepEqual(calls.decisions, [true]);
  const poll = captureResponse();
  await handler(request('GET'), poll, path('room-1', `decisions/jobs/${jobId}`));
  const body = json(poll);
  assert.equal(body.status, 'done');
  assert.deepEqual((body.result as Record<string, unknown>).decisions, [7]);
});

test('analysis route: VacuousAnalysisError from a cached read maps to 503', async () => {
  const { handler, path } = makeRoutes({
    resolveAnalysis: async () => {
      throw new VacuousAnalysisError('testvariant');
    },
  });
  const response = captureResponse();
  assert.equal(await handler(request('POST'), response, path('room-1', 'analysis')), true);
  assert.equal(response.status, 503);
  assert.equal(json(response).error, 'analysis_engine_unavailable');
});

test('analysis route: a non-vacuous resolver error propagates (500 path stays upstream)', async () => {
  const { handler, path } = makeRoutes({
    resolveAnalysis: async () => {
      throw new Error('engine exploded');
    },
  });
  await assert.rejects(
    handler(request('POST'), captureResponse(), path('room-1', 'analysis')),
    /engine exploded/,
  );
});

test('route ids with a hyphen match literally (jungle-flip style)', async () => {
  const { handler } = makeRoutes({
    routeId: 'test-flip',
    resolveAnalysis: async () => ({ engineId: 'e@1', depth: 12, plies: [] }),
  });
  const response = captureResponse();
  assert.equal(
    await handler(request('POST'), response, '/api/test-flip/games/room%20x/analysis'),
    true,
  );
  assert.equal(response.status, 200);
});

test('refresh discovers existing work with GET and repeat POST never duplicates it', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let computes = 0;
  const { handler, path } = makeRoutes({
    resolveAnalysis: async (_id, _input, compute) => {
      if (!compute) return null;
      computes += 1;
      await gate;
      return { engineId: 'e@1', depth: 12, plies: [1, 2] };
    },
  });
  const url = path('refresh', 'analysis');
  const first = captureResponse();
  await handler(request('POST'), first, url);
  try {
    const refreshed = captureResponse();
    await handler(request('GET'), refreshed, url);
    assert.equal(refreshed.status, 202, 'a reload must discover work without a POST');
    assert.equal(json(refreshed).jobId, json(first).jobId);
    const repeated = captureResponse();
    await handler(request('POST'), repeated, url);
    assert.equal(json(repeated).jobId, json(first).jobId);
    assert.equal(computes, 1);
  } finally {
    release();
    await waitJob(String(json(first).jobId));
  }
});

test('discovery stays public/read-only, coalesces accounts and respects finished gates', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let computes = 0;
  let visible = true;
  const config: Overrides = {
    routeId: 'recovery-public',
    loadInputs: async () => (visible ? { moves: ['a', 'b'] } : null),
    resolveAnalysis: async (_room, _inputs, compute) => {
      if (!compute) return null;
      computes += 1;
      reportAnalysisJobProgress({ completed: 1 });
      await gate;
      return { engineId: 'e', depth: 12, plies: [1] };
    },
  };
  const first = makeRoutes(config, { user: { id: 'private-account-one' } });
  const other = makeRoutes(config, { user: { id: 'private-account-two' }, limiterAllows: false });
  const anonymous = makeRoutes(
    { ...config, engineBinary: { available: () => false, label: 'unused' } },
    { user: null },
  );
  const url = first.path('public-room', 'analysis');
  const accepted = captureResponse();
  await first.handler(request('POST'), accepted, url);
  const id = String(json(accepted).jobId);
  try {
    const read = captureResponse();
    await anonymous.handler(request('GET'), read, url);
    assert.equal(read.status, 202);
    assert.equal(json(read).jobId, id);
    assert.equal(json(read).state, 'running');
    assert.deepEqual(json(read).progress, { phase: 'analysis', completed: 1, total: 3 });
    assert.doesNotMatch(read.body, /private-account|items|deal|secret/);
    const repeat = captureResponse();
    await other.handler(request('POST'), repeat, url);
    assert.equal(json(repeat).jobId, id);
    assert.equal(computes, 1);
    visible = false;
    for (const path of [url, `${url}/jobs/${id}`]) {
      const denied = captureResponse();
      await anonymous.handler(request('GET'), denied, path);
      assert.equal(denied.status, 404);
    }
  } finally {
    release();
    await waitJob(id);
  }
});

test('cached base plus pending reveals resumes separately; every completed decision read projects its viewer', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const raw = {
    engineId: 'e',
    depth: 12,
    decisions: [7],
    privateCheckpoint: 'hidden-deal-sentinel',
  };
  let computes = 0;
  const { handler, path } = makeRoutes({
    resolveAnalysis: async () => ({ engineId: 'e', depth: 12, plies: [1, 2] }),
    resolveDecisions: async (_room, _inputs, compute) => {
      if (!compute) return null;
      computes += 1;
      reportAnalysisJobProgress({ completed: 1 });
      await gate;
      return raw;
    },
    decisionsForViewer: async (value) => ({
      engineId: value.engineId,
      depth: value.depth,
      decisions: [],
    }),
  });
  const url = path('reveals', 'decisions');
  const accepted = captureResponse();
  await handler(request('POST'), accepted, url);
  const id = String(json(accepted).jobId);
  try {
    await new Promise((resolve) => setImmediate(resolve));
    const base = captureResponse();
    await handler(request('GET'), base, path('reveals', 'analysis'));
    assert.equal(base.status, 200);
    const read = captureResponse();
    await handler(request('GET'), read, url);
    assert.equal(read.status, 202);
    assert.equal(json(read).jobId, id);
    assert.deepEqual(json(read).progress, { phase: 'decisions', completed: 1, total: 2 });
    assert.doesNotMatch(read.body, /hidden-deal|privateCheckpoint/);
    assert.equal(computes, 1);
  } finally {
    release();
    await waitJob(id);
  }
  for (const readUrl of [url, `${url}/jobs/${id}`]) {
    const done = captureResponse();
    await handler(request('GET'), done, readUrl);
    assert.doesNotMatch(done.body, /hidden-deal|privateCheckpoint/);
    assert.deepEqual((json(done).result as Decisions).decisions, []);
  }
});
