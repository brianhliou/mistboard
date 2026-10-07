// Per-ply replay history for a FINISHED Fog Xiangqi room, rebuilt from what the
// room already sent this client (the replayHistory hook in
// variant-tenant/live-client).
//
// Why only finished: a live seat's move log is redacted (opponent moves it could
// not see arrive without their squares) and a spectator sees an empty board, so
// a live client has nothing to replay and must not be shown more than the
// server sent. Once the game is over the room reveals the truth (roomViewPolicy):
// the unredacted move log and a board with every piece unshrouded. Fog Xiangqi
// starts from the standard xiangqi position, so those moves replay through the
// kernel from the start, and the result is used only if the final board matches
// the one the server sent.
//
// HIDDEN-INFO INVARIANT: the inputs are the finished room's truth view and its
// move log, both already on this client. A view that is not finished, or whose
// board still carries a shrouded entry, returns null before replaying anything,
// so a live seat keeps its fog view and a live spectator its empty board.
//
// Each rebuilt ply is the TRUTH board at that ply (no fog), the same view the
// finished room itself shows. The core swaps the last ply for the server's own
// view.

import {
  applyMove,
  createInitialXiangqiState,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPieceRole,
  type XiangqiSquare,
} from '@mistboard/game';
import type { DarkXiangqiWireView } from './live-dark-xiangqi.js';
import type { TenantReplaySnapshot } from './variant-tenant/replay-controller.js';

const ALL_SQUARES: XiangqiSquare[] = Array.from({ length: 90 }, (_, index) => {
  const file = 'abcdefghi'[index % 9]!;
  const rank = Math.floor(index / 9) + 1;
  return `${file}${rank}` as XiangqiSquare;
});

type Captures = DarkXiangqiWireView['captures'];

export function rebuildFinishedDarkXiangqiHistory(
  moves: readonly XiangqiMove[],
  view: DarkXiangqiWireView,
): TenantReplaySnapshot<DarkXiangqiWireView>[] | null {
  if (view.status.type !== 'finished') return null;
  if (moves.length === 0) return null;
  // The truth view only: any shrouded entry means this is a fog view.
  if (Object.values(view.board).some((entry) => entry.shrouded)) return null;

  let state: XiangqiGameState = createInitialXiangqiState(view.id);
  let captures: Captures = { red: [], black: [] };
  const snapshots: TenantReplaySnapshot<DarkXiangqiWireView>[] = [
    { ply: 0, view: projectPly(state, captures, view) },
  ];
  for (const move of moves) {
    const victim = state.board[move.to];
    const next = applyMove(state, move);
    if (next === state) return null; // kernel rejected: keep the captured history
    if (victim) captures = withCapture(captures, victim.color, victim.role);
    state = next;
    snapshots.push({ ply: snapshots.length, view: projectPly(state, captures, view) });
  }
  if (!sameBoard(state, view)) return null;
  return snapshots;
}

function withCapture(captures: Captures, color: XiangqiColor, role: XiangqiPieceRole): Captures {
  return { ...captures, [color]: [...captures[color], role] };
}

function projectPly(
  state: XiangqiGameState,
  captures: Captures,
  served: DarkXiangqiWireView,
): DarkXiangqiWireView {
  const board: DarkXiangqiWireView['board'] = {};
  for (const [square, piece] of Object.entries(state.board)) {
    if (piece) board[square as XiangqiSquare] = { piece, shrouded: false };
  }
  return {
    id: served.id,
    perspective: served.perspective,
    board,
    visibleSquares: ALL_SQUARES,
    legalMoves: [],
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
    captures,
  };
}

function sameBoard(state: XiangqiGameState, view: DarkXiangqiWireView): boolean {
  for (const square of ALL_SQUARES) {
    const piece = state.board[square];
    const entry = view.board[square];
    if (!piece || !entry) {
      if (piece || entry) return false;
      continue;
    }
    if (entry.shrouded) return false;
    if (entry.piece.color !== piece.color || entry.piece.role !== piece.role) return false;
  }
  return true;
}
