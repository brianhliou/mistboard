/**
 * Engine failures we already understand: counted and logged as data, never paged.
 *
 * Why: one Fog Xiangqi belief blow-up sent three critical emails (worker
 * turns-failed + pool error, web fallback, web seat forfeit) for a cause that was
 * already known, which trains the operator to ignore the inbox the day a NEW
 * failure arrives. A signature here must be narrow enough that anything outside
 * it still pages; widening one is a decision, not a convenience.
 *
 * Signatures:
 * - `fog-xiangqi-belief-timeout`: a dark-xiangqi turn that timed out at least once.
 *   The belief set (up to 20M positions) can take most of the 60s deadline just to
 *   replay the transcript; the pool kills the worker on timeout, the retry lands on
 *   the dying worker ("worker N exited"), the worker answers 500, and the web
 *   forfeits the bot's seat. So the FINAL error is often not a timeout: the
 *   classification has to follow the request across attempts. A dark-xiangqi worker
 *   crash with no timeout before it is not this signature and still pages.
 *
 * The worker names the signature in its 500 body (`known_failure`), so the web
 * service classifies the same turn the same way without guessing from "HTTP 500".
 */

export const KNOWN_ENGINE_FAILURES = ['fog-xiangqi-belief-timeout'] as const;
export type KnownEngineFailure = (typeof KNOWN_ENGINE_FAILURES)[number];

export function classifyKnownEngineFailure(input: {
  gameSpecId: string | null | undefined;
  timedOut: boolean;
}): KnownEngineFailure | null {
  if (input.gameSpecId === 'dark-xiangqi' && input.timedOut) return 'fog-xiangqi-belief-timeout';
  return null;
}

export function parseKnownEngineFailure(value: unknown): KnownEngineFailure | null {
  return KNOWN_ENGINE_FAILURES.find((known) => known === value) ?? null;
}

/** Tag an error with its known signature so it survives being rethrown. */
export function withKnownEngineFailure<E extends Error>(err: E, known: KnownEngineFailure): E {
  (err as E & { knownFailure?: KnownEngineFailure }).knownFailure = known;
  return err;
}

export function knownEngineFailureOf(err: unknown): KnownEngineFailure | null {
  if (typeof err !== 'object' || err === null) return null;
  return parseKnownEngineFailure((err as { knownFailure?: unknown }).knownFailure);
}

export function isTimeoutish(error: string | null | undefined): boolean {
  if (!error) return false;
  return /\b(timeout|timed out|abort)\b/i.test(error);
}
