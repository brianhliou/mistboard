/**
 * Server-side Fairy-Stockfish loop for Fortress Xiangqi PvE.
 *
 * Fortress is perfect-information (7x8 xiangqi + the Treasure + crazyhouse drops
 * + the chasing rule), so it uses FSF directly via a custom variants.ini
 * (fortress-xiangqi.ini). Structurally this mirrors the Drop Mini Xiangqi loop;
 * the only specifics are the UCI translation: a drop {drop,to} maps to
 * "<L>@<to>" (L = R/N/C/P/Q/A/E for chariot/horse/cannon/soldier/treasure/
 * advisor/elephant) and a board move {from,to} to "<from><to>", matching the
 * FSF `fortressxiangqi` coordinates (files a-g, ranks 1-8, red on rank 1).
 *
 * Engine moves are injected through the same append+broadcast path as human
 * moves so clocks, persistence, reconnect, and review stay event-sourced.
 */

import {
  applyFortressXiangqiMove,
  type FORTRESS_XIANGQI_SPEC_ID,
  type FortressXiangqiColor,
  type FortressXiangqiDropRole,
  type FortressXiangqiGameState,
  type FortressXiangqiMove,
  type FortressXiangqiSquare,
  getFortressXiangqiLegalMoves,
  isFortressXiangqiDropMove,
  isFortressXiangqiGeneralInCheck,
  oppositeFortressXiangqiColor,
} from '@mistboard/game';
import {
  buildEngineDecisionRecord,
  reportEngineFallback,
  reportEngineMoveOk,
  resolveValidatedEngineMove,
} from './engine-move-guard.js';
import { budgetForMove } from './engine-time-budget.js';
import {
  FORTRESS_XIANGQI_ENGINE_VERSION,
  fortressXiangqiEngineTierFor,
  fortressXiangqiLiveEngineMove,
  isFortressXiangqiEngineClientId,
} from './fortress-xiangqi-fsf-engine.js';
import { logger } from './obs.js';
import type { UciEval } from './uci-engine-harness.js';
import {
  buildLiveEngineDecisionPayload,
  queueEngineDecision,
} from './variant-tenant/engine-decisions.js';
import type { TenantLifecycleContext } from './variant-tenant/lifecycle.js';
import { tenantClockRemainingMs } from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';
import type { TenantLiveRoom } from './variant-tenant/ws.js';

// Re-export the engine metadata so the tenant, registration, and rooms route
// resolve these from this module (matching the Drop Mini layout).
export {
  FORTRESS_XIANGQI_DEFAULT_ENGINE_ID,
  FORTRESS_XIANGQI_ENGINE_VERSION,
  FORTRESS_XIANGQI_PLAYABLE_ENGINES,
  type FortressXiangqiEngineTier,
  fortressXiangqiEngineDisplayName,
  fortressXiangqiEngineVersion,
  isFortressXiangqiEngineClientId,
} from './fortress-xiangqi-fsf-engine.js';

const CLOCK_SAFETY_MS = 1_000;
const MIN_MOVETIME_MS = 50;
const ENGINE_MOVE_MAX_ATTEMPTS = 2;

const DROP_ROLE_TO_FSF_LETTER: Record<FortressXiangqiDropRole, string> = {
  chariot: 'R',
  horse: 'N',
  cannon: 'C',
  soldier: 'P',
  treasure: 'Q',
  advisor: 'A',
  elephant: 'E',
};
const FSF_LETTER_TO_DROP_ROLE: Record<string, FortressXiangqiDropRole> = {
  R: 'chariot',
  N: 'horse',
  C: 'cannon',
  P: 'soldier',
  Q: 'treasure',
  A: 'advisor',
  E: 'elephant',
};

type FortressXiangqiEngineRoom = TenantLiveRoom<
  'fortress-xiangqi',
  FortressXiangqiColor,
  FortressXiangqiMove,
  FortressXiangqiGameState,
  typeof FORTRESS_XIANGQI_SPEC_ID
>;
type FortressXiangqiEngineContext = TenantLifecycleContext<
  FortressXiangqiColor,
  FortressXiangqiMove,
  FortressXiangqiGameState,
  typeof FORTRESS_XIANGQI_SPEC_ID,
  FortressXiangqiEngineRoom
>;

export function fortressXiangqiEngineSeatFor(
  room: FortressXiangqiEngineRoom,
): FortressXiangqiColor | null {
  for (const seat of ['red', 'black'] as const) {
    if (isFortressXiangqiEngineClientId(room.projection.seats[seat])) return seat;
  }
  return null;
}

export function scheduleFortressXiangqiEngineMove(
  ctx: FortressXiangqiEngineContext,
  room: FortressXiangqiEngineRoom,
): void {
  if (room.engineTimer) return;
  const seat = fortressXiangqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playFortressXiangqiEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        {
          kind: 'fortress_xiangqi_engine_move_failure',
          room_id: room.id,
          error: (err as Error).message,
        },
        'Fortress Xiangqi engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

/**
 * The move provider returns the whole search summary, not just the move, so the
 * decision artifact can record what the engine did. Tests inject a stub.
 */
export type FortressXiangqiEngineMoveProvider = (
  engineId: string,
  moves: string[],
  opts: { movetimeMs?: number },
) => Promise<UciEval>;

export async function playFortressXiangqiEngineMoveIfReady(
  ctx: FortressXiangqiEngineContext,
  room: FortressXiangqiEngineRoom,
  moveProvider: FortressXiangqiEngineMoveProvider = fortressXiangqiLiveEngineMove,
): Promise<void> {
  const seat = fortressXiangqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  const engineId = room.projection.seats[seat]!;
  const tier = fortressXiangqiEngineTierFor(engineId);
  if (!tier) return;

  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  const incrementMs = clock?.incrementMs ?? 0;
  if (remainingMs !== null && remainingMs <= 0) return;

  const history = fortressXiangqiUciHistory(room.events);
  // Clock-aware per-move budget (shared allocator). The tier's NODE budget is the
  // CPU-independent strength anchor and binds first on a healthy clock; this
  // movetime is the latency ceiling + time-pressure guard. Replaces the old naive
  // min(tier.cap, remaining - safety) clamp, which ignored the increment and the
  // clock bank and (with a 2s cap) could bind before the 800k node budget on the
  // slow prod vCPU — see the fortress build-track strength section.
  const { computeBudgetMs: movetimeMs } = budgetForMove({
    remainingMs,
    incrementMs,
    ceilingMs: tier.movetimeMs,
    reserveMs: CLOCK_SAFETY_MS,
    floorMs: MIN_MOVETIME_MS,
  });

  const startedAt = Date.now();
  let lastSearch: UciEval | null = null;
  const {
    chosen: validated,
    attempts,
    aborted,
  } = await resolveValidatedEngineMove({
    maxAttempts: ENGINE_MOVE_MAX_ATTEMPTS,
    requestMove: async () => {
      const search = await moveProvider(engineId, history, { movetimeMs });
      lastSearch = search;
      return search.best;
    },
    validate: (uci) => legalMoveForUci(getFortressXiangqiLegalMoves(room.projection.state), uci),
    stillOnTurn: () => engineToMove(room, seat),
    onReject: ({ attempt, maxAttempts, uci, reason, error }) =>
      logger.warn(
        {
          kind: 'fortress_xiangqi_engine_move_rejected',
          room_id: room.id,
          engine_id: engineId,
          attempt,
          max_attempts: maxAttempts,
          uci,
          reject_reason: reason,
          error,
        },
        'Fortress Xiangqi engine output rejected by kernel; retrying',
      ),
  });
  if (aborted || !engineToMove(room, seat)) return;

  if (validated === null) {
    const record = buildEngineDecisionRecord({
      variant: 'fortress-xiangqi',
      roomId: room.id,
      engineId,
      engineVersion: FORTRESS_XIANGQI_ENGINE_VERSION,
      movetimeMs,
      tier,
      ply: history.length,
      toMove: seat,
      inCheck: isFortressXiangqiGeneralInCheck(room.projection.state, seat),
      history,
      legalUci: getFortressXiangqiLegalMoves(room.projection.state).map(fortressXiangqiMoveToUci),
      attempts,
    });
    reportEngineFallback(record, 'fortress_xiangqi_engine_failed_closed', 'Fortress Xiangqi');
    const resign: TenantRoomEvent<
      FortressXiangqiColor,
      FortressXiangqiMove,
      typeof FORTRESS_XIANGQI_SPEC_ID
    > = { type: 'seat-resigned', at: Date.now(), roomId: room.id, color: seat };
    const seq = await ctx.appendEvent(room, resign);
    ctx.broadcastEventAppended(room, resign, seq);
    return;
  }

  reportEngineMoveOk();
  let chosen: FortressXiangqiMove = validated;
  const legalMoves = getFortressXiangqiLegalMoves(room.projection.state);
  const guarded = guardFortressXiangqiEngineMove(room.projection.state, chosen, legalMoves);
  if (guarded !== chosen) {
    logger.warn(
      {
        kind: 'fortress_xiangqi_engine_immediate_loss_guard',
        room_id: room.id,
        engine_id: engineId,
        move: fortressXiangqiMoveToUci(chosen),
        replacement_move: fortressXiangqiMoveToUci(guarded),
      },
      'Fortress Xiangqi engine immediate-loss guard replaced an avoidable losing move',
    );
    chosen = guarded;
  }

  const event: TenantRoomEvent<
    FortressXiangqiColor,
    FortressXiangqiMove,
    typeof FORTRESS_XIANGQI_SPEC_ID
  > = {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: seat,
    move: chosen,
  };
  // Queue BEFORE the append: if this move mates, the tenant event writer records
  // the game end and flushes the queue inside that same append, and a decision
  // queued afterwards would never be written.
  queueEngineDecision(
    room,
    buildLiveEngineDecisionPayload({
      variant: 'fortress-xiangqi',
      roomId: room.id,
      engineId,
      engineVersion: FORTRESS_XIANGQI_ENGINE_VERSION,
      seat,
      ply: history.length,
      budgetMs: movetimeMs,
      remainingMs,
      incrementMs,
      tier,
      search: lastSearch,
      thinkTimeMs: Date.now() - startedAt,
      attempts,
      move: fortressXiangqiMoveToUci(chosen),
      legalCount: legalMoves.length,
      guardReplaced: guarded !== validated,
    }),
  );
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}

function bothSeatsFilled(room: FortressXiangqiEngineRoom): boolean {
  return Boolean(room.projection.seats.red && room.projection.seats.black);
}

function engineToMove(room: FortressXiangqiEngineRoom, seat: FortressXiangqiColor): boolean {
  const status = room.projection.state.status;
  return status.type === 'playing' && status.turn === seat && bothSeatsFilled(room);
}

function fortressXiangqiUciHistory(
  events: readonly TenantRoomEvent<
    FortressXiangqiColor,
    FortressXiangqiMove,
    typeof FORTRESS_XIANGQI_SPEC_ID
  >[],
): string[] {
  return events
    .filter(
      (
        event,
      ): event is Extract<
        TenantRoomEvent<FortressXiangqiColor, FortressXiangqiMove, typeof FORTRESS_XIANGQI_SPEC_ID>,
        { type: 'move-played' }
      > => event.type === 'move-played',
    )
    .map((event) => fortressXiangqiMoveToUci(event.move));
}

export function fortressXiangqiMoveToUci(move: FortressXiangqiMove): string {
  if (isFortressXiangqiDropMove(move)) {
    return `${DROP_ROLE_TO_FSF_LETTER[move.drop]}@${move.to}`;
  }
  return `${move.from}${move.to}`;
}

export function legalMoveForUci(
  legalMoves: readonly FortressXiangqiMove[],
  uci: string,
): FortressXiangqiMove | null {
  const drop = uci.match(/^([RNCPQAE])@([a-g][1-8])$/);
  if (drop) {
    const role = FSF_LETTER_TO_DROP_ROLE[drop[1]!];
    const to = drop[2] as FortressXiangqiSquare;
    return (
      legalMoves.find(
        (move) => isFortressXiangqiDropMove(move) && move.drop === role && move.to === to,
      ) ?? null
    );
  }
  const board = uci.match(/^([a-g][1-8])([a-g][1-8])$/);
  if (board) {
    const from = board[1] as FortressXiangqiSquare;
    const to = board[2] as FortressXiangqiSquare;
    return (
      legalMoves.find(
        (move) => !isFortressXiangqiDropMove(move) && move.from === from && move.to === to,
      ) ?? null
    );
  }
  return null;
}

/**
 * Replace a move that lets the opponent win on the immediate reply with any legal
 * move that does not — a cheap king-safety backstop matching the Drop Mini loop.
 */
export function guardFortressXiangqiEngineMove(
  state: FortressXiangqiGameState,
  chosen: FortressXiangqiMove,
  legalMoves: readonly FortressXiangqiMove[],
): FortressXiangqiMove {
  if (!allowsImmediateOpponentWin(state, chosen)) return chosen;
  return legalMoves.find((move) => !allowsImmediateOpponentWin(state, move)) ?? chosen;
}

function allowsImmediateOpponentWin(
  state: FortressXiangqiGameState,
  move: FortressXiangqiMove,
): boolean {
  if (state.status.type !== 'playing') return false;
  const mover = state.status.turn;
  const opponent = oppositeFortressXiangqiColor(mover);
  const after = applyFortressXiangqiMove(state, move);
  if (after.status.type !== 'playing') return false;
  return getFortressXiangqiLegalMoves(after).some((reply) => {
    const afterReply = applyFortressXiangqiMove(after, reply);
    return afterReply.status.type === 'finished' && afterReply.status.winner === opponent;
  });
}
