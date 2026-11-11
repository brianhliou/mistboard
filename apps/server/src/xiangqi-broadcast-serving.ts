import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import {
  applyXiangqiRecordMove,
  createInitialXiangqiState,
  getStandardXiangqiPlayerView,
  type StandardXiangqiPlayerView,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
} from '@mistboard/game';
import type { StoredXiangqiBroadcastBoard } from './persistence.js';

// How a stored broadcast board becomes something a browser can show. Both the
// board API and the index thumbnail replay through here, and so does the
// readout's serving check, so "the rows ingest" and "the rows serve" are
// judged by the same loop. They were not on 2026-09-20: ingestion had learned
// to read a record past the kernel's auto-draw and the route had not, and 52
// of 376 prod boards answered 500 with nothing counting them.

export type BroadcastMoveTimelineEntry = {
  type: 'move-played';
  color: XiangqiColor;
  move: XiangqiMove;
  ply: number;
};

export type BroadcastHistorySnapshot = {
  ply: number;
  view: StandardXiangqiPlayerView;
};

// The source decides arbiter results. Record replay already clears automatic
// draws; without a posted result, keep board endings such as mate or stalemate.
function withBroadcastResult(
  state: XiangqiGameState,
  result: StoredXiangqiBroadcastBoard['result'],
): XiangqiGameState {
  if (result === '*') return state;
  const winner = result === '1-0' ? 'red' : result === '0-1' ? 'black' : null;
  if (state.status.type === 'finished' && state.status.winner === winner) return state;
  return {
    ...state,
    status: { type: 'finished', winner, reason: winner === null ? 'agreement' : 'resignation' },
  };
}

// Replay a stored board to its final position. Defensive about moves past a
// genuinely terminal state so one bad row degrades to a stale thumbnail instead
// of a 500. Legal moves are dead weight on a non-interactive thumbnail, so they
// are stripped from the shipped view.
export function finalXiangqiBoardView(
  board: StoredXiangqiBroadcastBoard,
): StandardXiangqiPlayerView {
  let state = createInitialXiangqiState(board.id);
  for (const move of board.moves) {
    if (state.status.type !== 'playing') break;
    state = applyXiangqiRecordMove(state, move);
  }
  return {
    ...getStandardXiangqiPlayerView(withBroadcastResult(state, board.result), 'red'),
    legalMoves: [],
  };
}

// The one loop that decides whether a stored record is servable. Throws on a
// move the kernel cannot play from where the record stands; the callback sees
// every ply that was.
function replayStoredXiangqiBoard(
  board: StoredXiangqiBroadcastBoard,
  onPly?: (ply: number, color: XiangqiColor, move: XiangqiMove, state: XiangqiGameState) => void,
): XiangqiGameState {
  let state = createInitialXiangqiState(board.id);
  for (const [index, move] of board.moves.entries()) {
    if (state.status.type !== 'playing') {
      throw new Error(`stored broadcast board ${board.id} has moves after terminal state`);
    }
    const color = state.status.turn;
    state = applyXiangqiRecordMove(state, move);
    onPly?.(index + 1, color, move, state);
  }
  return withBroadcastResult(state, board.result);
}

export function buildXiangqiBroadcastBoardReplay(board: StoredXiangqiBroadcastBoard) {
  const timeline: BroadcastMoveTimelineEntry[] = [];
  const truth: BroadcastHistorySnapshot[] = [
    { ply: 0, view: getStandardXiangqiPlayerView(createInitialXiangqiState(board.id), 'red') },
  ];
  const state = replayStoredXiangqiBoard(board, (ply, color, move, next) => {
    timeline.push({ type: 'move-played', color, move, ply });
    truth.push({ ply, view: getStandardXiangqiPlayerView(next, 'red') });
  });
  truth[truth.length - 1] = {
    ply: timeline.length,
    view: getStandardXiangqiPlayerView(state, 'red'),
  };

  return {
    board: {
      id: board.id,
      tourSlug: board.tourSlug,
      roundId: board.roundId,
      sourceBoardId: board.sourceBoardId,
      boardNumber: board.boardNumber,
      red: board.red,
      black: board.black,
      status: board.status,
      result: board.result,
      plyCount: board.plyCount,
      finalStatus: board.finalStatus,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      ...(board.sourceUrl ? { sourceUrl: board.sourceUrl } : {}),
      // A record that reads two ways: the page shows the result and why, no replay.
      ...(board.recordWithheld ? { recordWithheld: board.recordWithheld } : {}),
    },
    state: {
      status: state.status,
      moveNumber: state.moveNumber,
    },
    timeline,
    view: getStandardXiangqiPlayerView(state, 'red'),
    views: {
      truth: getStandardXiangqiPlayerView(state, 'red'),
    },
    history: { truth },
  };
}

// Whether the board API would answer 200 for this row: the replay loop above
// without the per-ply views, so the readout can run it over every stored board
// once a day without building tens of thousands of player views.
export function xiangqiBroadcastBoardServes(board: StoredXiangqiBroadcastBoard): boolean {
  try {
    replayStoredXiangqiBoard(board);
    return true;
  } catch {
    return false;
  }
}

// The readout's whole-corpus sweep. It runs in the serving process, so it
// replays in slices and hands the event loop back between them: on 2026-10-16
// one synchronous filter over ~2,000 boards (~155k plies) held prod's loop for
// 16.4s, freezing every room, clock and request on the box. A slice of 20ms
// keeps the loop-lag p99 well under the 400ms alert while the sweep runs.
const UNSERVABLE_SWEEP_SLICE_MS = 20;

export async function findUnservableXiangqiBroadcastBoards(
  boards: readonly StoredXiangqiBroadcastBoard[],
  options: { serves?: (board: StoredXiangqiBroadcastBoard) => boolean; sliceMs?: number } = {},
): Promise<StoredXiangqiBroadcastBoard[]> {
  const serves = options.serves ?? xiangqiBroadcastBoardServes;
  const sliceMs = options.sliceMs ?? UNSERVABLE_SWEEP_SLICE_MS;
  const unservable: StoredXiangqiBroadcastBoard[] = [];
  let sliceStart = performance.now();
  for (const board of boards) {
    if (performance.now() - sliceStart >= sliceMs) {
      await yieldToEventLoop();
      sliceStart = performance.now();
    }
    if (!serves(board)) unservable.push(board);
  }
  return unservable;
}
