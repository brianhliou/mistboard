import assert from 'node:assert/strict';
import test from 'node:test';
import type { XiangqiMove } from '@mistboard/game';
import {
  type BroadcastAnalysisSweepDeps,
  broadcastAnalysisRoomId,
  createBroadcastAnalysisSweep,
  SWEEP_GAMES_PER_HOUR,
} from './xiangqi-broadcast-analysis.js';

type Board = { id: string; moves: XiangqiMove[] };

function harness(boards: Board[]) {
  let now = 1_000_000;
  let pending = 0;
  const analysed: string[] = [];
  const skipsSeen: string[][] = [];
  let fail: Set<string> = new Set();
  const deps: BroadcastAnalysisSweepDeps = {
    pendingJobs: () => pending,
    nextBoard: async (skip) => {
      skipsSeen.push([...skip]);
      return (
        boards.find((board) => !analysed.includes(board.id) && !skip.includes(board.id)) ?? null
      );
    },
    analyse: (board) => {
      if (fail.has(board.id)) return Promise.reject(new Error('vacuous'));
      analysed.push(board.id);
      return Promise.resolve();
    },
    now: () => now,
  };
  return {
    sweep: createBroadcastAnalysisSweep(deps),
    analysed,
    skipsSeen,
    advance: (ms: number) => {
      now += ms;
    },
    setPending: (n: number) => {
      pending = n;
    },
    failOn: (ids: string[]) => {
      fail = new Set(ids);
    },
  };
}

const boards = (n: number): Board[] =>
  Array.from({ length: n }, (_, i) => ({ id: `b${i}`, moves: [] }));

test('the curator and the sweep share one analysis key', () => {
  assert.equal(
    broadcastAnalysisRoomId('2026-xiangqi-league-r06-b1'),
    'broadcast:2026-xiangqi-league-r06-b1',
  );
});

test('the sweep analyses one board a tick and waits while a reader has a job queued', async () => {
  const h = harness(boards(3));
  h.setPending(1);
  await h.sweep.tick();
  assert.deepEqual(h.analysed, [], "a reader's request goes first");
  h.setPending(0);
  await h.sweep.tick();
  await h.sweep.tick();
  assert.deepEqual(h.analysed, ['b0', 'b1']);
});

test('the sweep starts at most its hourly quota, then resumes the next hour', async () => {
  const h = harness(boards(SWEEP_GAMES_PER_HOUR + 2));
  for (let i = 0; i < SWEEP_GAMES_PER_HOUR + 2; i += 1) await h.sweep.tick();
  assert.equal(h.analysed.length, SWEEP_GAMES_PER_HOUR);
  h.advance(60 * 60_000 + 1);
  await h.sweep.tick();
  assert.equal(h.analysed.length, SWEEP_GAMES_PER_HOUR + 1);
});

test('a board the engine cannot score is skipped from then on, not retried every tick', async () => {
  const h = harness(boards(2));
  h.failOn(['b0']);
  await h.sweep.tick();
  await h.sweep.tick();
  assert.deepEqual(h.analysed, ['b1']);
  assert.deepEqual(h.skipsSeen.at(-1), ['b0']);
});

test('with slots to spare, the sweep runs that many games side by side, never the same one twice', async () => {
  const started: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const all = boards(5);
  const sweep = createBroadcastAnalysisSweep(
    {
      pendingJobs: () => 0,
      nextBoard: async (skip) => all.find((board) => !skip.includes(board.id)) ?? null,
      analyse: (board) => {
        started.push(board.id);
        return gate;
      },
      now: () => 1_000_000,
    },
    { concurrency: 3, perHour: 100 },
  );
  const tick = sweep.tick();
  // All three slots fill before any game finishes, each with its own board.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['b0', 'b1', 'b2']);
  release();
  assert.equal(await tick, 3);
});
