/**
 * Server-side engine-move loop for full Dark Xiangqi PvE.
 *
 * Mirrors the DMX loop: build a redacted 9x10 EngineTurnRequest, ask the
 * internal engine worker, then append the returned move through the normal
 * tenant event path so clients, clocks, persistence, and lifecycle timers stay
 * on the same code path as human moves.
 */

import {
  type EngineTurnResponse,
  getLegalMoves as getXiangqiLegalMoves,
  type XiangqiColor,
} from '@mistboard/game';
import type { DarkXiangqiEvent } from './dark-xiangqi-runtime.js';
import { sendEngineAlertNotification } from './engine-alert-email.js';
import {
  buildEngineDecisionRecord,
  reportEngineMoveOk,
  reportObservedFallback,
} from './engine-move-guard.js';
import { buildXiangqiEngineTurnRequest } from './engine-protocol/build-xiangqi.js';
import { isDarkXiangqiEngineClientId, loadEngine } from './engines/registry.js';
import { engineCounters, logger } from './obs.js';
import type { DarkXiangqiLiveRoom } from './server-dark-xiangqi-types.js';
import { requestLiveEngineTurnWithRenewal } from './server-live-engine-reservations.js';
import { queueEngineDecision } from './variant-tenant/engine-decisions.js';
import { tenantClockRemainingMs } from './variant-tenant/runtime.js';

const ENGINE_SECRET = process.env.MISTBOARD_ENGINE_SECRET ?? 'mistboard-dev-engine-secret';
const DEFAULT_TIMEOUT_MS = 60_000;
const BUDGET_SAFETY_MS = 1_500;
const PROCESS_OVERHEAD_MS = 1_500;
const CLOCK_GRACE_MS = 2_000;
const MAX_TIMEOUT_MS = 60_000;

export type DarkXiangqiEngineContext = {
  appendEvent(room: DarkXiangqiLiveRoom, event: DarkXiangqiEvent): Promise<number>;
  broadcastEventAppended(room: DarkXiangqiLiveRoom, event: DarkXiangqiEvent, seq: number): void;
  now?(): number;
};

export function darkXiangqiEngineSeatFor(room: DarkXiangqiLiveRoom): XiangqiColor | null {
  for (const seat of ['red', 'black'] as const) {
    if (isDarkXiangqiEngineClientId(room.projection.seats[seat])) return seat;
  }
  return null;
}

function bothSeatsFilled(room: DarkXiangqiLiveRoom): boolean {
  return Boolean(room.projection.seats.red && room.projection.seats.black);
}

function engineToMove(room: DarkXiangqiLiveRoom, seat: XiangqiColor): boolean {
  const status = room.projection.state.status;
  return status.type === 'playing' && status.turn === seat && bothSeatsFilled(room);
}

export function scheduleDarkXiangqiEngineMove(
  ctx: DarkXiangqiEngineContext,
  room: DarkXiangqiLiveRoom,
): void {
  if (room.engineTimer) return;
  const seat = darkXiangqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playDarkXiangqiEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        { kind: 'dxq_engine_move_failure', room_id: room.id, error: (err as Error).message },
        'dxq engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

function budgetFor(
  remainingMs: number | null,
  incrementMs: number,
  configuredMs: number,
): { computeBudgetMs: number; watchdogTimeoutMs: number } {
  if (remainingMs === null) {
    return { computeBudgetMs: configuredMs, watchdogTimeoutMs: configuredMs };
  }
  const usable = Math.max(0, remainingMs - BUDGET_SAFETY_MS);
  const perMove = Math.min(usable > 0 ? usable : 50, usable * 0.1 + incrementMs * 0.8 + 250);
  // Liveness bound only — NOT derived from the per-move allocation. Deriving
  // it from perMove + overhead conflated "slow" with "dead" and forfeited
  // seats with minutes still banked (dark-chess 12c8ff99, engine issue #11;
  // the same belief-explosion class hit fdx in July). The engine allocates
  // its own think time; the server bounds a true hang (MAX_TIMEOUT_MS) and
  // clock exhaustion — an engine that overspends flags on its clock instead.
  const watchdogTimeoutMs = Math.max(
    1,
    Math.min(MAX_TIMEOUT_MS, Math.ceil(Math.max(0, remainingMs) + CLOCK_GRACE_MS)),
  );
  return {
    computeBudgetMs: Math.max(1, Math.min(Math.ceil(perMove), watchdogTimeoutMs)),
    watchdogTimeoutMs,
  };
}

export async function playDarkXiangqiEngineMoveIfReady(
  ctx: DarkXiangqiEngineContext,
  room: DarkXiangqiLiveRoom,
): Promise<void> {
  const seat = darkXiangqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  const engineId = room.projection.seats[seat]!;
  const engine = loadEngine(engineId);

  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  const incrementMs = clock?.incrementMs ?? 0;
  if (remainingMs !== null && remainingMs <= 0) return;

  const ply = room.events.reduce((n, e) => (e.type === 'move-played' ? n + 1 : n), 0);
  const request = buildXiangqiEngineTurnRequest({
    gameId: room.id,
    engineId,
    engineSecret: ENGINE_SECRET,
    engineColor: seat,
    state: room.projection.state,
    events: room.events,
    ply,
    clockRemainingMs: remainingMs,
    incrementMs,
  });
  const { computeBudgetMs, watchdogTimeoutMs } = budgetFor(
    remainingMs,
    incrementMs,
    engine.livePolicy?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let response: EngineTurnResponse;
  const turnStartedAt = Date.now();
  try {
    response = await requestLiveEngineTurnWithRenewal({
      holder: room,
      request,
      budget: { computeBudgetMs, watchdogTimeoutMs },
      // Re-derive from the clock left now: an outage spends the engine's time.
      rebudget: () =>
        budgetFor(
          remainingMs === null ? null : Math.max(0, remainingMs - (Date.now() - turnStartedAt)),
          incrementMs,
          engine.livePolicy?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ),
      stillNeeded: () => room.projection.state.status.type === 'playing',
    });
  } catch (err) {
    logger.error(
      {
        kind: 'dxq_engine_request_failed',
        room_id: room.id,
        engine_id: engineId,
        error: (err as Error).message,
      },
      'dxq engine request failed',
    );
    engineCounters.recordMove(true);
    await forfeitDarkXiangqiEngine(ctx, room, seat, (err as Error).message);
    return;
  }

  if (!engineToMove(room, seat)) return;
  const legal = getXiangqiLegalMoves(room.projection.state);
  let chosen = legal.find((m) => m.from === response.move.from && m.to === response.move.to);
  const fellBackToLegal = chosen === undefined;
  if (!chosen) {
    chosen = legal[0] ?? null;
    if (!chosen) {
      engineCounters.recordMove(true);
      logger.error(
        { kind: 'dxq_engine_no_legal_move', room_id: room.id, move: response.move },
        'dxq engine returned an illegal move and no legal fallback exists',
      );
      await forfeitDarkXiangqiEngine(ctx, room, seat, 'no legal fallback for illegal move');
      return;
    }
    // Fog: a move illegal in the TRUE position can be a legitimate consequence of
    // hidden information (e.g. a slider blocked by a hidden piece), so we keep the
    // true-legal fallback rather than resign — but make it observable (counted +
    // full record) so it is never a silent strength regression.
    reportObservedFallback(
      buildEngineDecisionRecord({
        variant: 'dark-xiangqi',
        roomId: room.id,
        engineId,
        engineVersion: 'internal',
        movetimeMs: computeBudgetMs,
        ply,
        toMove: seat,
        inCheck: false,
        history: [],
        legalUci: legal.map((m) => `${m.from}${m.to}`),
        attempts: [
          {
            attempt: 1,
            uci: `${response.move.from}${response.move.to}`,
            error: null,
            reason: 'illegal-move',
          },
        ],
      }),
      'dxq_engine_illegal_move_fallback',
      'dxq engine returned a fog-pseudo-legal move; using a true-legal fallback (observed)',
    );
  } else {
    reportEngineMoveOk();
  }

  queueEngineDecision(room, {
    engineId,
    seat,
    ply,
    // What the SERVER allotted. The engine reports its own self-budget and the
    // time it actually spent inside `diagnostics`; the gap between the three is
    // the whole question when a fog move looks too fast or too slow.
    computeBudgetMs,
    remainingMs,
    incrementMs,
    move: `${chosen.from}${chosen.to}`,
    requestedMove: `${response.move.from}${response.move.to}`,
    fallbackUsed: fellBackToLegal,
    legalCount: legal.length,
    // Opaque per-engine telemetry (belief size, iterations, elapsed, decision
    // source, leaf evaluator). Free-form by protocol contract, stored as-is.
    diagnostics: response.diagnostics ?? null,
  });

  const event: DarkXiangqiEvent = {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: seat,
    move: chosen,
  };
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}

async function forfeitDarkXiangqiEngine(
  ctx: DarkXiangqiEngineContext,
  room: DarkXiangqiLiveRoom,
  seat: XiangqiColor,
  reason?: string,
): Promise<void> {
  if (room.projection.state.status.type !== 'playing') return;
  const event: DarkXiangqiEvent = {
    type: 'seat-forfeited',
    at: Date.now(),
    roomId: room.id,
    color: seat,
  };
  try {
    const seq = await ctx.appendEvent(room, event);
    ctx.broadcastEventAppended(room, event, seq);
    // Page, don't just count: the forfeit's cause was previously only
    // reconstructible by joining adjacent log lines by timestamp.
    logger.error(
      {
        kind: 'engine_seat_forfeited',
        variant: 'dark-xiangqi',
        room_id: room.id,
        color: seat,
        reason: reason ?? null,
      },
      'engine seat forfeited',
    );
    void sendEngineAlertNotification({
      severity: 'critical',
      alert_kind: 'engine_seat_forfeited',
      variant: 'dark-xiangqi',
      room_id: room.id,
      color: seat,
      reason: reason ?? undefined,
    }).catch(() => {});
  } catch (err) {
    logger.error(
      { kind: 'dxq_engine_forfeit_failed', room_id: room.id, error: (err as Error).message },
      'dxq engine forfeit failed',
    );
  }
}
