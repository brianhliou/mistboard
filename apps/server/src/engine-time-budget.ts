/**
 * Shared clock-aware per-move time allocator for the UCI-subprocess engine fleet.
 *
 * Consolidates the time-budget logic that was copy-pasted as a naive
 * `min(tierCap, remaining - safety)` clamp across the server engine loops
 * (banqi, fortress, jieqi, jungle, jungle-flip). Those clamps were NOT
 * clock-aware — no increment, no
 * moves-to-go — so the bot always tried to burn the fixed tier cap regardless of
 * how much clock it had. This mirrors the moves-to-go + increment model the
 * FoW/dark family already uses (`server-dark-xiangqi-engine.ts` `budgetFor`,
 * `fow-engine-budget.ts` `computeEngineBudget`), so all three families share
 * one time-management model.
 *
 * For the node-budgeted FSF/Rust engines, the returned `computeBudgetMs` is a
 * `movetime` CEILING, not the strength knob: the tier's NODE budget is the
 * CPU-independent strength anchor and binds first when the clock is healthy;
 * this time budget only takes over under time pressure (solvency). Measured
 * rationale (FSF does ~900k nps local / ~333k prod on the 7x8 board, so an 800k
 * node budget needs ~2.4s on prod) lives in the fortress build-track doc.
 */

import { pacingApplies, pacingClockReserveMs, replyPace } from './engine-reply-pacing.js';

export type MoveBudgetInput = {
  /** Engine seat's remaining clock in ms, or null for an untimed game. */
  remainingMs: number | null;
  /** Per-move increment in ms (0 if none). */
  incrementMs: number;
  /** Upper bound on think time — the tier's latency ceiling. */
  ceilingMs: number;
  /** Assumed moves remaining, for bank division. Default 30. */
  movesToGoEstimate?: number;
  /** Clock reserve never spent (solvency buffer). Default 1000. */
  reserveMs?: number;
  /** Minimum think time while any clock remains. Default 50. */
  floorMs?: number;
  /** Fraction of the increment spent each move. Default 0.8. */
  incrementFraction?: number;
  /** Added to the budget for the outer watchdog timeout. Default 1000. */
  processOverheadMs?: number;
  /** Absolute watchdog cap. Default 60000. */
  maxWatchdogMs?: number;
  /** Extra grace over remaining for the watchdog. Default 2000. */
  clockGraceMs?: number;
};

export type MoveBudget = {
  /** ms to hand the engine as `movetime`. */
  computeBudgetMs: number;
  /** Outer watchdog timeout for the move (SIGKILL guard). */
  watchdogTimeoutMs: number;
};

/**
 * Allocate a per-move think budget from the remaining clock.
 *
 * Untimed → the full ceiling. Timed → `bank / movesToGo + fraction·increment`,
 * clamped to `[floor, ceiling]` and never exceeding the usable clock
 * (`remaining - reserve`). So it uses more time when the clock is healthy and
 * shrinks gracefully under pressure, increment-aware in both regimes.
 */
export function budgetForMove(input: MoveBudgetInput): MoveBudget {
  const {
    remainingMs,
    incrementMs,
    ceilingMs,
    movesToGoEstimate = 30,
    reserveMs = 1_000,
    floorMs = 50,
    incrementFraction = 0.8,
    processOverheadMs = 1_000,
    maxWatchdogMs = 60_000,
    clockGraceMs = 2_000,
  } = input;

  if (remainingMs === null) {
    return {
      computeBudgetMs: ceilingMs,
      watchdogTimeoutMs: Math.min(maxWatchdogMs, ceilingMs + processOverheadMs),
    };
  }

  const usable = Math.max(0, remainingMs - reserveMs);
  if (usable <= 0) {
    // Reserve is spent — a flag is imminent regardless; think the bare minimum.
    return {
      computeBudgetMs: floorMs,
      watchdogTimeoutMs: Math.max(1, Math.ceil(remainingMs + clockGraceMs)),
    };
  }

  const bankShare = usable / Math.max(1, movesToGoEstimate);
  const raw = bankShare + Math.max(0, incrementMs) * incrementFraction;
  const clamped = Math.min(ceilingMs, Math.max(floorMs, raw));
  // Never spend more than the usable clock (below `floor` only if that is all
  // that is left).
  const computeBudgetMs = Math.round(Math.min(clamped, usable));

  const watchdogTimeoutMs = Math.min(
    maxWatchdogMs,
    Math.ceil(computeBudgetMs + processOverheadMs),
    Math.ceil(remainingMs + clockGraceMs),
  );
  return { computeBudgetMs, watchdogTimeoutMs };
}

/**
 * Which per-move rule a live top-tier bot uses at a short time control.
 *
 * `flat` is `budgetForMove` above: a fixed moves-to-go of 30, so the bot thinks
 * longest on move 1 and a little less every move after, and ends a 1+1 game with
 * most of its clock unspent (audit `docs-private/research/bot-time-1plus1-audit-2026-10.md`).
 * `phase` is `phaseBudgetForMove` below: a quick first move of the game, the most
 * time from the opening into the early middlegame, less as the game simplifies, and the pace hold spent thinking.
 * `native` hands the engine its own clock (`go wtime/btime/winc/binc`, less a
 * reserve) and lets its time manager decide; only engines whose provider can send
 * a clock (`NATIVE_TIME_ENGINE_IDS`) take it, the rest stay flat.
 *
 * `flat` unless MISTBOARD_BOT_TIME_RULE is `phase` or `native`, so the old rule
 * stays the default and a self-play match can run the rules side by side (each
 * side passes its own rule).
 */
export type BotTimeRule = 'flat' | 'phase' | 'native';

export function botTimeRule(env: NodeJS.ProcessEnv = process.env): BotTimeRule {
  const rule = env.MISTBOARD_BOT_TIME_RULE;
  return rule === 'phase' || rule === 'native' ? rule : 'flat';
}

/**
 * The bots the phase rule is for: the strongest rung of each top family, the
 * ones people play at 1+1. Every ladder rung keeps the flat rule.
 * `engine-time-budget.test.ts` checks each id still resolves to a live tier.
 */
export const PHASE_TIME_ENGINE_IDS: ReadonlySet<string> = new Set([
  'pikafish-xiangqi-level-8',
  'fairy-stockfish-xiangqi-level-8',
  'pikafish-jieqi-strongest',
  'ab-jchess-jieqi',
  'jqe-jieqi',
]);

/** The engines whose live provider can send a UCI clock: the xiangqi L8 rungs. */
export const NATIVE_TIME_ENGINE_IDS: ReadonlySet<string> = new Set([
  'pikafish-xiangqi-level-8',
  'fairy-stockfish-xiangqi-level-8',
]);

export const NATIVE_TIME = {
  /**
   * Taken off the clock the engine is told it has: the 2 s reserve plus 500 ms
   * of process and round-trip latency (prod measures 0-270 ms). The engine's own
   * time manager never plans past its clock, so the real clock keeps this much.
   */
  reserveMs: 2_500,
  /**
   * The process watchdog: the told clock plus this. It stays under the real
   * clock (by `reserveMs - watchdogGraceMs`), so an engine that ignored its clock
   * is killed with a second still on the bot's clock instead of flagging.
   */
  watchdogGraceMs: 1_500,
} as const;

/** A UCI clock for `go wtime/btime/winc/binc`: the side to move's, both sides set to it. */
export type EngineClock = { timeMs: number; incMs: number };

export const PHASE_TIME = {
  /** Applies only at a base clock of this or less (3 min), and only with an increment. */
  maxInitialMs: 180_000,
  /** Clock the bot never plans to go under after its increment lands. */
  reserveMs: 2_000,
  /**
   * Wall time a move may run past its movetime (process overhead, the move's
   * round trip). Prod measures 0-270 ms; the cap below assumes up to this much.
   */
  overrunAllowanceMs: 500,
  incrementFraction: 0.8,
  /** Moves-to-go starts here and shrinks by `movesToGoPerBotMove` per bot move. */
  movesToGoStart: 30,
  movesToGoPerBotMove: 0.25,
  movesToGoMin: 18,
  /**
   * The game's first move (ply 0, the bot playing red): a fixed quick reply, not a
   * share of the clock. Every later move, black's first included, takes a share.
   */
  firstPlyMs: 150,
  /** Multiplier on the share by the bot's own move number (1-based), first match wins. */
  phaseFactors: [
    { throughBotMove: 1, factor: 1.0 },
    { throughBotMove: 20, factor: 1.6 },
    { throughBotMove: 30, factor: 1.1 },
  ],
  lateFactor: 0.9,
} as const;

type TimeRuleInput = {
  rule: BotTimeRule;
  engineId: string;
  initialMs: number | null | undefined;
  incrementMs: number;
};

/** True when `engineId` at this clock should use the phase rule, given the rule in force. */
export function phaseRuleApplies(input: TimeRuleInput): boolean {
  return input.rule === 'phase' && shortClockTopTier(input);
}

/** True when `engineId` at this clock should run its own time manager, given the rule in force. */
export function nativeRuleApplies(input: TimeRuleInput): boolean {
  return (
    input.rule === 'native' &&
    NATIVE_TIME_ENGINE_IDS.has(input.engineId) &&
    shortClockTopTier(input)
  );
}

/** The rule this move actually runs: the one in force where it applies, else `flat`. */
export function effectiveTimeRule(input: TimeRuleInput): BotTimeRule {
  if (phaseRuleApplies(input)) return 'phase';
  if (nativeRuleApplies(input)) return 'native';
  return 'flat';
}

function shortClockTopTier(input: TimeRuleInput): boolean {
  return (
    PHASE_TIME_ENGINE_IDS.has(input.engineId) &&
    typeof input.initialMs === 'number' &&
    input.initialMs > 0 &&
    input.initialMs <= PHASE_TIME.maxInitialMs &&
    input.incrementMs > 0
  );
}

/** The bot's own move number (1-based) from the game's ply count before this move. */
export function botMoveNumber(ply: number): number {
  return Math.floor(Math.max(0, ply) / 2) + 1;
}

export function phaseFactor(botMove: number): number {
  for (const step of PHASE_TIME.phaseFactors) {
    if (botMove <= step.throughBotMove) return step.factor;
  }
  return PHASE_TIME.lateFactor;
}

export type PhaseMoveBudgetInput = {
  reserveMs?: number;
  remainingMs: number | null;
  incrementMs: number;
  ceilingMs: number;
  /** Plies played before this move (0 = the game's first move). */
  ply: number;
  floorMs?: number;
};

export type PhaseMoveBudget = MoveBudget & {
  /**
   * The most this move may be given and still leave the reserve after the
   * increment, with the overrun allowance spent: anything that raises the
   * movetime (the pace target) stays under it.
   */
  capMs: number;
};

/**
 * The phase-shaped allocator: the game's first move (ply 0) is a fixed quick
 * reply; every later one gets `(bank / movesToGo + 0.8·inc) × phaseFactor`, where
 * the bank is the clock over a 2 s reserve and moves-to-go shrinks as the game
 * goes on. The factor weights bot moves 2-20 and tapers after. Clamped to `[floor, ceiling]` and then to `capMs`, which is what keeps
 * it from flagging: a move that runs its full movetime plus the overrun allowance
 * still leaves `reserve` on the clock once the increment lands.
 */
export function phaseBudgetForMove(input: PhaseMoveBudgetInput): PhaseMoveBudget {
  const {
    remainingMs,
    incrementMs,
    ceilingMs,
    ply,
    floorMs = 50,
    reserveMs = PHASE_TIME.reserveMs,
  } = input;
  const botMove = botMoveNumber(ply);
  if (remainingMs === null) {
    return {
      computeBudgetMs: ceilingMs,
      watchdogTimeoutMs: Math.min(60_000, ceilingMs + 1_000),
      capMs: ceilingMs,
    };
  }
  const inc = Math.max(0, incrementMs);
  const bank = Math.max(0, remainingMs - reserveMs);
  const movesToGo = Math.max(
    PHASE_TIME.movesToGoMin,
    PHASE_TIME.movesToGoStart - botMove * PHASE_TIME.movesToGoPerBotMove,
  );
  const raw =
    ply === 0
      ? PHASE_TIME.firstPlyMs
      : (bank / movesToGo + inc * PHASE_TIME.incrementFraction) * phaseFactor(botMove);
  // The move plus its overrun allowance may dip into the reserve by at most the
  // increment it is about to earn, and never by more than the allowance itself:
  // so the clock is back at the reserve once the increment lands, and before it
  // lands it is still at least `reserve - allowance` (no flag even if the engine
  // overruns twice its allowance).
  const capMs = Math.max(
    1,
    Math.floor(
      remainingMs -
        reserveMs -
        PHASE_TIME.overrunAllowanceMs +
        Math.min(inc, PHASE_TIME.overrunAllowanceMs),
    ),
  );
  const computeBudgetMs = Math.max(
    1,
    Math.round(Math.min(capMs, Math.min(ceilingMs, Math.max(floorMs, raw)))),
  );
  const watchdogTimeoutMs = Math.min(
    60_000,
    Math.ceil(computeBudgetMs + 1_000),
    Math.ceil(remainingMs + 2_000),
  );
  return { computeBudgetMs, watchdogTimeoutMs, capMs };
}

/**
 * The native rule's clock for one move: the bot's real clock less
 * `NATIVE_TIME.reserveMs`, for the engine's own time manager. The game's first
 * move (ply 0) gets no clock: it is the same quick fixed reply as under `phase`.
 * `watchdogTimeoutMs` is the hard ceiling on the process.
 */
export function nativeClockForMove(input: {
  reserveMs?: number;
  remainingMs: number;
  incrementMs: number;
  ply: number;
}): { clock: EngineClock | null; movetimeMs: number; watchdogTimeoutMs: number } {
  const reserveMs = input.reserveMs ?? NATIVE_TIME.reserveMs;
  if (input.ply === 0) {
    const movetimeMs = Math.max(1, Math.min(PHASE_TIME.firstPlyMs, input.remainingMs - reserveMs));
    return { clock: null, movetimeMs, watchdogTimeoutMs: movetimeMs + NATIVE_TIME.watchdogGraceMs };
  }
  const clock = {
    timeMs: Math.max(1, Math.floor(input.remainingMs - reserveMs)),
    incMs: Math.max(0, Math.floor(input.incrementMs)),
  };
  return {
    clock,
    // The engine never plans past the clock it is told; this is the most it could take.
    movetimeMs: clock.timeMs,
    watchdogTimeoutMs: nativeWatchdogMs(clock),
  };
}

/** The hard process ceiling for a move searched on `clock`. */
export function nativeWatchdogMs(clock: EngineClock): number {
  return Math.max(1, Math.floor(clock.timeMs)) + NATIVE_TIME.watchdogGraceMs;
}

/** The UCI `go` clock words for a clock: both sides get the mover's figure. */
export function uciClockWords(clock: EngineClock): string {
  const t = Math.max(1, Math.floor(clock.timeMs));
  const i = Math.max(0, Math.floor(clock.incMs));
  return `wtime ${t} btime ${t} winc ${i} binc ${i}`;
}

/**
 * Spend the pace hold thinking: when the reply pace would hold the move until
 * `paceTargetMs`, search until then instead of sleeping. Never past the tier
 * ceiling (it is also a CPU bound on the shared box) or the never-flag cap.
 */
export function paceAwareMovetimeMs(input: {
  budgetMs: number;
  paceTargetMs: number;
  ceilingMs: number;
  capMs: number;
}): number {
  const raised = Math.max(
    input.budgetMs,
    Math.min(input.paceTargetMs, input.ceilingMs, input.capMs),
  );
  return Math.round(raised);
}

export type LiveBotMoveTimeInput = {
  variant?: string;
  correspondence?: boolean;
  /** The rule in force; defaults to `botTimeRule()` (MISTBOARD_BOT_TIME_RULE). */
  rule?: BotTimeRule;
  engineId: string;
  roomId: string;
  /** Plies played before this move. */
  ply: number;
  legalCount: number;
  /** The game's base clock; null when untimed. */
  initialMs: number | null | undefined;
  remainingMs: number | null;
  incrementMs: number;
  ceilingMs: number;
  /** Already spent this turn before the search (a queue wait); off the clock first. */
  waitedMs?: number;
  /** The flat rule's reserve and floor, as each loop has always passed them. */
  flatReserveMs: number;
  floorMs: number;
  engineVsEngine: boolean;
  /** Pacing switch, for tests; defaults to MISTBOARD_BOT_PACING. */
  pacingEnabled?: boolean;
};

export type LiveBotMoveTime = {
  /** Under `native`, the most the engine could take (its told clock), not a `go movetime`. */
  movetimeMs: number;
  rule: BotTimeRule;
  /** Set under `native`: send `go ... wtime/btime/winc/binc` from this instead of a movetime. */
  clock?: EngineClock;
  /** The allocator's own figure, before the pace raise (equal to movetimeMs under `flat`). */
  budgetMs: number;
};

/**
 * One live top-tier move's movetime. Under `flat`, today's `budgetForMove`.
 * Under `phase` (only where `phaseRuleApplies`), the phase-shaped budget, raised
 * to the pace target when the reply would be held anyway, so the hold is spent
 * searching instead of sleeping. The pace is read before the search without an
 * eval, so a move that turns out decisive may think longer than its short reply
 * would have waited; it stays under the tier ceiling and the never-flag cap.
 */
export function liveBotMoveTime(input: LiveBotMoveTimeInput): LiveBotMoveTime {
  const waitedMs = Math.max(0, input.waitedMs ?? 0);
  const remainingMs = input.remainingMs === null ? null : Math.max(0, input.remainingMs - waitedMs);
  const paced = pacingApplies({ ...input, enabled: input.pacingEnabled });
  const reserveMs = paced ? pacingClockReserveMs(input.initialMs) : input.flatReserveMs;
  // Both the search and the hold obey this cap, before any increment arrives.
  const capMs = remainingMs === null ? Infinity : Math.max(0, Math.floor(remainingMs - reserveMs));
  // A fixed floor eventually consumes the reserve in a long zero-increment game.
  const floorMs =
    paced && remainingMs !== null ? Math.min(input.floorMs, capMs / 30) : input.floorMs;
  const safe = (result: LiveBotMoveTime): LiveBotMoveTime => {
    if (!paced || remainingMs === null) return result;
    return {
      ...result,
      movetimeMs: Math.min(result.movetimeMs, capMs),
      budgetMs: Math.min(result.budgetMs, capMs),
      ...(result.clock
        ? { clock: { ...result.clock, timeMs: Math.min(result.clock.timeMs, capMs) } }
        : {}),
    };
  };
  const rule = effectiveTimeRule({
    rule: input.rule ?? botTimeRule(),
    engineId: input.engineId,
    initialMs: input.initialMs,
    incrementMs: input.incrementMs,
  });
  if (rule === 'native' && remainingMs !== null) {
    const native = nativeClockForMove({
      remainingMs,
      incrementMs: input.incrementMs,
      ply: input.ply,
      reserveMs: paced ? Math.max(NATIVE_TIME.reserveMs, reserveMs) : undefined,
    });
    return safe({
      movetimeMs: native.movetimeMs,
      rule: 'native',
      budgetMs: native.movetimeMs,
      ...(native.clock ? { clock: native.clock } : {}),
    });
  }
  if (rule !== 'phase') {
    const { computeBudgetMs } = budgetForMove({
      remainingMs,
      incrementMs: input.incrementMs,
      ceilingMs: input.ceilingMs,
      reserveMs,
      floorMs,
    });
    return safe({ movetimeMs: computeBudgetMs, rule: 'flat', budgetMs: computeBudgetMs });
  }
  const budget = phaseBudgetForMove({
    remainingMs,
    incrementMs: input.incrementMs,
    ceilingMs: input.ceilingMs,
    ply: input.ply,
    floorMs,
    reserveMs: paced ? Math.max(PHASE_TIME.reserveMs, reserveMs) : undefined,
  });
  const pace = replyPace({
    variant: input.variant,
    initialMs: input.initialMs,
    correspondence: input.correspondence,
    roomId: input.roomId,
    ply: input.ply,
    legalCount: input.legalCount,
    cp: null,
    mate: null,
    remainingMs: input.remainingMs,
    incrementMs: input.incrementMs,
    computeMs: waitedMs,
    engineVsEngine: input.engineVsEngine,
    enabled: input.pacingEnabled,
  });
  const movetimeMs =
    pace.reason === 'paced'
      ? paceAwareMovetimeMs({
          budgetMs: budget.computeBudgetMs,
          paceTargetMs: pace.targetMs - waitedMs,
          ceilingMs: input.ceilingMs,
          capMs: budget.capMs,
        })
      : budget.computeBudgetMs;
  return safe({ movetimeMs, rule: 'phase', budgetMs: budget.computeBudgetMs });
}
