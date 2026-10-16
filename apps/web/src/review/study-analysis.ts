// A study chapter's stored engine analysis, cut to what still describes it.
//
// The server stores each chapter's analysis with the line it ran on
// (GET /api/studies/:id/chapters/:cid/analysis). The page compares that line
// with the tree it is about to mount, which for an owner may be an unsaved
// local draft, and hands the review shell only the shared prefix: the chart,
// the move judgments and the accuracy summary then cover exactly the plies
// whose positions the analysis saw. An edit after the run shortens the chart
// rather than leaving it describing a game that is no longer on the board.

import {
  coveredStudyAnalysisPlies,
  serializedTreeMainline,
  serializedTreeRootFen,
  studyAnalysisCoveredPlies,
} from '@mistboard/game';
import { computeGameAnalysis, type GameAnalysis, type PlyEval } from './game-analysis.js';
import type { AnalysisSource } from './tree-review.js';

export type StudyChapterAnalysisResponse = {
  engineId: string;
  depth: number;
  rootFen: string | null;
  /** The analysed mainline, in the chapter tree's own UCI strings. */
  moves: string[];
  plies: PlyEval[];
};

/** Who moves first from a chapter's start: the FEN's side-to-move field
 *  ('b' is Black in every FEN spelling the site writes), Red otherwise. */
function firstMoverOf(rootFen: string | null): 'red' | 'black' {
  return rootFen?.trim().split(/\s+/)[1] === 'b' ? 'black' : 'red';
}

/** The stored analysis as the review shell's GameAnalysis, over the prefix of
 *  `tree`'s mainline it still covers; null when it covers no move. */
export function studyChapterGameAnalysis(
  stored: StudyChapterAnalysisResponse,
  tree: unknown,
): GameAnalysis | null {
  const rootFen = serializedTreeRootFen(tree);
  const covered = studyAnalysisCoveredPlies(
    { moves: stored.moves, rootFen: stored.rootFen ?? null },
    { moves: serializedTreeMainline(tree), rootFen },
  );
  const plies = coveredStudyAnalysisPlies(stored.plies, covered);
  if (!plies) return null;
  return computeGameAnalysis(
    { engineId: stored.engineId, depth: stored.depth, plies },
    { firstMover: firstMoverOf(rootFen) },
  );
}

/** GET the chapter's analysis and cut it to `tree`. Null on none (204), on any
 *  failure, and when nothing is covered: the page then renders as it did
 *  before analysis existed, which is the right fallback for a decoration. */
export async function fetchStudyChapterAnalysis(
  studyId: string,
  chapterId: string,
  tree: unknown,
): Promise<GameAnalysis | null> {
  try {
    const response = await fetch(
      `/api/studies/${encodeURIComponent(studyId)}/chapters/${encodeURIComponent(chapterId)}/analysis`,
    );
    if (response.status !== 200) return null;
    return studyChapterGameAnalysis((await response.json()) as StudyChapterAnalysisResponse, tree);
  } catch {
    return null;
  }
}

/** The review shell's analysis seam over an analysis already in hand. There is
 *  no request affordance on a study: the analysis is produced server-side, so
 *  `run` is never offered (fetchCached always answers) and refuses if called. */
export function storedStudyAnalysisSource(analysis: GameAnalysis): AnalysisSource {
  return {
    requestLabel: '',
    fetchCached: async () => analysis,
    run: () => Promise.reject(new Error('study analysis is produced on the server')),
  };
}
