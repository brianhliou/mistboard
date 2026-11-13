// Hidden FFQ PvE lifecycle (#809), mirrored from TK.
import {
  type BanqiColor,
  type FFQ_BANQI_SPEC_ID,
  type FFQBanqiMove,
  type FFQBanqiState,
  ffqBanqiSeatToMove,
  ffqBanqiStateToFen,
  getFFQBanqiLegalMoves,
  getFFQBanqiPlayerView,
  isFFQBanqiLegalMove,
} from '@mistboard/game';
import { type EngineMoveAttempt, resolveValidatedEngineMove } from './engine-move-guard.js';
import { createReplyTurn, replyPace, replyPacePayload } from './engine-reply-pacing.js';
import { liveBotMoveTime } from './engine-time-budget.js';
import {
  FFQ_BANQI_ENGINE_MOVETIME_CAP_MS,
  type FFQBanqiEngineProvider,
  type FFQBanqiEngineRequest,
  ffqBanqiEngineTierFor,
  ffqBanqiEngineVersion,
  ffqBanqiLiveEngineMove,
  ffqBanqiMoveToUci,
  isFFQBanqiEngineClientId,
  uciToFFQBanqiMove,
} from './ffq-banqi-engine.js';
import type { FFQBanqiEvent } from './ffq-banqi-tenant.js';
import { logger } from './obs.js';
import type { UciEval } from './uci-engine-harness.js';
import {
  buildLiveEngineDecisionPayload,
  queueEngineDecision,
} from './variant-tenant/engine-decisions.js';
import type { TenantLifecycleContext } from './variant-tenant/lifecycle.js';
import { tenantClockRemainingMs } from './variant-tenant/runtime.js';
import type { TenantLiveRoom } from './variant-tenant/ws.js';

const CLOCK_SAFETY_MS = 1_000;
const MIN_MOVETIME_MS = 50;
const ENGINE_MOVE_MAX_ATTEMPTS = 2;

export type FFQBanqiEngineRoom = TenantLiveRoom<
  'ffq-banqi',
  BanqiColor,
  FFQBanqiMove,
  FFQBanqiState,
  typeof FFQ_BANQI_SPEC_ID
>;
type EngineContext = TenantLifecycleContext<
  BanqiColor,
  FFQBanqiMove,
  FFQBanqiState,
  typeof FFQ_BANQI_SPEC_ID,
  FFQBanqiEngineRoom
>;

export function ffqBanqiEngineSeatFor(
  room: Pick<FFQBanqiEngineRoom, 'projection'>,
): BanqiColor | null {
  for (const seat of ['red', 'black'] as const) {
    if (isFFQBanqiEngineClientId(room.projection.seats[seat])) return seat;
  }
  return null;
}

function engineToMove(room: FFQBanqiEngineRoom, seat: BanqiColor): boolean {
  const { projection } = room;
  const status = projection.state.status;
  if (projection.paused) return false;
  return (
    status.type === 'playing' &&
    ffqBanqiSeatToMove(projection.state) === seat &&
    Boolean(projection.seats.red && projection.seats.black)
  );
}

/** Both live play and EvE cross this same masked EngineTurnRequest boundary. */
export function ffqBanqiTierRequestFor(
  state: FFQBanqiState,
  engineId: string,
  movetimeCapMs: number,
  remainingMs: number | null = null,
  incrementMs = 0,
): FFQBanqiEngineRequest {
  const tier = ffqBanqiEngineTierFor(engineId);
  if (!tier) throw new Error(`Unknown FFQ engine: ${engineId}`);
  const seat = ffqBanqiSeatToMove(state);
  const view = getFFQBanqiPlayerView(state, seat);
  return {
    protocolVersion: '1',
    gameId: state.id,
    engineId,
    gameSpecId: 'ffq-banqi',
    sessionId: `${state.id}:${engineId}:${seat}`,
    color: seat === 'red' ? 'white' : 'black',
    ply: state.ply,
    engineSeed: state.ply,
    clock: { remaining_ms: remainingMs, increment_ms: incrementMs },
    legalMoves: view.legalMoves,
    position: { view, fen: ffqBanqiStateToFen(state) },
    nodes: tier.nodes,
    movetimeCapMs: Math.min(movetimeCapMs, tier.movetimeCapMs),
  };
}

export function scheduleFFQBanqiEngineMove(ctx: EngineContext, room: FFQBanqiEngineRoom): void {
  if (room.engineTimer) return;
  const seat = ffqBanqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playFFQBanqiEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        {
          kind: 'ffq_banqi_engine_move_failure',
          room_id: room.id,
          error: (err as Error).message,
        },
        'FFQ banqi engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

export async function playFFQBanqiEngineMoveIfReady(
  ctx: EngineContext,
  room: FFQBanqiEngineRoom,
  moveProvider: FFQBanqiEngineProvider = ffqBanqiLiveEngineMove,
  rng: () => number = Math.random,
): Promise<void> {
  const seat = ffqBanqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  if (remainingMs !== null && remainingMs <= 0) return;
  const engineId = room.projection.seats[seat]!;
  const tier = ffqBanqiEngineTierFor(engineId)!;
  const startedAt = Date.now();
  const turn = createReplyTurn(
    room,
    () =>
      engineToMove(room, seat) &&
      room.projection.seats[seat] === engineId &&
      (!room.projection.clock ||
        tenantClockRemainingMs(room.projection.clock, seat, ctx.now?.() ?? Date.now()) > 0),
  );
  const state = room.projection.state;
  const paceInput = {
    variant: 'ffq-banqi',
    initialMs: clock?.initialMs,
    correspondence: room.projection.timeControl?.daysPerMove !== undefined,
    roomId: room.id,
    ply: state.ply,
    legalCount: getFFQBanqiLegalMoves(state).length,
    remainingMs,
    incrementMs: clock?.incrementMs ?? 0,
    engineVsEngine: (['red', 'black'] as const).every((color) =>
      isFFQBanqiEngineClientId(room.projection.seats[color]),
    ),
  };
  const budgetInput = {
    ...paceInput,
    engineId,
    ceilingMs: FFQ_BANQI_ENGINE_MOVETIME_CAP_MS,
    flatReserveMs: CLOCK_SAFETY_MS,
    floorMs: MIN_MOVETIME_MS,
  };
  let movetimeCapMs = liveBotMoveTime(budgetInput).movetimeMs;
  let budgetExhausted = false;
  let lastSearch: UciEval | null = null;
  let attempts: EngineMoveAttempt[] = [];
  if (movetimeCapMs <= 0 || !turn.current()) return;
  let chosen: FFQBanqiMove | null;
  if (tier.evaluation === 'random') {
    const legal = getFFQBanqiLegalMoves(state);
    chosen = legal[Math.min(legal.length - 1, Math.floor(rng() * legal.length))] ?? null;
  } else {
    const result = await resolveValidatedEngineMove<FFQBanqiMove>({
      maxAttempts: ENGINE_MOVE_MAX_ATTEMPTS,
      requestMove: async () => {
        movetimeCapMs = liveBotMoveTime({
          ...budgetInput,
          waitedMs: Date.now() - startedAt,
        }).movetimeMs;
        if (movetimeCapMs <= 0) {
          budgetExhausted = true;
          return null;
        }
        const request = ffqBanqiTierRequestFor(
          state,
          engineId,
          movetimeCapMs,
          remainingMs,
          paceInput.incrementMs,
        );
        const response = await moveProvider(request);
        if (
          response.protocolVersion !== request.protocolVersion ||
          response.gameId !== request.gameId ||
          response.sessionId !== request.sessionId
        )
          throw new Error('FFQ engine response correlation mismatch');
        const uci = response.move ? ffqBanqiMoveToUci(response.move) : null;
        lastSearch = response.search ?? {
          best: uci,
          cp: response.cp ?? null,
          mate: response.mate ?? null,
          depth: 0,
        };
        return uci;
      },
      validate: (uci) => {
        const parsed = uciToFFQBanqiMove(uci);
        return parsed && isFFQBanqiLegalMove(room.projection.state, parsed) ? parsed : null;
      },
      stillOnTurn: () => !budgetExhausted && turn.current(),
      onReject: ({ attempt, uci, reason, error }) =>
        logger.warn(
          {
            kind: 'ffq_banqi_engine_move_rejected',
            room_id: room.id,
            attempt,
            uci,
            reject_reason: reason,
            error,
          },
          'FFQ banqi engine output rejected by kernel; retrying',
        ),
    });
    if (result.aborted) return;
    chosen = result.chosen;
    attempts = result.attempts;
  }
  let writes: Promise<void>;
  do {
    writes = room.pendingWrites;
    await writes;
  } while (writes !== room.pendingWrites);
  if (!turn.current()) return;
  const thinkTimeMs = Date.now() - startedAt;
  const search = lastSearch as UciEval | null;
  // Provider failure keeps its existing immediate terminal outcome.
  const pace = replyPace({
    ...paceInput,
    cp: search?.cp ?? null,
    mate: search?.mate ?? null,
    computeMs: thinkTimeMs,
    ...(chosen === null ? { enabled: false } : {}),
  });
  if (!(await turn.wait(pace.waitMs))) return;
  do {
    writes = room.pendingWrites;
    await writes;
  } while (writes !== room.pendingWrites);
  if (!turn.current()) return;
  // A playtest bot that cannot answer resigns, as banqi's does (fail closed):
  // a silent random move would hide an engine/kernel disagreement.
  const event: FFQBanqiEvent =
    chosen === null
      ? { type: 'seat-resigned', at: Date.now(), roomId: room.id, color: seat }
      : { type: 'move-played', at: Date.now(), roomId: room.id, color: seat, move: chosen };
  if (chosen === null) {
    logger.warn(
      {
        kind: 'ffq_banqi_engine_failed_closed',
        room_id: room.id,
        fen: ffqBanqiStateToFen(state),
      },
      'FFQ banqi engine gave no legal move; resigning its seat',
    );
  }
  // The masked public FEN only: the decision artifact carries nothing the bot
  // seat could not see.
  queueEngineDecision(room, {
    ...buildLiveEngineDecisionPayload({
      variant: 'ffq-banqi',
      roomId: room.id,
      engineId,
      engineVersion: ffqBanqiEngineVersion(engineId)!,
      seat,
      ply: state.ply,
      budgetMs: tier.evaluation === 'random' ? null : movetimeCapMs,
      remainingMs,
      incrementMs: paceInput.incrementMs,
      tier: { nodes: tier.nodes, movetimeMs: tier.movetimeCapMs },
      search: lastSearch,
      thinkTimeMs,
      attempts,
      move: chosen ? ffqBanqiMoveToUci(chosen) : null,
      fen: ffqBanqiStateToFen(state),
      legalCount: paceInput.legalCount,
    }),
    ...replyPacePayload(pace),
  });
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}
