/**
 * Bot-match arbiter.
 *
 * Plays a full Fog-of-War chess game between two engines that are each reached
 * through the redacted engine protocol. The arbiter owns the canonical
 * `GameState` + event log + clock; each ply it builds a fog-redacted
 * `EngineTurnRequest` via `buildEngineTurnRequest` (THE security boundary) and
 * hands it to a per-seat move provider. The provider is injected, so the same
 * loop drives:
 *   - deterministic fake engines in tests (no network), and
 *   - real engines over HTTP in the self-test / real match (see http-move-provider.ts).
 *
 * SAFETY INVARIANT: the ONLY thing ever handed to a provider is the output of
 * `buildEngineTurnRequest`. No canonical state, event log, seed secret, or
 * opponent-hidden info ever crosses the provider boundary. Redaction is correct
 * by construction because the request is the sole channel. `arbiter.test.ts`
 * re-asserts the hidden-info property at this boundary.
 *
 * This module has ZERO persistence and ZERO network dependencies. It maintains
 * state purely in memory via `replayGameEvents`, mirroring the canonical
 * offline runner (engine-runner.ts) minus all the DB writes.
 */
import {
  type Color,
  capturedRoleFor,
  clockRemainingMs,
  type EngineDiagnostics,
  type EngineObservationPush,
  type EngineTurnRequest,
  expireClock,
  type GameEvent,
  type Move,
  replayGameEvents,
  type VariantId,
  variantForId,
} from '@mistboard/game';
import { buildEngineObservationPush, buildEngineTurnRequest } from '../engine-protocol/build.js';
import {
  clockStartedEvent,
  type EngineTaskTimeControl,
  roomTimeControlFromEngine,
} from '../engine-time-policy.js';
import { computeEngineBudget, type EngineTimePolicy } from '../fow-engine-budget.js';

const DEFAULT_MAX_PLIES = 200;
const DEFAULT_UNTIMED_BUDGET_MS = 1_000;
const DEFAULT_UNTIMED_WATCHDOG_MS = 60_000;

/** What the arbiter grants an engine for a single move. */
export type ArbiterMoveContext = {
  color: Color;
  engineId: string;
  ply: number;
  /** Think-time budget (ms) we grant this move — the live per-move budget rule. */
  budgetMs: number;
  /** Hard wall-clock deadline (ms) for producing a move. */
  watchdogMs: number;
};

/** A provider's answer for one move. */
export type ArbiterMove = {
  move: Move;
  /**
   * Time the engine spent, in ms. If omitted, the arbiter substitutes the
   * measured wall-clock round-trip. Fakes set this explicitly for determinism.
   */
  thinkTimeMs?: number;
  diagnostics?: EngineDiagnostics;
};

/**
 * Obtains a move for one seat, given ONLY the redacted request. Throwing (or
 * returning a move outside `request.legalMoves`) forfeits the game for that
 * seat — the guard a real third-party bot needs.
 */
export type ArbiterMoveProvider = (
  request: EngineTurnRequest,
  ctx: ArbiterMoveContext,
) => Promise<ArbiterMove>;

export type ArbiterSeat = {
  engineId: string;
  provider: ArbiterMoveProvider;
  /**
   * Optional post-move observation sink: called immediately after this seat's
   * move is applied and BEFORE the opponent replies, so the engine can observe
   * its own move (new vantage) and think on the opponent's clock. Best-effort —
   * a rejection is swallowed (the same observation still reaches the engine in
   * its next turn request). Omit for engines that don't ponder / tests.
   */
  observe?: (push: EngineObservationPush) => Promise<void>;
};

export type ArbiterConfig = {
  gameId: string;
  /** Defaults to 'dark-chess'. */
  variant?: VariantId;
  /** Seeds the engine RNG (see deriveEngineSeed). Any stable value; use the prod secret for live-identical play. */
  engineSecret: string;
  white: ArbiterSeat;
  black: ArbiterSeat;
  /** Symmetric clock. Omit / null for an untimed game (tests, quick smokes). */
  timeControl?: { initialMs: number; incrementMs: number } | null;
  /**
   * How the per-move budget is derived from the clock. Defaults to
   * 'self-managed' (engine's ceiling = its whole clock; arbiter enforces
   * flag-fall) — the fair external-match model. Use 'live-cap' to reproduce
   * live PvE's tight per-move cap exactly.
   */
  timePolicy?: EngineTimePolicy;
  maxPlies?: number;
  /**
   * Play the first N plies as arbiter-chosen random-legal moves before the
   * engines take over. Diversifies the starting position so a bot-vs-bot series
   * measures strength rather than a deterministic first-mover line. The engines
   * still receive the full (fogged) observation history of these moves.
   */
  randomOpeningPlies?: number;
  /**
   * Seed for the opening RNG. Pairs of games that share an openingSeed but swap
   * colors get the SAME opening from both sides (balanced-pair design). Falls
   * back to a hash of gameId.
   */
  openingSeed?: number;
  /** Injectable for deterministic tests. Defaults to Date.now(). */
  startedAtMs?: number;
  /** Wall clock used to measure provider round-trips. Defaults to Date.now. */
  now?: () => number;
  /** Per-move budget when untimed. */
  untimedBudgetMs?: number;
  untimedWatchdogMs?: number;
  /** Optional per-move observer (logging / progress). */
  onMove?: (info: {
    ply: number;
    color: Color;
    engineId: string;
    move: Move;
    thinkTimeMs: number;
    diagnostics?: EngineDiagnostics;
  }) => void;
};

export type ArbiterOutcome =
  | 'king-captured'
  | 'draw'
  | 'no-legal-moves'
  | 'truncated'
  | 'clock-expired'
  | 'illegal-move-forfeit'
  | 'provider-error-forfeit';

export type ArbiterResult = {
  gameId: string;
  variant: VariantId;
  winner: Color | null;
  outcome: ArbiterOutcome;
  plyCount: number;
  events: GameEvent[];
  whiteEngineId: string;
  blackEngineId: string;
  /** Set on forfeit / timeout: the seat that lost the game for a non-board reason. */
  forfeitedBy?: Color;
  /** Human-readable detail (attempted illegal move, provider error). */
  detail?: string;
};

export async function runArbiterGame(cfg: ArbiterConfig): Promise<ArbiterResult> {
  const variant: VariantId = cfg.variant ?? 'dark-chess';
  const maxPlies = cfg.maxPlies ?? DEFAULT_MAX_PLIES;
  const startedAt = cfg.startedAtMs ?? Date.now();
  const now = cfg.now ?? Date.now;
  const timePolicy: EngineTimePolicy = cfg.timePolicy ?? 'self-managed';
  const rules = variantForId(variant);

  const timeControl: EngineTaskTimeControl = cfg.timeControl
    ? {
        kind: 'standard',
        initial_seconds: cfg.timeControl.initialMs / 1000,
        increment_seconds: cfg.timeControl.incrementMs / 1000,
      }
    : { kind: 'none' };
  const roomTimeControl = roomTimeControlFromEngine(timeControl);

  const gameId = cfg.gameId;
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: startedAt,
      roomId: gameId,
      variant,
      ...(roomTimeControl ? { timeControl: roomTimeControl } : {}),
    },
    {
      type: 'seat-assigned',
      at: startedAt,
      roomId: gameId,
      clientId: 'engine:white',
      seat: 'white',
    },
    {
      type: 'seat-assigned',
      at: startedAt,
      roomId: gameId,
      clientId: 'engine:black',
      seat: 'black',
    },
  ];
  const clockEvent = clockStartedEvent(gameId, startedAt, timeControl);
  if (clockEvent) events.push(clockEvent);

  const seatFor = (color: Color): ArbiterSeat => (color === 'white' ? cfg.white : cfg.black);
  const result = (
    partial: Omit<
      ArbiterResult,
      'gameId' | 'variant' | 'events' | 'plyCount' | 'whiteEngineId' | 'blackEngineId'
    >,
  ): ArbiterResult => ({
    gameId,
    variant,
    events,
    plyCount: moveCount(events),
    whiteEngineId: cfg.white.engineId,
    blackEngineId: cfg.black.engineId,
    ...partial,
  });

  let projection = replayGameEvents(events);

  while (projection.state.status.type === 'playing') {
    const color = projection.state.status.turn;
    const ply = moveCount(events);
    const legalMoves = rules.getLegalMoves(projection.state, color);

    if (legalMoves.length === 0) {
      // No pseudo-legal fog move (rare, no check concept in dark chess): score a draw.
      return result({ winner: null, outcome: 'no-legal-moves' });
    }
    if (ply >= maxPlies) {
      return result({ winner: null, outcome: 'truncated' });
    }

    const clock = projection.state.clock;
    const remainingMs = clock ? clockRemainingMs(clock, color, latestEventAt(events)) : undefined;
    let budgetMs: number;
    let watchdogMs: number;
    if (remainingMs === undefined) {
      // Untimed is a plumbing/test mode only; keep a generous watchdog for cold starts.
      budgetMs = cfg.untimedBudgetMs ?? DEFAULT_UNTIMED_BUDGET_MS;
      watchdogMs = cfg.untimedWatchdogMs ?? DEFAULT_UNTIMED_WATCHDOG_MS;
    } else {
      const budget = computeEngineBudget(timePolicy, {
        clockRemainingMs: remainingMs,
        incrementMs: clock?.incrementMs ?? 0,
        untimedFallbackMs: 0,
      });
      budgetMs = budget.computeBudgetMs;
      watchdogMs = budget.watchdogTimeoutMs;
    }

    const seat = seatFor(color);
    // THE only channel to the engine: the redacted request. cold:true matches
    // the live serving path (live-engine.ts) — no cross-turn session state.
    const request = buildEngineTurnRequest({
      gameId,
      engineId: seat.engineId,
      engineSecret: cfg.engineSecret,
      engineColor: color,
      state: projection.state,
      events,
      ply,
      cold: true,
    });

    const t0 = now();
    let provided: ArbiterMove;
    try {
      provided = await seat.provider(request, {
        color,
        engineId: seat.engineId,
        ply,
        budgetMs,
        watchdogMs,
      });
    } catch (err) {
      return result({
        winner: opponent(color),
        outcome: 'provider-error-forfeit',
        forfeitedBy: color,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    const measuredMs = Math.max(0, now() - t0);
    const thinkTimeMs = Math.round(provided.thinkTimeMs ?? measuredMs);

    // Validate the move is one we actually offered. An external bot returning
    // anything else forfeits — no illegal move ever reaches applyMove.
    if (!request.legalMoves.some((m) => movesEqual(m, provided.move))) {
      return result({
        winner: opponent(color),
        outcome: 'illegal-move-forfeit',
        forfeitedBy: color,
        detail: `move ${moveLabel(provided.move)} not in legalMoves`,
      });
    }

    // Flag-fall: the engine spent more than its remaining time.
    if (remainingMs !== undefined && thinkTimeMs > remainingMs) {
      const at = latestEventAt(events) + Math.max(1, thinkTimeMs);
      const expired = expireClock(clock, at, color);
      if (expired) {
        events.push({ type: 'clock-expired', at, roomId: gameId, color, clock: expired });
      }
      return result({ winner: opponent(color), outcome: 'clock-expired', forfeitedBy: color });
    }

    const at = latestEventAt(events) + Math.max(1, thinkTimeMs);
    const prevState = projection.state;
    const captured = capturedRoleFor(projection.state, provided.move);
    events.push({
      type: 'move-played',
      at,
      roomId: gameId,
      color,
      move: provided.move,
      ...(captured ? { capturedRole: captured } : {}),
      thinkTimeMs,
    });
    projection = replayGameEvents(events);

    // Push this seat its own-move observation NOW, before the opponent replies,
    // so it can observe its new vantage and think on the opponent's clock. The
    // same observation also rides in its next turn request, so this is a
    // best-effort optimization: a failure never affects the game.
    if (seat.observe) {
      await seat
        .observe(
          buildEngineObservationPush({
            gameId,
            engineId: seat.engineId,
            engineColor: color,
            prevState,
            nextState: projection.state,
            move: provided.move,
            ply: moveCount(events),
            ...(variant === 'dark-chess' ? {} : { gameSpecId: variant }),
          }),
        )
        .catch(() => {});
    }
    cfg.onMove?.({
      ply,
      color,
      engineId: seat.engineId,
      move: provided.move,
      thinkTimeMs,
      diagnostics: provided.diagnostics,
    });
  }

  const status = projection.state.status;
  if (status.type === 'finished') {
    return result({
      winner: status.winner,
      outcome: status.reason === 'king-captured' ? 'king-captured' : 'draw',
    });
  }
  // Should be unreachable (loop only exits on !playing), but stay defensive.
  return result({ winner: null, outcome: 'truncated' });
}

function moveCount(events: GameEvent[]): number {
  let n = 0;
  for (const e of events) if (e.type === 'move-played') n += 1;
  return n;
}

function latestEventAt(events: GameEvent[]): number {
  return events[events.length - 1]?.at ?? 0;
}

function opponent(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

export function movesEqual(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && (a.promotion ?? null) === (b.promotion ?? null);
}

function moveLabel(move: Move): string {
  return `${move.from}${move.to}${move.promotion ? `=${move.promotion}` : ''}`;
}
