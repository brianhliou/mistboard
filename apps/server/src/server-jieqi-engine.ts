/**
 * Server-side PikaJieQi loop for Jieqi (揭棋) PvE.
 *
 * Tier-B: jieqi is driven by a Pikafish-jieqi UCI subprocess (jieqi-engine.ts),
 * the same shape as the Fairy-Stockfish xiangqi ladder — NOT the hidden-info
 * Misty engine-worker. Unlike xiangqi (perfect info, replayed from move history),
 * jieqi has hidden identities, so we hand the engine a redacted current-position
 * FEN built by jieqi-fen.ts from canonical state. Engine moves are injected
 * through the same append+broadcast path as human moves, so clocks, persistence,
 * reconnect, and review stay event-sourced.
 *
 * The engine SEAT is whichever projection.seats slot holds an engine clientId
 * (jieqi-engine.ts owns the id set); no dedicated room field, so it survives
 * hydration. The room types come from the generic tenant runtime, kept local to
 * avoid an import cycle with server-ws-jieqi.ts.
 */

import {
  getJieqiLegalMoves,
  isJieqiLegalMove,
  type JieqiColor,
  type JieqiGameState,
  type JieqiMove,
} from '@mistboard/game';
import {
  buildEngineDecisionRecord,
  reportEngineFallback,
  reportEngineMoveOk,
  resolveValidatedEngineMove,
} from './engine-move-guard.js';
import { budgetForMove } from './engine-time-budget.js';
import {
  isJieqiEngineClientId,
  JIEQI_ENGINE_VERSION,
  jieqiEngineTierFor,
  jieqiLiveEngineMove,
  pikafishJieqiWarmSessionStats,
} from './jieqi-engine.js';
import {
  jieqiMoveToPikafishUci,
  jieqiStateToPikafishFen,
  pikafishUciToJieqiMove,
} from './jieqi-fen.js';
import type { JieqiEvent, JieqiSpecId } from './jieqi-runtime.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { logger } from './obs.js';
import type { UciEval } from './uci-engine-harness.js';
import {
  buildLiveEngineDecisionPayload,
  queueEngineDecision,
} from './variant-tenant/engine-decisions.js';
import type { TenantLifecycleContext } from './variant-tenant/lifecycle.js';
import {
  applyTenantEvent,
  replayTenantEvents,
  tenantClockRemainingMs,
} from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';
import type { TenantLiveRoom } from './variant-tenant/ws.js';

const CLOCK_SAFETY_MS = 1_000;
const MIN_MOVETIME_MS = 50;

// Bounded retries before failing closed (see engine-move-guard.ts).
const ENGINE_MOVE_MAX_ATTEMPTS = 2;

type JieqiEngineRoom = TenantLiveRoom<'jieqi', JieqiColor, JieqiMove, JieqiGameState, JieqiSpecId>;
type JieqiEngineContext = TenantLifecycleContext<
  JieqiColor,
  JieqiMove,
  JieqiGameState,
  JieqiSpecId,
  JieqiEngineRoom
>;

export function jieqiEngineSeatFor(room: JieqiEngineRoom): JieqiColor | null {
  for (const seat of ['red', 'black'] as const) {
    if (isJieqiEngineClientId(room.projection.seats[seat])) return seat;
  }
  return null;
}

function bothSeatsFilled(room: JieqiEngineRoom): boolean {
  return Boolean(room.projection.seats.red && room.projection.seats.black);
}

function engineToMove(room: JieqiEngineRoom, seat: JieqiColor): boolean {
  const status = room.projection.state.status;
  return status.type === 'playing' && status.turn === seat && bothSeatsFilled(room);
}

// Build the repetition WINDOW for PikaJieQi: the redacted FEN at the last irreversible
// move (capture OR reveal) plus the quiet plies since, sent as `position fen <ws> moves
// <...>` so pikafish's is_repeated() (gated on pliesFromNull>=4) activates and honors the
// xiangqi repetition / perpetual-check / perpetual-chase rules. The window must contain NO
// reveal: a reveal flips a dark piece to an identity the engine cannot replay from a UCI
// move (and noCaptureClock only resets on capture, not reveal), so we detect both here by
// replaying move-by-move — capture = target occupied, reveal = moving piece faceDown.
// Within a window every piece's revealed-ness is constant, so the window-start redacted FEN
// plus the quiet moves leak no hidden identity and replay cleanly. Empty window => FEN only.
// `moves` is only the slice the engine replays; `gameMoves` is the whole game, and
// the decision record needs BOTH. Reporting the window as the game's history is how
// a twelve-ply game paged as a two-ply one on 2026-09-02.
function jieqiEngineRepWindow(room: JieqiEngineRoom): {
  fen: string;
  moves: string[];
  gameMoves: string[];
} {
  const events = room.events as readonly JieqiEvent[];
  const gameMoves: string[] = [];
  for (const event of events) {
    if (event.type === 'move-played') gameMoves.push(jieqiMoveToPikafishUci(event.move));
  }
  const created = events[0];
  if (created?.type !== 'room-created') {
    return { fen: jieqiStateToPikafishFen(room.projection.state), moves: [], gameMoves };
  }
  let proj = replayTenantEvents(jieqiTenant, [created]);
  let startState = proj.state;
  let windowMoves: JieqiMove[] = [];
  for (const event of events.slice(1)) {
    if (event.type !== 'move-played') {
      proj = applyTenantEvent(jieqiTenant, proj, event);
      continue;
    }
    const board = proj.state.board;
    const irreversible = board[event.move.from]?.faceDown === true || board[event.move.to] != null;
    proj = applyTenantEvent(jieqiTenant, proj, event);
    if (irreversible) {
      startState = proj.state;
      windowMoves = [];
    } else {
      windowMoves.push(event.move);
    }
  }
  return {
    fen: jieqiStateToPikafishFen(startState),
    moves: windowMoves.map(jieqiMoveToPikafishUci),
    gameMoves,
  };
}

export function scheduleJieqiEngineMove(ctx: JieqiEngineContext, room: JieqiEngineRoom): void {
  if (room.engineTimer) return;
  const seat = jieqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playJieqiEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        { kind: 'jieqi_engine_move_failure', room_id: room.id, error: (err as Error).message },
        'Jieqi engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

/**
 * The move provider returns the whole search summary, not just the move, so the
 * decision artifact can record what the engine actually did. Tests inject a stub.
 */
export type JieqiEngineMoveProvider = (
  engineId: string,
  fen: string,
  opts: { movetimeMs?: number; moves?: readonly string[]; newGame?: boolean },
) => Promise<UciEval>;

export async function playJieqiEngineMoveIfReady(
  ctx: JieqiEngineContext,
  room: JieqiEngineRoom,
  moveProvider: JieqiEngineMoveProvider = jieqiLiveEngineMove,
): Promise<void> {
  const seat = jieqiEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  const engineId = room.projection.seats[seat]!;
  const tier = jieqiEngineTierFor(engineId);
  if (!tier) return;

  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  const incrementMs = clock?.incrementMs ?? 0;
  if (remainingMs !== null && remainingMs <= 0) return;

  const { fen, moves, gameMoves } = jieqiEngineRepWindow(room);
  // Clock-aware per-move budget (shared allocator). Jieqi's strength anchor is the
  // tier's search DEPTH (set inside jieqiLiveEngineMove); this movetime is the
  // latency ceiling + time-pressure guard. Existing ceiling preserved —
  // behavior-neutral for untimed play; adds increment awareness + graceful shrink.
  const { computeBudgetMs: movetimeMs } = budgetForMove({
    remainingMs,
    incrementMs,
    ceilingMs: tier.movetimeMs,
    reserveMs: CLOCK_SAFETY_MS,
    floorMs: MIN_MOVETIME_MS,
  });

  // Engine-move boundary contract (see engine-move-guard.ts): bounded retries,
  // validate every output against the kernel, FAIL CLOSED (resign + page) rather
  // than silently substituting a threat-blind legal move.
  const startedAt = Date.now();
  const newGame = gameMoves.length <= 1;
  let lastSearch: UciEval | null = null;
  const {
    chosen: validated,
    attempts,
    aborted,
  } = await resolveValidatedEngineMove<JieqiMove>({
    maxAttempts: ENGINE_MOVE_MAX_ATTEMPTS,
    requestMove: async () => {
      const search = await moveProvider(engineId, fen, { movetimeMs, moves, newGame });
      lastSearch = search;
      return search.best;
    },
    validate: (uci) => {
      const parsed = pikafishUciToJieqiMove(uci);
      return parsed && isJieqiLegalMove(room.projection.state, parsed) ? parsed : null;
    },
    stillOnTurn: () => engineToMove(room, seat),
    onReject: ({ attempt, maxAttempts, uci, reason, error }) =>
      logger.warn(
        {
          kind: 'jieqi_engine_move_rejected',
          room_id: room.id,
          engine_id: engineId,
          attempt,
          max_attempts: maxAttempts,
          uci,
          reject_reason: reason,
          error,
        },
        'Jieqi engine output rejected by kernel; retrying',
      ),
  });
  if (aborted || !engineToMove(room, seat)) return;

  if (validated === null) {
    // FAIL CLOSED: capture a complete replayable record, page, and resign. Jieqi
    // is perfect-information at decision time (only hidden piece identities, which
    // do not change the current legal-move set), so a rejected move is a bug.
    const record = buildEngineDecisionRecord({
      variant: 'jieqi',
      roomId: room.id,
      engineId,
      engineVersion: JIEQI_ENGINE_VERSION,
      movetimeMs,
      tier: { movetimeMs: tier.movetimeMs },
      ply: gameMoves.length,
      toMove: seat,
      inCheck: false,
      fen,
      history: gameMoves,
      engineWindow: moves,
      legalUci: getJieqiLegalMoves(room.projection.state).map(jieqiMoveToPikafishUci),
      attempts,
    });
    // An engine that never answered at the opening is an infrastructure failure, not
    // a game: void it instead of handing the human a win by "resignation" (#296).
    // The tenant runtime only applies an abort while the full-move number is 1, so
    // the same guard (at most one ply played) is what makes it a real abort here.
    const abortable = record.unreachable && newGame;
    reportEngineFallback(
      record,
      'jieqi_engine_failed_closed',
      'Jieqi',
      abortable ? 'abort' : 'resign',
    );
    const terminal: TenantRoomEvent<JieqiColor, JieqiMove, JieqiSpecId> = abortable
      ? { type: 'game-aborted', at: Date.now(), roomId: room.id, reason: 'engine-unavailable' }
      : { type: 'seat-resigned', at: Date.now(), roomId: room.id, color: seat };
    const seq = await ctx.appendEvent(room, terminal);
    ctx.broadcastEventAppended(room, terminal, seq);
    return;
  }

  reportEngineMoveOk();
  logger.info(
    {
      kind: 'jieqi_engine_move_ok',
      room_id: room.id,
      engine_id: engineId,
      ply: gameMoves.length,
      movetime_ms: movetimeMs,
      elapsed_ms: Date.now() - startedAt,
      attempts: attempts.length,
      warm: pikafishJieqiWarmSessionStats(),
    },
    'Jieqi engine move accepted',
  );
  const event: TenantRoomEvent<JieqiColor, JieqiMove, JieqiSpecId> = {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: seat,
    move: validated,
  };
  // Queue BEFORE the append: if this move ends the game, the tenant event writer
  // records the game end and flushes the queue inside that same append, and a
  // decision queued afterwards would never be written. The log line above is
  // live-only and dies with the container; this is the durable copy, and it adds
  // the depth the search reached — the one number that says whether a depth-capped
  // rung is actually searching to its cap.
  queueEngineDecision(
    room,
    buildLiveEngineDecisionPayload({
      variant: 'jieqi',
      roomId: room.id,
      engineId,
      engineVersion: JIEQI_ENGINE_VERSION,
      seat,
      ply: gameMoves.length,
      budgetMs: movetimeMs,
      remainingMs,
      incrementMs,
      tier: {
        movetimeMs: tier.movetimeMs,
        ...(tier.depth === undefined ? {} : { depth: tier.depth }),
      },
      search: lastSearch,
      thinkTimeMs: Date.now() - startedAt,
      attempts,
      move: jieqiMoveToPikafishUci(validated),
      fen,
      legalCount: getJieqiLegalMoves(room.projection.state).length,
    }),
  );
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}
