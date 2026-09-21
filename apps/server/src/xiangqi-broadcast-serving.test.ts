import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { replayXiangqiBroadcastBoard, type XiangqiBroadcastBoard } from '@mistboard/game';
import type { StoredXiangqiBroadcastBoard } from './persistence.js';
import {
  buildXiangqiBroadcastBoardReplay,
  xiangqiBroadcastBoardServes,
} from './xiangqi-broadcast-serving.js';

const FIXTURES = new URL('../../../packages/game/fixtures/xiangqi-broadcast/', import.meta.url);

function stored(relative: string): StoredXiangqiBroadcastBoard {
  const record = JSON.parse(
    readFileSync(fileURLToPath(new URL(relative, FIXTURES)), 'utf-8'),
  ) as XiangqiBroadcastBoard;
  const ingest = replayXiangqiBroadcastBoard(record, { continuePastAdjudicatedDraw: true });
  if (!ingest.ok) throw new Error(ingest.reason);
  return {
    ...record,
    plyCount: ingest.plies,
    finalStatus: ingest.finalStatus,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

// The readout's sweep and the board API must agree on every row, or the sweep
// reports a corpus the page cannot show (or the reverse). Judged on the real
// arbiter-adjudicated games and a clean one.
for (const file of [
  '2025-wxc-sample/games/men-r1-b01.json',
  'arbiter-adjudicated/repetition.json',
  'arbiter-adjudicated/progress-clock.json',
]) {
  test(`serving check agrees with the board API replay for ${file}`, () => {
    const board = stored(file);
    assert.equal(xiangqiBroadcastBoardServes(board), true);
    assert.equal(buildXiangqiBroadcastBoardReplay(board).timeline.length, board.moves.length);
  });
}

test('serving check fails a record with a move after checkmate, as the API does', () => {
  // A real game (2026 women's league) that ended in mate on the board, plus one
  // more move: checkmate is not an arbiter draw, so neither path resumes.
  const mated = stored('checkmate.json');
  assert.equal(mated.finalStatus.type, 'finished');
  assert.equal(xiangqiBroadcastBoardServes(mated), true);
  const past = { ...mated, moves: [...mated.moves, mated.moves[0]!] };
  assert.equal(xiangqiBroadcastBoardServes(past), false);
  assert.throws(() => buildXiangqiBroadcastBoardReplay(past), /moves after terminal state/);
});
