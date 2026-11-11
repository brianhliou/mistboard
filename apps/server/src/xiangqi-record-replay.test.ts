import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  formatXiangqiMoves,
  pikafishUciToXiangqiSquares,
  serializedTreeMainline,
  standardXiangqiFen,
  type XiangqiGameState,
  type XiangqiMove,
  xiangqiMoveToFsfUci,
} from '@mistboard/game';
import { broadcastFinalFen } from './og-broadcast.js';
import { planChapterAnalysis, xiangqiChapterLine } from './study-analysis.js';
import {
  buildDecisiveMomentChapter,
  buildModelGameChapter,
  legalLine,
} from './study-curator/annotate.js';
import { evalsOf, gameOf, recipeOf } from './study-curator/fixtures.js';
import { judgeGame } from './study-curator/moments.js';
import { replayPlies } from './study-curator/opening-match.js';
import {
  standardXiangqiLineReplays,
  xiangqiPgnStyle,
  xiangqiPgnWriter,
  xiangqiWxfLabels,
} from './xiangqi-game-export.js';

const fixtures = JSON.parse(
  readFileSync(
    new URL(
      '../../../packages/game/fixtures/xiangqi-notation/adjudicated-records.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  cases: { key: string; iccs: string; plies: number; adjudicatedAt: number }[];
};

function tree(ucis: string[]) {
  const root = { children: [] as unknown[] };
  let tail = root;
  for (const uci of ucis) {
    const child = { uci, children: [] as unknown[] };
    tail.children.push(child);
    tail = child;
  }
  return { version: 1, root };
}

// Independent reference: retain the live kernel's ruling, then explicitly
// restore the known next mover before replaying the next recorded ply.
function positions(moves: XiangqiMove[]) {
  const states = [createInitialXiangqiState('reference')];
  for (const [i, move] of moves.entries()) {
    const prior = states.at(-1)!;
    const state: XiangqiGameState =
      prior.status.type === 'finished'
        ? { ...prior, status: { type: 'playing', turn: i % 2 === 0 ? 'red' : 'black' } }
        : prior;
    const next = applyStandardXiangqiMove(state, move);
    assert.notEqual(next, state);
    states.push(
      next.status.type === 'finished' &&
        (next.status.reason === 'repetition' || next.status.reason === 'progress-clock')
        ? { ...next, status: { type: 'playing', turn: i % 2 === 0 ? 'black' : 'red' } }
        : next,
    );
  }
  return states;
}

for (const record of fixtures.cases) {
  const moves = record.iccs.split(' ').map((uci) => pikafishUciToXiangqiSquares(uci)!);
  const ucis = moves.map(xiangqiMoveToFsfUci);
  const root = tree(ucis);
  const states = positions(moves);
  test(`${record.key}: study analysis plans the whole record and replaces truncated analysis`, () => {
    assert.equal(xiangqiChapterLine(root).moves.length, record.plies);
    const plan = planChapterAnalysis(
      { chapterId: 'record', variant: 'xiangqi', root, practice: false, gamebook: false },
      { engineId: 'test', rootFen: null, moves: ucis.slice(0, record.adjudicatedAt) },
      { engineId: 'test' },
    );
    assert.equal(plan.kind, 'run');
    assert.deepEqual(plan.kind === 'run' && plan.ucis, ucis);
  });
  test(`${record.key}: export keeps position-relative notation through the final ply`, () => {
    assert.equal(standardXiangqiLineReplays(moves), true);
    assert.equal(xiangqiPgnStyle(moves), 'wxf');
    const labels = formatXiangqiMoves(moves, 'wxf');
    assert.deepEqual(xiangqiWxfLabels(moves), labels);
    const pgn = xiangqiPgnWriter(moves, 'wxf')({}, '1-0');
    assert.ok(!/[a-i]\d+-[a-i]\d+/.test(pgn), 'PGN fell back to coordinates');
    assert.ok(pgn.includes(labels.at(-1)!));
  });
  test(`${record.key}: broadcast image uses the final recorded position`, () => {
    assert.equal(broadcastFinalFen(moves), standardXiangqiFen(states.at(-1)!));
  });
  test(`${record.key}: curator opening and legal-line replay reach the final ply`, () => {
    const replay = replayPlies(moves, moves.length);
    assert.equal(replay.applied, moves.length);
    assert.deepEqual(replay.state.board, states.at(-1)!.board);
    assert.deepEqual(legalLine(createInitialXiangqiState('line'), ucis), moves);
  });
  // Pick a Black move beyond the kernel draw, with a legal recorded continuation
  // as its engine answer. This isolates replay from the engine's judgment logic.
  const ply = record.adjudicatedAt + 2;
  const cps = Array.from({ length: moves.length + 1 }, (_, i) => (i < ply ? 0 : 400));
  const verdicts = judgeGame(
    ucis,
    evalsOf(cps, { [ply - 1]: { best: ucis[ply - 1]!, pv: ucis.slice(ply - 1, ply + 2) } }),
  );
  const game = gameOf(record.key, moves, '1-0');
  test(`${record.key}: curator retains refutation branches after the draw`, async () => {
    const chapter = await buildModelGameChapter(game, verdicts, recipeOf());
    assert.deepEqual(serializedTreeMainline(chapter.root), ucis);
    let parent = chapter.root.root;
    for (let i = 0; i < ply - 1; i++) parent = parent.children[0]!;
    assert.equal(parent.children.length, 2);
    assert.equal(parent.children[1]?.children[0]?.uci, ucis[ply]);
  });
  test(`${record.key}: curator can root a decisive lesson after the draw`, () => {
    const chapter = buildDecisiveMomentChapter(game, verdicts);
    assert.ok(chapter);
    assert.equal(
      chapter.root.rootFen,
      standardXiangqiFen({ ...states[ply - 2]!, status: { type: 'playing', turn: 'red' } }),
    );
  });
}
