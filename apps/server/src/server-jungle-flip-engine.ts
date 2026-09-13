/**
 * Server-side MistyJungleFlip loop for Flip Jungle (兽棋 / 翻翻棋) PvE.
 *
 * Tier-B: Flip Jungle is driven by our `jungle-flip-engine` UCI subprocess
 * (jungle-flip-engine.ts), the same shape as banqi/jieqi/xiangqi — NOT the
 * hidden-info Misty engine-worker. Flip Jungle has hidden piece IDENTITIES, so we hand
 * the engine a redacted current-position FEN built by jungle-flip-fen.ts from canonical
 * state. Engine moves are injected through the same append+broadcast path as human
 * moves, so clocks, persistence, reconnect, and review stay event-sourced.
 *
 * The engine SEAT is whichever projection.seats slot holds an engine clientId
 * (jungle-flip-engine.ts owns the id set); no dedicated room field, so it survives
 * hydration. Mirrors server-banqi-engine.ts.
 */

import {
  applyJungleFlipMove,
  createInitialJungleFlipState,
  getJungleFlipLegalMoves,
  isJungleFlipLegalMove,
  type JungleFlipDeal,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipSeat,
} from '@mistboard/game';
import {
  buildEngineDecisionRecord,
  reportEngineFallback,
  reportEngineMoveOk,
  resolveValidatedEngineMove,
} from './engine-move-guard.js';
import { budgetForMove } from './engine-time-budget.js';
import {
  isJungleFlipEngineClientId,
  JUNGLE_FLIP_ENGINE_VERSION,
  jungleFlipEngineTierFor,
  jungleFlipLiveEngineMove,
  jungleFlipTieSeed,
} from './jungle-flip-engine.js';
import {
  engineUciToJungleFlipMove,
  jungleFlipMoveToEngineUci,
  jungleFlipRepSeedFens,
  jungleFlipStateToEngineFen,
} from './jungle-flip-fen.js';
import type { JungleFlipSpecId } from './jungle-flip-runtime.js';
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

const CLOCK_SAFETY_MS = 1_000;
const MIN_MOVETIME_MS = 50;

// Bounded retries before failing closed (see engine-move-guard.ts).
const ENGINE_MOVE_MAX_ATTEMPTS = 2;

type JungleFlipEngineRoom = TenantLiveRoom<
  'jungle-flip',
  JungleFlipSeat,
  JungleFlipMove,
  JungleFlipGameState,
  JungleFlipSpecId
>;
type JungleFlipEngineContext = TenantLifecycleContext<
  JungleFlipSeat,
  JungleFlipMove,
  JungleFlipGameState,
  JungleFlipSpecId,
  JungleFlipEngineRoom
>;

export function jungleFlipEngineSeatFor(room: JungleFlipEngineRoom): JungleFlipSeat | null {
  for (const seat of ['red', 'black'] as const) {
    if (isJungleFlipEngineClientId(room.projection.seats[seat])) return seat;
  }
  return null;
}

function bothSeatsFilled(room: JungleFlipEngineRoom): boolean {
  return Boolean(room.projection.seats.red && room.projection.seats.black);
}

function engineToMove(room: JungleFlipEngineRoom, seat: JungleFlipSeat): boolean {
  const status = room.projection.state.status;
  return status.type === 'playing' && status.turn === seat && bothSeatsFilled(room);
}

export function scheduleJungleFlipEngineMove(
  ctx: JungleFlipEngineContext,
  room: JungleFlipEngineRoom,
): void {
  if (room.engineTimer) return;
  const seat = jungleFlipEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playJungleFlipEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        {
          kind: 'jungle_flip_engine_move_failure',
          room_id: room.id,
          error: (err as Error).message,
        },
        'Flip Jungle engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

/**
 * Replay the room's event log into the per-ply state sequence and derive the threefold
 * rep seed (positions already seen twice). Fail-safe: returns [] on any error so a malformed
 * log never breaks the engine move (the engine just falls back to history-blind search).
 */
function repSeedFensForRoom(room: JungleFlipEngineRoom): string[] {
  try {
    const created = room.events.find((e) => e.type === 'room-created');
    const deal = created?.setup as JungleFlipDeal | undefined;
    if (!deal) return [];
    let state = createInitialJungleFlipState(room.id, deal);
    const states: JungleFlipGameState[] = [state];
    for (const event of room.events) {
      if (event.type !== 'move-played') continue;
      state = applyJungleFlipMove(state, event.move);
      states.push(state);
    }
    return jungleFlipRepSeedFens(states);
  } catch (err) {
    logger.warn(
      { kind: 'jungle_flip_rep_seed_failed', room_id: room.id, error: String(err) },
      'Flip Jungle repetition-seed replay failed; sending no seed',
    );
    return [];
  }
}

/**
 * The move provider returns the whole search summary, not just the move, so the
 * decision artifact can record what the engine actually did. Tests inject a stub.
 */
export type JungleFlipEngineMoveProvider = (
  engineId: string,
  fen: string,
  opts: {
    nodes?: number;
    movetimeCapMs?: number;
    repSeedFens?: readonly string[];
    tieSeed?: string;
  },
) => Promise<UciEval>;

export async function playJungleFlipEngineMoveIfReady(
  ctx: JungleFlipEngineContext,
  room: JungleFlipEngineRoom,
  moveProvider: JungleFlipEngineMoveProvider = jungleFlipLiveEngineMove,
): Promise<void> {
  const seat = jungleFlipEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  const engineId = room.projection.seats[seat]!;
  const tier = jungleFlipEngineTierFor(engineId);
  if (!tier) return;

  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  const incrementMs = clock?.incrementMs ?? 0;
  if (remainingMs !== null && remainingMs <= 0) return;

  const fen = jungleFlipStateToEngineFen(room.projection.state);
  // Threefold awareness: replay the game so the engine learns which positions have already
  // occurred twice (re-entering one is the 3rd = a draw). Fail-safe: on any replay error
  // we send no seed rather than break the move.
  const repSeedFens = repSeedFensForRoom(room);
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

  // Engine-move boundary contract (see engine-move-guard.ts): bounded retries, validate
  // every output against the kernel, FAIL CLOSED (resign + page) rather than silently
  // substituting a threat-blind legal move.
  const startedAt = Date.now();
  let lastSearch: UciEval | null = null;
  const {
    chosen: validated,
    attempts,
    aborted,
  } = await resolveValidatedEngineMove<JungleFlipMove>({
    maxAttempts: ENGINE_MOVE_MAX_ATTEMPTS,
    requestMove: async () => {
      const search = await moveProvider(engineId, fen, {
        nodes: tier.nodes,
        movetimeCapMs,
        repSeedFens,
        // Stable per-game seed so tied choices (mainly the opening flip) vary across games
        // but replay exactly for this room; no extra state to persist (see jungleFlipTieSeed).
        tieSeed: jungleFlipTieSeed(room.id),
      });
      lastSearch = search;
      return search.best;
    },
    validate: (uci) => {
      const parsed = engineUciToJungleFlipMove(uci);
      return parsed && isJungleFlipLegalMove(room.projection.state, parsed) ? parsed : null;
    },
    stillOnTurn: () => engineToMove(room, seat),
    onReject: ({ attempt, maxAttempts, uci, reason, error }) =>
      logger.warn(
        {
          kind: 'jungle_flip_engine_move_rejected',
          room_id: room.id,
          engine_id: engineId,
          attempt,
          max_attempts: maxAttempts,
          uci,
          reject_reason: reason,
          error,
        },
        'Flip Jungle engine output rejected by kernel; retrying',
      ),
  });
  if (aborted || !engineToMove(room, seat)) return;

  if (validated === null) {
    // FAIL CLOSED: capture a complete replayable record, page, and resign. Flip Jungle
    // is perfect-recall at decision time (only future flips are hidden), so a move the
    // kernel rejects is a bug, not fog.
    const record = buildEngineDecisionRecord({
      variant: 'jungle-flip',
      roomId: room.id,
      engineId,
      engineVersion: JUNGLE_FLIP_ENGINE_VERSION,
      movetimeMs: movetimeCapMs,
      tier: { nodes: tier.nodes, movetimeMs: tier.movetimeCapMs },
      ply: room.projection.state.moveNumber,
      toMove: seat,
      inCheck: false,
      fen,
      history: [],
      legalUci: getJungleFlipLegalMoves(room.projection.state).map(jungleFlipMoveToEngineUci),
      attempts,
    });
    reportEngineFallback(record, 'jungle_flip_engine_failed_closed', 'Flip Jungle');
    const resign: TenantRoomEvent<JungleFlipSeat, JungleFlipMove, JungleFlipSpecId> = {
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
  const event: TenantRoomEvent<JungleFlipSeat, JungleFlipMove, JungleFlipSpecId> = {
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
      variant: 'jungle-flip',
      roomId: room.id,
      engineId,
      engineVersion: JUNGLE_FLIP_ENGINE_VERSION,
      seat,
      ply: room.projection.state.moveNumber,
      budgetMs: movetimeCapMs,
      remainingMs,
      incrementMs,
      tier: { nodes: tier.nodes, movetimeMs: tier.movetimeCapMs },
      search: lastSearch,
      thinkTimeMs: Date.now() - startedAt,
      attempts,
      move: jungleFlipMoveToEngineUci(validated),
      fen,
      legalCount: getJungleFlipLegalMoves(room.projection.state).length,
    }),
  );
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}
