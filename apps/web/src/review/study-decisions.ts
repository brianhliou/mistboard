import {
  serializedTreeMainline,
  serializedTreeRootFen,
  studyAnalysisCoveredPlies,
} from '@mistboard/game';
import type { DecisionOverlay } from './analysis-marks.js';
import { type JieqiDecision, jieqiDecisionOverlay, summarizeDecisions } from './jieqi-decisions.js';

/** Read only. A local unsaved edit cannot relabel a different mainline move. */
export async function fetchStudyChapterDecisions(
  studyId: string,
  chapterId: string,
  savedTree: unknown,
  mountedTree: unknown = savedTree,
): Promise<DecisionOverlay | null> {
  try {
    const response = await fetch(
      `/api/studies/${encodeURIComponent(studyId)}/chapters/${encodeURIComponent(chapterId)}/decisions`,
    );
    if (response.status !== 200) return null;
    const body = (await response.json()) as { decisions: JieqiDecision[] };
    const covered = studyAnalysisCoveredPlies(
      { moves: serializedTreeMainline(savedTree), rootFen: serializedTreeRootFen(savedTree) },
      { moves: serializedTreeMainline(mountedTree), rootFen: serializedTreeRootFen(mountedTree) },
    );
    // Studies import luck only. Even full room-shaped rows do not introduce decision glyphs here.
    const rows = body.decisions
      .filter((row) => row.ply <= covered && row.realizedWin !== undefined)
      .map(({ ply, mover, playedWin, realizedWin }) => ({ ply, mover, playedWin, realizedWin }));
    return rows.length ? jieqiDecisionOverlay(summarizeDecisions(rows)) : null;
  } catch {
    return null;
  }
}
