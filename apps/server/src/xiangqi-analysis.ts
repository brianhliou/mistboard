// Whole-game postgame analysis for xiangqi (P3.2). Evaluates every position of a
// finished game so the client can draw the advantage chart, mark move judgments,
// and score accuracy. Orchestration only — the eval work is Pikafish (Red POV),
// run through the shared sweep walker (game-analysis-sweep). The real path opens
// ONE persistent engine process per sweep (#168): spawn + NNUE net load happen
// once, then each ply is an incremental `position startpos moves …` prefix with
// a fixed NODE budget (`go nodes N`), so the eval is CPU-independent, uniform
// per position, and several-fold faster than the old spawn-per-ply depth sweep.

import {
  applyStandardXiangqiMove,
  classifyXiangqiMove,
  createInitialXiangqiState,
  pikafishUciToXiangqiSquares,
  winPercent,
  type XiangqiMove,
  xiangqiMoveToPikafishUci,
} from '@mistboard/game';
import type { AnalysisProgressStore } from './game-analysis-kernel.js';
import { sweepPlyEvals } from './game-analysis-sweep.js';
import {
  withXiangqiAnalysisSession,
  XIANGQI_ANALYSIS_MULTI_PV,
  type XiangqiPositionEval,
} from './xiangqi-pikafish-engine.js';

// Version of the ANALYSIS configuration (binary + net + the Red-POV sweep),
// independent of the PvE ladder's XIANGQI_ENGINE_VERSION. Bump whenever the
// analysis output would change so stored evals invalidate.
// @2 (2026-07-16, #168): the sweep budget moved from `go depth 12` to
// `go nodes 1_000_000` on a persistent process. A node-budget eval has
// different semantics than depth-12 (deeper in quiet positions, no depth-parity
// sawtooth), so @1 rows must NOT be served as if comparable — the id bump
// orphans them deliberately instead of silently mixing cache semantics.
// @3 (2026-08-27): every @2 row is WRONG, not merely differently-scaled. The UCI
// reader took the last scored `info` line, which under a node budget is the
// fail-high/fail-low line of the ABORTED final iteration — a bound score with a
// one-move pv. Measured over a 156-ply game: 38% of positions carried a
// truncated pv, evals were off by up to 163cp, and a real blunder was graded an
// inaccuracy. Fixed in uci-engine-harness (prefer the last COMPLETE iteration);
// this bump orphans the corrupted rows so they recompute on demand.
// @4 (2026-08-27, same day): the stored PV cap went 16 -> 32 plies. Bumping
// again is nearly free because @3 shipped hours earlier and almost nothing has
// recomputed yet, and it keeps every cached row on one PV depth rather than
// mixing 16-ply and 32-ply lines depending on when they were computed.
// @5 (2026-08-28, #315): the sweep now runs MultiPV 2 and persists the runner-up
// root move per ply, plus a `offerLine` capture search on the plies where a piece
// was offered and the engine's line declined it. Both are inputs the positive-glyph
// rules (`!!` / `!`) read; without them `!` could never fire in production and a
// declined `!!` stayed silent. Rank-1 scores are also very slightly different at
// the same node budget, because two lines share the budget — so @4 rows are not
// mixable and this bump orphans them.
export const XIANGQI_ANALYSIS_ENGINE_VERSION = 5;

// Cache engine id, version-suffixed so an engine/config change invalidates stored
// evals (the sibling pattern: JIEQI/BANQI/JUNGLE_ANALYSIS_ENGINE_ID). Xiangqi
// analyses were historically cached under the PvE bot id (XIANGQI_DEFAULT_ENGINE_ID),
// so the 2026-07-10 ladder rename ('pikafish-xiangqi-strong' -> 'pikafish-xiangqi-
// level-5') silently orphaned every cached row; migration 104 maps both old ids
// onto this dedicated id (at @1; @2 recomputes on demand).
export const XIANGQI_ANALYSIS_ENGINE_ID = `pikafish-xiangqi-analysis@${XIANGQI_ANALYSIS_ENGINE_VERSION}`;

// Nominal cache dimension for the (room, engine, depth) key. The sweep's real
// strength dial is the NODE budget (XIANGQI_ANALYSIS_NODES, encoded in the
// versioned engine id — the sibling-variant pattern); `depth` only has to be
// STABLE, so it stays at the family default. Lives beside the engine id (not
// in routes/xiangqi-games.ts) so the registration's share card can name the
// stored row without importing the route, which imports the registration.
export const XIANGQI_ANALYSIS_REQUEST_DEPTH = 12;

export type PlyEval = {
  /** Position AFTER this many plies (0 = start position). */
  ply: number;
  /** Centipawns from Red's POV; null when mate is set. */
  cp: number | null;
  /** Signed moves-to-mate from Red's POV; null otherwise. */
  mate: number | null;
  /** Engine best move at this position (engine UCI). */
  best: string | null;
  /** Principal variation at this position (engine UCI, capped) — the review's
   *  inline best-play line at judged moves. Absent on pre-PV cached rows. */
  pv?: string[];
  /** Runner-up root move at this position (MultiPV rank 2), Red POV, from the
   *  SAME search as `cp`/`mate`. The `!` rule's "was there another move this
   *  good" test. Absent at terminal / single-move positions and on rows cached
   *  before @5. */
  second?: { move: string; cp: number | null; mate: number | null };
  /** For the move that REACHED this position: the engine's line after the
   *  opponent accepts the piece it offered, when the main line declines it.
   *  `capture` is the accepting move (engine UCI); `pv` is the line from AFTER
   *  that capture, so it does not repeat it. Only present on the handful of
   *  plies that offer a piece the engine does not take (#315). */
  offerLine?: { capture: string; pv: string[] };
};

export type AnalyzeXiangqiGameOptions = {
  /** Depth handed to an INJECTED evaluate (tests / depth-based fallback). The
   *  real node-budget session path ignores it — nodes are the strength dial. */
  depth?: number;
  /** Node budget per position for the real sweep (default XIANGQI_ANALYSIS_NODES). */
  nodes?: number;
  /** Injectable for tests; defaults to the persistent-session Pikafish sweep. */
  evaluate?: (moves: string[], opts: { depth?: number }) => Promise<XiangqiPositionEval>;
  /** Incremental-checkpoint store: the sweep saves after every evaluated ply and
   *  resumes from the last checkpoint (persist expensive output incrementally). */
  progress?: AnalysisProgressStore<PlyEval>;
  /**
   * The same game in native moves. Optional, and only used to attach `offerLine`
   * rows (#315): finding an offered-but-declined piece needs the BOARD, which the
   * UCI prefix walk does not carry. Omit and the sweep is exactly as before,
   * minus the declined-sacrifice half of `!!`.
   */
  moves?: readonly XiangqiMove[];
};

/**
 * Evaluate positions after 0, 1, … N plies (N+1 points) and return the Red-POV
 * series. `movesUci` is the game's move history in Pikafish UCI (the caller builds
 * it from the timeline via xiangqiMoveToPikafishUci). With an injected `evaluate`
 * this is a plain prefix walk (the shared sweep); the default path runs the walk
 * against one persistent engine session at the analysis node budget.
 */
export async function analyzeXiangqiGame(
  movesUci: readonly string[],
  opts: AnalyzeXiangqiGameOptions = {},
): Promise<PlyEval[]> {
  const injected = opts.evaluate;
  if (injected) {
    const depth = opts.depth ?? XIANGQI_ANALYSIS_DEPTH_FALLBACK;
    const evals = await sweepPlyEvals(
      movesUci,
      (moves, o) => injected(moves, o),
      depth,
      opts.progress,
    );
    // The offer pass runs on the injected path too: it is ordinary logic over the
    // sweep's own output, and keeping it behind the real-engine branch would leave
    // it untestable — which is how a code path ships having never run.
    if (opts.moves?.length) {
      await attachOfferLines(evals, movesUci, opts.moves, (moves) => injected(moves, { depth }));
    }
    return evals;
  }
  return await withXiangqiAnalysisSession(
    // The session evaluator carries the node budget internally; the sweep's depth
    // argument is the nominal cache dimension and is not a search limit here.
    async (evaluate) => {
      const evals = await sweepPlyEvals(movesUci, (moves) => evaluate(moves), 0, opts.progress);
      if (opts.moves?.length) {
        await attachOfferLines(evals, movesUci, opts.moves, evaluate);
      }
      return evals;
    },
    { nodes: opts.nodes, multiPv: XIANGQI_ANALYSIS_MULTI_PV },
  );
}

/**
 * Second pass over a finished sweep: for every ply that OFFERED a piece the
 * engine's own line declined, search the position after the opponent takes it and
 * store that line on the ply's row.
 *
 * Why a second pass rather than a wider first one: the test is cheap but needs the
 * board and the classifier's own verdict, and it fires rarely — a 13-game corpus
 * scan needed 8 of these searches in total. Running the classifier first is what
 * keeps it rare: a move that was not near-best, was made in check, or was forced
 * never reaches the sacrifice branch, so it never costs a search.
 *
 * Failures here are swallowed on purpose. `offerLine` is an enrichment: without it
 * the classifier reports `sacrifice-unverified` and stays silent, which is exactly
 * today's behaviour. Losing the whole sweep over it would be a bad trade.
 */
async function attachOfferLines(
  evals: PlyEval[],
  movesUci: readonly string[],
  moves: readonly XiangqiMove[],
  evaluate: (moves: string[]) => Promise<XiangqiPositionEval>,
): Promise<void> {
  const byPly = new Map(evals.map((entry) => [entry.ply, entry]));
  let state = createInitialXiangqiState('analysis');
  for (let ply = 1; ply <= moves.length; ply += 1) {
    const move = moves[ply - 1];
    const before = state;
    if (!move || before.status.type !== 'playing') return;
    const next = applyStandardXiangqiMove(before, move);
    // The kernel may adjudicate an end (repetition, no-progress) before the record
    // does; nothing past that point is a position worth classifying.
    if (next === before) return;
    state = next;

    const beforeEval = byPly.get(ply - 1);
    const afterEval = byPly.get(ply);
    if (!beforeEval || !afterEval) continue;
    // Red moves first, so odd plies are Red's.
    const moverIsRed = ply % 2 === 1;
    const redBefore = winPercent(beforeEval.cp, beforeEval.mate);
    const redAfter = winPercent(afterEval.cp, afterEval.mate);
    const pvAfter: XiangqiMove[] = [];
    for (const uci of afterEval.pv ?? []) {
      const decoded = pikafishUciToXiangqiSquares(uci);
      if (!decoded) break;
      pvAfter.push(decoded);
    }

    let verdict: ReturnType<typeof classifyXiangqiMove>;
    try {
      verdict = classifyXiangqiMove({
        before,
        move,
        winBefore: moverIsRed ? redBefore : 100 - redBefore,
        winAfter: moverIsRed ? redAfter : 100 - redAfter,
        playedBest: beforeEval.best === movesUci[ply - 1],
        pvAfter,
      });
    } catch {
      continue; // a position the rules cannot read offers nothing to search
    }
    if (verdict.reason !== 'sacrifice-unverified') continue;
    const offered = verdict.material.offeredPiece;
    if (!offered) continue;

    const capture = xiangqiMoveToPikafishUci({ from: offered.capturer, to: offered.square });
    try {
      const line = await evaluate([...movesUci.slice(0, ply), capture]);
      if (line.pv?.length) afterEval.offerLine = { capture, pv: line.pv };
    } catch {
      // Enrichment only — see the note above.
    }
  }
}

// Depth handed to an injected evaluate when none is specified. Kept at the old
// request-depth default so the injectable (test) contract is unchanged.
const XIANGQI_ANALYSIS_DEPTH_FALLBACK = 12;
