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
// FINISHED rooms take the same path (Brian, 2026-10-16): a finished room keeps
// serving each seat its own view and a spectator the public one, never the deal,
// because a piece captured face-down stays known only to its capturer after the
// game too. So a finished rebuild knows exactly what the live one knew, and every
// ply masks the same roles.
//
// HIDDEN-INFO INVARIANT: the input is the view this client was served and the
// public move list; nothing here can name a role the view did not.

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
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import type { JieqiWireView } from './live-jieqi.js';
import type { TenantReplaySnapshot } from './variant-tenant/replay-controller.js';

const COLORS: readonly JieqiColor[] = ['red', 'black'];

/**
 * Per-ply history for a live room, playing or finished, from the viewer's own
 * served view and the public move list. `seat` is the viewer's colour, or null
 * for a spectator. Null when the room is neither playing nor finished, or the
 * view and moves do not fit.
 */
export function rebuildLiveJieqiHistory(
  moves: readonly JieqiMove[],
  view: JieqiWireView,
  seat: JieqiColor | null,
): TenantReplaySnapshot<JieqiWireView>[] | null {
  if (view.status.type !== 'playing' && view.status.type !== 'finished') return null;
  if (moves.length === 0) return null;
  const deal = recoverJieqiDeal(moves, view);
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

/**
 * The deal as far as `view` knows it. A face-down piece is one that has not
 * moved (it must still be on its home square) and its role is unknown to this
 * viewer, as is a dark capture listed with role null. Unknown roles become
 * undetermined placeholders.
 */
function recoverJieqiDeal(
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

  // null = a role this viewer does not know.
  const roleOf = new Map<JieqiSquare, JieqiPieceRole | null>();
  for (const [square, origin] of originAt) {
    const entry = view.board[square];
    if (!entry || entry.color !== start[origin]?.color) return null;
    if (entry.faceDown) {
      if (origin !== square) return null;
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
