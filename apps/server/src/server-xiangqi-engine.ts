/**
 * Server-side engine loop for standard (open-information) Xiangqi PvE: mainline
 * Pikafish and the Fairy-Stockfish ladder, dispatched by the engine catalog.
 *
 * Standard xiangqi is perfect-information, so this mirrors the Fortress Xiangqi
 * loop structurally — the only differences are: there are no drops (board moves
 * only), and the UCI coordinate system is Pikafish's native rank-0-9 (translation
 * lives in xiangqi-pikafish-engine.ts). The engine replays the game from
 * `position startpos moves ...` in Pikafish UCI, so this loop hands the provider
 * the Pikafish-UCI move history rather than a FEN.
 *
 * Engine moves are injected through the same append+broadcast path as human
 * moves so clocks, persistence, reconnect, and review stay event-sourced.
 *
 * Every engine turn also persists a `live-engine-decision` debug artifact (the
 * type the fog/chess path has written since #287): the budget it was given, the
 * search it actually ran (depth, nodes, time, score), and the move it played.
 * Until 2026-09-02 this loop recorded nothing on success, so when a human beat
 * the top FSF rung there was no way to read how deep that bot had really
 * searched on prod short of replaying the game offline.
 */

import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
  type XIANGQI_SPEC_ID,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
} from '@mistboard/game';
import {
  buildEngineDecisionRecord,
  type EngineMoveAttempt,
  reportEngineFallback,
  reportEngineMoveOk,
  resolveValidatedEngineMove,
} from './engine-move-guard.js';
import { budgetForMove } from './engine-time-budget.js';
import { logger } from './obs.js';
import type { UciEval } from './uci-engine-harness.js';
import { queueEngineDecision } from './variant-tenant/engine-decisions.js';
import type { TenantLifecycleContext } from './variant-tenant/lifecycle.js';
import { tenantClockRemainingMs } from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';
import type { TenantLiveRoom } from './variant-tenant/ws.js';
import {
  isXiangqiEngineClientId,
  type XiangqiEngineTier,
  xiangqiEngineTierFor,
  xiangqiEngineVersion,
  xiangqiLiveEngineMove,
  xiangqiMoveToPikafishUci,
} from './xiangqi-engine-catalog.js';

// Re-export the engine metadata so the tenant, registration, and rooms route
// resolve these from this module (matching the Fortress layout).
export {
  isXiangqiEngineClientId,
  XIANGQI_DEFAULT_ENGINE_ID,
  XIANGQI_PLAYABLE_ENGINES,
  type XiangqiEngineTier,
  xiangqiEngineDisplayName,
  xiangqiEngineVersion,
} from './xiangqi-engine-catalog.js';

const CLOCK_SAFETY_MS = 1_000;
const MIN_MOVETIME_MS = 50;
const ENGINE_MOVE_MAX_ATTEMPTS = 2;
/** Stored pv length in the per-move artifact; enough to read the engine's plan. */
const DECISION_PV_MAX_PLIES = 8;

type XiangqiSpecId = typeof XIANGQI_SPEC_ID;

type XiangqiEngineRoom = TenantLiveRoom<
  'xiangqi',
  XiangqiColor,
  XiangqiMove,
  XiangqiGameState,
  XiangqiSpecId
>;
type XiangqiEngineContext = TenantLifecycleContext<
  XiangqiColor,
  XiangqiMove,
  XiangqiGameState,
  XiangqiSpecId,
  XiangqiEngineRoom
>;

export function xiangqiEngineSeatFor(room: XiangqiEngineRoom): XiangqiColor | null {
  for (const seat of ['red', 'black'] as const) {
    if (isXiangqiEngineClientId(room.projection.seats[seat])) return seat;
  }
  return null;
}

export function scheduleXiangqiEngineMove(
  ctx: XiangqiEngineContext,
  room: XiangqiEngineRoom,
): void {
  if (room.engineTimer) return;
  const seat = xiangqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playXiangqiEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        {
          kind: 'xiangqi_engine_move_failure',
          room_id: room.id,
          error: (err as Error).message,
        },
        'Xiangqi engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

/**
 * The move provider returns the whole search summary, not just the move, so the
 * decision artifact can record what the engine did. Tests inject a stub.
 */
export type XiangqiEngineMoveProvider = (
  engineId: string,
  moves: string[],
  opts: { movetimeMs?: number },
) => Promise<UciEval>;

export async function playXiangqiEngineMoveIfReady(
  ctx: XiangqiEngineContext,
  room: XiangqiEngineRoom,
  moveProvider: XiangqiEngineMoveProvider = xiangqiLiveEngineMove,
): Promise<void> {
  const seat = xiangqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  const engineId = room.projection.seats[seat]!;
  const tier = xiangqiEngineTierFor(engineId);
  if (!tier) return;

  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  const incrementMs = clock?.incrementMs ?? 0;
  if (remainingMs !== null && remainingMs <= 0) return;

  const history = xiangqiUciHistory(room.events);
  // Clock-aware per-move budget (shared allocator): on a node-anchored tier the
  // NODE budget is the strength anchor and binds first on a healthy clock; this
  // movetime is the latency ceiling + time-pressure guard. On the depth-capped
  // FSF rungs (levels 1-7) the movetime is, in practice, the strength knob too.
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
    validate: (uci) => legalMoveForUci(getStandardXiangqiLegalMoves(room.projection.state), uci),
    stillOnTurn: () => engineToMove(room, seat),
    onReject: ({ attempt, maxAttempts, uci, reason, error }) =>
      logger.warn(
        {
          kind: 'xiangqi_engine_move_rejected',
          room_id: room.id,
          engine_id: engineId,
          attempt,
          max_attempts: maxAttempts,
          uci,
          reject_reason: reason,
          error,
        },
        'Xiangqi engine output rejected by kernel; retrying',
      ),
  });
  if (aborted || !engineToMove(room, seat)) return;
  const thinkTimeMs = Date.now() - startedAt;

  const decisionBase = {
    engineId,
    engineVersion: xiangqiEngineVersion(engineId) ?? 'unknown',
    seat,
    ply: history.length,
    movetimeMs,
    remainingMs,
    incrementMs,
    tier,
    search: lastSearch,
    thinkTimeMs,
    attempts,
  };

  if (validated === null) {
    const record = buildEngineDecisionRecord({
      variant: 'xiangqi',
      roomId: room.id,
      engineId,
      engineVersion: xiangqiEngineVersion(engineId) ?? 'unknown',
      movetimeMs,
      tier,
      ply: history.length,
      toMove: seat,
      // Diagnostic-only log field; standard xiangqi exposes no in-check predicate
      // and this path (no kernel-legal move after retries) is rare.
      inCheck: false,
      history,
      legalUci: getStandardXiangqiLegalMoves(room.projection.state).map(xiangqiMoveToPikafishUci),
      attempts,
    });
    reportEngineFallback(record, 'xiangqi_engine_failed_closed', 'Xiangqi');
    const resign: TenantRoomEvent<XiangqiColor, XiangqiMove, XiangqiSpecId> = {
      type: 'seat-resigned',
      at: Date.now(),
      roomId: room.id,
      color: seat,
    };
    // Queue BEFORE the append: the resign finishes the game, and the tenant
    // event writer flushes the queue in the same append.
    queueEngineDecision(
      room,
      buildXiangqiEngineDecisionPayload({ ...decisionBase, move: null, guardReplaced: false }),
    );
    const seq = await ctx.appendEvent(room, resign);
    ctx.broadcastEventAppended(room, resign, seq);
    return;
  }

  reportEngineMoveOk();
  let chosen: XiangqiMove = validated;
  const legalMoves = getStandardXiangqiLegalMoves(room.projection.state);
  const guarded = guardXiangqiEngineMove(room.projection.state, chosen, legalMoves);
  if (guarded !== chosen) {
    logger.warn(
      {
        kind: 'xiangqi_engine_immediate_loss_guard',
        room_id: room.id,
        engine_id: engineId,
        move: xiangqiMoveToPikafishUci(chosen),
        replacement_move: xiangqiMoveToPikafishUci(guarded),
      },
      'Xiangqi engine immediate-loss guard replaced an avoidable losing move',
    );
    chosen = guarded;
  }

  const event: TenantRoomEvent<XiangqiColor, XiangqiMove, XiangqiSpecId> = {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: seat,
    move: chosen,
  };
  // Queue BEFORE the append: if this move mates, the tenant event writer records
  // the game end and flushes the queue inside the same append, and a decision
  // queued afterwards would never be written.
  queueEngineDecision(
    room,
    buildXiangqiEngineDecisionPayload({
      ...decisionBase,
      move: xiangqiMoveToPikafishUci(chosen),
      guardReplaced: guarded !== validated,
    }),
  );
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}

export type XiangqiEngineDecisionInput = {
  engineId: string;
  engineVersion: string;
  seat: XiangqiColor;
  /** The game's ply count when the engine was asked (the move played is ply+1). */
  ply: number;
  /** Budget handed to the engine as `movetime`. */
  movetimeMs: number;
  remainingMs: number | null;
  incrementMs: number;
  tier: XiangqiEngineTier;
  /** Last search summary the provider returned; null when every attempt failed. */
  search: UciEval | null;
  /** Wall time from the first request to the validated result, all attempts. */
  thinkTimeMs: number;
  attempts: readonly EngineMoveAttempt[];
  /** Move played, in Pikafish UCI; null when the engine failed closed (resigned). */
  move: string | null;
  /** The immediate-loss guard swapped the engine's move for a safer legal one. */
  guardReplaced: boolean;
};

/**
 * The `live-engine-decision` payload for one xiangqi engine turn. Flat, snake_case
 * like the fog/chess writer's, and self-describing: the tier block says what the
 * rung is configured to do, the search block says what it did. `search.nodes`
 * well under `tier.nodes` with `search.time_ms` at the budget means the movetime
 * ceiling bound (a slow box or time pressure), which is the first thing to check
 * when a "strong" rung plays weak.
 */
export function buildXiangqiEngineDecisionPayload(
  input: XiangqiEngineDecisionInput,
): Record<string, unknown> {
  const tier = input.tier as Partial<{
    skill: number;
    depth: number;
    nodes: number;
    movetimeMs: number;
    hashMb: number;
    nnue: boolean;
  }>;
  const last = input.attempts[input.attempts.length - 1];
  return {
    variant: 'xiangqi',
    engine_id: input.engineId,
    engine_version: input.engineVersion,
    // The artifacts table's engine_color column is chess-typed (white/black), so
    // the xiangqi seat travels in the payload instead.
    engine_seat: input.seat,
    ply: input.ply,
    move: input.move,
    engine_move: input.search?.best ?? null,
    guard_replaced: input.guardReplaced,
    failed_closed: input.move === null,
    movetime_ms: input.movetimeMs,
    remaining_ms: input.remainingMs,
    increment_ms: input.incrementMs,
    think_time_ms: input.thinkTimeMs,
    attempts: input.attempts.length,
    reject_reason: last?.reason ?? null,
    tier: {
      skill: tier.skill ?? null,
      depth: tier.depth ?? null,
      nodes: tier.nodes ?? null,
      movetime_ms: tier.movetimeMs ?? null,
      hash_mb: tier.hashMb ?? null,
      nnue: tier.nnue ?? false,
    },
    search:
      input.search === null
        ? null
        : {
            depth: input.search.depth,
            nodes: input.search.nodes ?? null,
            time_ms: input.search.timeMs ?? null,
            cp: input.search.cp,
            mate: input.search.mate,
            pv: (input.search.pv ?? []).slice(0, DECISION_PV_MAX_PLIES),
          },
  };
}

function bothSeatsFilled(room: XiangqiEngineRoom): boolean {
  return Boolean(room.projection.seats.red && room.projection.seats.black);
}

function engineToMove(room: XiangqiEngineRoom, seat: XiangqiColor): boolean {
  const status = room.projection.state.status;
  return status.type === 'playing' && status.turn === seat && bothSeatsFilled(room);
}

function xiangqiUciHistory(
  events: readonly TenantRoomEvent<XiangqiColor, XiangqiMove, XiangqiSpecId>[],
): string[] {
  return events
    .filter(
      (
        event,
      ): event is Extract<
        TenantRoomEvent<XiangqiColor, XiangqiMove, XiangqiSpecId>,
        { type: 'move-played' }
      > => event.type === 'move-played',
    )
    .map((event) => xiangqiMoveToPikafishUci(event.move));
}

// Match a Pikafish-UCI bestmove (e.g. "b0c2") against our legal move set by
// translating each legal move to Pikafish UCI. Avoids a bespoke UCI->square
// parser and can never admit an off-board or illegal move.
export function legalMoveForUci(
  legalMoves: readonly XiangqiMove[],
  uci: string,
): XiangqiMove | null {
  if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) return null;
  return legalMoves.find((move) => xiangqiMoveToPikafishUci(move) === uci) ?? null;
}

/**
 * Replace a move that lets the opponent win on the immediate reply with any legal
 * move that does not — a cheap king-safety backstop matching the Fortress loop.
 */
export function guardXiangqiEngineMove(
  state: XiangqiGameState,
  chosen: XiangqiMove,
  legalMoves: readonly XiangqiMove[],
): XiangqiMove {
  if (!allowsImmediateOpponentWin(state, chosen)) return chosen;
  return legalMoves.find((move) => !allowsImmediateOpponentWin(state, move)) ?? chosen;
}

function allowsImmediateOpponentWin(state: XiangqiGameState, move: XiangqiMove): boolean {
  if (state.status.type !== 'playing') return false;
  const after = applyStandardXiangqiMove(state, move);
  if (after.status.type !== 'playing') return false;
  const opponent = after.status.turn;
  return getStandardXiangqiLegalMoves(after).some((reply) => {
    const afterReply = applyStandardXiangqiMove(after, reply);
    return afterReply.status.type === 'finished' && afterReply.status.winner === opponent;
  });
}
