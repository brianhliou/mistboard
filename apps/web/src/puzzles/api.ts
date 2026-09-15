/**
 * The puzzles HTTP surface (list/detail/attempt/reveal/rating) plus the
 * rating-preference singletons. One puzzle page is mounted at a time, so the
 * rated preference and the "an attempt just changed my rating" callback live
 * as module singletons the free-function attempt path can reach without
 * threading them through every call.
 */

import { browserTimeZone } from '../play-streak.js';
import type { PuzzleDetail, PuzzleMove, PuzzleState, PuzzleSummary } from './adapter.js';

export type PuzzleAttempt =
  | {
      ok: true;
      playedMoves: PuzzleMove[];
      solverMoves: PuzzleMove[];
      complete: boolean;
      ply: number;
      state: PuzzleState;
      lastMove?: PuzzleMove;
    }
  | {
      ok: false;
      code: 'incorrect-move' | 'illegal-move' | 'line-too-long' | 'wrong-move-shape';
      ply: number;
      state: PuzzleState;
      move: PuzzleMove;
    };

// The signed-in user's puzzle rating for the current variant (from
// /api/puzzles/rating), and the rating change returned by a rated attempt.
export type UserPuzzleRating = {
  rating: number;
  provisional: boolean;
  solved: number;
  attempts: number;
};

export type PuzzleAttemptRating = {
  userRating: number;
  delta: number;
  provisional: boolean;
  ratingChanged: boolean;
  firstAttempt: boolean;
};

let puzzleRatedPref = true;
let onAttemptRating: ((rating: PuzzleAttemptRating) => void) | null = null;

export function setPuzzleRatedPref(enabled: boolean): void {
  puzzleRatedPref = enabled;
}

export function getPuzzleRatedPref(): boolean {
  return puzzleRatedPref;
}

export function setOnAttemptRating(callback: ((rating: PuzzleAttemptRating) => void) | null): void {
  onAttemptRating = callback;
}

export function reportAttemptRating(rating: PuzzleAttemptRating): void {
  onAttemptRating?.(rating);
}

export async function fetchPuzzleList(): Promise<PuzzleSummary[]> {
  return (await fetchPuzzleListWithAttempts()).puzzles;
}

// `attemptedIds` is what the SERVER knows this account has already finished.
// The localStorage seen-set does not survive a cleared browser, a second
// device, or a reinstall, so without this a signed-in visitor restarts the
// rotation from the top of the pool. Empty for anonymous visitors.
export async function fetchPuzzleListWithAttempts(): Promise<{
  puzzles: PuzzleSummary[];
  attemptedIds: string[];
}> {
  const response = await fetch('/api/puzzles');
  if (!response.ok) throw new Error(`Puzzle list failed: ${response.status}`);
  const body = (await response.json()) as {
    puzzles?: PuzzleSummary[];
    attemptedIds?: unknown;
  };
  return {
    puzzles: Array.isArray(body.puzzles) ? body.puzzles : [],
    attemptedIds: Array.isArray(body.attemptedIds)
      ? body.attemptedIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

export async function fetchPuzzleDetail(id: string): Promise<PuzzleDetail | null> {
  const response = await fetch(`/api/puzzles/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Puzzle detail failed: ${response.status}`);
  const body = (await response.json()) as { puzzle?: PuzzleDetail };
  return body.puzzle ?? null;
}

// The per-account play lock: an account set up as an identity rather than a
// player is refused by every route that would book a puzzle attempt. Its own
// error type so the three solving actions share one message instead of each
// inventing a failure mode for a 403.
export class PuzzlePlayDisabledError extends Error {}

async function throwIfPlayDisabled(response: Response): Promise<void> {
  if (response.status !== 403) return;
  const body = (await response
    .clone()
    .json()
    .catch(() => ({}))) as { error?: string };
  if (body.error === 'play_disabled') throw new PuzzlePlayDisabledError('play disabled');
}

// Consecutive days with a puzzle solved, on the solver's own calendar; comes
// back with a completed solve for signed-in users, absent for guests.
export type PuzzleStreak = { current: number; best: number };

export async function submitPuzzleAttempt(
  id: string,
  moves: readonly PuzzleMove[],
  qualitySessionId?: string,
): Promise<{
  attempt: PuzzleAttempt;
  rating: PuzzleAttemptRating | null;
  streak: PuzzleStreak | null;
}> {
  const response = await fetch(`/api/puzzles/${encodeURIComponent(id)}/attempt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      moves,
      rated: puzzleRatedPref,
      qualitySessionId,
      timeZone: browserTimeZone(),
    }),
  });
  await throwIfPlayDisabled(response);
  if (!response.ok) throw new Error(`Puzzle attempt failed: ${response.status}`);
  const body = (await response.json()) as {
    attempt?: PuzzleAttempt;
    rating?: PuzzleAttemptRating;
    streak?: Partial<PuzzleStreak>;
  };
  if (!body.attempt) throw new Error('Puzzle attempt response missing attempt.');
  const streak =
    body.streak && typeof body.streak.current === 'number' && typeof body.streak.best === 'number'
      ? { current: body.streak.current, best: body.streak.best }
      : null;
  return { attempt: body.attempt, rating: body.rating ?? null, streak };
}

// Fetch the full solution line (the reveal endpoint is the only route that
// exposes solution moves). POST because it books a failed rated attempt.
export async function fetchPuzzleSolution(
  id: string,
  qualitySessionId?: string,
): Promise<{ solution: PuzzleMove[] | null; rating: PuzzleAttemptRating | null }> {
  const response = await fetch(`/api/puzzles/${encodeURIComponent(id)}/reveal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'solution', rated: puzzleRatedPref, qualitySessionId }),
  });
  await throwIfPlayDisabled(response);
  if (!response.ok) throw new Error(`Puzzle reveal failed: ${response.status}`);
  const body = (await response.json()) as {
    solution?: PuzzleMove[];
    rating?: PuzzleAttemptRating;
  };
  return { solution: body.solution ?? null, rating: body.rating ?? null };
}

// Fetch just the next correct move for the current ply (server computes it via
// the per-variant *PuzzleNextMove helpers; the client never holds the full line
// for a hint). POST because it books a failed rated attempt.
export async function fetchPuzzleHint(
  id: string,
  playedPlyCount: number,
  qualitySessionId?: string,
): Promise<{ move: PuzzleMove | null; rating: PuzzleAttemptRating | null }> {
  const response = await fetch(`/api/puzzles/${encodeURIComponent(id)}/reveal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'hint',
      playedPlyCount,
      rated: puzzleRatedPref,
      qualitySessionId,
    }),
  });
  await throwIfPlayDisabled(response);
  if (!response.ok) throw new Error(`Puzzle hint failed: ${response.status}`);
  const body = (await response.json()) as {
    move?: PuzzleMove | null;
    rating?: PuzzleAttemptRating;
  };
  return { move: body.move ?? null, rating: body.rating ?? null };
}

export async function fetchUserPuzzleRating(variant: string): Promise<UserPuzzleRating | null> {
  try {
    const response = await fetch(`/api/puzzles/rating?variant=${encodeURIComponent(variant)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { rating?: UserPuzzleRating | null };
    return body.rating ?? null;
  } catch {
    return null;
  }
}

export type PuzzleQualityVote = 'up' | 'down' | null;

export async function sendPuzzleQualityEvent(
  id: string,
  sessionId: string,
  event: 'view' | 'start' | 'abandon' | 'vote',
  vote?: PuzzleQualityVote,
): Promise<void> {
  const response = await fetch(`/api/puzzles/${encodeURIComponent(id)}/quality`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, event, ...(event === 'vote' ? { vote } : {}) }),
    keepalive: true,
  });
  if (!response.ok) throw new Error(`Puzzle quality event failed: ${response.status}`);
}
