// The game's advantage chart under an article replay board (a test, 2026-10-06).
//
// An article board whose game is in the broadcast archive (spec.boardId) can
// show the eval swing without sending the reader to the board page: the SAME
// chart the review and broadcast pages draw (review/advantage-chart.ts), fed by
// the SAME stored analysis (GET /api/xiangqi-broadcasts/games/<id>/analysis,
// which never starts an engine pass). Nothing here draws a chart of its own.
//
// Loaded with a dynamic import from xiangqi-replay.ts once the board nears the
// viewport, so the chart's code and CSS stay out of the article chunk and out of
// the prerender, which never mounts widgets.

import { winPercentK, type XiangqiGameState } from '@mistboard/game';
import { type AdvantageChart, createAdvantageChart } from './review/advantage-chart.js';
import { fetchCachedGameAnalysis, type GameAnalysis } from './review/game-analysis.js';
import { xiangqiGamePhases } from './review/xiangqi-phases.js';

/** Route segment of the broadcast analysis endpoint (`/api/<this>/games/<id>/analysis`). */
export const BROADCAST_ANALYSIS_ROUTE = 'xiangqi-broadcasts';

/**
 * The stored analysis of an article board's game, or null when there is nothing
 * to draw: no analysis yet (204), an error, a network failure, or a series that
 * does not cover this board's moves one for one. The last guard matters because
 * the article carries its own copy of the record: an eval series of a different
 * length would put the cursor on the wrong move, which is worse than no chart.
 */
export async function loadReplayChartAnalysis(
  boardId: string,
  totalPlies: number,
  fetchAnalysis: (
    route: string,
    id: string,
  ) => Promise<GameAnalysis | null> = fetchCachedGameAnalysis,
): Promise<GameAnalysis | null> {
  let analysis: GameAnalysis | null;
  try {
    analysis = await fetchAnalysis(BROADCAST_ANALYSIS_ROUTE, boardId);
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
