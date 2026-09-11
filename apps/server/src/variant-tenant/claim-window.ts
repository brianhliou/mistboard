/**
 * A decision the game is waiting on from several seats at once.
 *
 * Every variant this platform has run is strictly alternating: the seat to move
 * moves, and ws.ts drops anything arriving from anyone else. Mahjong is not. A
 * discard opens a window in which up to three other seats may respond, their
 * responses outrank each other, and the winner takes the turn out of order.
 *
 * This module owns only the WAITING: who may answer, who has, and when the
 * question is settled. It knows nothing about what a response means or which
 * one wins - that is a rules question and belongs to the tenant. Keeping the
 * split here is what stops mahjong vocabulary leaking into the shared runtime.
 *
 * Two properties are load-bearing and pull in opposite directions:
 *
 *   - it settles EARLY, the moment every eligible seat has answered, or the
 *     game crawls while everyone waits out a timer nobody needs;
 *   - it settles AT ALL on the deadline, or one dropped connection hangs the
 *     room forever.
 */

/** A seat that has not answered yet is absent from `responses` entirely. */
export interface ClaimWindow<C extends string, R> {
  readonly openedAt: number;
  readonly deadlineAt: number;
  readonly eligible: readonly C[];
  /** null means the seat answered and declined, which is not the same as silence. */
  readonly responses: ReadonlyMap<C, R | null>;
}

export function openClaimWindow<C extends string, R>(
  eligible: readonly C[],
  at: number,
  timeoutMs: number,
): ClaimWindow<C, R> {
  if (timeoutMs <= 0) throw new Error('a claim window needs a positive timeout');
  return {
    openedAt: at,
    deadlineAt: at + timeoutMs,
    eligible: [...eligible],
    responses: new Map(),
  };
}

/**
 * Record one seat's answer. `null` declines.
 *
 * Ineligible seats are ignored rather than rejected: the message arrives over a
 * socket and a seat that is not entitled to answer is a normal thing to
 * receive, not an error worth tearing a connection down for.
 *
 * A second answer from the same seat is ignored too. Without that, a client
 * could pung, watch the window not resolve, and switch to a win - or simply
 * double-submit on a flaky connection and change an answer that had already
 * been counted.
 */
export function submitClaim<C extends string, R>(
  window: ClaimWindow<C, R>,
  seat: C,
  response: R | null,
): ClaimWindow<C, R> {
  if (!window.eligible.includes(seat)) return window;
  if (window.responses.has(seat)) return window;
  const responses = new Map(window.responses);
  responses.set(seat, response);
  return { ...window, responses };
}

/** Every eligible seat has answered. */
export function claimWindowComplete<C extends string, R>(window: ClaimWindow<C, R>): boolean {
  return window.eligible.every((seat) => window.responses.has(seat));
}

/**
 * The question can be answered now: everyone has spoken, or time is up. A seat
 * that never answered is treated as having declined, which is why a dropped
 * connection costs that player the claim rather than costing everyone the game.
 */
export function claimWindowSettled<C extends string, R>(
  window: ClaimWindow<C, R>,
  now: number,
): boolean {
  return claimWindowComplete(window) || now >= window.deadlineAt;
}

/** Milliseconds left before the window settles itself. Never negative. */
export function claimWindowRemainingMs<C extends string, R>(
  window: ClaimWindow<C, R>,
  now: number,
): number {
  return Math.max(0, window.deadlineAt - now);
}

/** Seats still owed an answer, in eligibility order. */
export function claimWindowPending<C extends string, R>(window: ClaimWindow<C, R>): C[] {
  return window.eligible.filter((seat) => !window.responses.has(seat));
}

/**
 * The answers that actually claimed something, in eligibility order, with
 * declines and silence dropped. This is what a tenant's resolver receives.
 */
export function claimWindowClaims<C extends string, R>(
  window: ClaimWindow<C, R>,
): { seat: C; response: R }[] {
  const out: { seat: C; response: R }[] = [];
  for (const seat of window.eligible) {
    const response = window.responses.get(seat);
    if (response !== undefined && response !== null) out.push({ seat, response });
  }
  return out;
}
