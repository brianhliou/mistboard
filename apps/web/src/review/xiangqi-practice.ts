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
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
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
 * what the defender plays. `exact` is set only from an exact tablebase answer
 * (also side to move); a miss, an outage or the timeout leave it null, and the
 * runner grades by the engine as before.
 */
export async function evaluateXiangqiForPractice(
  ceval: CevalHandle,
  truth: XiangqiGameState,
  lookup: XiangqiTablebaseLookupFn = fetchXiangqiTablebase,
): Promise<PracticeEval> {
  // A finished position has no move to search; asking anyway wastes a search and
  // some engines answer with a stale line.
  if (truth.status.type !== 'playing') return { cp: null, mate: null, bestUci: null };

  const [engine, exact] = await Promise.all([
    searchForPractice(ceval, truth),
    exactResult(lookup, truth),
  ]);
  return { ...engine, exact };
}

async function exactResult(
  lookup: XiangqiTablebaseLookupFn,
  truth: XiangqiGameState,
): Promise<PracticeEval['exact']> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRACTICE_TABLEBASE_TIMEOUT_MS);
  try {
    const response = await lookup(truth, controller.signal);
    return response.status === 'exact' ? { result: response.result } : null;
  } catch {
    return null;
  } finally {
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
  };
}

/** The engine dialect token for a move, for scripting or logging an exercise. */
export const xiangqiPracticeUci = (move: XiangqiMove): string => xiangqiMoveToFsfUci(move);
