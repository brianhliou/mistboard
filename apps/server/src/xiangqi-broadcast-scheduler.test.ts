import assert from 'node:assert/strict';
import test from 'node:test';
import type { XiangqiBroadcastPollResult } from './xiangqi-broadcast-poller.js';
import {
  clampXiangqiBroadcastScheduleIntervalMs,
  createXiangqiBroadcastScheduler,
  type XiangqiBroadcastSchedulerDeps,
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

type Harness = {
  deps: XiangqiBroadcastSchedulerDeps;
  polls: string[];
  pollSlugs: string[];
  logs: unknown[];
  advance(ms: number): void;
  setTours(tours: Array<{ slug: string; sourceUrl: string | null; pollIntervalMs: number }>): void;
  setPollResult(result: XiangqiBroadcastPollResult): void;
};

function harness(): Harness {
  let now = 1_000_000;
  let tours: Array<{ slug: string; sourceUrl: string | null; pollIntervalMs: number }> = [];
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
    setTours(next) {
      tours = next;
    },
    setPollResult(result) {
      pollResult = result;
    },
    pollSlugs,
    deps: {
      listScheduledTours: async () => tours.map((tour) => ({ ...tour, pollEnabled: true })),
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
