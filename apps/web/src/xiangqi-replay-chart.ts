// The game's advantage chart under an article replay board (a test, 2026-10-06;
// every article game since 2026-10-08).
//
// The SAME chart the review and broadcast pages draw (review/advantage-chart.ts),
// fed by the SAME engine pass. Nothing here draws a chart of its own. Two sources:
// - a board whose game is in the broadcast archive (spec.boardId) reads the stored
//   analysis (GET /api/xiangqi-broadcasts/games/<id>/analysis, which never starts
//   an engine pass);
// - any other article game reads a precomputed file of the same analysis, shipped
//   with the site (article-replay-analysis.ts).
//
// Loaded with a dynamic import from xiangqi-replay.ts once the board nears the
// viewport, so the chart's code and CSS stay out of the article chunk and out of
// the prerender, which never mounts widgets.

import { winPercentK, type XiangqiGameState } from '@mistboard/game';
import { type AdvantageChart, createAdvantageChart } from './review/advantage-chart.js';
import {
  computeGameAnalysis,
  fetchCachedGameAnalysis,
  type GameAnalysis,
  type XiangqiGameAnalysisResponse,
} from './review/game-analysis.js';
import { xiangqiGamePhases } from './review/xiangqi-phases.js';

/** Route segment of the broadcast analysis endpoint (`/api/<this>/games/<id>/analysis`). */
export const BROADCAST_ANALYSIS_ROUTE = 'xiangqi-broadcasts';

/** Where an article board's analysis comes from: the archive, or a shipped file. */
export type ReplayChartSource =
  | { boardId: string }
  | { load: () => Promise<XiangqiGameAnalysisResponse | null> };

/**
 * The analysis of an article board's game, or null when there is nothing to
 * draw: no analysis yet (204), an error, a network failure, or a series that
 * does not cover this board's moves one for one. The last guard matters because
 * the article carries its own copy of the record: an eval series of a different
 * length would put the cursor on the wrong move, which is worse than no chart.
 * It holds for both sources; a shipped file is checked like a fetched row.
 */
export async function loadReplayChartAnalysis(
  source: ReplayChartSource,
  totalPlies: number,
  fetchAnalysis: (
    route: string,
    id: string,
  ) => Promise<GameAnalysis | null> = fetchCachedGameAnalysis,
): Promise<GameAnalysis | null> {
  let analysis: GameAnalysis | null;
  try {
    if ('boardId' in source) {
      analysis = await fetchAnalysis(BROADCAST_ANALYSIS_ROUTE, source.boardId);
    } else {
      const body = await source.load();
      analysis = body && Array.isArray(body.plies) ? computeGameAnalysis(body) : null;
    }
  } catch {
    return null;
  }
  if (!analysis) return null;
  const { evals } = analysis;
  if (evals.length !== totalPlies + 1) return null;
  if (evals.some((entry, i) => entry.ply !== i)) return null;
  return analysis;
}

export type ReplayChartOptions = {
  /** One position per ply, `states[0]` the start: feeds the phase dividers. */
  states: readonly XiangqiGameState[];
  /** "12. h2e2" for the hover readout, or null for the start position. */
  moveLabel: (ply: number) => string | null;
  onJump: (ply: number) => void;
  ariaLabel: string;
  phaseLabels: { opening: string; middlegame: string; endgame: string };
};

/** Draw the chart for a loaded analysis. The caller places `el` and drives `setPly`. */
export function createReplayAdvantageChart(
  analysis: GameAnalysis,
  opts: ReplayChartOptions,
): AdvantageChart {
  const chart = createAdvantageChart(analysis.evals, {
    winK: winPercentK(analysis.engineId),
    phases: xiangqiGamePhases(opts.states),
    phaseLabels: opts.phaseLabels,
    moveLabel: opts.moveLabel,
    onJump: opts.onJump,
  });
  chart.el.setAttribute('aria-label', opts.ariaLabel);
  return chart;
}
