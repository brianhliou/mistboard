import assert from 'node:assert/strict';
import test from 'node:test';
import type { XiangqiMove } from '@mistboard/game';
import type { UciMultiPvEval, UciMultiPvLine } from './uci-engine-harness.js';
import {
  broadcastLiveEvalFromSearch,
  broadcastLiveEvalNodes,
  createBroadcastLiveEvaluator,
} from './xiangqi-broadcast-live-eval.js';

function line(
  index: number,
  move: string,
  score: { cp?: number; mate?: number },
  pv: string[] = [move],
): UciMultiPvLine {
  return {
    index,
    move,
    cp: score.cp ?? null,
    mate: score.mate ?? null,
    depth: 12,
    pv,
    bound: null,
  };
}

function table(lines: UciMultiPvLine[]): UciMultiPvEval {
  const best = lines.find((entry) => entry.index === 1) ?? lines[0]!;
  return { best: best.move, cp: best.cp, mate: best.mate, depth: best.depth, pv: best.pv, lines };
}

// Red cannon to the centre; Pikafish spells our `b3e3` as `b2e2`.
const RED_OPENING: XiangqiMove[] = [{ from: 'b3', to: 'e3' }];

test('live eval normalises to Red POV and converts moves to our squares', () => {
  // After one red move Black is to move: a side-to-move +40 is Red -40.
  const result = broadcastLiveEvalFromSearch(
    table([
      line(1, 'h9g7', { cp: 40 }, ['h9g7', 'b0c2', 'h7e7']),
      line(2, 'b9c7', { cp: 25 }),
      line(3, 'a9a8', { mate: -3 }),
    ]),
    1,
    300_000,
  );
  assert.equal(result.ply, 1);
  assert.equal(result.nodes, 300_000);
  assert.equal(result.cp, -40);
  assert.equal(result.mate, null);
  assert.deepEqual(result.lines, [
    { move: 'h10g8', cp: -40, mate: null, pv: ['h10g8', 'b1c3', 'h8e8'] },
    { move: 'b10c8', cp: -25, mate: null, pv: ['b10c8'] },
    { move: 'a10a9', cp: null, mate: 3, pv: ['a10a9'] },
  ]);

  // Red to move at an even ply keeps the sign.
  const red = broadcastLiveEvalFromSearch(table([line(1, 'b2e2', { cp: 15 })]), 0, 1);
  assert.equal(red.cp, 15);
  assert.equal(red.lines[0]?.move, 'b3e3');
});

test('live eval truncates a PV at the first token it cannot convert', () => {
  const result = broadcastLiveEvalFromSearch(
    table([line(1, 'b2e2', { cp: 10 }, ['b2e2', 'h9g7', '(none)', 'b0c2'])]),
    0,
    1,
  );
  assert.deepEqual(result.lines[0]?.pv, ['b3e3', 'h10g8']);
  // A rank whose root move will not convert is dropped rather than shipped blank.
  const dropped = broadcastLiveEvalFromSearch(
    table([line(1, 'b2e2', { cp: 10 }), line(2, '0000', { cp: 5 })]),
    0,
    1,
  );
  assert.equal(dropped.lines.length, 1);
});

test('live eval encodes an already-checkmated side as a decisive score', () => {
  // Black to move and checkmated: mate 0 from Black's side is Red winning.
  const result = broadcastLiveEvalFromSearch(table([line(1, '', { mate: 0 })]), 1, 1);
  assert.equal(result.cp, 30000);
  assert.equal(result.mate, null);
  assert.deepEqual(result.lines, []);
});

test('the evaluator caches by (board, ply) and reads the node budget from the environment', async () => {
  const searches: string[][] = [];
  const evaluator = createBroadcastLiveEvaluator({
    nodes: 42,
    search: async (moves) => {
      searches.push(moves);
      return table([line(1, 'h9g7', { cp: 30 })]);
    },
  });
  const first = await evaluator.evaluate('b1', RED_OPENING);
  assert.deepEqual(searches, [['b2e2']]);
  assert.equal(first?.nodes, 42);
  assert.equal(first?.cp, -30);
  assert.equal(evaluator.cached('b1', 1), first);
  assert.equal(evaluator.cached('b1', 2), null);
  // Same position again: served from the cache, no second search.
  assert.equal(await evaluator.evaluate('b1', RED_OPENING), first);
  assert.equal(searches.length, 1);

  assert.equal(broadcastLiveEvalNodes({}), 300_000);
  assert.equal(broadcastLiveEvalNodes({ MISTBOARD_BROADCAST_LIVE_EVAL_NODES: '150000' }), 150_000);
  assert.equal(broadcastLiveEvalNodes({ MISTBOARD_BROADCAST_LIVE_EVAL_NODES: 'lots' }), 300_000);
});

test('the evaluator runs one search at a time and drops a stale request when a newer ply arrives', async () => {
  const started: number[] = [];
  const release: Array<() => void> = [];
  const evaluator = createBroadcastLiveEvaluator({
    nodes: 1,
    search: (moves) =>
      new Promise((resolve) => {
        started.push(moves.length);
        release.push(() => resolve(table([line(1, 'b2e2', { cp: moves.length })])));
      }),
  });
  const twoMoves: XiangqiMove[] = [...RED_OPENING, { from: 'h10', to: 'g8' }];
  const threeMoves: XiangqiMove[] = [...twoMoves, { from: 'b1', to: 'c3' }];

  // Board A is running; board B's ply 1 waits; then board B's ply 2 arrives
  // and supersedes the waiting ply-1 request before it ever runs.
  const a = evaluator.evaluate('a', RED_OPENING);
  const bStale = evaluator.evaluate('b', twoMoves);
  const bFresh = evaluator.evaluate('b', threeMoves);
  // A second ask for the same fresh position shares the queued job.
  const bFreshAgain = evaluator.evaluate('b', threeMoves);
  assert.deepEqual(started, [1]);
  assert.equal(evaluator.pending(), 2);
  assert.equal(await bStale, null);

  release[0]!();
  // One ply played: Black to move, so the side-to-move +1 reads as Red -1.
  assert.equal((await a)?.cp, -1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 3]);
  release[1]!();
  const fresh = await bFresh;
  assert.equal(fresh?.ply, 3);
  assert.equal(await bFreshAgain, fresh);
  assert.equal(evaluator.pending(), 0);
  assert.equal(evaluator.cached('b', 2), null);
  assert.equal(evaluator.cached('b', 3), fresh);
});

test('a failed search rejects its waiters, logs once per distinct failure, and frees the queue', async () => {
  const logs: Record<string, unknown>[] = [];
  let calls = 0;
  const evaluator = createBroadcastLiveEvaluator({
    nodes: 1,
    log: (entry) => logs.push(entry),
    search: async () => {
      calls += 1;
      if (calls <= 2) throw new Error('binary not found');
      return table([line(1, 'b2e2', { cp: 3 })]);
    },
  });
  await assert.rejects(evaluator.evaluate('a', []), /binary not found/);
  await assert.rejects(evaluator.evaluate('b', []), /binary not found/);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.kind, 'xiangqi_broadcast_live_eval_failed');
  const ok = await evaluator.evaluate('c', []);
  assert.equal(ok?.cp, 3);
  assert.equal(evaluator.pending(), 0);
});

test('the cache is LRU-bounded', async () => {
  const evaluator = createBroadcastLiveEvaluator({
    nodes: 1,
    cacheSize: 2,
    search: async () => table([line(1, 'b2e2', { cp: 0 })]),
  });
  await evaluator.evaluate('a', []);
  await evaluator.evaluate('b', []);
  assert.ok(evaluator.cached('a', 0)); // touch a: b is now the oldest
  await evaluator.evaluate('c', []);
  assert.ok(evaluator.cached('a', 0));
  assert.equal(evaluator.cached('b', 0), null);
  assert.ok(evaluator.cached('c', 0));
});
