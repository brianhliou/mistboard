import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createInitialXiangqiState, type XiangqiGameState } from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  applyXiangqiRecordMove,
  resumeAdjudicatedDraw,
} from './variants-xiangqi-standard.js';
import { parseStandardXiangqiFen } from './xiangqi-position.js';
import { pikafishUciToXiangqiSquares } from './xiangqi-uci.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/xiangqi-notation/adjudicated-records.json', import.meta.url),
    'utf8',
  ),
) as {
  cases: { key: string; iccs: string; reason: string }[];
};
for (const record of fixture.cases) {
  test(`record mode replays all of ${record.key} while live play still ends on ${record.reason}`, () => {
    const moves = record.iccs.split(' ').map((uci) => pikafishUciToXiangqiSquares(uci)!);
    let state = createInitialXiangqiState('record');
    let live = createInitialXiangqiState('live');
    for (const move of moves) {
      const next = applyXiangqiRecordMove(state, move);
      assert.notEqual(next, state, `record stopped at ${move.from}-${move.to}`);
      assert.equal(next.status.type, 'playing');
      state = next;
      live = applyStandardXiangqiMove(live, move);
    }
    assert.deepEqual(live.status, { type: 'finished', winner: null, reason: record.reason });
    assert.notDeepEqual(state.board, live.board);
  });
}

test('Black-first FEN resumes with the right turn and keeps the no-capture clock', () => {
  const parsed = parseStandardXiangqiFen(
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 59 12',
    'record',
  );
  assert.ok(parsed.ok);
  const move = { from: 'h10', to: 'g8' } as const;
  const live = applyStandardXiangqiMove(parsed.state, move);
  assert.equal(live.status.type, 'finished');
  const record = applyXiangqiRecordMove(parsed.state, move);
  assert.deepEqual(record.status, { type: 'playing', turn: 'red' });
  assert.equal(record.progressClock, 60);
  assert.equal(record.moveNumber, 13);
  assert.deepEqual(record.board, live.board);
  assert.deepEqual(applyXiangqiRecordMove(live, { from: 'h1', to: 'g3' }).status, {
    type: 'playing',
    turn: 'black',
  });
  // Even when a stored state needs resuming, an illegal move is a true no-op.
  assert.equal(applyXiangqiRecordMove(live, { from: 'a1', to: 'a5' }), live);
});

test('record mode preserves all non-draw terminal reasons and illegal-move identity', () => {
  const start = createInitialXiangqiState('record');
  assert.equal(applyXiangqiRecordMove(start, { from: 'a1', to: 'a5' }), start);
  for (const reason of ['checkmate', 'stalemate', 'resignation', 'timeout'] as const) {
    const terminal: XiangqiGameState = {
      ...start,
      status: { type: 'finished', winner: 'red', reason },
      lastMove: { from: 'h1', to: 'g3' },
    };
    assert.equal(resumeAdjudicatedDraw(terminal), terminal);
    assert.equal(applyXiangqiRecordMove(terminal, { from: 'h10', to: 'g8' }), terminal);
  }
});
