// Per-ply replay history for a jieqi room, rebuilt from what the room already
// sent this client (the replayHistory hook in variant-tenant/live-client), so a
// cold join or reload can step back through every ply.
//
// LIVE rooms (rebuildLiveJieqiHistory, #523): the deal is a server secret,
// stripped from room-created, but this client does not need it. Every piece
// that has moved is face-up on the served board or sits in the captured list
// with its role (a moved piece is revealed, so its capture is public), and every
// piece that has never moved is still on its home square. The only roles the
// served view lacks are the ones this viewer never knew: a face-down piece on
// the board, or a dark capture made by the other side. Those enter the deal as
// undetermined placeholders, and the per-ply projection (getJieqiPlayerView for
// the seat, getJieqiPublicView for a spectator) masks exactly those, so no ply
// shows a role the served view did not. The final ply must reproduce the served
// board AND captured list, or the rebuild is dropped.
//
// FINISHED rooms (rebuildFinishedJieqiHistory): once the game is over the room serves the truth view instead (roomViewPolicy): every
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
  getJieqiPublicView,
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

/**
 * Per-ply history for a LIVE room from the viewer's own served view and the
 * public move list. `seat` is the viewer's colour, or null for a spectator.
 * Null when the room is not being played or the view and moves do not fit.
 */
export function rebuildLiveJieqiHistory(
  moves: readonly JieqiMove[],
  view: JieqiWireView,
  seat: JieqiColor | null,
): TenantReplaySnapshot<JieqiWireView>[] | null {
  if (view.status.type !== 'playing') return null;
  if (moves.length === 0) return null;
  const deal = recoverJieqiDeal(moves, view, 'live');
  if (!deal) return null;
  let state: JieqiGameState;
  try {
    state = createInitialJieqiState(view.id, deal);
  } catch {
    return null;
  }
  const project = (at: JieqiGameState): JieqiWireView =>
    (seat
      ? { ...getJieqiPlayerView(at, seat), legalMoves: [] }
      : getJieqiPublicView(at)) as JieqiWireView;
  const snapshots: TenantReplaySnapshot<JieqiWireView>[] = [{ ply: 0, view: project(state) }];
  for (const move of moves) {
    const next = applyJieqiMove(state, move);
    if (next === state) return null;
    state = next;
    snapshots.push({ ply: snapshots.length, view: project(state) });
  }
  const last = snapshots[snapshots.length - 1]!.view;
  if (!sameBoard(last.board, view.board)) return null;
  if (!sameCaptures(last.captured, view.captured)) return null;
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
  return recoverJieqiDeal(moves, view, 'finished');
}

/**
 * The deal as far as `view` knows it. 'finished' reads a truth view, where only
 * a never-determined piece is face-down (marked unknown). 'live' reads a served
 * masked view: a face-down piece is one that has not moved (it must still be on
 * its home square) and its role is unknown to this viewer, as is a dark capture
 * listed with role null. Unknown roles become undetermined placeholders.
 */
function recoverJieqiDeal(
  moves: readonly JieqiMove[],
  view: Pick<JieqiWireView, 'board' | 'captured'>,
  source: 'finished' | 'live',
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
      if (source === 'live' ? origin !== square : (entry as { unknown?: unknown }).unknown !== true)
        return null;
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

function sameCaptures(a: JieqiWireView['captured'], b: JieqiWireView['captured']): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, index) => {
    const other = b[index];
    return !!other && entry.owner === other.owner && (entry.role ?? null) === (other.role ?? null);
  });
}
