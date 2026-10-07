// Per-ply replay history for a FINISHED jieqi room, rebuilt from what the room
// already sent this client (the replayHistory hook in variant-tenant/live-client).
//
// Why only finished: the deal is a server secret, stripped from room-created, so
// a live client cannot replay its own event log through the kernel. Once the
// game is over the room serves the truth view instead (roomViewPolicy): every
// piece on the board with its real role, and every captured piece with its role.
// That is enough to recover the deal. Follow each starting piece through the
// public move list to where it ended up, on a square or in the n-th capture, and
// read its role off the truth view. Then replay the moves from that deal and
// check that the final board matches what the server sent, so a recovery that
// went wrong anywhere is dropped (the core keeps the captured history).
//
// HIDDEN-INFO INVARIANT: the input is the finished room's truth view and its
// move log, both already on this client. A view whose status is not 'finished'
// returns null without looking at anything, so a live room (and its masked
// per-seat or spectator view) keeps the incremental capture path unchanged.
//
// Each rebuilt ply is the board as played (face-down pieces stay face-down until
// they move, the same projection the review page uses), with the captured pool
// from the truth, which a finished room shows in full anyway. The core swaps
// the last ply for the server's own view, so the final position stays the
// fully revealed board.

import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiPlayerView,
  type JieqiColor,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPieceRole,
  type JieqiSquare,
  jieqiHomeSquares,
  jieqiTruthBoard,
  jieqiTruthCaptures,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import type { JieqiWireView } from './live-jieqi.js';
import type { TenantReplaySnapshot } from './variant-tenant/replay-controller.js';

const COLORS: readonly JieqiColor[] = ['red', 'black'];

export function rebuildFinishedJieqiHistory(
  moves: readonly JieqiMove[],
  view: JieqiWireView,
  perspective: JieqiColor,
): TenantReplaySnapshot<JieqiWireView>[] | null {
  if (view.status.type !== 'finished') return null;
  if (moves.length === 0) return null;
  const deal = recoverJieqiDealFromFinish(moves, view);
  if (!deal) return null;
  let state: JieqiGameState;
  try {
    state = createInitialJieqiState(view.id, deal);
  } catch {
    return null;
  }
  const snapshots: TenantReplaySnapshot<JieqiWireView>[] = [
    { ply: 0, view: projectPly(state, perspective) },
  ];
  for (const move of moves) {
    const next = applyJieqiMove(state, move);
    if (next === state) return null; // kernel rejected: keep the captured history
    state = next;
    snapshots.push({ ply: snapshots.length, view: projectPly(state, perspective) });
  }
  if (!sameBoard(jieqiTruthBoard(state), view.board)) return null;
  return snapshots;
}

function projectPly(state: JieqiGameState, perspective: JieqiColor): JieqiWireView {
  return {
    ...getJieqiPlayerView(state, perspective),
    captured: jieqiTruthCaptures(state),
    legalMoves: [],
  } as JieqiWireView;
}

/**
 * The deal, from a finished room's truth view and its move list. Null when the
 * two do not fit together (a square the moves leave empty is occupied, a capture
 * count or owner disagrees, a face-down piece that is not marked unknown).
 */
export function recoverJieqiDealFromFinish(
  moves: readonly JieqiMove[],
  view: Pick<JieqiWireView, 'board' | 'captured'>,
): JieqiDeal | null {
  // Every piece is named by the square it started on.
  const start = createInitialJieqiState('deal-recovery').board;
  const originAt = new Map<JieqiSquare, JieqiSquare>();
  for (const square of Object.keys(start) as JieqiSquare[]) originAt.set(square, square);
  const capturedOrigins: JieqiSquare[] = [];
  for (const move of moves) {
    const origin = originAt.get(move.from);
    if (!origin) return null;
    const victim = originAt.get(move.to);
    if (victim) capturedOrigins.push(victim);
    originAt.delete(move.from);
    originAt.set(move.to, origin);
  }
  if (capturedOrigins.length !== view.captured.length) return null;
  if (Object.keys(view.board).length !== originAt.size) return null;

  // null = an imported game's never-determined piece.
  const roleOf = new Map<JieqiSquare, JieqiPieceRole | null>();
  for (const [square, origin] of originAt) {
    const entry = view.board[square];
    if (!entry || entry.color !== start[origin]?.color) return null;
    if (entry.faceDown) {
      if ((entry as { unknown?: unknown }).unknown !== true) return null;
      roleOf.set(origin, null);
    } else {
      roleOf.set(origin, entry.role);
    }
  }
  for (const [index, origin] of capturedOrigins.entries()) {
    const captured = view.captured[index];
    if (!captured || captured.owner !== start[origin]?.color) return null;
    roleOf.set(origin, captured.role);
  }

  const deal: JieqiDeal = { red: [], black: [] };
  const undetermined: Record<JieqiColor, JieqiSquare[]> = { red: [], black: [] };
  for (const color of COLORS) {
    const squares = jieqiHomeSquares(color);
    const roles = squares.map((square) => roleOf.get(square));
    if (roles.some((role) => role === undefined)) return null;
    // A never-determined piece takes a placeholder from what the set has left;
    // the deal lists it as undetermined, so every truth view keeps it unknown.
    const left = [...STANDARD_JIEQI_DEAL[color]];
    for (const role of roles) {
      if (!role) continue;
      const index = left.indexOf(role);
      if (index < 0) return null;
      left.splice(index, 1);
    }
    deal[color] = roles.map((role, index) => {
      if (role) return role;
      undetermined[color].push(squares[index]!);
      return left.shift()!;
    });
  }
  if (undetermined.red.length + undetermined.black.length > 0) deal.undetermined = undetermined;
  return deal;
}

function sameBoard(a: JieqiWireView['board'], b: JieqiWireView['board']): boolean {
  const squares = Object.keys(a) as JieqiSquare[];
  if (squares.length !== Object.keys(b).length) return false;
  return squares.every((square) => {
    const left = a[square];
    const right = b[square];
    if (!left || !right) return false;
    if (left.color !== right.color || left.faceDown !== right.faceDown) return false;
    return left.faceDown || right.faceDown || left.role === right.role;
  });
}
