/**
 * Server-side MistyBanqi loop for Banqi (半棋) PvE.
 *
 * Tier-B: banqi is driven by our `banqi-engine` UCI subprocess (banqi-engine.ts), the
 * same shape as jieqi/xiangqi — NOT the hidden-info Misty engine-worker. Banqi has
 * hidden piece IDENTITIES, so we hand the engine a redacted current-position FEN built
 * by banqi-fen.ts from canonical state. Engine moves are injected through the same
 * append+broadcast path as human moves, so clocks, persistence, reconnect, and review
 * stay event-sourced.
 *
 * The engine SEAT is whichever projection.seats slot holds an engine clientId
 * (banqi-engine.ts owns the id set); no dedicated room field, so it survives hydration.
 * Mirrors server-jieqi-engine.ts.
 */

import {
  type BanqiGameState,
  type BanqiMove,
  type BanqiSeat,
  getBanqiLegalMoves,
  isBanqiLegalMove,
} from '@mistboard/game';
import {
  BANQI_ENGINE_VERSION,
  banqiEngineTierFor,
  banqiLiveEngineMove,
  isBanqiEngineClientId,
} from './banqi-engine.js';
import { banqiMoveToEngineUci, banqiStateToEngineFen, engineUciToBanqiMove } from './banqi-fen.js';
import type { BanqiEvent, BanqiSpecId } from './banqi-runtime.js';
import { banqiTenant } from './banqi-tenant.js';
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
import { replayTenantEvents, tenantClockRemainingMs } from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';
import type { TenantLiveRoom } from './variant-tenant/ws.js';

const CLOCK_SAFETY_MS = 1_000;
const MIN_MOVETIME_MS = 50;

// Bounded retries before failing closed (see engine-move-guard.ts).
const ENGINE_MOVE_MAX_ATTEMPTS = 2;

type BanqiEngineRoom = TenantLiveRoom<'banqi', BanqiSeat, BanqiMove, BanqiGameState, BanqiSpecId>;
type BanqiEngineContext = TenantLifecycleContext<
  BanqiSeat,
  BanqiMove,
  BanqiGameState,
  BanqiSpecId,
  BanqiEngineRoom
>;

export function banqiEngineSeatFor(room: BanqiEngineRoom): BanqiSeat | null {
  for (const seat of ['red', 'black'] as const) {
    if (isBanqiEngineClientId(room.projection.seats[seat])) return seat;
  }
  return null;
}

function bothSeatsFilled(room: BanqiEngineRoom): boolean {
  return Boolean(room.projection.seats.red && room.projection.seats.black);
}

function engineToMove(room: BanqiEngineRoom, seat: BanqiSeat): boolean {
  const status = room.projection.state.status;
  return status.type === 'playing' && status.turn === seat && bothSeatsFilled(room);
}

// Build the repetition WINDOW the engine needs to detect threefold from GAME history: the
// redacted FEN at the last irreversible move (capture/flip) plus the quiet plies since.
// `noProgressClock` counts exactly those quiet plies, so the last K move-played events are
// the window (a flip/capture would have reset the clock to 0); replaying the event prefix
// before them yields the window-start state. Empty window (clock 0) => current FEN only,
// i.e. prior behavior. The replayed moves are all quiet, which the engine replays safely.
// `moves` is only the slice the engine replays; `gameMoves` is the whole game, and
// the decision record needs BOTH. Reporting the window as the game's history is how
// a twelve-ply game paged as a two-ply one on 2026-09-02.
function banqiEngineRepWindow(room: BanqiEngineRoom): {
  fen: string;
  moves: string[];
  gameMoves: string[];
} {
  const state = room.projection.state;
  const moveEvents = (room.events as readonly BanqiEvent[]).filter(
    (e): e is Extract<BanqiEvent, { type: 'move-played' }> => e.type === 'move-played',
  );
  const gameMoves = moveEvents.map((e) => banqiMoveToEngineUci(e.move));
  const k = state.noProgressClock;
  if (k <= 0 || k >= moveEvents.length) {
    return { fen: banqiStateToEngineFen(state), moves: [], gameMoves };
  }
  const firstWindowed = moveEvents[moveEvents.length - k]!;
  const cutoff = room.events.indexOf(firstWindowed);
  const startState = replayTenantEvents(banqiTenant, room.events.slice(0, cutoff)).state;
  return {
    fen: banqiStateToEngineFen(startState),
    moves: gameMoves.slice(moveEvents.length - k),
    gameMoves,
  };
}

export function scheduleBanqiEngineMove(ctx: BanqiEngineContext, room: BanqiEngineRoom): void {
  if (room.engineTimer) return;
  const seat = banqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playBanqiEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        { kind: 'banqi_engine_move_failure', room_id: room.id, error: (err as Error).message },
        'Banqi engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

/**
 * The move provider returns the whole search summary, not just the move, so the
 * decision artifact can record what the engine actually did. Tests inject a stub.
 */
export type BanqiEngineMoveProvider = (
  engineId: string,
  fen: string,
  opts: { nodes?: number; movetimeCapMs?: number; moves?: readonly string[] },
) => Promise<UciEval>;

export async function playBanqiEngineMoveIfReady(
  ctx: BanqiEngineContext,
  room: BanqiEngineRoom,
  moveProvider: BanqiEngineMoveProvider = banqiLiveEngineMove,
): Promise<void> {
  const seat = banqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  const engineId = room.projection.seats[seat]!;
  const tier = banqiEngineTierFor(engineId);
  if (!tier) return;

  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  const incrementMs = clock?.incrementMs ?? 0;
  if (remainingMs !== null && remainingMs <= 0) return;

  const { fen, moves, gameMoves } = banqiEngineRepWindow(room);
  // Strength = the tier's NODE budget; this movetime is the latency CEILING + a
  // clock-aware time-pressure guard (shared allocator). Existing ceiling preserved —
  // behavior-neutral for untimed play; adds increment awareness + graceful shrink
  // when timed. Replaces the old naive min(cap, remaining - safety) clamp.
  const { computeBudgetMs: movetimeCapMs } = budgetForMove({
    remainingMs,
    incrementMs,
    ceilingMs: tier.movetimeCapMs,
    reserveMs: CLOCK_SAFETY_MS,
    floorMs: MIN_MOVETIME_MS,
  });

  // Engine-move boundary contract (see engine-move-guard.ts): bounded retries,
  // validate every output against the kernel, FAIL CLOSED (resign + page) rather
  // than silently substituting a threat-blind legal move.
  const startedAt = Date.now();
  let lastSearch: UciEval | null = null;
  const {
    chosen: validated,
    attempts,
    aborted,
  } = await resolveValidatedEngineMove<BanqiMove>({
    maxAttempts: ENGINE_MOVE_MAX_ATTEMPTS,
    requestMove: async () => {
      const search = await moveProvider(engineId, fen, {
        nodes: tier.nodes,
        movetimeCapMs,
        moves,
      });
      lastSearch = search;
      return search.best;
    },
    validate: (uci) => {
      const parsed = engineUciToBanqiMove(uci);
      return parsed && isBanqiLegalMove(room.projection.state, parsed) ? parsed : null;
    },
    stillOnTurn: () => engineToMove(room, seat),
    onReject: ({ attempt, maxAttempts, uci, reason, error }) =>
      logger.warn(
        {
          kind: 'banqi_engine_move_rejected',
          room_id: room.id,
          engine_id: engineId,
          attempt,
          max_attempts: maxAttempts,
          uci,
          reject_reason: reason,
          error,
        },
        'Banqi engine output rejected by kernel; retrying',
      ),
  });
  if (aborted || !engineToMove(room, seat)) return;

  if (validated === null) {
    // FAIL CLOSED: capture a complete replayable record, page, and resign. Banqi
    // is perfect-information at decision time (only future flips are hidden), so
    // a move the kernel rejects is a bug, not fog.
    const record = buildEngineDecisionRecord({
      variant: 'banqi',
      roomId: room.id,
      engineId,
      engineVersion: BANQI_ENGINE_VERSION,
      movetimeMs: movetimeCapMs,
      tier: { nodes: tier.nodes, movetimeMs: tier.movetimeCapMs },
      ply: gameMoves.length,
      toMove: seat,
      inCheck: false,
      fen,
      history: gameMoves,
      engineWindow: moves,
      legalUci: getBanqiLegalMoves(room.projection.state).map(banqiMoveToEngineUci),
      attempts,
    });
    reportEngineFallback(record, 'banqi_engine_failed_closed', 'Banqi');
    const resign: TenantRoomEvent<BanqiSeat, BanqiMove, BanqiSpecId> = {
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
  const event: TenantRoomEvent<BanqiSeat, BanqiMove, BanqiSpecId> = {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: seat,
    move: validated,
  };
  // Queue BEFORE the append: if this move ends the game, the tenant event writer
  // records the game end and flushes the queue inside that same append, and a
  // decision queued afterwards would never be written.
  queueEngineDecision(
    room,
    buildLiveEngineDecisionPayload({
      variant: 'banqi',
      roomId: room.id,
      engineId,
      engineVersion: BANQI_ENGINE_VERSION,
      seat,
      ply: gameMoves.length,
      budgetMs: movetimeCapMs,
      remainingMs,
      incrementMs,
      tier: { nodes: tier.nodes, movetimeMs: tier.movetimeCapMs },
      search: lastSearch,
      thinkTimeMs: Date.now() - startedAt,
      attempts,
      move: banqiMoveToEngineUci(validated),
      fen,
      legalCount: getBanqiLegalMoves(room.projection.state).length,
    }),
  );
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}
