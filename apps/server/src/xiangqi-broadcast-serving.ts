import {
  ARBITER_ADJUDICATED_DRAWS,
  applyStandardXiangqiMove,
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

// A stored board is a tournament RECORD, not live play: the kernel auto-draws
// on repetition and on the progress clock, but an arbiter applies the
// perpetual-check/chase rules instead and the real game runs on. Ingestion
// already replays past those two reasons (`continuePastAdjudicatedDraw`), so
// the rows hold the full game; the serving side has to resume the same way or
// a legitimate record reads as "moves after terminal state". Mirrors
// `replayXiangqiBroadcastBoard` in the game package and the web replay, which
// both resume on the ply's mover.
export function resumePastArbiterDraw(state: XiangqiGameState, index: number): XiangqiGameState {
  if (state.status.type !== 'finished' || !ARBITER_ADJUDICATED_DRAWS.has(state.status.reason)) {
    return state;
  }
  return { ...state, status: { type: 'playing', turn: index % 2 === 0 ? 'red' : 'black' } };
}

// Replay a stored board to its final position. Defensive about moves past a
// genuinely terminal state so one bad row degrades to a stale thumbnail instead
// of a 500. Legal moves are dead weight on a non-interactive thumbnail, so they
// are stripped from the shipped view.
export function finalXiangqiBoardView(
  board: StoredXiangqiBroadcastBoard,
): StandardXiangqiPlayerView {
  let state = createInitialXiangqiState(board.id);
  for (const [index, move] of board.moves.entries()) {
    state = resumePastArbiterDraw(state, index);
    if (state.status.type !== 'playing') break;
    state = applyStandardXiangqiMove(state, move);
  }
  return { ...getStandardXiangqiPlayerView(state, 'red'), legalMoves: [] };
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
    state = resumePastArbiterDraw(state, index);
    if (state.status.type !== 'playing') {
      throw new Error(`stored broadcast board ${board.id} has moves after terminal state`);
    }
    const color = state.status.turn;
    state = applyStandardXiangqiMove(state, move);
    onPly?.(index + 1, color, move, state);
  }
  return state;
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
