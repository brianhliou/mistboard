/**
 * Shared engine-move boundary for variant PvE engines.
 *
 * Every variant engine (FSF subprocess or internal FoW engine) must, on a bad
 * move, be VISIBLE and FAIL CLOSED — never silently substitute a threat-blind
 * `legalMoves[0]`. Before this existed each engine reimplemented (or skipped)
 * that, and the `engine_fallback_rate` page in obs.ts was blind to all of them,
 * which is how "engine plays weak live, can't reproduce" kept recurring.
 *
 * This module owns the three things that must always happen together:
 *   1. count the move (engineCounters → fallback-rate page),
 *   2. capture a complete, replayable decision record,
 *   3. alert on a fail-closed event.
 * plus a generic retry+validate loop for the FSF/UCI engines.
 *
 * Terminal action stays per-engine (perfect-info → resign; fog → forfeit/observe)
 * because an illegal move means different things under perfect vs imperfect info.
 */
import { getBuildInfo } from './build-info.js';
import { type EngineAlertEmailPayload, sendEngineAlertNotification } from './engine-alert-email.js';
import { engineCounters, logger } from './obs.js';

export type EngineMoveRejectReason = 'request-failed' | 'illegal-move' | 'no-move';

export type EngineMoveAttempt = {
  attempt: number;
  uci: string | null;
  error: string | null;
  reason: EngineMoveRejectReason | null;
};

// Flat, log-and-replay friendly. `history` + the tier fields determine the exact
// engine call; replay tools reconstruct from this alone.
export type EngineDecisionRecord = {
  variant: string;
  room_id: string;
  engine_id: string;
  engine_version: string;
  revision: string | null;
  movetime_ms: number;
  tier_skill: number | null;
  tier_nodes: number | null;
  tier_movetime_ms: number | null;
  /** The GAME's ply count — not the length of whatever slice the engine was fed. */
  ply: number;
  to_move: string;
  in_check: boolean;
  // FEN of the position, for engines fed a FEN (banqi/jieqi). null for engines
  // replayed purely from move history.
  fen: string | null;
  /** The whole game, in engine UCI. */
  history: string;
  /**
   * The moves actually replayed onto `fen` for this call, when the caller feeds the
   * engine a window rather than the whole game (jieqi/banqi replay only the quiet
   * plies since the last irreversible move, so the engine sees repetitions). Kept
   * separate from `history` because collapsing the two makes the record lie: the
   * 2026-09-02 jieqi alert reported `ply: 2, history: "d5c6 g5g7"` for a game that
   * was twelve plies deep, and pointed triage at an opening bug that did not exist.
   */
  engine_window: string | null;
  legal_moves: string;
  legal_count: number;
  attempts: number;
  reject_reason: EngineMoveRejectReason | null;
  last_output: string;
  attempts_detail: string;
  /** Every attempt failed on the request itself: infrastructure, not a bad move. */
  unreachable: boolean;
};

export function buildEngineDecisionRecord(input: {
  variant: string;
  roomId: string;
  engineId: string;
  engineVersion: string;
  movetimeMs: number;
  tier?: { skill?: number; nodes?: number; movetimeMs?: number } | null;
  ply: number;
  toMove: string;
  inCheck: boolean;
  fen?: string | null;
  /** The whole game, in engine UCI. */
  history: string[];
  /** The slice replayed onto `fen`, when that is narrower than `history`. */
  engineWindow?: readonly string[];
  legalUci: string[];
  attempts: EngineMoveAttempt[];
}): EngineDecisionRecord {
  const last = input.attempts[input.attempts.length - 1];
  return {
    variant: input.variant,
    room_id: input.roomId,
    engine_id: input.engineId,
    engine_version: input.engineVersion,
    revision: getBuildInfo().revision,
    movetime_ms: input.movetimeMs,
    tier_skill: input.tier?.skill ?? null,
    tier_nodes: input.tier?.nodes ?? null,
    tier_movetime_ms: input.tier?.movetimeMs ?? null,
    ply: input.ply,
    to_move: input.toMove,
    in_check: input.inCheck,
    fen: input.fen ?? null,
    history: input.history.join(' '),
    engine_window: input.engineWindow === undefined ? null : input.engineWindow.join(' '),
    legal_moves: input.legalUci.join(' '),
    legal_count: input.legalUci.length,
    attempts: input.attempts.length,
    reject_reason: last?.reason ?? null,
    last_output: last?.uci ?? last?.error ?? '(none)',
    attempts_detail: input.attempts
      .map((a) => `${a.attempt}:${a.uci ?? a.error ?? '(none)'}:${a.reason ?? 'ok'}`)
      .join(' | '),
    unreachable: engineNeverResponded(input.attempts),
  };
}

/**
 * True when the engine never answered at all — every attempt died on the request
 * (crash, hang, timeout) rather than returning a move the kernel refused.
 *
 * The two are different incidents wanting different triage: an illegal move is an
 * engine bug reproducible from `fen`, while no move at all is infrastructure and
 * reproduces from nothing. They were reported under one name until 2026-09-02, when
 * six jieqi games were resigned on `request-failed` under an alert that said the
 * engine had failed to produce a KERNEL-LEGAL move.
 */
export function engineNeverResponded(attempts: readonly EngineMoveAttempt[]): boolean {
  return attempts.length > 0 && attempts.every((attempt) => attempt.reason === 'request-failed');
}

export function engineFailClosedAlert(record: EngineDecisionRecord): EngineAlertEmailPayload {
  return {
    severity: 'critical',
    // `alert_kind` is what the email subject, the throttle bucket, and every other
    // alert site key on; this one spelled it `kind` and was bucketed as a generic
    // "engine" alert alongside unrelated infra pages.
    alert_kind: record.unreachable ? 'engine_unreachable' : 'engine_failed_closed',
    variant: record.variant,
    room_id: record.room_id,
    engine_id: record.engine_id,
    engine_version: record.engine_version,
    revision: record.revision ?? 'unknown',
    ply: record.ply,
    to_move: record.to_move,
    attempts: record.attempts,
    reject_reason: record.reject_reason ?? 'unknown',
    last_output: record.last_output,
    attempts_detail: record.attempts_detail,
    ...(record.engine_window === null ? {} : { engine_window: record.engine_window }),
    history: record.history || '(startpos)',
  };
}

/**
 * A move was accepted: count it as a non-fallback move so the fallback-rate
 * denominator includes this engine.
 */
export function reportEngineMoveOk(): void {
  engineCounters.recordMove(false);
}

/**
 * The one line an operator reads in a log list, so it has to say WHICH failure this
 * was. Every variant used to pass the same hand-written sentence ("no kernel-legal
 * move after retries"), which is a lie when the engine never answered — and that is
 * the sentence the 2026-09-02 jieqi incident was triaged from.
 */
/** What the caller does to the game after the engine failed: resign its seat (a
 *  scored loss) or, when the bot never answered at the opening, void the game. */
export type EngineFallbackOutcome = 'resign' | 'abort';

function engineFallbackSummary(
  record: EngineDecisionRecord,
  displayName: string,
  outcome: EngineFallbackOutcome,
): string {
  const action =
    outcome === 'abort' ? 'aborting the game (no result)' : 'resigning the engine seat';
  return record.unreachable
    ? `${displayName} engine unreachable: no response in ${record.attempts} attempt(s) (${record.last_output}); ${action}`
    : `${displayName} engine failed closed: no kernel-legal move after retries; ${action}`;
}

/**
 * The engine could not produce an acceptable move. Count it as a fallback, log
 * the full record at error, and page immediately. For perfect-information
 * engines where a rejected move is unambiguously a bug. The caller still
 * performs the terminal action (resign / forfeit / abort), named by `outcome`.
 *
 * `displayName` is the variant's human name ("Flip Jungle"); the summary sentence
 * is built here so every variant reports the same two failure modes the same way.
 */
export function reportEngineFallback(
  record: EngineDecisionRecord,
  logKind: string,
  displayName: string,
  outcome: EngineFallbackOutcome = 'resign',
): void {
  engineCounters.recordMove(true);
  logger.error({ kind: logKind, ...record }, engineFallbackSummary(record, displayName, outcome));
  void sendEngineAlertNotification(engineFailClosedAlert(record)).catch(() => {});
}

/**
 * Fog/imperfect-information variant: the engine's move was rejected, but under
 * fog that can be a legitimate consequence of hidden information (e.g. a slider
 * blocked by a hidden piece), not necessarily a bug. So count it (a SPIKE still
 * pages via engine_fallback_rate) and log the full record at warn, but do not
 * fire a per-event critical page. The caller still performs its fallback.
 */
export function reportObservedFallback(
  record: EngineDecisionRecord,
  logKind: string,
  message: string,
): void {
  engineCounters.recordMove(true);
  logger.warn({ kind: logKind, ...record }, message);
}

/**
 * Bounded-retry + kernel-validate loop for any move-serving engine. A fresh
 * engine call can diverge (FSF is nondeterministic), so a transient bad output
 * often clears on the next attempt. The caller supplies `requestMove` (closing
 * over its own args — uci-history for FSF, FEN+nodes for banqi, etc.) and
 * `validate` (parse + legality against the kernel). Returns the kernel move (or
 * null after the budget) plus the attempt trail for the decision record.
 * `aborted` means the turn changed under us (clock expiry, opponent move) and
 * the caller should just return.
 */
export async function resolveValidatedEngineMove<M>(input: {
  maxAttempts: number;
  requestMove: () => Promise<string | null>;
  validate: (uci: string) => M | null;
  stillOnTurn: () => boolean;
  onReject: (info: {
    attempt: number;
    maxAttempts: number;
    uci: string | null;
    reason: EngineMoveRejectReason;
    error: string | null;
  }) => void;
}): Promise<{ chosen: M | null; attempts: EngineMoveAttempt[]; aborted: boolean }> {
  const attempts: EngineMoveAttempt[] = [];
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    if (!input.stillOnTurn()) return { chosen: null, attempts, aborted: true };
    let uci: string | null = null;
    let error: string | null = null;
    try {
      uci = await input.requestMove();
    } catch (err) {
      error = (err as Error).message;
    }
    if (!input.stillOnTurn()) return { chosen: null, attempts, aborted: true };
    const match = !error && uci ? input.validate(uci) : null;
    const reason: EngineMoveRejectReason | null = match
      ? null
      : error
        ? 'request-failed'
        : uci
          ? 'illegal-move'
          : 'no-move';
    attempts.push({ attempt, uci, error, reason });
    if (match) return { chosen: match, attempts, aborted: false };
    input.onReject({ attempt, maxAttempts: input.maxAttempts, uci, reason: reason!, error });
  }
  return { chosen: null, attempts, aborted: false };
}
