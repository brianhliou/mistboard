import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  replayXiangqiBroadcastBoard,
  type XiangqiBroadcastBoard,
} from '@mistboard/game';
import type { StoredXiangqiBroadcastBoard } from './persistence.js';
import {
  buildXiangqiBroadcastBoardReplay,
  finalXiangqiBoardView,
  findUnservableXiangqiBroadcastBoards,
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
    assert.deepEqual(finalXiangqiBoardView(board), {
      ...buildXiangqiBroadcastBoardReplay(board).view,
      legalMoves: [],
    });
  });
}

for (const reason of ['repetition', 'progress-clock'] as const) {
  test(`broadcast ending on ${reason} keeps its final draw status`, () => {
    const board = stored(`arbiter-adjudicated/${reason}.json`);
    let state = createInitialXiangqiState(board.id);
    let plies = 0;
    for (const move of board.moves) {
      state = applyStandardXiangqiMove(state, move);
      plies += 1;
      if (state.status.type === 'finished') break;
    }
    assert.deepEqual(state.status, { type: 'finished', winner: null, reason });
    const ended = {
      ...board,
      moves: board.moves.slice(0, plies),
      plyCount: plies,
      result: '1/2-1/2' as const,
      finalStatus: state.status,
    };
    const replay = buildXiangqiBroadcastBoardReplay(ended);
    assert.deepEqual(replay.state.status, state.status);
    assert.deepEqual(replay.view.status, state.status);
    assert.deepEqual(replay.history.truth.at(-1)?.view.status, state.status);
    assert.deepEqual(finalXiangqiBoardView(ended).status, state.status);
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

test('readout sweep finds the same unservable boards as the per-board check', async () => {
  const clean = stored('2025-wxc-sample/games/men-r1-b01.json');
  const mated = stored('checkmate.json');
  const past = { ...mated, id: `${mated.id}-past`, moves: [...mated.moves, mated.moves[0]!] };
  const unservable = await findUnservableXiangqiBroadcastBoards([clean, past, mated], {
    sliceMs: 0,
  });
  assert.deepEqual(
    unservable.map((board) => board.id),
    [past.id],
  );
});

// 2026-10-16: the daily readout replayed every stored board (~2,000 boards,
// ~155k plies) in one synchronous filter and held prod's event loop for 16.4s,
// stalling every room and request on the box. The sweep must hand the loop
// back between slices however large the corpus grows.
test('readout sweep yields the event loop while it replays a large corpus', async () => {
  const board = stored('2025-wxc-sample/games/men-r1-b01.json');
  const boards = Array.from({ length: 40 }, (_, index) => ({ ...board, id: `b${index}` }));
  let ticks = 0;
  const ticker = setInterval(() => {
    ticks += 1;
  }, 1);
  let ticksBeforeLastBoard = -1;
  try {
    await findUnservableXiangqiBroadcastBoards(boards, {
      sliceMs: 5,
      serves: (next) => {
        const until = performance.now() + 2;
        while (performance.now() < until) {
          // stand in for a 2ms replay
        }
        if (next.id === 'b39') ticksBeforeLastBoard = ticks;
        return true;
      },
    });
  } finally {
    clearInterval(ticker);
  }
  // 80ms of work in 5ms slices: timers must have run during the sweep, not after.
  assert.ok(ticksBeforeLastBoard >= 5, `timers ran ${ticksBeforeLastBoard} times during the sweep`);
});
