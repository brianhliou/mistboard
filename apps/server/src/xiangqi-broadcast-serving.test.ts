import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyStandardXiangqiMove,
  applyXiangqiRecordMove,
  createInitialXiangqiState,
  replayXiangqiBroadcastBoard,
  type XiangqiBroadcastBoard,
  type XiangqiGameStatus,
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
  test(`broadcast ending on ${reason} takes its ending from the source result`, () => {
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
    for (const result of ['*', '1-0', '0-1', '1/2-1/2'] as const) {
      const source = {
        ...ended,
        result,
        status: result === '*' ? ('live' as const) : ('complete' as const),
      };
      const expected: XiangqiGameStatus =
        result === '*'
          ? { type: 'playing', turn: plies % 2 === 0 ? 'red' : 'black' }
          : {
              type: 'finished',
              winner: result === '1-0' ? 'red' : result === '0-1' ? 'black' : null,
              reason: result === '1/2-1/2' ? 'agreement' : 'resignation',
            };
      const replay = buildXiangqiBroadcastBoardReplay(source);
      assert.deepEqual(replay.state.status, expected, result);
      assert.deepEqual(replay.view.status, expected, result);
      assert.deepEqual(replay.views.truth.status, expected, result);
      assert.deepEqual(replay.history.truth.at(-1)?.view.status, expected, result);
      assert.deepEqual(finalXiangqiBoardView(source).status, expected, result);
      assert.ok(
        replay.history.truth.slice(0, -1).every(({ view }) => view.status.type === 'playing'),
      );
    }
  });
}

test('live broadcast at the 61st no-capture ply stays playing', () => {
  const board = stored('arbiter-adjudicated/progress-clock.json');
  let state = createInitialXiangqiState(board.id);
  for (const move of board.moves) {
    state = applyXiangqiRecordMove(state, move);
    if (state.progressClock === 61) break;
  }
  assert.equal(state.progressClock, 61);
  assert.ok(state.moveLog);
  const live = {
    ...board,
    moves: [...state.moveLog],
    plyCount: state.moveLog.length,
    status: 'live' as const,
    result: '*' as const,
  };
  const replay = buildXiangqiBroadcastBoardReplay(live);
  assert.deepEqual(replay.state.status, state.status);
  assert.deepEqual(replay.history.truth.at(-1)?.view.status, state.status);
  assert.deepEqual(finalXiangqiBoardView(live).status, state.status);
});

test('live broadcast ending in checkmate keeps the mate before the source posts its result', () => {
  const board = stored('checkmate.json');
  const expected: XiangqiGameStatus = { type: 'finished', winner: 'red', reason: 'checkmate' };
  assert.deepEqual(board.finalStatus, expected);
  const live = { ...board, status: 'live' as const, result: '*' as const };
  const replay = buildXiangqiBroadcastBoardReplay(live);
  assert.equal(replay.timeline.length, board.moves.length);
  assert.deepEqual(replay.state.status, expected);
  assert.deepEqual(replay.view.status, expected);
  assert.deepEqual(replay.views.truth.status, expected);
  assert.deepEqual(replay.history.truth.at(-1)?.view.status, expected);
  assert.deepEqual(finalXiangqiBoardView(live).status, expected);
});

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
