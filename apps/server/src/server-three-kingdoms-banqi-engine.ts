// The Three Kingdoms banqi PvE turn (hidden playtest, #628, #684): when the engine's
// seat is to move, ask the Rust engine for a move on the REDACTED position and
// append it as an ordinary move-played event. Modeled on server-banqi-engine.ts.
//
// The request is built from public facts only: the state after the last flip or
// capture (its public FEN plus the covered pool, which is start counts minus
// what is face up or captured) and the quiet moves since. Repetition and the
// 長捉 rule restart at every flip or capture, so that window is everything the
// engine needs to see the position's history. three-kingdoms-banqi-hidden-info.test.ts
// swaps two face-down tiles and asserts the request does not change.

import {
  type BanqiSeat,
  getThreeKingdomsBanqiForbiddenChaseMoves,
  getThreeKingdomsBanqiLegalMoves,
  isThreeKingdomsBanqiLegalMove,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiState,
  threeKingdomsBanqiStateToEngineFen,
} from '@mistboard/game';
import { resolveValidatedEngineMove } from './engine-move-guard.js';
import { budgetForMove } from './engine-time-budget.js';
import { logger } from './obs.js';
import {
  isThreeKingdomsBanqiEngineClientId,
  THREE_KINGDOMS_BANQI_ENGINE_MOVETIME_CAP_MS,
  THREE_KINGDOMS_BANQI_ENGINE_NODES,
  type ThreeKingdomsBanqiEngineProvider,
  type ThreeKingdomsBanqiEngineRequest,
  threeKingdomsBanqiLiveEngineMove,
} from './three-kingdoms-banqi-engine.js';
import {
  isThreeKingdomsBanqiSquare,
  type ThreeKingdomsBanqiEvent,
  type ThreeKingdomsBanqiSpecId,
  threeKingdomsBanqiTenant,
} from './three-kingdoms-banqi-tenant.js';
import type { TenantLifecycleContext } from './variant-tenant/lifecycle.js';
import { replayTenantEvents, tenantClockRemainingMs } from './variant-tenant/runtime.js';
import type { TenantLiveRoom } from './variant-tenant/ws.js';

const CLOCK_SAFETY_MS = 1_000;
const MIN_MOVETIME_MS = 50;
const ENGINE_MOVE_MAX_ATTEMPTS = 2;

export type ThreeKingdomsBanqiEngineRoom = TenantLiveRoom<
  'three-kingdoms-banqi',
  BanqiSeat,
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiState,
  ThreeKingdomsBanqiSpecId
>;
type EngineContext = TenantLifecycleContext<
  BanqiSeat,
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiState,
  ThreeKingdomsBanqiSpecId,
  ThreeKingdomsBanqiEngineRoom
>;

export const threeKingdomsBanqiMoveToUci = (move: ThreeKingdomsBanqiMove): string =>
  `${move.from}${move.to}`;

export function uciToThreeKingdomsBanqiMove(uci: string): ThreeKingdomsBanqiMove | null {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  if (uci.length !== 4 || !isThreeKingdomsBanqiSquare(from) || !isThreeKingdomsBanqiSquare(to)) {
    return null;
  }
  return { from, to };
}

export function threeKingdomsBanqiEngineSeatFor(
  room: Pick<ThreeKingdomsBanqiEngineRoom, 'projection'>,
): BanqiSeat | null {
  for (const seat of ['red', 'black'] as const) {
    if (isThreeKingdomsBanqiEngineClientId(room.projection.seats[seat])) return seat;
  }
  return null;
}

function engineToMove(room: ThreeKingdomsBanqiEngineRoom, seat: BanqiSeat): boolean {
  const { projection } = room;
  const status = projection.state.status;
  if (projection.paused) return false;
  return (
    status.type === 'playing' &&
    status.turn === seat &&
    Boolean(projection.seats.red && projection.seats.black)
  );
}

/**
 * The engine request for the room's current position, from the event log. The
 * FEN is the state after the last flip or capture; the moves are the quiet plies
 * since (noProgressClock counts exactly those). No face-down identity is read.
 */
export function threeKingdomsBanqiEngineRequestFor(
  events: readonly ThreeKingdomsBanqiEvent[],
  state: ThreeKingdomsBanqiState,
  budget: { nodes: number; movetimeCapMs: number },
): ThreeKingdomsBanqiEngineRequest {
  const moveEvents = events.filter(
    (e): e is Extract<ThreeKingdomsBanqiEvent, { type: 'move-played' }> => e.type === 'move-played',
  );
  const k = state.noProgressClock;
  let fen = threeKingdomsBanqiStateToEngineFen(state);
  let moves: string[] = [];
  if (k > 0 && k < moveEvents.length) {
    const cutoff = events.indexOf(moveEvents[moveEvents.length - k]!);
    const windowStart = replayTenantEvents(threeKingdomsBanqiTenant, events.slice(0, cutoff)).state;
    fen = threeKingdomsBanqiStateToEngineFen(windowStart);
    moves = moveEvents.slice(moveEvents.length - k).map((e) => threeKingdomsBanqiMoveToUci(e.move));
  }
  // The 長捉 rule can forbid a move the engine would otherwise pick; restrict
  // its root to the kernel's legal moves whenever that happens.
  const forbidden = getThreeKingdomsBanqiForbiddenChaseMoves(state);
  const searchMoves =
    forbidden.length > 0
      ? getThreeKingdomsBanqiLegalMoves(state).map(threeKingdomsBanqiMoveToUci)
      : undefined;
  return { fen, moves, ...(searchMoves ? { searchMoves } : {}), ...budget };
}

export function scheduleThreeKingdomsBanqiEngineMove(
  ctx: EngineContext,
  room: ThreeKingdomsBanqiEngineRoom,
): void {
  if (room.engineTimer) return;
  const seat = threeKingdomsBanqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playThreeKingdomsBanqiEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        {
          kind: 'three_kingdoms_banqi_engine_move_failure',
          room_id: room.id,
          error: (err as Error).message,
        },
        'Three Kingdoms banqi engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

export async function playThreeKingdomsBanqiEngineMoveIfReady(
  ctx: EngineContext,
  room: ThreeKingdomsBanqiEngineRoom,
  moveProvider: ThreeKingdomsBanqiEngineProvider = threeKingdomsBanqiLiveEngineMove,
): Promise<void> {
  const seat = threeKingdomsBanqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  if (remainingMs !== null && remainingMs <= 0) return;
  const { computeBudgetMs: movetimeCapMs } = budgetForMove({
    remainingMs,
    incrementMs: clock?.incrementMs ?? 0,
    ceilingMs: THREE_KINGDOMS_BANQI_ENGINE_MOVETIME_CAP_MS,
    reserveMs: CLOCK_SAFETY_MS,
    floorMs: MIN_MOVETIME_MS,
  });
  const state = room.projection.state;
  const request = threeKingdomsBanqiEngineRequestFor(
    room.events as readonly ThreeKingdomsBanqiEvent[],
    state,
    { nodes: THREE_KINGDOMS_BANQI_ENGINE_NODES, movetimeCapMs },
  );
  const { chosen, aborted } = await resolveValidatedEngineMove<ThreeKingdomsBanqiMove>({
    maxAttempts: ENGINE_MOVE_MAX_ATTEMPTS,
    requestMove: async () => (await moveProvider(request)).best,
    validate: (uci) => {
      const parsed = uciToThreeKingdomsBanqiMove(uci);
      return parsed && isThreeKingdomsBanqiLegalMove(room.projection.state, parsed) ? parsed : null;
    },
    stillOnTurn: () => engineToMove(room, seat),
    onReject: ({ attempt, uci, reason, error }) =>
      logger.warn(
        {
          kind: 'three_kingdoms_banqi_engine_move_rejected',
          room_id: room.id,
          attempt,
          uci,
          reject_reason: reason,
          error,
        },
        'Three Kingdoms banqi engine output rejected by kernel; retrying',
      ),
  });
  if (aborted || !engineToMove(room, seat)) return;
  // A playtest bot that cannot answer resigns, as banqi's does (fail closed):
  // a silent random move would hide an engine/kernel disagreement.
  const event: ThreeKingdomsBanqiEvent =
    chosen === null
      ? { type: 'seat-resigned', at: Date.now(), roomId: room.id, color: seat }
      : { type: 'move-played', at: Date.now(), roomId: room.id, color: seat, move: chosen };
  if (chosen === null) {
    logger.warn(
      { kind: 'three_kingdoms_banqi_engine_failed_closed', room_id: room.id, fen: request.fen },
      'Three Kingdoms banqi engine gave no legal move; resigning its seat',
    );
  }
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}
