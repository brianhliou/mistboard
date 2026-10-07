// Standard-xiangqi binding for the practice runner: the kernel hooks on one side,
// a client engine on the other. Every rules hook is a one-liner over
// `@mistboard/game`, exactly as xiangqi-tree-adapter.ts does for the tree spine —
// a practice exercise needs no new rules code.
//
// The two things this file actually decides are the two that get practice wrong
// when they are left implicit:
//
//   1. WHOSE point of view an evaluation is in. The engine reports side-to-move;
//      the runner wants the learner. The flip lives in practice-play.ts, so what
//      matters here is only that we report the raw engine sign faithfully.
//   2. HOW DEEP the search is before its verdict is trusted. lila gates its goal
//      checks at depth 16. A shallow eval does not produce an uncertain verdict,
//      it produces a confident wrong one, so the depth floor is a correctness
//      setting and not a performance knob.

import {
  applyStandardXiangqiMove,
  formatXiangqiMove,
  fsfUciToXiangqiSquares,
  isStandardXiangqiLegalMove,
  type PracticeGoal,
  type PracticeTermination,
  standardXiangqiEngineFen,
  standardXiangqiFen,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiTablebaseOutcome,
  type XiangqiTablebaseResponse,
  xiangqiMoveToFsfUci,
} from '@mistboard/game';
import { currentXiangqiNotationStyle } from '../xiangqi-notation.js';
import type { CevalHandle } from './engine/ceval-types.js';
import type { PracticeConfig, PracticeEval } from './practice-play.js';
import { fetchXiangqiTablebase } from './xiangqi-tablebase-client.js';

/** How long practice waits on the tablebase before grading by the engine alone.
 *  Above the server's own queue cap plus its chessdb timeout, so a slow but
 *  live answer still lands; past it the move is graded as it always was. */
export const PRACTICE_TABLEBASE_TIMEOUT_MS = 4500;

/** The pause between the learner's move landing and the engine's reply, so the
 *  two plies read as two moves rather than one jump. Same order as lichess
 *  practice; measured from the learner's move, so search time counts toward it. */
export const PRACTICE_REPLY_DELAY_MS = 400;

export type XiangqiTablebaseLookupFn = (
  truth: XiangqiGameState,
  signal?: AbortSignal,
) => Promise<XiangqiTablebaseResponse>;

/**
 * Depth the defender's move and the goal verdict are both taken at. lila uses 16
 * for its practice success checks; a basic endgame is thin enough material that
 * this is fast, and shallower risks a "you lost the win" verdict the engine
 * itself would retract one ply deeper.
 */
export const PRACTICE_DEPTH = 16;

/** Map a finished xiangqi game onto the learner's result. */
export function xiangqiPracticeTermination(
  truth: XiangqiGameState,
  learner: XiangqiColor,
): PracticeTermination {
  if (truth.status.type !== 'finished') return 'none';
  if (truth.status.winner === null) return 'drawn';
  return truth.status.winner === learner ? 'learner-wins' : 'learner-loses';
}

/**
 * Evaluate one position with a client engine, at the practice depth, and look
 * it up in the tablebase alongside.
 *
 * The score is returned exactly as the engine gave it — side-to-move POV — and
 * the runner flips it. `bestUci` is the first move of the top line, which is
 * what the defender plays. The exact result (also side to move) is `exact`
 * when a parent's table already answered it, else `exactLater`, which resolves
 * once the lookup does: the engine answer is returned without waiting on the
 * network, so the learner is never held for the tablebase. A miss, an outage
 * or the timeout resolve to null, and the runner grades by the engine.
 */
export async function evaluateXiangqiForPractice(
  ceval: CevalHandle,
  truth: XiangqiGameState,
  lookup: XiangqiTablebaseLookupFn = fetchXiangqiTablebase,
): Promise<PracticeEval> {
  // A finished position has no move to search; asking anyway wastes a search and
  // some engines answer with a stale line.
  if (truth.status.type !== 'playing') return { cp: null, mate: null, bestUci: null };

  const known = knownExact.get(exactKey(truth));
  if (known) return { ...(await searchForPractice(ceval, truth)), exact: { result: known } };
  const exactLater = exactResult(lookup, truth);
  return { ...(await searchForPractice(ceval, truth)), exactLater };
}

/**
 * Exact results already known from a PARENT position's table, keyed like the
 * tablebase client's memo (board + side to move), side-to-move POV.
 *
 * An exact answer lists every legal move with its result, so the position after
 * any of them is answered by the lookup that was made for the position before
 * it. Reading it from there takes the after-move lookup, a chessdb round trip
 * paced at 400ms or more, off the path between the learner's move and the
 * engine's reply; the grade is the same database's answer either way.
 */
const knownExact = new Map<string, XiangqiTablebaseOutcome>();
/** Lookups still in flight. A learner who moves before the table for the
 *  position they moved from has arrived waits on it rather than asking chessdb
 *  for the child as well. */
const inflight = new Set<Promise<unknown>>();
const KNOWN_EXACT_ENTRIES = 2000;

function exactKey(truth: XiangqiGameState): string {
  return standardXiangqiFen(truth).split(' ').slice(0, 2).join(' ');
}

function rememberChildren(
  parent: XiangqiGameState,
  response: Extract<XiangqiTablebaseResponse, { status: 'exact' }>,
): void {
  for (const row of response.moves) {
    let child: XiangqiGameState;
    try {
      child = applyStandardXiangqiMove(parent, { from: row.from, to: row.to });
    } catch {
      continue;
    }
    // A finished position is never evaluated for an exact result.
    if (child.status.type !== 'playing') continue;
    // The row is the MOVER's result; the child has the other side to move.
    knownExact.set(exactKey(child), flipOutcome(row.result));
  }
  while (knownExact.size > KNOWN_EXACT_ENTRIES) {
    const oldest = knownExact.keys().next().value;
    if (oldest === undefined) break;
    knownExact.delete(oldest);
  }
}

function flipOutcome(result: XiangqiTablebaseOutcome): XiangqiTablebaseOutcome {
  return result === 'win' ? 'loss' : result === 'loss' ? 'win' : 'draw';
}

/** Test seam: forget results learned from parent tables. */
export function clearPracticeKnownExact(): void {
  knownExact.clear();
  inflight.clear();
}

async function exactResult(
  lookup: XiangqiTablebaseLookupFn,
  truth: XiangqiGameState,
): Promise<{ result: XiangqiTablebaseOutcome } | null> {
  if (inflight.size > 0) await Promise.allSettled([...inflight]);
  const known = knownExact.get(exactKey(truth));
  if (known) return { result: known };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRACTICE_TABLEBASE_TIMEOUT_MS);
  const asked = (async () => {
    const response = await lookup(truth, controller.signal);
    if (response.status !== 'exact') return null;
    rememberChildren(truth, response);
    return { result: response.result };
  })();
  inflight.add(asked);
  try {
    return await asked;
  } catch {
    return null;
  } finally {
    inflight.delete(asked);
    clearTimeout(timer);
  }
}

async function searchForPractice(
  ceval: CevalHandle,
  truth: XiangqiGameState,
): Promise<PracticeEval> {
  const update = await ceval.evaluate({
    movesUci: [],
    initialFen: standardXiangqiEngineFen(truth),
    multiPv: 1,
    maxDepth: PRACTICE_DEPTH,
  });
  const line = update.lines[0];
  if (!line) return { cp: null, mate: null, bestUci: null };
  return {
    cp: line.scoreCp,
    mate: line.mate,
    bestUci: line.pvUci[0] ?? null,
  };
}

export interface XiangqiPracticeOptions {
  goal: PracticeGoal;
  /** The side the learner plays; the engine defends with the other. */
  learner: XiangqiColor;
  initialTruth: XiangqiGameState;
  /** Injected so tests can drive the runner with a scripted engine. */
  evaluate: (truth: XiangqiGameState) => Promise<PracticeEval>;
  /** Notified as each ply lands; see `PracticeConfig.onMovePlayed`. */
  onMovePlayed?: (
    move: XiangqiMove,
    parentTruth: XiangqiGameState,
    by: 'learner' | 'defender',
  ) => void;
  /** See `PracticeConfig.minReplyDelayMs`; defaults to PRACTICE_REPLY_DELAY_MS. */
  minReplyDelayMs?: number;
}

/** Build the runner config for a standard-xiangqi practice exercise. */
export function xiangqiPracticeConfig(
  options: XiangqiPracticeOptions,
): PracticeConfig<XiangqiMove, XiangqiGameState> {
  return {
    goal: options.goal,
    learner: options.learner,
    initialTruth: options.initialTruth,
    isLegal: (truth, move) =>
      truth.status.type === 'playing' && isStandardXiangqiLegalMove(truth, move),
    applyMove: (truth, move) => applyStandardXiangqiMove(truth, move),
    sideToMove: (truth) => (truth.status.type === 'playing' ? truth.status.turn : null),
    termination: (truth, learner) => xiangqiPracticeTermination(truth, learner as XiangqiColor),
    // Our square notation IS FSF xiangqi UCI, so a token splits straight back
    // into { from, to }; an off-position token returns null and the runner
    // treats it as "no reply available" rather than guessing a move.
    fromUci: (uci) => fsfUciToXiangqiSquares(uci),
    // Rendered in the reader's own notation setting, the same way the review
    // move list is: a drill that names moves differently from the analysis board
    // teaches the learner two vocabularies for one game.
    moveLabel: (move, parentTruth) =>
      formatXiangqiMove(parentTruth, move, currentXiangqiNotationStyle()),
    evaluate: options.evaluate,
    onMovePlayed: options.onMovePlayed,
    minReplyDelayMs: options.minReplyDelayMs ?? PRACTICE_REPLY_DELAY_MS,
  };
}

/** The engine dialect token for a move, for scripting or logging an exercise. */
export const xiangqiPracticeUci = (move: XiangqiMove): string => xiangqiMoveToFsfUci(move);
