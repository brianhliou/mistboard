// Per-ply replay history for a FINISHED banqi room, rebuilt from what the room
// already sent this client (the replayHistory hook in variant-tenant/live-client).
//
// Why only finished: the deal is a server secret, stripped from room-created, so
// a live client cannot replay its event log through the kernel. Once the game is
// over the room serves the truth view instead (roomViewPolicy): every tile on
// the board face up, never-flipped ones included, and every capture with its
// identity. With the public move log that recovers the deal
// (flip-deal-recovery.ts); the moves are then replayed from it, and the result
// is used only if the final board and captured pool match what the server sent.
//
// HIDDEN-INFO INVARIANT: the inputs are the finished room's truth view and its
// move log, both already on this client. A view whose status is not 'finished'
// returns null before looking at anything, so a live room (seat or spectator)
// keeps the incremental capture path and its masked board unchanged.
//
// Each rebuilt ply is the board as played (face-down tiles stay face-down until
// flipped), the same projection the room showed live. The core swaps the last
// ply for the server's own view, so the final position stays fully revealed.

import {
  ALL_BANQI_SQUARES,
  applyBanqiMove,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiMove,
  type BanqiSeat,
  banqiRulesFromView,
  createInitialBanqiState,
  getBanqiPlayerView,
} from '@mistboard/game';
import { recoverFlipDeals, sameCaptures, sameFlipBoard } from './flip-deal-recovery.js';
import type { BanqiWireView } from './live-banqi.js';
import type { TenantReplaySnapshot } from './variant-tenant/replay-controller.js';

export function rebuildFinishedBanqiHistory(
  moves: readonly BanqiMove[],
  view: BanqiWireView,
  perspective: BanqiSeat,
): TenantReplaySnapshot<BanqiWireView>[] | null {
  if (view.status.type !== 'finished') return null;
  if (moves.length === 0) return null;
  for (const deal of recoverFlipDeals(ALL_BANQI_SQUARES, moves, view, { trades: false })) {
    const snapshots = replay(deal, moves, view, perspective);
    if (snapshots) return snapshots;
  }
  return null;
}

function replay(
  deal: BanqiDeal,
  moves: readonly BanqiMove[],
  view: BanqiWireView,
  perspective: BanqiSeat,
): TenantReplaySnapshot<BanqiWireView>[] | null {
  let state: BanqiGameState;
  try {
    // The finished view carries the 長捉 rule the game was played under.
    state = createInitialBanqiState(view.id, deal, banqiRulesFromView(view));
  } catch {
    return null; // not a valid piece set
  }
  const snapshots: TenantReplaySnapshot<BanqiWireView>[] = [
    { ply: 0, view: projectPly(state, perspective) },
  ];
  for (const move of moves) {
    const next = applyBanqiMove(state, move);
    if (next === state) return null; // kernel rejected: keep the captured history
    state = next;
    snapshots.push({ ply: snapshots.length, view: projectPly(state, perspective) });
  }
  if (!sameFlipBoard(state.board, view.board)) return null;
  if (!sameCaptures(state.captures, view.captured)) return null;
  return snapshots;
}

function projectPly(state: BanqiGameState, perspective: BanqiSeat): BanqiWireView {
  const { forbiddenMoves: _live, ...view } = getBanqiPlayerView(state, perspective);
  return { ...view, legalMoves: [] } as BanqiWireView;
}
