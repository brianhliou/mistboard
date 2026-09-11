/**
 * Server-side Fairy-Stockfish loop for Duck Xiangqi PvE.
 *
 * Duck Xiangqi is perfect-information (standard 9x10 xiangqi plus Duck Chess's
 * shared, uncapturable blocker), so it uses FSF directly via a custom
 * variants.ini on a patched binary (duck-xiangqi-fsf-engine.ts). Structurally
 * this mirrors the Fortress Xiangqi loop; the specifics are the UCI translation
 * below and the two things Duck Xiangqi does not have (check, and a cheap
 * immediate-loss guard).
 *
 * THE ENCODING. A turn is a piece move AND a duck placement, and FSF spells the
 * whole turn as ONE token:
 *
 *     <pieceFrom><pieceTo>,<pieceTo><duckTo>          e.g.  a1a2,a2e5
 *
 * Squares are `a1`-`i10`, identical to DuckXiangqiSquare: a straight
 * passthrough, with none of the rank shift the Pikafish/FSF xiangqi providers
 * need. The duck half's "from" is a redundant echo of the PIECE's destination,
 * not the duck's current square (measured on the real binary: with the duck on
 * e5, every duck half read `e9…` once a piece landed on e9).
 *
 * Conversion is by GENERATING, never by parsing: every candidate FSF string is
 * built from the kernel's own `getDuckXiangqiLegalTurns`, and the engine's reply
 * is matched against that set. So an encoding drift shows up as "no legal move
 * matched", which the fail-closed guard turns into a loud page, rather than as a
 * wrong move played on a real board.
 *
 * THE ONE ASYMMETRY: a general capture. The kernel ends the game on the capture,
 * so it emits exactly ONE turn, `{from, to, duckTo: null}`. FSF places the duck
 * on every legal point anyway and emits one token per point (measured: 87 tokens
 * for a single kernel turn on a sparse board). The kernel turn therefore has no
 * one-token FSF spelling, and a general capture is matched on the piece half
 * alone. It never travels in the other direction: the turn that captures ends
 * the game, so it can only ever be a game's LAST turn and is never replayed into
 * a `position startpos moves …` line.
 *
 * Engine moves are injected through the same append+broadcast path as human
 * moves so clocks, persistence, reconnect, and review stay event-sourced.
 */

import {
  type DUCK_XIANGQI_SPEC_ID,
  type DuckXiangqiColor,
  type DuckXiangqiGameState,
  type DuckXiangqiTurn,
  getDuckXiangqiLegalTurns,
} from '@mistboard/game';
import {
  DUCK_XIANGQI_FSF_ENGINE_VERSION,
  duckXiangqiEngineTierFor,
  duckXiangqiLiveEngineMove,
  isDuckXiangqiEngineClientId,
} from './duck-xiangqi-fsf-engine.js';
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

// Re-export the engine metadata so the tenant, registration, and rooms route
// resolve these from this module (matching the Fortress layout).
export {
  DUCK_XIANGQI_DEFAULT_ENGINE_ID,
  DUCK_XIANGQI_FSF_ENGINE_VERSION,
  DUCK_XIANGQI_PLAYABLE_ENGINES,
  type DuckXiangqiEngineTier,
  duckXiangqiEngineDisplayName,
  duckXiangqiEngineVersion,
  isDuckXiangqiEngineClientId,
} from './duck-xiangqi-fsf-engine.js';

const CLOCK_SAFETY_MS = 1_000;
const MIN_MOVETIME_MS = 50;
const ENGINE_MOVE_MAX_ATTEMPTS = 2;

type DuckXiangqiEngineRoom = TenantLiveRoom<
  'duck-xiangqi',
  DuckXiangqiColor,
  DuckXiangqiTurn,
  DuckXiangqiGameState,
  typeof DUCK_XIANGQI_SPEC_ID
>;
type DuckXiangqiEngineContext = TenantLifecycleContext<
  DuckXiangqiColor,
  DuckXiangqiTurn,
  DuckXiangqiGameState,
  typeof DUCK_XIANGQI_SPEC_ID,
  DuckXiangqiEngineRoom
>;

/** Why the engine loop declined to move. Every silent return names one.
 *
 *  This exists because a duck PvE game hung in production on 2026-09-11 and
 *  the loop wrote NOTHING: six branches could each produce that exact symptom
 *  and there was no way to tell them apart from outside. "Did nothing" is a
 *  fallback, and a fallback needs an output gate. */
type DuckXiangqiEngineSkipReason =
  | 'already-scheduled'
  | 'no-engine-seat'
  | 'not-engine-turn'
  | 'unknown-tier'
  | 'clock-expired'
  | 'aborted-mid-search';

function logDuckXiangqiEngineSkip(
  room: DuckXiangqiEngineRoom,
  reason: DuckXiangqiEngineSkipReason,
): void {
  logger.info(
    {
      kind: 'duck_xiangqi_engine_move_skipped',
      room_id: room.id,
      reason,
      seats: room.projection.seats,
      status: room.projection.state.status.type,
      turn:
        room.projection.state.status.type === 'playing' ? room.projection.state.status.turn : null,
      // `engineToMove` is a conjunction of three things and the first two are
      // visible above; this is the third, and it is the one that reads as a
      // hang rather than as a finished game: an unfilled human seat means the
      // engine waits forever for an opponent who never arrived.
      both_seats_filled: bothSeatsFilled(room),
      ply: room.events.length,
    },
    'Duck Xiangqi engine declined to move',
  );
}

export function duckXiangqiEngineSeatFor(room: DuckXiangqiEngineRoom): DuckXiangqiColor | null {
  for (const seat of ['red', 'black'] as const) {
    if (isDuckXiangqiEngineClientId(room.projection.seats[seat])) return seat;
  }
  // Nothing in this room's seats looked like a duck engine id. A seat holding
  // an engine-SHAPED id we do not recognise is the interesting case: it means
  // the seating half and the engine-registry half disagree about duck (the
  // same class of split that left duck out of bot_profiles.supported_game_spec_ids
  // until migration 138), and it is worth more than a null.
  for (const seat of ['red', 'black'] as const) {
    const clientId = room.projection.seats[seat];
    if (typeof clientId === 'string' && /^fairy-stockfish/.test(clientId)) {
      logger.error(
        {
          kind: 'duck_xiangqi_unrecognised_engine_seat',
          room_id: room.id,
          seat,
          client_id: clientId,
        },
        'Duck Xiangqi seat holds an engine id the duck registry does not know',
      );
    }
  }
  return null;
}

export function scheduleDuckXiangqiEngineMove(
  ctx: DuckXiangqiEngineContext,
  room: DuckXiangqiEngineRoom,
): void {
  logger.info(
    {
      kind: 'duck_xiangqi_engine_schedule_entered',
      room_id: room.id,
      seats: room.projection.seats,
      status: room.projection.state.status.type,
      has_timer: room.engineTimer !== null && room.engineTimer !== undefined,
      ply: room.events.length,
    },
    'Duck Xiangqi engine scheduler entered',
  );
  if (room.engineTimer) {
    logDuckXiangqiEngineSkip(room, 'already-scheduled');
    return;
  }
  const seat = duckXiangqiEngineSeatFor(room);
  if (seat === null) {
    logDuckXiangqiEngineSkip(room, 'no-engine-seat');
    return;
  }
  if (!engineToMove(room, seat)) {
    // Ordinary and expected when the HUMAN has the first-mover seat: the loop
    // is simply waiting for them. Logged anyway, because the alternative is
    // that "waiting for the human" and "broken" look identical in the logs.
    logDuckXiangqiEngineSkip(room, 'not-engine-turn');
    return;
  }
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playDuckXiangqiEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        {
          kind: 'duck_xiangqi_engine_move_failure',
          room_id: room.id,
          error: (err as Error).message,
        },
        'Duck Xiangqi engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

/**
 * The move provider returns the whole search summary, not just the move, so the
 * decision artifact can record what the engine did. Tests inject a stub.
 */
export type DuckXiangqiEngineMoveProvider = (
  engineId: string,
  moves: string[],
  opts: { movetimeMs?: number },
) => Promise<UciEval>;

export async function playDuckXiangqiEngineMoveIfReady(
  ctx: DuckXiangqiEngineContext,
  room: DuckXiangqiEngineRoom,
  moveProvider: DuckXiangqiEngineMoveProvider = duckXiangqiLiveEngineMove,
): Promise<void> {
  const seat = duckXiangqiEngineSeatFor(room);
  if (seat === null) {
    logDuckXiangqiEngineSkip(room, 'no-engine-seat');
    return;
  }
  if (!engineToMove(room, seat)) {
    logDuckXiangqiEngineSkip(room, 'not-engine-turn');
    return;
  }
  const engineId = room.projection.seats[seat]!;
  const tier = duckXiangqiEngineTierFor(engineId);
  if (!tier) {
    logDuckXiangqiEngineSkip(room, 'unknown-tier');
    return;
  }

  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  const incrementMs = clock?.incrementMs ?? 0;
  if (remainingMs !== null && remainingMs <= 0) {
    logDuckXiangqiEngineSkip(room, 'clock-expired');
    return;
  }

  logger.info(
    {
      kind: 'duck_xiangqi_engine_asking',
      room_id: room.id,
      engine_id: engineId,
      tier: tier.id,
      ply: room.events.length,
    },
    'Duck Xiangqi asking the engine for a move',
  );
  const askedAt = Date.now();
  const history = duckXiangqiUciHistory(room.events);
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

  // Materialised ONCE per engine move, not per attempt. The legal set here runs
  // to thousands of turns (~2,554 from the opening array, peaking near 4,901),
  // and the kernel is explicit that building it is the expensive operation. It is
  // safe to reuse across attempts because `resolveValidatedEngineMove` only calls
  // `validate` while `stillOnTurn()` holds, and the only thing that flips the
  // turn is a move being appended.
  const legalTurns = getDuckXiangqiLegalTurns(room.projection.state);

  // TAKE THE WIN. Capturing the general ends the game, and a rung is weakened by
  // Skill Level, which works by choosing a move OTHER than the best one it found.
  // Measured at level 1 on a real game: the engine reported `score mate 1` with
  // the capture in its own PV and played elsewhere, declining the same win five
  // times in one game while the human watched.
  //
  // Weakness belongs in how the bot builds a position, not in refusing to finish
  // one: a bot that will not take a general on offer makes a game unendable, and
  // reads as broken rather than as beginner. This is the mirror of the
  // immediate-loss guards the fortress and drop-mini loops already run, and it is
  // far cheaper than they are: the legal turns are already materialised, and a
  // capture is a property of the destination square, so it costs a scan and no
  // search at all.
  const winning = legalTurns.find((turn) => {
    const target = room.projection.state.board[turn.to];
    return target?.role === 'general' && target.color !== seat;
  });
  if (winning) {
    logger.info(
      {
        kind: 'duck_xiangqi_engine_took_the_win',
        room_id: room.id,
        engine_id: engineId,
        move: duckXiangqiTurnToFsfUci(winning),
      },
      'Duck Xiangqi engine captured the general without searching',
    );
    const win: TenantRoomEvent<DuckXiangqiColor, DuckXiangqiTurn, typeof DUCK_XIANGQI_SPEC_ID> = {
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
    validate: (uci) => legalTurnForUci(legalTurns, uci),
    stillOnTurn: () => engineToMove(room, seat),
    onReject: ({ attempt, maxAttempts, uci, reason, error }) =>
      logger.warn(
        {
          kind: 'duck_xiangqi_engine_move_rejected',
          room_id: room.id,
          engine_id: engineId,
          attempt,
          max_attempts: maxAttempts,
          uci,
          reject_reason: reason,
          error,
        },
        'Duck Xiangqi engine output rejected by kernel; retrying',
      ),
  });
  logger.info(
    {
      kind: 'duck_xiangqi_engine_answered',
      room_id: room.id,
      elapsed_ms: Date.now() - askedAt,
      validated: validated !== null,
      aborted,
      attempts: attempts.length,
    },
    'Duck Xiangqi engine call returned',
  );
  if (aborted || !engineToMove(room, seat)) {
    logDuckXiangqiEngineSkip(room, 'aborted-mid-search');
    return;
  }

  if (validated === null) {
    const record = buildEngineDecisionRecord({
      variant: 'duck-xiangqi',
      roomId: room.id,
      engineId,
      engineVersion: DUCK_XIANGQI_FSF_ENGINE_VERSION,
      movetimeMs,
      tier,
      ply: history.length,
      toMove: seat,
      // D4 removed check from this variant: capturing the general is a normal
      // move that ends the game, so there is no in-check predicate to report.
      inCheck: false,
      history,
      legalUci: legalTurns.map(duckXiangqiTurnToFsfUci),
      attempts,
    });
    // An engine that NEVER ANSWERED at the opening is an infrastructure failure,
    // not a game. Resigning there hands the human a win and writes it to the
    // games table as an ordinary resignation, so a broken deploy looks like a
    // run of legitimate results instead of an incident. A missing binary is
    // exactly this case: the resolver throws rather than falling back, because
    // stock Fairy-Stockfish cannot play this variant.
    //
    // REACHABLE ONLY WHEN THE BOT HAS RED. The runtime's reducer accepts a
    // `game-aborted` only while `moveNumber === 1`, and this kernel counts
    // moveNumber per TURN rather than per full move, so the window shuts after
    // Red's first turn. A bot on black is already at moveNumber 2 when it first
    // moves and can only resign. That divergence is the kernel's, not this
    // loop's: variants whose moveNumber is a real full-move number get the whole
    // opening. Worth aligning, and not worth special-casing here.
    const abortable = record.unreachable && room.projection.state.moveNumber === 1;
    reportEngineFallback(
      record,
      'duck_xiangqi_engine_failed_closed',
      'Duck Xiangqi',
      abortable ? 'abort' : 'resign',
    );
    const terminal: TenantRoomEvent<
      DuckXiangqiColor,
      DuckXiangqiTurn,
      typeof DUCK_XIANGQI_SPEC_ID
    > = abortable
      ? { type: 'game-aborted', at: Date.now(), roomId: room.id, reason: 'engine-unavailable' }
      : { type: 'seat-resigned', at: Date.now(), roomId: room.id, color: seat };
    const seq = await ctx.appendEvent(room, terminal);
    ctx.broadcastEventAppended(room, terminal, seq);
    return;
  }

  reportEngineMoveOk();
  // No immediate-loss guard here, unlike Fortress and Drop Mini. That guard
  // replays every legal reply to every candidate move; on this board that is
  // thousands of turns times thousands of replies per ply, which would cost more
  // than the search it is protecting. The node-anchored rungs are the strength
  // control instead.
  const event: TenantRoomEvent<DuckXiangqiColor, DuckXiangqiTurn, typeof DUCK_XIANGQI_SPEC_ID> = {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: seat,
    move: validated,
  };
  // Queue BEFORE the append: if this turn captures the general, the tenant event
  // writer records the game end and flushes the queue inside that same append,
  // and a decision queued afterwards would never be written.
  queueEngineDecision(
    room,
    buildLiveEngineDecisionPayload({
      variant: 'duck-xiangqi',
      roomId: room.id,
      engineId,
      engineVersion: DUCK_XIANGQI_FSF_ENGINE_VERSION,
      seat,
      ply: history.length,
      budgetMs: movetimeMs,
      remainingMs,
      incrementMs,
      tier,
      search: lastSearch,
      thinkTimeMs: Date.now() - startedAt,
      attempts,
      move: duckXiangqiTurnToFsfUci(validated),
      legalCount: legalTurns.length,
    }),
  );
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}

function bothSeatsFilled(room: DuckXiangqiEngineRoom): boolean {
  return Boolean(room.projection.seats.red && room.projection.seats.black);
}

function engineToMove(room: DuckXiangqiEngineRoom, seat: DuckXiangqiColor): boolean {
  const status = room.projection.state.status;
  return status.type === 'playing' && status.turn === seat && bothSeatsFilled(room);
}

function duckXiangqiUciHistory(
  events: readonly TenantRoomEvent<
    DuckXiangqiColor,
    DuckXiangqiTurn,
    typeof DUCK_XIANGQI_SPEC_ID
  >[],
): string[] {
  return events
    .filter(
      (
        event,
      ): event is Extract<
        TenantRoomEvent<DuckXiangqiColor, DuckXiangqiTurn, typeof DUCK_XIANGQI_SPEC_ID>,
        { type: 'move-played' }
      > => event.type === 'move-played',
    )
    .map((event) => duckXiangqiTurnToFsfUci(event.move));
}

/** The piece half of a turn: `<from><to>`, and the whole FSF spelling of a
 *  general capture. Squares pass through unchanged (both sides use a1-i10). */
function duckXiangqiPieceHalfUci(turn: DuckXiangqiTurn): string {
  return `${turn.from}${turn.to}`;
}

/**
 * A kernel turn as Fairy-Stockfish spells it: `<from><to>,<to><duckTo>`, the
 * duck half's origin being the redundant echo of the piece's destination.
 *
 * A general-capture turn (`duckTo: null`) returns the piece half ALONE. That is
 * not FSF's own spelling — FSF appends a duck placement there too and so writes
 * the same kernel turn once per legal duck point — but it is the only part of
 * that turn the kernel models, it is what `legalTurnForUci` matches on, and it
 * never has to round-trip: the game ends on the capture, so the turn is never
 * replayed into a `position startpos moves …` line.
 */
export function duckXiangqiTurnToFsfUci(turn: DuckXiangqiTurn): string {
  const piece = duckXiangqiPieceHalfUci(turn);
  return turn.duckTo === null ? piece : `${piece},${turn.to}${turn.duckTo}`;
}

/**
 * Match an engine reply against the kernel's legal turns, returning the KERNEL's
 * own turn object. Generated, never parsed: the only structure read out of the
 * engine's string is the comma, and only to recover the piece half for the
 * general-capture case.
 */
export function legalTurnForUci(
  legalTurns: readonly DuckXiangqiTurn[],
  uci: string,
): DuckXiangqiTurn | null {
  for (const turn of legalTurns) {
    if (turn.duckTo !== null && duckXiangqiTurnToFsfUci(turn) === uci) return turn;
  }
  // General capture: the kernel has one turn where FSF has one per duck point,
  // so the duck half carries no information and the piece half is the whole
  // match. Restricted to capture turns, so this can never rescue a malformed
  // token for an ordinary turn.
  const pieceHalf = uci.split(',')[0];
  for (const turn of legalTurns) {
    if (turn.duckTo === null && duckXiangqiPieceHalfUci(turn) === pieceHalf) return turn;
  }
  return null;
}
