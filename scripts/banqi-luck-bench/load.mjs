// Same-process load probe using the production route factory, job queue, live
// Banqi WebSocket runtime and real NNUE engines. No database or account secrets.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import {
  applyBanqiMove,
  banqiStateToEngineFen,
  createBanqiStateFromSetup,
  getBanqiLegalMoves,
} from '@mistboard/game';

// Clear persistence configuration before importing the application, which
// snapshots runtime config during module initialization.
delete process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.MISTBOARD_BANQI_ENABLED = 'true';
const { connectClient, startTestServer } = await import('../../apps/server/integration/harness.ts');
const { analyzeBanqiDecisions, resolveBanqiDecisions } = await import(
  '../../apps/server/src/banqi-analysis.ts'
);
const { closeBanqiAnalysisQueries, openBanqiAnalysisQueries } = await import(
  '../../apps/server/src/banqi-analysis-runner.ts'
);
const { banqiEngineAvailable, banqiLiveEngineMove } = await import(
  '../../apps/server/src/banqi-engine.ts'
);
const { createBanqiRoom } = await import('../../apps/server/src/banqi-registration.ts');
const { getAnalysisJob, resetAnalysisJobsForTests } = await import(
  '../../apps/server/src/game-analysis-jobs.ts'
);
const { logger, engineCounters } = await import('../../apps/server/src/obs.ts');
const { createGameAnalysisRoutes } = await import(
  '../../apps/server/src/routes/game-analysis-route.ts'
);
const { aggregateEnginePoolStats } = await import('../../apps/server/src/uci-engine-harness.ts');
const { fixtures, machine } = await import('./bench.mjs');
logger.level = 'silent';
assert.ok(banqiEngineAvailable('misty-banqi-level-8'));
const samples = await fixtures();
const report = {
  machine: await machine(),
  startedAt: new Date().toISOString(),
  method:
    'One memory-only app server process, plus an HTTP adapter for the production review route factory with fixture loader/test accounts; cached basic-analysis readiness; real decisions queue/resolver and live Banqi WS moves; then direct pool stress.',
  limitations:
    'Basic-analysis readiness is stubbed as a cache hit; no sweep compute, database, authenticated review endpoint, browser, WAN, or production CPU. Full decision jobs are cancelled after the observation window.',
};
const server = await startTestServer();
const sockets = [];
const cache = {
  get: async () => null,
  save: async () => {},
};
let activeReviews = 0,
  peakReviews = 0;
const routes = createGameAnalysisRoutes(
  {
    routeId: 'banqi',
    logPrefix: 'banqi',
    variantLabel: 'Banqi',
    enabled: () => true,
    requiresPersistence: false,
    engineBinary: {
      available: () => banqiEngineAvailable('misty-banqi-level-8'),
      label: 'Banqi L8',
    },
    loadInputs: async (id) => samples[Number(id)],
    countPlies: (inputs) => inputs.moves.length,
    resolveAnalysis: async () => ({ engineId: 'fixture-cached-layer1', depth: 12, plies: [] }),
    resolveDecisions: async (id, inputs, compute) =>
      resolveBanqiDecisions(
        `load-${id}`,
        inputs.moves,
        inputs.setup,
        cache,
        async (moves, setup) => {
          activeReviews++;
          peakReviews = Math.max(peakReviews, activeReviews);
          try {
            return await analyzeBanqiDecisions(moves, setup);
          } finally {
            activeReviews--;
          }
        },
        compute,
      ),
  },
  { currentUser: async (request) => ({ id: `bench-${request.headers['bench-account']}` }) },
);

const reviewServer = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!(await routes(request, response, path))) response.writeHead(404).end();
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise((resolve, reject) => {
  reviewServer.once('error', reject);
  reviewServer.listen(0, '127.0.0.1', resolve);
});
const reviewBase = `http://127.0.0.1:${reviewServer.address().port}`;
async function route(method, path, account = '0') {
  const start = performance.now();
  const response = await fetch(`${reviewBase}${path}`, {
    method,
    headers: { 'bench-account': account },
  });
  const body = await response.text();
  return {
    status: response.status,
    body: body ? JSON.parse(body) : null,
    wallMs: performance.now() - start,
  };
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
}
async function liveProbe(label, count = 12) {
  const created = await createBanqiRoom(undefined, 'red', {
    engineId: 'misty-banqi-level-8',
    seat: 'black',
  });
  assert.ok(created.ok);
  const room = created.room;
  const client = await connectClient({
    url: server.url,
    room: room.id,
    variant: 'banqi',
    helloTimeoutMs: 10_000,
  });
  sockets.push(client);
  assert.equal(client.seat, 'red');
  const rtts = [],
    moves = [],
    engineOnly = [],
    fixedNodes = [];
  let stopPings = false;
  let pingSequence = 0;
  const pingLoop = (async () => {
    while (!stopPings) {
      const at = ++pingSequence;
      const start = performance.now();
      client.send({ type: 'ping', at });
      await client.waitFor((m) => m.type === 'pong' && m.at === at, { timeoutMs: 5000 });
      rtts.push(performance.now() - start);
      await delay(500);
    }
  })();
  try {
    // End-to-end human move -> engine reply -> real websocket snapshot.
    for (let i = 0; i < count; i++) {
      const state = room.projection.state;
      assert.equal(state.status.type, 'playing');
      assert.equal(state.status.turn, 'red');
      const move =
        getBanqiLegalMoves(state).find((m) => m.from === m.to) ?? getBanqiLegalMoves(state)[0];
      const ply = state.ply;
      const start = performance.now();
      client.send({ type: 'move', from: move.from, to: move.to });
      await client.waitFor((m) => (m.state?.ply ?? -1) >= ply + 2, { timeoutMs: 15_000 });
      moves.push(performance.now() - start);
    }
    // Fixed public position paired with the same real L8 provider, avoiding
    // game-position differences in the unloaded/loaded engine comparison.
    let fixed = createBanqiStateFromSetup('fixed', samples[0].setup);
    for (const move of samples[0].moves.slice(0, 8)) fixed = applyBanqiMove(fixed, move);
    assert.equal(fixed.noProgressClock, 0);
    for (let i = 0; i < 8; i++) {
      const start = performance.now();
      const result = await banqiLiveEngineMove(
        'misty-banqi-level-8',
        banqiStateToEngineFen(fixed),
        { noProgressLimit: samples[0].setup.noProgressLimit },
      );
      assert.ok(result.best && result.cp != null);
      assert.ok(result.nodes >= 2_000_000, 'fixed L8 search must finish its node budget');
      fixedNodes.push(result.nodes);
      engineOnly.push(performance.now() - start);
    }
  } finally {
    stopPings = true;
    await pingLoop;
  }
  const result = {
    label,
    websocketRtt: stats(rtts),
    botReply: stats(moves),
    fixedL8Search: stats(engineOnly),
    samples: {
      websocketRttMs: rtts,
      botReplyMs: moves,
      fixedL8SearchMs: engineOnly,
      fixedL8SearchNodes: fixedNodes,
    },
  };
  console.log(
    JSON.stringify({
      label,
      websocketRtt: result.websocketRtt,
      botReply: result.botReply,
      fixedL8Search: result.fixedL8Search,
    }),
  );
  return result;
}
const poolPeaks = {};
const monitor = setInterval(() => {
  for (const pool of aggregateEnginePoolStats().pools) {
    poolPeaks[pool.name] ??= { active: 0, queued: 0 };
    const peak = poolPeaks[pool.name];
    peak.active = Math.max(peak.active, pool.active);
    peak.queued = Math.max(peak.queued, pool.queueDepth);
  }
}, 5);
try {
  report.unloaded = await liveProbe('unloaded');
  closeBanqiAnalysisQueries();
  openBanqiAnalysisQueries();
  report.enqueue = await Promise.all(
    samples.map((_, i) => route('POST', `/api/banqi/games/${i}/decisions`, String(i))),
  );
  assert.ok(report.enqueue.every((r) => r.status === 202));
  const jobs = report.enqueue.map((r) => getAnalysisJob(r.body.jobId));
  const admissionDeadline = performance.now() + 5000;
  while (
    aggregateEnginePoolStats().pools.find((p) => p.name === 'banqi-analysis').active === 0 &&
    performance.now() < admissionDeadline
  )
    await delay(10);
  assert.equal(peakReviews, 1, 'the queued decisions job must actually start');
  assert.ok(aggregateEnginePoolStats().pools.find((p) => p.name === 'banqi-analysis').active > 0);
  const loadStart = performance.now();
  report.loaded = await liveProbe('three queued reviews');
  while (performance.now() - loadStart < 60_000) await delay(100);
  report.poll = await Promise.all(
    jobs.map((job, i) => route('GET', `/api/banqi/games/${i}/decisions/jobs/${job.id}`, String(i))),
  );
  assert.ok(
    report.poll.every((r) => r.status === 200 && r.body.status === 'pending'),
    JSON.stringify(
      report.poll.map((r) => ({
        status: r.status,
        jobStatus: r.body?.status,
        error: r.body?.error,
      })),
    ),
  );
  report.queuedWindowMs = performance.now() - loadStart;
  report.reviewStatesBeforeCancellation = jobs.map((job) => ({
    status: job.status,
    started: job.startedAt !== null,
    error: job.error,
  }));
  assert.ok(jobs.every((job) => job.status === 'pending' && job.error === null));
  assert.equal(jobs.filter((job) => job.startedAt !== null).length, 1);
  report.peakReviewsThroughQueue = peakReviews;
  assert.equal(peakReviews, 1);
  closeBanqiAnalysisQueries();
  await resetAnalysisJobsForTests();
  openBanqiAnalysisQueries();
  // Bypass the serial job lane to exercise the pool's own bound under three
  // concurrent cold full-game requests. Cancel only after 30 seconds.
  const stressStart = performance.now();
  let failedDuringStress = 0;
  let cancelling = false;
  const pressure = samples.map((sample) =>
    analyzeBanqiDecisions(sample.moves, sample.setup, undefined, {
      load: async () => ({ nextIndex: 1, items: [] }),
      save: async () => {},
    }).catch(() => {
      if (!cancelling) failedDuringStress++;
    }),
  );
  report.directPool = await liveProbe('three direct concurrent reviews', 6);
  while (performance.now() - stressStart < 30_000) await delay(100);
  report.directResumePly = 1;
  report.directWindowMs = performance.now() - stressStart;
  report.failedDuringStress = failedDuringStress;
  assert.equal(failedDuringStress, 0);
  cancelling = true;
  report.poolStatsBeforeCancellation = aggregateEnginePoolStats();
  closeBanqiAnalysisQueries();
  await Promise.all(pressure);
  report.poolPeaks = poolPeaks;
  assert.equal(poolPeaks['banqi-analysis'].active, 2);
  assert.ok(poolPeaks['banqi-analysis'].queued > 0);
  assert.equal(
    report.poolStatsBeforeCancellation.pools.find((p) => p.name === 'banqi-analysis').timedOut,
    0,
  );
  report.liveEngineCounters = {
    moves: engineCounters.totalMoves,
    fallbacks: engineCounters.totalFallbacks,
    failures: engineCounters.totalMoveFailures,
  };
  assert.equal(report.liveEngineCounters.fallbacks, 0);
  assert.equal(report.liveEngineCounters.failures, 0);
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL('./load.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
} finally {
  clearInterval(monitor);
  closeBanqiAnalysisQueries();
  await Promise.all(sockets.map((client) => client.disconnect()));
  await new Promise((resolve, reject) =>
    reviewServer.close((error) => (error ? reject(error) : resolve())),
  );
  await server.close();
}
