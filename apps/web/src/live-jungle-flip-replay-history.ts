// Per-ply replay history for a FINISHED Flip Jungle room, rebuilt from what the
// room already sent this client (the replayHistory hook in
// variant-tenant/live-client). Same shape as live-banqi-replay-history.ts.
//
// Why only finished: the deal is a server secret, stripped from room-created, so
// a live client cannot replay its event log through the kernel. Once the game is
// over the room serves the truth view instead (roomViewPolicy): every tile on
// the board face up and every capture with its identity. With the public move
// log that recovers the deal (flip-deal-recovery.ts, which also reads Flip
// Jungle's unmarked equal-rank trades both ways); the moves are then replayed
// from it, and the result is used only if the final board and captured pool
// match what the server sent.
//
// HIDDEN-INFO INVARIANT: the inputs are the finished room's truth view and its
// move log, both already on this client. A view whose status is not 'finished'
// returns null before looking at anything, so a live room (seat or spectator)
// keeps the incremental capture path and its masked board unchanged.
//
// Each rebuilt ply is the board as played (face-down tiles stay face-down until
// flipped). The core swaps the last ply for the server's own view, so the final
// position stays fully revealed.

import {
  ALL_JUNGLE_FLIP_SQUARES,
  applyJungleFlipMove,
  createInitialJungleFlipState,
  getJungleFlipPlayerView,
  type JungleFlipDeal,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipSeat,
} from '@mistboard/game';
import { recoverFlipDeals, sameCaptures, sameFlipBoard } from './flip-deal-recovery.js';
import type { JungleFlipWireView } from './live-jungle-flip.js';
import type { TenantReplaySnapshot } from './variant-tenant/replay-controller.js';

export function rebuildFinishedJungleFlipHistory(
  moves: readonly JungleFlipMove[],
  view: JungleFlipWireView,
  perspective: JungleFlipSeat,
): TenantReplaySnapshot<JungleFlipWireView>[] | null {
  if (view.status.type !== 'finished') return null;
  if (moves.length === 0) return null;
  for (const deal of recoverFlipDeals(ALL_JUNGLE_FLIP_SQUARES, moves, view, { trades: true })) {
    const snapshots = replay(deal, moves, view, perspective);
    if (snapshots) return snapshots;
  }
  return null;
}

function replay(
  deal: JungleFlipDeal,
  moves: readonly JungleFlipMove[],
  view: JungleFlipWireView,
  perspective: JungleFlipSeat,
): TenantReplaySnapshot<JungleFlipWireView>[] | null {
  let state: JungleFlipGameState;
  try {
    state = createInitialJungleFlipState(view.id, deal);
  } catch {
    return null; // not a valid piece set
  }
  const snapshots: TenantReplaySnapshot<JungleFlipWireView>[] = [
    { ply: 0, view: projectPly(state, perspective) },
  ];
  for (const move of moves) {
    const next = applyJungleFlipMove(state, move);
    if (next === state) return null; // kernel rejected: keep the captured history
    state = next;
    snapshots.push({ ply: snapshots.length, view: projectPly(state, perspective) });
  }
  if (!sameFlipBoard(state.board, view.board)) return null;
  if (!sameCaptures(state.captures, view.captured)) return null;
  return snapshots;
}

function projectPly(state: JungleFlipGameState, perspective: JungleFlipSeat): JungleFlipWireView {
  return { ...getJungleFlipPlayerView(state, perspective), legalMoves: [] } as JungleFlipWireView;
}
