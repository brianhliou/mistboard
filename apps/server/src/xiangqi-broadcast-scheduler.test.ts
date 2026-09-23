import assert from 'node:assert/strict';
import test from 'node:test';
import type { XiangqiBroadcastPollResult } from './xiangqi-broadcast-poller.js';
import {
  clampXiangqiBroadcastScheduleIntervalMs,
  createXiangqiBroadcastScheduler,
  XIANGQI_BROADCAST_AFTER_EVENT_INTERVAL_MS,
  XIANGQI_BROADCAST_AFTER_EVENT_WINDOW_MS,
  XIANGQI_BROADCAST_INDEX_SWEEP_MS,
  type XiangqiBroadcastSchedulerDeps,
  xiangqiBroadcastPollPhase,
} from './xiangqi-broadcast-scheduler.js';

function okResult(overrides: Partial<Extract<XiangqiBroadcastPollResult, { ok: true }>> = {}) {
  return {
    ok: true as const,
    sourceUrl: 'https://fixture.invalid/source.json',
    dryRun: false,
    tourSlug: 'fixture',
    roundsImported: 1,
    boardsSeen: 2,
    boardsFailed: 0,
    sourcesSeen: 1,
    sourcesFailed: 0,
    updates: [],
    sources: [],
    ...overrides,
  };
}

function failedResult(): XiangqiBroadcastPollResult {
  return {
    ok: false,
    sourceUrl: 'https://fixture.invalid/source.json',
    dryRun: false,
    kind: 'source_http_error',
    message: 'source answered HTTP 500',
  };
}

type HarnessTour = {
  slug: string;
  sourceUrl: string | null;
  pollIntervalMs: number;
  endsAt?: string | null;
};

type Harness = {
  deps: XiangqiBroadcastSchedulerDeps;
  polls: string[];
  pollSlugs: string[];
  logs: unknown[];
  advance(ms: number): void;
  now(): number;
  setTours(tours: HarnessTour[]): void;
  setPollResult(result: XiangqiBroadcastPollResult): void;
};

function harness(): Harness {
  let now = 1_000_000;
  let tours: HarnessTour[] = [];
  let pollResult: XiangqiBroadcastPollResult = okResult();
  const polls: string[] = [];
  const pollSlugs: string[] = [];
  const logs: unknown[] = [];
  return {
    polls,
    logs,
    advance(ms) {
      now += ms;
    },
    now: () => now,
    setTours(next) {
      tours = next;
    },
    setPollResult(result) {
      pollResult = result;
    },
    pollSlugs,
    deps: {
      listScheduledTours: async () =>
        tours.map((tour) => ({ endsAt: null, ...tour, pollEnabled: true })),
      poll: async (input) => {
        polls.push(input.sourceUrl);
        pollSlugs.push(input.tourSlug);
        return pollResult;
      },
      recordSyncLog: async (input) => {
        logs.push(input);
      },
      now: () => now,
    },
  };
}

test('scheduler clamps operator intervals to the scheduled polling range', () => {
  assert.equal(clampXiangqiBroadcastScheduleIntervalMs(1), 5_000);
  assert.equal(clampXiangqiBroadcastScheduleIntervalMs(30_000), 30_000);
  assert.equal(clampXiangqiBroadcastScheduleIntervalMs(10_000_000), 300_000);
  assert.equal(clampXiangqiBroadcastScheduleIntervalMs('bogus'), 30_000);
});

test('scheduler polls due tours and waits out their interval', async () => {
  const h = harness();
  h.setTours([
    { slug: 'wxc', sourceUrl: 'https://fixture.invalid/source.json', pollIntervalMs: 10_000 },
  ]);
  const scheduler = createXiangqiBroadcastScheduler(h.deps);

  await scheduler.tick();
  assert.equal(h.polls.length, 1);

  await scheduler.tick();
  assert.equal(h.polls.length, 1, 'not due again yet');

  h.advance(10_001);
  await scheduler.tick();
  assert.equal(h.polls.length, 2);
});

test('scheduler backs off on failures and recovers on success', async () => {
  const h = harness();
  h.setTours([
    { slug: 'wxc', sourceUrl: 'https://fixture.invalid/source.json', pollIntervalMs: 10_000 },
  ]);
  const scheduler = createXiangqiBroadcastScheduler(h.deps);

  h.setPollResult(failedResult());
  await scheduler.tick();
  assert.equal(h.polls.length, 1);

  h.advance(10_001);
  await scheduler.tick();
  assert.equal(h.polls.length, 1, 'failure delay doubled past the base interval');

  h.advance(10_000);
  await scheduler.tick();
  assert.equal(h.polls.length, 2, 'due after the backoff delay elapses');

  h.setPollResult(okResult());
  h.advance(40_001);
  await scheduler.tick();
  assert.equal(h.polls.length, 3);

  h.advance(10_001);
  await scheduler.tick();
  assert.equal(h.polls.length, 4, 'success resets to the healthy interval');
});

test('scheduler records poll_ok only when a poll changed something', async () => {
  const h = harness();
  h.setTours([
    { slug: 'wxc', sourceUrl: 'https://fixture.invalid/source.json', pollIntervalMs: 10_000 },
  ]);
  const scheduler = createXiangqiBroadcastScheduler(h.deps);

  h.setPollResult(
    okResult({
      updates: [{ ok: true, boardId: 'b1', status: 'unchanged', plyCount: 8 }],
    }),
  );
  await scheduler.tick();
  assert.equal(h.logs.length, 0, 'idle source stays quiet');

  h.setPollResult(
    okResult({
      updates: [{ ok: true, boardId: 'b1', status: 'extended', plyCount: 10 }],
    }),
  );
  h.advance(10_001);
  await scheduler.tick();
  assert.equal(h.logs.length, 1);
  assert.equal((h.logs[0] as { kind: string }).kind, 'poll_ok');

  h.setPollResult(failedResult());
  h.advance(10_001);
  await scheduler.tick();
  assert.equal(h.logs.length, 1, 'failures are logged by the poller, not the scheduler');
});

test('scheduler skips tours without a source and drops disabled tours', async () => {
  const h = harness();
  h.setTours([
    { slug: 'no-source', sourceUrl: null, pollIntervalMs: 10_000 },
    { slug: 'wxc', sourceUrl: 'https://fixture.invalid/source.json', pollIntervalMs: 10_000 },
  ]);
  const scheduler = createXiangqiBroadcastScheduler(h.deps);

  await scheduler.tick();
  assert.deepEqual(h.polls, ['https://fixture.invalid/source.json']);

  h.setTours([]);
  h.advance(10_001);
  await scheduler.tick();
  assert.equal(h.polls.length, 1, 'disabled tour is no longer polled');
});

// The poller stamps every sync log it writes with this slug; without it the
// tour endpoint, which reads health as "newest log with my slug", showed no log
// at all through five days of failed polls on the 2026 Shanghai Cup.
test('scheduler hands each poll the tour it is polling for', async () => {
  const h = harness();
  h.setTours([
    { slug: 'wxc', sourceUrl: 'https://fixture.invalid/source.json', pollIntervalMs: 10_000 },
  ]);
  const scheduler = createXiangqiBroadcastScheduler(h.deps);
  await scheduler.tick();
  assert.deepEqual(h.pollSlugs, ['wxc']);
});

test('scheduler asks the live engine layer for every board a poll moved, never for an idle one', async () => {
  const h = harness();
  h.setTours([
    { slug: 'wxc', sourceUrl: 'https://fixture.invalid/source.json', pollIntervalMs: 10_000 },
  ]);
  const requested: string[] = [];
  const scheduler = createXiangqiBroadcastScheduler({
    ...h.deps,
    evaluateLiveBoard: async (boardId) => {
      requested.push(boardId);
      if (boardId === 'b4') throw new Error('engine unavailable');
    },
  });

  h.setPollResult(
    okResult({
      updates: [
        { ok: true, boardId: 'b1', status: 'created', plyCount: 2 },
        { ok: true, boardId: 'b2', status: 'unchanged', plyCount: 8 },
        { ok: true, boardId: 'b3', status: 'extended', plyCount: 10 },
        { ok: true, boardId: 'b4', status: 'corrected', plyCount: 9 },
        { ok: true, boardId: 'b5', status: 'updated', plyCount: 9 },
        { ok: false, boardId: 'b6', kind: 'illegal_move', message: 'nope' },
      ],
    }),
  );
  // A trigger that rejects (b4) is logged, not fatal: the tick still completes
  // and schedules the next poll.
  await scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requested, ['b1', 'b3', 'b4', 'b5']);

  // The trigger is optional: polling tests without an engine keep working.
  const bare = createXiangqiBroadcastScheduler(h.deps);
  h.advance(10_001);
  await bare.tick();
  assert.deepEqual(requested, ['b1', 'b3', 'b4', 'b5']);
});

test('poll phase follows the end date: as set, slow for three weeks, then done', () => {
  const end = Date.parse('2026-09-18T15:59:59.000Z');
  assert.equal(xiangqiBroadcastPollPhase(null, end + 1), 'event');
  assert.equal(xiangqiBroadcastPollPhase('not a date', end + 1), 'event');
  assert.equal(xiangqiBroadcastPollPhase('2026-09-18T23:59:59+08:00', end), 'event');
  assert.equal(xiangqiBroadcastPollPhase('2026-09-18T23:59:59+08:00', end + 1), 'after-event');
  assert.equal(
    xiangqiBroadcastPollPhase(
      '2026-09-18T23:59:59+08:00',
      end + XIANGQI_BROADCAST_AFTER_EVENT_WINDOW_MS,
    ),
    'after-event',
  );
  assert.equal(
    xiangqiBroadcastPollPhase(
      '2026-09-18T23:59:59+08:00',
      end + XIANGQI_BROADCAST_AFTER_EVENT_WINDOW_MS + 1,
    ),
    'ended',
  );
});

test('scheduler polls a finished event every half hour while late records land', async () => {
  const h = harness();
  const scheduler = createXiangqiBroadcastScheduler(h.deps);
  // Ended an hour ago: inside the after-event window.
  h.setTours([
    {
      slug: 'finished',
      sourceUrl: 'https://fixture.invalid/finished.json',
      pollIntervalMs: 30_000,
      endsAt: new Date(h.now() - 60 * 60_000).toISOString(),
    },
  ]);

  await scheduler.tick();
  assert.equal(h.polls.length, 1);

  h.advance(30_000);
  await scheduler.tick();
  assert.equal(h.polls.length, 1, 'the operator interval no longer applies after the event');

  h.advance(XIANGQI_BROADCAST_AFTER_EVENT_INTERVAL_MS);
  await scheduler.tick();
  assert.equal(h.polls.length, 2);
  assert.deepEqual(h.logs, []);
});

test('scheduler stops polling three weeks after the event, logs once, and resumes on a moved end', async () => {
  const h = harness();
  const scheduler = createXiangqiBroadcastScheduler(h.deps);
  const longOver = {
    slug: 'long-over',
    sourceUrl: 'https://fixture.invalid/over.json',
    pollIntervalMs: 30_000,
    endsAt: new Date(h.now() - XIANGQI_BROADCAST_AFTER_EVENT_WINDOW_MS - 1).toISOString(),
  };
  h.setTours([
    longOver,
    { slug: 'no-end', sourceUrl: 'https://fixture.invalid/open.json', pollIntervalMs: 30_000 },
  ]);

  await scheduler.tick();
  assert.deepEqual(h.pollSlugs, ['no-end'], 'a tour with no end date polls as set');
  assert.deepEqual(
    h.logs.map((log) => (log as { kind: string }).kind),
    ['poll_stopped_after_event'],
  );

  h.advance(30_000);
  await scheduler.tick();
  assert.deepEqual(h.pollSlugs, ['no-end', 'no-end']);
  assert.equal(h.logs.length, 1, 'the stop is logged once, not every tick');

  // The index sweep found the league's next stage: the end date moves out.
  h.setTours([{ ...longOver, endsAt: new Date(h.now() + 86_400_000).toISOString() }]);
  h.advance(30_000);
  await scheduler.tick();
  assert.deepEqual(h.pollSlugs.slice(-1), ['long-over']);
});

test('scheduler sweeps the dpxq index before polling, then every six hours', async () => {
  const h = harness();
  let sweeps = 0;
  const scheduler = createXiangqiBroadcastScheduler({
    ...h.deps,
    sweepIndex: async () => {
      sweeps += 1;
    },
  });
  await scheduler.tick();
  assert.equal(sweeps, 1);
  h.advance(60 * 60_000);
  await scheduler.tick();
  assert.equal(sweeps, 1);
  h.advance(XIANGQI_BROADCAST_INDEX_SWEEP_MS);
  await scheduler.tick();
  assert.equal(sweeps, 2);
});

test('a failing index sweep never stops the polls', async () => {
  const h = harness();
  h.setTours([
    { slug: 'cup', sourceUrl: 'https://fixture.invalid/cup.json', pollIntervalMs: 30_000 },
  ]);
  const scheduler = createXiangqiBroadcastScheduler({
    ...h.deps,
    sweepIndex: async () => {
      throw new Error('dpxq down');
    },
  });
  await scheduler.tick();
  assert.deepEqual(h.pollSlugs, ['cup']);
});
