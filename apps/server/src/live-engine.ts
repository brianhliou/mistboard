import { clockRemainingMs, type EngineTurnResponse, type Move } from '@mistboard/game';
import { buildEngineTurnRequest } from './engine-protocol/build.js';
import {
  defaultEngineId,
  type EngineDefinition,
  type EngineMoveContext,
  type EngineMoveDecision,
  loadEngine,
} from './engine-registry.js';
import { computeEngineBudget, type EngineBudget } from './fow-engine-budget.js';
import { InternalEngineClientError } from './internal-engine-client.js';
import { requestLiveEngineTurnWithRenewal } from './server-live-engine-reservations.js';

/**
 * Per-engine secret used to derive deterministic per-turn engineSeed.
 * In production set MISTBOARD_ENGINE_SECRET so the same game produces
 * the same engine play across restarts. In dev a fixed fallback keeps
 * play deterministic across local sessions.
 *
 * This secret never leaves the server — engines receive only the
 * derived engineSeed.
 */
const ENGINE_SECRET = process.env.MISTBOARD_ENGINE_SECRET ?? 'mistboard-dev-engine-secret';

export type LiveEngineFallbackReason =
  | 'timeout'
  | 'unsupported_engine'
  | 'illegal_move'
  | 'invalid_json'
  | 'internal_error';

export type LiveEngineFallbackEvent = {
  diagnostics?: Record<string, unknown>;
  durationMs: number;
  engineId: string;
  fallbackEngineId: string;
  ply: number;
  reason: LiveEngineFallbackReason;
  timeoutMs?: number;
};

export type LiveEngineMoveResult = {
  decision: EngineMoveDecision;
  engineId: string;
  fallback: boolean;
};

type ChooseLiveEngineMoveOptions = {
  context: EngineMoveContext;
  engine: EngineDefinition;
  onFallback?: (event: LiveEngineFallbackEvent) => void;
  timeoutMs?: number;
};

const DEFAULT_LIVE_ENGINE_TIMEOUT_MS = 3_000;

export async function chooseLiveEngineMove({
  context,
  engine,
  onFallback,
  timeoutMs = DEFAULT_LIVE_ENGINE_TIMEOUT_MS,
}: ChooseLiveEngineMoveOptions): Promise<LiveEngineMoveResult> {
  const startedAt = Date.now();
  try {
    const decision = await chooseWithTimeout(
      engine,
      context,
      engine.livePolicy?.timeoutMs ?? timeoutMs,
    );
    validateDecision(engine.id, decision, context.legalMoves);
    return { decision, engineId: engine.id, fallback: false };
  } catch (err) {
    const reason = fallbackReason(err);
    const diagnostics = fallbackDiagnostics(err);
    const fallbackEngineId =
      engine.livePolicy?.fallbackEngineId === undefined
        ? defaultFallbackEngineId(engine)
        : engine.livePolicy.fallbackEngineId;
    if (!fallbackEngineId || fallbackEngineId === engine.id) throw err;

    const fallbackEngine = loadEngine(fallbackEngineId);
    const decision = await chooseWithTimeout(
      fallbackEngine,
      context,
      fallbackEngine.livePolicy?.timeoutMs ?? timeoutMs,
    );
    validateDecision(fallbackEngine.id, decision, context.legalMoves);
    onFallback?.({
      durationMs: Date.now() - startedAt,
      engineId: engine.id,
      fallbackEngineId,
      ply: context.ply,
      reason,
      ...(diagnostics ? { diagnostics } : {}),
      ...(err instanceof LiveEngineError && err.timeoutMs !== undefined
        ? { timeoutMs: err.timeoutMs }
        : {}),
    });
    return { decision, engineId: fallbackEngineId, fallback: true };
  }
}

function defaultFallbackEngineId(engine: EngineDefinition): string | null {
  if (engine.config.kind === 'python-subprocess') return null;
  return defaultEngineId();
}

async function chooseWithTimeout(
  engine: EngineDefinition,
  context: EngineMoveContext,
  timeoutMs: number,
): Promise<EngineMoveDecision> {
  if (engine.config.kind === 'python-subprocess')
    return choosePythonSubprocessMove(engine, context, timeoutMs);
  if (!engine.chooseMove)
    throw new LiveEngineError(
      'unsupported_engine',
      `engine ${engine.id} does not support live move selection`,
    );
  if (timeoutMs <= 0) return Promise.resolve().then(() => engine.chooseMove!(context));

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve().then(() => engine.chooseMove!(context)),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new LiveEngineError('timeout', `engine ${engine.id} timed out after ${timeoutMs}ms`, {
              timeoutMs,
            }),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function choosePythonSubprocessMove(
  engine: EngineDefinition,
  context: EngineMoveContext,
  timeoutMs: number,
): Promise<EngineMoveDecision> {
  if (!context.events || !context.roomId) {
    throw new LiveEngineError(
      'unsupported_engine',
      `engine ${engine.id} requires live room events`,
    );
  }
  const { computeBudgetMs, watchdogTimeoutMs } = pythonLiveTimeoutBudgetMs(context, timeoutMs);

  // Build the redacted EngineTurnRequest — the sole game-state channel
  // to the engine (Phase 3c). Construction is the security boundary:
  // see apps/server/src/engine-protocol/build.ts for the redaction
  // guarantees, and build.test.ts for the redaction tests.
  const engineTurnRequest = buildEngineTurnRequest({
    gameId: context.roomId,
    engineId: engine.id,
    engineSecret: ENGINE_SECRET,
    engineColor: context.color,
    state: context.state,
    events: context.events,
    ply: context.ply,
    cold: true,
  });

  // The holder, not a bare id: a worker restart forgets every seat, and the
  // renewal path writes the fresh one back to the room (#477).
  const holder = context.engineReservation ?? {
    id: context.roomId,
    engineReservationId: null,
  };
  const startedAt = Date.now();
  const result = await requestLiveEngineTurnWithRenewal({
    holder,
    request: engineTurnRequest,
    budget: { computeBudgetMs, watchdogTimeoutMs },
    // A retry is budgeted from the clock as it stands then, not as it stood
    // when the turn began: the engine's clock kept running through the outage.
    rebudget: () =>
      pythonLiveTimeoutBudgetMs(
        context.clockRemainingMs === undefined
          ? context
          : {
              ...context,
              clockRemainingMs: Math.max(0, context.clockRemainingMs - (Date.now() - startedAt)),
            },
        timeoutMs,
      ),
    ...(context.engineReservationStillNeeded
      ? { stillNeeded: context.engineReservationStillNeeded }
      : {}),
  }).catch((err) => {
    throw liveEngineErrorFromInternalEngine(err, engine.id, watchdogTimeoutMs);
  });
  return {
    move: result.move,
    scores: [
      {
        move: result.move,
        score: 0,
        reason: remoteEngineDecisionReason(result),
      },
    ],
    // Surface the worker's per-move telemetry for the live-engine-decision
    // artifact (observability) — it rides through in result.diagnostics.
    ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
  };
}

export function pythonLiveWatchdogTimeoutMs(
  context: EngineMoveContext,
  configuredTimeoutMs: number,
): number {
  return pythonLiveTimeoutBudgetMs(context, configuredTimeoutMs).watchdogTimeoutMs;
}

/**
 * The per-move COMPUTE budget this engine turn is granted, or null for an engine
 * the server hands no time budget at all.
 *
 * This exists so the `live-engine-decision` artifact can record the ceiling the
 * move actually ran under. Without it the fog/chess path persists think time
 * against nothing, and no report can say whether Misty stopped because it
 * finished its work or because it ran out of clock — the two look identical from
 * outside, and only one of them is a defect.
 *
 * It reads the SAME allocator the move itself runs under
 * (`pythonLiveTimeoutBudgetMs` -> `computeEngineBudget('live-cap')`) instead of
 * re-deriving a number from the clock here. A second formula would drift from
 * the first on the next knob change and the artifact would then describe a
 * budget no engine was ever handed, which is worse than recording none.
 *
 * Only the python-subprocess path is time-budgeted; the in-process builtin
 * engines (random-legal and friends) get no movetime, so they report null.
 * Null is emphatically not zero: a reader that saw 0 would report a starved
 * engine where there is simply no budget to speak of.
 *
 * `timeoutMs` is resolved exactly as `chooseLiveEngineMove` resolves it
 * (`engine.livePolicy?.timeoutMs ?? timeoutMs`) so the recorded budget matches
 * the one the request was built with. It only reaches the allocator as the
 * untimed fallback, i.e. on a clockless room.
 */
export function liveEngineComputeBudgetMs(
  engine: EngineDefinition,
  context: EngineMoveContext,
  timeoutMs: number = DEFAULT_LIVE_ENGINE_TIMEOUT_MS,
): number | null {
  if (engine.config.kind !== 'python-subprocess') return null;
  return pythonLiveTimeoutBudgetMs(context, engine.livePolicy?.timeoutMs ?? timeoutMs)
    .computeBudgetMs;
}

/**
 * Live PvE per-move budget. Delegates to the shared `computeEngineBudget`
 * ('live-cap' policy) — the SAME code the bot-match arbiter uses — so PvE and
 * EvE-3P cannot diverge in how much time Misty is granted. See fow-engine-budget.ts
 * and bot-match/pve-eve-conformance.test.ts.
 */
export function pythonLiveTimeoutBudgetMs(
  context: EngineMoveContext,
  configuredTimeoutMs: number,
): EngineBudget {
  return computeEngineBudget('live-cap', {
    clockRemainingMs: liveClockRemainingMs(context),
    incrementMs: liveIncrementMs(context),
    untimedFallbackMs: configuredTimeoutMs,
  });
}

function liveClockRemainingMs(context: EngineMoveContext): number | undefined {
  if (context.clockRemainingMs !== undefined) return Math.max(0, context.clockRemainingMs);
  const clock = context.state.clock;
  if (!clock) return undefined;
  return clockRemainingMs(clock, context.color, Date.now());
}

function liveIncrementMs(context: EngineMoveContext): number {
  return Math.max(0, context.incrementMs ?? context.state.clock?.incrementMs ?? 0);
}

function remoteEngineDecisionReason(response: EngineTurnResponse): string {
  const source = response.diagnostics?.decisionSource;
  return typeof source === 'string' ? `engine-worker:${source}` : 'engine-worker-http';
}

function liveEngineErrorFromInternalEngine(
  err: unknown,
  engineId: string,
  watchdogTimeoutMs: number,
): LiveEngineError {
  if (!(err instanceof InternalEngineClientError)) {
    return new LiveEngineError(
      'internal_error',
      `internal engine service request failed for ${engineId}: ${(err as Error).message}`,
    );
  }

  const diagnostics = {
    transport: 'internal-engine-http',
    reason: err.reason,
    ...(err.status !== undefined ? { status: err.status } : {}),
    ...(err.diagnostics ?? {}),
  };
  if (err.reason === 'timeout') {
    return new LiveEngineError('timeout', err.message, {
      timeoutMs: err.timeoutMs ?? watchdogTimeoutMs,
      diagnostics,
    });
  }
  if (err.reason === 'missing_config') {
    return new LiveEngineError('unsupported_engine', err.message, { diagnostics });
  }
  if (err.reason === 'invalid_response') {
    return new LiveEngineError('invalid_json', err.message, { diagnostics });
  }
  return new LiveEngineError('internal_error', err.message, { diagnostics });
}

function validateDecision(
  engineId: string,
  decision: EngineMoveDecision,
  legalMoves: Move[],
): void {
  if (!legalMoves.some((move) => movesMatch(move, decision.move))) {
    throw new LiveEngineError('illegal_move', `engine ${engineId} returned an illegal move`);
  }
}

function movesMatch(left: Move, right: Move): boolean {
  return (
    left.from === right.from &&
    left.to === right.to &&
    (left.promotion ?? null) === (right.promotion ?? null)
  );
}

function fallbackReason(err: unknown): LiveEngineFallbackReason {
  return err instanceof LiveEngineError ? err.reason : 'internal_error';
}

function fallbackDiagnostics(err: unknown): Record<string, unknown> | undefined {
  return err instanceof LiveEngineError ? err.diagnostics : undefined;
}

class LiveEngineError extends Error {
  readonly diagnostics?: Record<string, unknown>;
  readonly timeoutMs?: number;

  constructor(
    readonly reason: LiveEngineFallbackReason,
    message: string,
    options: { diagnostics?: Record<string, unknown>; timeoutMs?: number } = {},
  ) {
    super(message);
    this.diagnostics = options.diagnostics;
    this.timeoutMs = options.timeoutMs;
  }
}
