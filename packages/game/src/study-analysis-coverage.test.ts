import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coveredStudyAnalysisPlies,
  serializedTreeMainline,
  serializedTreeRootFen,
  studyAnalysisCoveredPlies,
} from './study-analysis-coverage.js';

function line(...ucis: string[]): unknown {
  let node: { uci?: string; children: unknown[] } = { children: [] };
  const root = node;
  for (const uci of ucis) {
    const child = { uci, children: [] as unknown[] };
    node.children.push(child);
    node = child;
  }
  return { version: 1, root };
}

const MAINLINE = ['h3e3', 'h10g8', 'h1g3', 'i10h10', 'i1h1'];
const plies = Array.from({ length: MAINLINE.length + 1 }, (_, ply) => ({ ply, cp: ply * 10 }));

test('the mainline is the first-child chain, variations ignored', () => {
  const tree = line(...MAINLINE) as { root: { children: unknown[] } };
  // A variation off the first move: a second child must not enter the line.
  tree.root.children.push({ uci: 'b3e3', children: [] });
  assert.deepEqual(serializedTreeMainline(tree), MAINLINE);
  assert.deepEqual(serializedTreeMainline(null), []);
  assert.deepEqual(serializedTreeMainline({ version: 1, root: { children: [] } }), []);
});

test('a node without a move string ends the line', () => {
  const tree = line('h3e3', 'h10g8') as { root: { children: Array<{ children: unknown[] }> } };
  tree.root.children[0]!.children[0] = { children: [{ uci: 'h1g3', children: [] }] };
  assert.deepEqual(serializedTreeMainline(tree), ['h3e3']);
});

test('rootFen is read off the tree, blank meaning the standard start', () => {
  assert.equal(
    serializedTreeRootFen({ rootFen: '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1' }),
    '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
  );
  assert.equal(serializedTreeRootFen({ rootFen: '  ' }), null);
  assert.equal(serializedTreeRootFen({}), null);
});

test('an unchanged mainline is fully covered', () => {
  const covered = studyAnalysisCoveredPlies(
    { moves: MAINLINE, rootFen: null },
    { moves: MAINLINE, rootFen: null },
  );
  assert.equal(covered, MAINLINE.length);
  assert.deepEqual(coveredStudyAnalysisPlies(plies, covered), plies);
});

test('an edit at ply k leaves the chart covering fewer than k moves', () => {
  // Ply 3 (index 2) replaced: moves 1-2 still match, the edited move does not.
  const edited = ['h3e3', 'h10g8', 'b1c3', 'i10h10', 'i1h1'];
  const covered = studyAnalysisCoveredPlies(
    { moves: MAINLINE, rootFen: null },
    { moves: edited, rootFen: null },
  );
  assert.equal(covered, 2);
  const kept = coveredStudyAnalysisPlies(plies, covered);
  assert.deepEqual(
    kept?.map((entry) => entry.ply),
    [0, 1, 2],
  );
  assert.ok(kept!.every((entry) => entry.ply < 3));
});

test('moves added after the run stay uncovered; a shortened line is cut to it', () => {
  assert.equal(
    studyAnalysisCoveredPlies(
      { moves: MAINLINE, rootFen: null },
      { moves: [...MAINLINE, 'a10a9'], rootFen: null },
    ),
    MAINLINE.length,
  );
  assert.equal(
    studyAnalysisCoveredPlies(
      { moves: MAINLINE, rootFen: null },
      { moves: MAINLINE.slice(0, 3), rootFen: null },
    ),
    3,
  );
});

test('a different start position covers nothing', () => {
  assert.equal(
    studyAnalysisCoveredPlies(
      { moves: MAINLINE, rootFen: null },
      { moves: MAINLINE, rootFen: '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1' },
    ),
    0,
  );
});

test('no covered move means no chart', () => {
  assert.equal(coveredStudyAnalysisPlies(plies, 0), null);
  // Only the start position stored: still nothing to draw.
  assert.equal(coveredStudyAnalysisPlies([{ ply: 0 }], 3), null);
  assert.equal(
    studyAnalysisCoveredPlies(
      { moves: MAINLINE, rootFen: null },
      { moves: ['b3e3'], rootFen: null },
    ),
    0,
  );
});
