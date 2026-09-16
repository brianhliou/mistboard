/**
 * Server-side Fairy-Stockfish loop for Atomic Xiangqi PvE.
 *
 * Perfect information on the standard 9x10 board, so FSF plays it directly
 * through a custom variants.ini on a patched binary (atomic-xiangqi-fsf-
 * engine.ts). Structurally the Duck Xiangqi loop; the specifics are simpler,
 * because a move is one `<from><to>` token in both directions with no rank
 * shift (a1-i10 on both sides).
 *
 * Conversion is by GENERATING, never by parsing: every candidate string is
 * built from the kernel's own legal moves, and the engine's reply is matched
 * against that set, so an encoding drift shows up as "no legal move matched"
 * and a loud fallback rather than as a wrong move on a real board.
 *
 * TAKE THE WIN. A rung is weakened by Skill Level, which works by choosing a
 * move other than the best one it found, and the duck ladder showed a level-1
 * bot declining a general capture it had in its own PV five times in one
 * game. Removing the enemy general is a property of the move, not of the
 * search (the kernel's `boardAfter` says whether the general survives), so the
 * scan costs ~40 replays and no search, and the bot never leaves a general on
 * offer. Weakness belongs in how the bot builds a position, not in refusing
 * to finish one.
 *
 * Engine moves are injected through the same append+broadcast path as human
 * moves so clocks, persistence, reconnect, and review stay event-sourced.
 */

import {
  type ATOMIC_XIANGQI_SPEC_ID,
  type AtomicXiangqiColor,
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  atomicXiangqiBoardAfterMove,
  getAtomicXiangqiLegalMoves,
  isAtomicXiangqiGeneralInCheck,
} from '@mistboard/game';
import {
  ATOMIC_XIANGQI_FSF_ENGINE_VERSION,
  atomicXiangqiEngineTierFor,
  atomicXiangqiLiveEngineMove,
  isAtomicXiangqiEngineClientId,
} from './atomic-xiangqi-fsf-engine.js';
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
  ATOMIC_XIANGQI_DEFAULT_ENGINE_ID,
  ATOMIC_XIANGQI_FSF_ENGINE_VERSION,
  ATOMIC_XIANGQI_PLAYABLE_ENGINES,
  type AtomicXiangqiEngineTier,
  atomicXiangqiEngineDisplayName,
  atomicXiangqiEngineVersion,
  isAtomicXiangqiEngineClientId,
} from './atomic-xiangqi-fsf-engine.js';

const CLOCK_SAFETY_MS = 1_000;
const MIN_MOVETIME_MS = 50;
const ENGINE_MOVE_MAX_ATTEMPTS = 2;

type AtomicXiangqiEvent = TenantRoomEvent<
  AtomicXiangqiColor,
  AtomicXiangqiMove,
  typeof ATOMIC_XIANGQI_SPEC_ID
>;
type AtomicXiangqiEngineRoom = TenantLiveRoom<
  'atomic-xiangqi',
  AtomicXiangqiColor,
  AtomicXiangqiMove,
  AtomicXiangqiGameState,
  typeof ATOMIC_XIANGQI_SPEC_ID
>;
type AtomicXiangqiEngineContext = TenantLifecycleContext<
  AtomicXiangqiColor,
  AtomicXiangqiMove,
  AtomicXiangqiGameState,
  typeof ATOMIC_XIANGQI_SPEC_ID,
  AtomicXiangqiEngineRoom
>;

/** Why the engine loop declined to move. Every silent return names one (the
 *  duck loop hung silently in prod once; "did nothing" needs an output gate). */
type AtomicXiangqiEngineSkipReason =
  | 'already-scheduled'
  | 'no-engine-seat'
  | 'not-engine-turn'
  | 'unknown-tier'
  | 'clock-expired'
  | 'aborted-mid-search';

function logSkip(room: AtomicXiangqiEngineRoom, reason: AtomicXiangqiEngineSkipReason): void {
  logger.info(
    {
      kind: 'atomic_xiangqi_engine_move_skipped',
      room_id: room.id,
      reason,
      seats: room.projection.seats,
      status: room.projection.state.status.type,
      turn:
        room.projection.state.status.type === 'playing' ? room.projection.state.status.turn : null,
      both_seats_filled: bothSeatsFilled(room),
      ply: room.events.length,
    },
    'Atomic Xiangqi engine declined to move',
  );
}

export function atomicXiangqiEngineSeatFor(
  room: AtomicXiangqiEngineRoom,
): AtomicXiangqiColor | null {
  for (const seat of ['red', 'black'] as const) {
    if (isAtomicXiangqiEngineClientId(room.projection.seats[seat])) return seat;
  }
  for (const seat of ['red', 'black'] as const) {
    const clientId = room.projection.seats[seat];
    if (typeof clientId === 'string' && /^fairy-stockfish/.test(clientId)) {
      logger.error(
        {
          kind: 'atomic_xiangqi_unrecognised_engine_seat',
          room_id: room.id,
          seat,
          client_id: clientId,
        },
        'Atomic Xiangqi seat holds an engine id the atomic registry does not know',
      );
    }
  }
  return null;
}

export function scheduleAtomicXiangqiEngineMove(
  ctx: AtomicXiangqiEngineContext,
  room: AtomicXiangqiEngineRoom,
): void {
  if (room.engineTimer) {
    logSkip(room, 'already-scheduled');
    return;
  }
  const seat = atomicXiangqiEngineSeatFor(room);
  if (seat === null) {
    logSkip(room, 'no-engine-seat');
    return;
  }
  if (!engineToMove(room, seat)) {
    logSkip(room, 'not-engine-turn');
    return;
  }
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playAtomicXiangqiEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        {
          kind: 'atomic_xiangqi_engine_move_failure',
          room_id: room.id,
          error: (err as Error).message,
        },
        'Atomic Xiangqi engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

export type AtomicXiangqiEngineMoveProvider = (
  engineId: string,
  moves: string[],
  opts: { movetimeMs?: number },
) => Promise<UciEval>;

export async function playAtomicXiangqiEngineMoveIfReady(
  ctx: AtomicXiangqiEngineContext,
  room: AtomicXiangqiEngineRoom,
  moveProvider: AtomicXiangqiEngineMoveProvider = atomicXiangqiLiveEngineMove,
): Promise<void> {
  const seat = atomicXiangqiEngineSeatFor(room);
  if (seat === null) {
    logSkip(room, 'no-engine-seat');
    return;
  }
  if (!engineToMove(room, seat)) {
    logSkip(room, 'not-engine-turn');
    return;
  }
  const engineId = room.projection.seats[seat]!;
  const tier = atomicXiangqiEngineTierFor(engineId);
  if (!tier) {
    logSkip(room, 'unknown-tier');
    return;
  }

  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  const incrementMs = clock?.incrementMs ?? 0;
  if (remainingMs !== null && remainingMs <= 0) {
    logSkip(room, 'clock-expired');
    return;
  }

  const askedAt = Date.now();
  const history = atomicXiangqiUciHistory(room.events);
  const { computeBudgetMs: movetimeMs } = budgetForMove({
    remainingMs,
    incrementMs,
    ceilingMs: tier.movetimeMs,
    reserveMs: CLOCK_SAFETY_MS,
    floorMs: MIN_MOVETIME_MS,
  });

  const state = room.projection.state;
  const legalMoves = getAtomicXiangqiLegalMoves(state);
  const winning = atomicXiangqiWinningMove(state, legalMoves, seat);
  if (winning) {
    logger.info(
      {
        kind: 'atomic_xiangqi_engine_took_the_win',
        room_id: room.id,
        engine_id: engineId,
        move: atomicXiangqiMoveToUci(winning),
      },
      'Atomic Xiangqi engine removed the general without searching',
    );
    const win: AtomicXiangqiEvent = {
      type: 'move-played',
      at: Date.now(),
      roomId: room.id,
      color: seat,
      move: winning,
    };
    const winSeq = await ctx.appendEvent(room, win);
    ctx.broadcastEventAppended(room, win, winSeq);
    return;
  }

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
    validate: (uci) => legalMoveForUci(legalMoves, uci),
    stillOnTurn: () => engineToMove(room, seat),
    onReject: ({ attempt, maxAttempts, uci, reason, error }) =>
      logger.warn(
        {
          kind: 'atomic_xiangqi_engine_move_rejected',
          room_id: room.id,
          engine_id: engineId,
          attempt,
          max_attempts: maxAttempts,
          uci,
          reject_reason: reason,
          error,
        },
        'Atomic Xiangqi engine output rejected by kernel; retrying',
      ),
  });
  logger.info(
    {
      kind: 'atomic_xiangqi_engine_answered',
      room_id: room.id,
      elapsed_ms: Date.now() - askedAt,
      validated: validated !== null,
      aborted,
      attempts: attempts.length,
    },
    'Atomic Xiangqi engine call returned',
  );
  if (aborted || !engineToMove(room, seat)) {
    logSkip(room, 'aborted-mid-search');
    return;
  }

  if (validated === null) {
    const record = buildEngineDecisionRecord({
      variant: 'atomic-xiangqi',
      roomId: room.id,
      engineId,
      engineVersion: ATOMIC_XIANGQI_FSF_ENGINE_VERSION,
      movetimeMs,
      tier,
      ply: history.length,
      toMove: seat,
      inCheck: isAtomicXiangqiGeneralInCheck(state.board, seat),
      history,
      legalUci: legalMoves.map(atomicXiangqiMoveToUci),
      attempts,
    });
    // An engine that never answered at the opening is an infrastructure
    // failure, not a game: abort rather than hand the human a resignation.
    // The runtime accepts `game-aborted` only while moveNumber === 1, which
    // for this kernel is the whole first full move (both sides' first ply).
    const abortable = record.unreachable && state.moveNumber === 1;
    reportEngineFallback(
      record,
      'atomic_xiangqi_engine_failed_closed',
      'Atomic Xiangqi',
      abortable ? 'abort' : 'resign',
    );
    const terminal: AtomicXiangqiEvent = abortable
      ? { type: 'game-aborted', at: Date.now(), roomId: room.id, reason: 'engine-unavailable' }
      : { type: 'seat-resigned', at: Date.now(), roomId: room.id, color: seat };
    const seq = await ctx.appendEvent(room, terminal);
    ctx.broadcastEventAppended(room, terminal, seq);
    return;
  }

  reportEngineMoveOk();
  const event: AtomicXiangqiEvent = {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: seat,
    move: validated,
  };
  // Queue BEFORE the append: if this move ends the game, the tenant event
  // writer records the end and flushes the queue inside that same append.
  queueEngineDecision(
    room,
    buildLiveEngineDecisionPayload({
      variant: 'atomic-xiangqi',
      roomId: room.id,
      engineId,
      engineVersion: ATOMIC_XIANGQI_FSF_ENGINE_VERSION,
      seat,
      ply: history.length,
      budgetMs: movetimeMs,
      remainingMs,
      incrementMs,
      tier,
      search: lastSearch,
      thinkTimeMs: Date.now() - startedAt,
      attempts,
      move: atomicXiangqiMoveToUci(validated),
      legalCount: legalMoves.length,
    }),
  );
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}

function bothSeatsFilled(room: AtomicXiangqiEngineRoom): boolean {
  return Boolean(room.projection.seats.red && room.projection.seats.black);
}

function engineToMove(room: AtomicXiangqiEngineRoom, seat: AtomicXiangqiColor): boolean {
  const status = room.projection.state.status;
  return status.type === 'playing' && status.turn === seat && bothSeatsFilled(room);
}

function atomicXiangqiUciHistory(events: readonly AtomicXiangqiEvent[]): string[] {
  return events
    .filter(
      (event): event is Extract<AtomicXiangqiEvent, { type: 'move-played' }> =>
        event.type === 'move-played',
    )
    .map((event) => atomicXiangqiMoveToUci(event.move));
}

/** A kernel move as Fairy-Stockfish spells it: `<from><to>`, a1-i10 on both sides. */
export function atomicXiangqiMoveToUci(move: AtomicXiangqiMove): string {
  return `${move.from}${move.to}`;
}

/**
 * The general-removing move on offer, if any: a capture whose blast (or whose
 * target) is the enemy general. Read off the kernel's own `boardAfter`, so it
 * is the same test legality uses. Shared with the EvE adapter so the rated
 * bot takes the same wins the live one does.
 */
export function atomicXiangqiWinningMove(
  state: AtomicXiangqiGameState,
  legalMoves: readonly AtomicXiangqiMove[],
  color: AtomicXiangqiColor,
): AtomicXiangqiMove | null {
  const enemy: AtomicXiangqiColor = color === 'red' ? 'black' : 'red';
  for (const move of legalMoves) {
    if (state.board[move.to] === undefined) continue;
    const after = atomicXiangqiBoardAfterMove(state.board, move).board;
    const generalSurvives = Object.values(after).some(
      (piece) => piece.role === 'general' && piece.color === enemy,
    );
    if (!generalSurvives) return move;
  }
  return null;
}

/** Match an engine reply against the kernel's legal moves. Generated, never parsed. */
export function legalMoveForUci(
  legalMoves: readonly AtomicXiangqiMove[],
  uci: string,
): AtomicXiangqiMove | null {
  return legalMoves.find((move) => atomicXiangqiMoveToUci(move) === uci) ?? null;
}
