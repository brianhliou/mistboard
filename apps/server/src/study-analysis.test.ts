import assert from 'node:assert/strict';
import test from 'node:test';
import { fsfUciToXiangqiSquares, type XiangqiMove } from '@mistboard/game';
import type { StoredPlyEval } from './persistence-game-analysis.js';
import {
  buildBroadcastAnalysisIndex,
  type ChapterAnalysisDeps,
  planChapterAnalysis,
  runChapterAnalysis,
  xiangqiChapterLine,
} from './study-analysis.js';

const ENGINE = 'pikafish-xiangqi-analysis@5';
const LINE = ['h3e3', 'h10g8', 'h1g3', 'i10h10', 'i1h1'];

function tree(ucis: readonly string[], rootFen?: string): unknown {
  let node: { uci?: string; children: unknown[] } = { children: [] };
  const root = node;
  for (const uci of ucis) {
    const child = { uci, children: [] as unknown[] };
    node.children.push(child);
    node = child;
  }
  return { version: 1, root, ...(rootFen ? { rootFen } : {}) };
}

function chapter(
  root: unknown,
  extra: Partial<{ variant: string; practice: boolean; gamebook: boolean }> = {},
) {
  return {
    chapterId: 'ch1',
    variant: extra.variant ?? 'xiangqi',
    root,
    practice: extra.practice ?? false,
    gamebook: extra.gamebook ?? false,
  };
}

const moves = (ucis: readonly string[]): XiangqiMove[] =>
  ucis.map((uci) => fsfUciToXiangqiSquares(uci) as XiangqiMove);

const evals = (count: number): StoredPlyEval[] =>
  Array.from({ length: count }, (_, ply) => ({ ply, cp: 20 - ply, mate: null, best: null }));

test('the chapter line stops at the first move the kernel refuses', () => {
  // b10c8 after h3e3 is fine; a1a5 (a chariot through its own soldier) is not.
  const { ucis, moves: played } = xiangqiChapterLine(tree(['h3e3', 'b10c8', 'a1a5', 'h1g3']));
  assert.deepEqual(ucis, ['h3e3', 'b10c8']);
  assert.equal(played.length, 2);
  assert.deepEqual(xiangqiChapterLine(tree(LINE), 3).ucis, LINE.slice(0, 3));
});

test('only xiangqi chapters from the standard start with moves are planned', () => {
  const opts = { engineId: ENGINE };
  assert.deepEqual(planChapterAnalysis(chapter(tree(LINE), { variant: 'jungle' }), null, opts), {
    kind: 'skip',
    reason: 'variant jungle',
  });
  assert.equal(
    planChapterAnalysis(chapter(tree(LINE), { practice: true }), null, opts).kind,
    'skip',
  );
  assert.equal(
    planChapterAnalysis(chapter(tree(LINE), { gamebook: true }), null, opts).kind,
    'skip',
  );
  assert.deepEqual(
    planChapterAnalysis(chapter(tree(LINE, '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1')), null, opts),
    { kind: 'skip', reason: 'set-up position' },
  );
  assert.deepEqual(planChapterAnalysis(chapter(tree([])), null, opts), {
    kind: 'skip',
    reason: 'no moves',
  });
  const plan = planChapterAnalysis(chapter(tree(LINE)), null, opts);
  assert.equal(plan.kind, 'run');
  assert.deepEqual(plan.kind === 'run' && plan.ucis, LINE);
});

test('a stored analysis of the same line is current; an edited line re-runs', () => {
  const stored = { engineId: ENGINE, rootFen: null, moves: LINE };
  assert.deepEqual(planChapterAnalysis(chapter(tree(LINE)), stored, { engineId: ENGINE }), {
    kind: 'current',
    plies: LINE.length,
  });
  const edited = [...LINE.slice(0, 2), 'b1c3'];
  const plan = planChapterAnalysis(chapter(tree(edited)), stored, { engineId: ENGINE });
  assert.equal(plan.kind, 'run');
  assert.equal(plan.kind === 'run' && plan.replaces, true);
  // A longer mainline (moves added) re-runs too, and so does a new engine id.
  assert.equal(
    planChapterAnalysis(chapter(tree([...LINE, 'a10a9'])), stored, { engineId: ENGINE }).kind,
    'run',
  );
  assert.equal(
    planChapterAnalysis(chapter(tree(LINE)), stored, { engineId: 'pikafish-xiangqi-analysis@6' })
      .kind,
    'run',
  );
  assert.equal(
    planChapterAnalysis(chapter(tree(LINE)), stored, { engineId: ENGINE, force: true }).kind,
    'run',
  );
});

test('a chapter that is a broadcast game copies its stored evals', async () => {
  const index = buildBroadcastAnalysisIndex([
    { id: 'other', moves: moves(['b3e3', 'h10g8']) },
    { id: 'longer', moves: moves([...LINE, 'a10a9']) },
    { id: 'exact', moves: moves(LINE) },
  ]);
  assert.equal(index.find(LINE), 'exact');
  // A shorter chapter (an opening cut from the game) is served by any board
  // that starts with it: those positions are the same positions.
  assert.ok(['longer', 'exact'].includes(index.find(LINE.slice(0, 2)) ?? ''));
  assert.equal(index.find(['b1c3']), null);

  const plan = planChapterAnalysis(chapter(tree(LINE)), null, {
    engineId: ENGINE,
    broadcasts: index,
  });
  assert.deepEqual(plan, { kind: 'reuse', boardId: 'exact', ucis: LINE, replaces: false });

  const saved: unknown[] = [];
  const deps: ChapterAnalysisDeps = {
    engineId: ENGINE,
    depth: 12,
    analyse: () => Promise.reject(new Error('must not run the engine')),
    broadcastPlies: async (boardId) => (boardId === 'exact' ? evals(LINE.length + 3) : null),
    save: async (record) => {
      saved.push(record);
    },
  };
  assert.equal(plan.kind, 'reuse');
  if (plan.kind !== 'reuse') return;
  const result = await runChapterAnalysis('ch1', plan, deps);
  assert.deepEqual(result, { plies: LINE.length, source: 'broadcast:exact' });
  const record = saved[0] as { plies: StoredPlyEval[]; moves: string[]; source: string };
  // Cut to the chapter: positions 0..5, nothing from the board's later moves.
  assert.deepEqual(
    record.plies.map((entry) => entry.ply),
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(record.moves, LINE);
});

test('an engine run stores the line it ran on; an all-null sweep is refused', async () => {
  const plan = planChapterAnalysis(chapter(tree(LINE)), null, { engineId: ENGINE });
  assert.equal(plan.kind, 'run');
  if (plan.kind !== 'run') return;
  const saved: Array<{ moves: readonly string[]; source: string; rootFen: string | null }> = [];
  const deps: ChapterAnalysisDeps = {
    engineId: ENGINE,
    depth: 12,
    analyse: async (played) => ({ engineId: ENGINE, depth: 12, plies: evals(played.length + 1) }),
    broadcastPlies: async () => null,
    save: async (record) => {
      saved.push(record);
    },
  };
  assert.deepEqual(await runChapterAnalysis('ch1', plan, deps), {
    plies: LINE.length,
    source: 'engine',
  });
  assert.deepEqual(saved[0]?.moves, LINE);
  assert.equal(saved[0]?.rootFen, null);

  const silent: ChapterAnalysisDeps = {
    ...deps,
    analyse: async (played) => ({
      engineId: ENGINE,
      depth: 12,
      plies: Array.from({ length: played.length + 1 }, (_, ply) => ({
        ply,
        cp: null,
        mate: null,
        best: null,
      })),
    }),
  };
  await assert.rejects(runChapterAnalysis('ch1', plan, silent), /no scores/);
  assert.equal(saved.length, 1);
});
