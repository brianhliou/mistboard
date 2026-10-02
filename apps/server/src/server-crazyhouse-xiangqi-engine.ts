/**
 * Server-side Fairy-Stockfish loop for Crazyhouse Xiangqi PvE.
 *
 * Perfect information, so the engine gets the whole move list from the start
 * position (crazyhouse-xiangqi-fsf-engine.ts, stock FSF + crazyhouse-xiangqi.ini).
 * The UCI spelling is the kernel's own (crazyhouseXiangqiMoveToUci): a board
 * move `<from><to>`, a drop `<L>@<to>` with L in R N B A C P, which is how
 * Fairy-Stockfish writes them for this variant.
 *
 * Structurally the Fortress Xiangqi loop: kernel validation of the engine's
 * output with one retry, resign on a fail-closed engine, then the
 * immediate-loss guard, then the per-move decision artifact. Engine moves are
 * injected through the same append+broadcast path as human moves so clocks,
 * persistence, reconnect and review stay event-sourced.
 */

import {
  applyCrazyhouseXiangqiMove,
  type CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  crazyhouseXiangqiMoveFromUci,
  crazyhouseXiangqiMoveToUci,
  getCrazyhouseXiangqiLegalMoves,
  isCrazyhouseXiangqiDropMove,
  isCrazyhouseXiangqiGeneralInCheck,
  oppositeCrazyhouseXiangqiColor,
} from '@mistboard/game';
import {
  CRAZYHOUSE_XIANGQI_FSF_ENGINE_VERSION,
  crazyhouseXiangqiEngineTierFor,
  crazyhouseXiangqiLiveEngineMove,
  isCrazyhouseXiangqiEngineClientId,
} from './crazyhouse-xiangqi-fsf-engine.js';
import {
  buildEngineDecisionRecord,
  reportEngineFallback,
  reportEngineMoveOk,
  resolveValidatedEngineMove,
} from './engine-move-guard.js';
import { budgetForMove } from './engine-time-budget.js';
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

export {
  CRAZYHOUSE_XIANGQI_DEFAULT_ENGINE_ID,
  CRAZYHOUSE_XIANGQI_FSF_ENGINE_VERSION,
  CRAZYHOUSE_XIANGQI_PLAYABLE_ENGINES,
  type CrazyhouseXiangqiEngineTier,
  crazyhouseXiangqiEngineDisplayName,
  crazyhouseXiangqiEngineVersion,
  isCrazyhouseXiangqiEngineClientId,
} from './crazyhouse-xiangqi-fsf-engine.js';

const CLOCK_SAFETY_MS = 1_000;
const MIN_MOVETIME_MS = 50;
const ENGINE_MOVE_MAX_ATTEMPTS = 2;
// The guard looks one reply deep over every legal move, and a position here can
// hold a few hundred (every empty point times every role in hand). Searching
// for a replacement stops at this budget and keeps the engine's move, so a
// position where nearly everything loses never costs the bot its clock.
const GUARD_REPLACEMENT_BUDGET_MS = 750;

type CrazyhouseXiangqiEvent = TenantRoomEvent<
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiMove,
  typeof CRAZYHOUSE_XIANGQI_SPEC_ID
>;

type CrazyhouseXiangqiEngineRoom = TenantLiveRoom<
  'crazyhouse-xiangqi',
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState,
  typeof CRAZYHOUSE_XIANGQI_SPEC_ID
>;
type CrazyhouseXiangqiEngineContext = TenantLifecycleContext<
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState,
  typeof CRAZYHOUSE_XIANGQI_SPEC_ID,
  CrazyhouseXiangqiEngineRoom
>;

export function crazyhouseXiangqiEngineSeatFor(
  room: CrazyhouseXiangqiEngineRoom,
): CrazyhouseXiangqiColor | null {
  for (const seat of ['red', 'black'] as const) {
    if (isCrazyhouseXiangqiEngineClientId(room.projection.seats[seat])) return seat;
  }
  return null;
}

export function scheduleCrazyhouseXiangqiEngineMove(
  ctx: CrazyhouseXiangqiEngineContext,
  room: CrazyhouseXiangqiEngineRoom,
): void {
  if (room.engineTimer) return;
  const seat = crazyhouseXiangqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playCrazyhouseXiangqiEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        {
          kind: 'crazyhouse_xiangqi_engine_move_failure',
          room_id: room.id,
          error: (err as Error).message,
        },
        'Crazyhouse Xiangqi engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

/**
 * The move provider returns the whole search summary, not just the move, so the
 * decision artifact can record what the engine did. Tests inject a stub.
 */
export type CrazyhouseXiangqiEngineMoveProvider = (
  engineId: string,
  moves: string[],
  opts: { movetimeMs?: number },
) => Promise<UciEval>;

export async function playCrazyhouseXiangqiEngineMoveIfReady(
  ctx: CrazyhouseXiangqiEngineContext,
  room: CrazyhouseXiangqiEngineRoom,
  moveProvider: CrazyhouseXiangqiEngineMoveProvider = crazyhouseXiangqiLiveEngineMove,
): Promise<void> {
  const seat = crazyhouseXiangqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  const engineId = room.projection.seats[seat]!;
  const tier = crazyhouseXiangqiEngineTierFor(engineId);
  if (!tier) return;

  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  const incrementMs = clock?.incrementMs ?? 0;
  if (remainingMs !== null && remainingMs <= 0) return;

  const history = crazyhouseXiangqiUciHistory(room.events);
  // Clock-aware per-move budget (shared allocator). The tier's NODE budget is the
  // CPU-independent strength anchor and binds first on a healthy clock; this
  // movetime is the latency ceiling + time-pressure guard.
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
    validate: (uci) => legalMoveForUci(getCrazyhouseXiangqiLegalMoves(room.projection.state), uci),
    stillOnTurn: () => engineToMove(room, seat),
    onReject: ({ attempt, maxAttempts, uci, reason, error }) =>
      logger.warn(
        {
          kind: 'crazyhouse_xiangqi_engine_move_rejected',
          room_id: room.id,
          engine_id: engineId,
          attempt,
          max_attempts: maxAttempts,
          uci,
          reject_reason: reason,
          error,
        },
        'Crazyhouse Xiangqi engine output rejected by kernel; retrying',
      ),
  });
  if (aborted || !engineToMove(room, seat)) return;

  if (validated === null) {
    const record = buildEngineDecisionRecord({
      variant: 'crazyhouse-xiangqi',
      roomId: room.id,
      engineId,
      engineVersion: CRAZYHOUSE_XIANGQI_FSF_ENGINE_VERSION,
      movetimeMs,
      tier,
      ply: history.length,
      toMove: seat,
      inCheck: isCrazyhouseXiangqiGeneralInCheck(room.projection.state.board, seat),
      history,
      legalUci: getCrazyhouseXiangqiLegalMoves(room.projection.state).map(
        crazyhouseXiangqiMoveToUci,
      ),
      attempts,
    });
    reportEngineFallback(record, 'crazyhouse_xiangqi_engine_failed_closed', 'Crazyhouse Xiangqi');
    const resign: CrazyhouseXiangqiEvent = {
      type: 'seat-resigned',
      at: Date.now(),
      roomId: room.id,
      color: seat,
    };
    const seq = await ctx.appendEvent(room, resign);
    ctx.broadcastEventAppended(room, resign, seq);
    return;
  }

  reportEngineMoveOk();
  const legalMoves = getCrazyhouseXiangqiLegalMoves(room.projection.state);
  const guarded = guardCrazyhouseXiangqiEngineMove(room.projection.state, validated, legalMoves);
  if (guarded !== validated) {
    logger.warn(
      {
        kind: 'crazyhouse_xiangqi_engine_immediate_loss_guard',
        room_id: room.id,
        engine_id: engineId,
        move: crazyhouseXiangqiMoveToUci(validated),
        replacement_move: crazyhouseXiangqiMoveToUci(guarded),
      },
      'Crazyhouse Xiangqi engine immediate-loss guard replaced an avoidable losing move',
    );
  }

  const event: CrazyhouseXiangqiEvent = {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: seat,
    move: guarded,
  };
  // Queue BEFORE the append: if this move mates, the tenant event writer records
  // the game end and flushes the queue inside that same append, and a decision
  // queued afterwards would never be written.
  queueEngineDecision(
    room,
    buildLiveEngineDecisionPayload({
      variant: 'crazyhouse-xiangqi',
      roomId: room.id,
      engineId,
      engineVersion: CRAZYHOUSE_XIANGQI_FSF_ENGINE_VERSION,
      seat,
      ply: history.length,
      budgetMs: movetimeMs,
      remainingMs,
      incrementMs,
      tier,
      search: lastSearch,
      thinkTimeMs: Date.now() - startedAt,
      attempts,
      move: crazyhouseXiangqiMoveToUci(guarded),
      legalCount: legalMoves.length,
      guardReplaced: guarded !== validated,
    }),
  );
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}

function bothSeatsFilled(room: CrazyhouseXiangqiEngineRoom): boolean {
  return Boolean(room.projection.seats.red && room.projection.seats.black);
}

function engineToMove(room: CrazyhouseXiangqiEngineRoom, seat: CrazyhouseXiangqiColor): boolean {
  const status = room.projection.state.status;
  return status.type === 'playing' && status.turn === seat && bothSeatsFilled(room);
}

function crazyhouseXiangqiUciHistory(events: readonly CrazyhouseXiangqiEvent[]): string[] {
  return events
    .filter(
      (event): event is Extract<CrazyhouseXiangqiEvent, { type: 'move-played' }> =>
        event.type === 'move-played',
    )
    .map((event) => crazyhouseXiangqiMoveToUci(event.move));
}

/** The kernel's own UCI spelling; re-exported for the EvE adapter. */
export const crazyhouseXiangqiEngineMoveToUci = crazyhouseXiangqiMoveToUci;

/** The legal move an engine's UCI names, or null when it names none. */
export function legalMoveForUci(
  legalMoves: readonly CrazyhouseXiangqiMove[],
  uci: string,
): CrazyhouseXiangqiMove | null {
  const parsed = crazyhouseXiangqiMoveFromUci(uci);
  if (!parsed) return null;
  if (isCrazyhouseXiangqiDropMove(parsed)) {
    return (
      legalMoves.find(
        (move) =>
          isCrazyhouseXiangqiDropMove(move) && move.drop === parsed.drop && move.to === parsed.to,
      ) ?? null
    );
  }
  return (
    legalMoves.find(
      (move) =>
        !isCrazyhouseXiangqiDropMove(move) && move.from === parsed.from && move.to === parsed.to,
    ) ?? null
  );
}

/**
 * Replace a move that lets the opponent win on the immediate reply with a legal
 * move that does not: a cheap general-safety backstop for the low rungs, whose
 * Skill Level noise can pick a move that hangs mate in one (a drop mate is easy
 * to miss). The replacement search is time-boxed; past the budget the engine's
 * move stands.
 */
export function guardCrazyhouseXiangqiEngineMove(
  state: CrazyhouseXiangqiGameState,
  chosen: CrazyhouseXiangqiMove,
  legalMoves: readonly CrazyhouseXiangqiMove[],
  budgetMs = GUARD_REPLACEMENT_BUDGET_MS,
): CrazyhouseXiangqiMove {
  if (!allowsImmediateOpponentWin(state, chosen)) return chosen;
  const deadline = Date.now() + budgetMs;
  for (const move of legalMoves) {
    if (Date.now() > deadline) break;
    if (move === chosen) continue;
    if (!allowsImmediateOpponentWin(state, move)) return move;
  }
  return chosen;
}

function allowsImmediateOpponentWin(
  state: CrazyhouseXiangqiGameState,
  move: CrazyhouseXiangqiMove,
): boolean {
  if (state.status.type !== 'playing') return false;
  const opponent = oppositeCrazyhouseXiangqiColor(state.status.turn);
  const after = applyCrazyhouseXiangqiMove(state, move);
  if (after.status.type !== 'playing') return false;
  return getCrazyhouseXiangqiLegalMoves(after).some((reply) => {
    const afterReply = applyCrazyhouseXiangqiMove(after, reply);
    return afterReply.status.type === 'finished' && afterReply.status.winner === opponent;
  });
}
