import {
  hasOwnKey,
  serializedTreeMainline,
  serializedTreeRootFen,
  studyAnalysisCoveredPlies,
} from '@mistboard/game';
import type { DecisionOverlay } from './analysis-marks.js';
import {
  type BanqiDecision,
  banqiDecisionOverlay,
  summarizeDecisions as summarizeBanqi,
} from './banqi-decisions.js';
import { type JieqiDecision, jieqiDecisionOverlay, summarizeDecisions } from './jieqi-decisions.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isWin(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}
function isLuckRow(raw: unknown): raw is JieqiDecision {
  return (
    isObject(raw) &&
    typeof raw.ply === 'number' &&
    Number.isInteger(raw.ply) &&
    raw.ply > 0 &&
    (raw.mover === 'red' || raw.mover === 'black') &&
    isWin(raw.playedWin) &&
    isWin(raw.realizedWin)
  );
}

/** Variant id -> row validator + the same overlay used by that variant's review. */
export const STUDY_DECISION_VARIANTS: Readonly<
  Record<
    string,
    {
      validate: (raw: unknown) => boolean;
      overlay: (rows: unknown[]) => DecisionOverlay;
    }
  >
> = {
  jieqi: {
    validate: isLuckRow,
    // Imported Jieqi rows remain reveal-luck only, as before.
    overlay: (rows) =>
      jieqiDecisionOverlay(
        summarizeDecisions(
          (rows as JieqiDecision[]).map(({ ply, mover, playedWin, realizedWin }) => ({
            ply,
            mover,
            playedWin,
            realizedWin,
          })),
        ),
      ),
  },
  banqi: {
    validate: (raw) =>
      isLuckRow(raw) &&
      isWin(raw.bestWin) &&
      (raw.playedRank === null ||
        (typeof raw.playedRank === 'number' &&
          Number.isInteger(raw.playedRank) &&
          raw.playedRank > 0)) &&
      Array.isArray(raw.candidates) &&
      raw.candidates.length > 0 &&
      raw.candidates.every(
        (candidate) =>
          isObject(candidate) &&
          typeof candidate.move === 'string' &&
          /^[a-h][0-3][a-h][0-3]$/.test(candidate.move) &&
          isWin(candidate.win) &&
          (candidate.played === undefined || typeof candidate.played === 'boolean'),
      ),
    overlay: (rows) => banqiDecisionOverlay(summarizeBanqi(rows as BanqiDecision[])),
  },
};

/** Read only. A local unsaved edit cannot relabel a different mainline move. */
export async function fetchStudyChapterDecisions(
  variant: string,
  studyId: string,
  chapterId: string,
  savedTree: unknown,
  mountedTree: unknown = savedTree,
): Promise<DecisionOverlay | null> {
  if (!hasOwnKey(STUDY_DECISION_VARIANTS, variant)) return null;
  const support = STUDY_DECISION_VARIANTS[variant]!;
  try {
    const response = await fetch(
      `/api/studies/${encodeURIComponent(studyId)}/chapters/${encodeURIComponent(chapterId)}/decisions`,
    );
    if (response.status !== 200) return null;
    const body = (await response.json()) as { decisions?: unknown };
    if (!Array.isArray(body.decisions)) return null;
    const covered = studyAnalysisCoveredPlies(
      { moves: serializedTreeMainline(savedTree), rootFen: serializedTreeRootFen(savedTree) },
      { moves: serializedTreeMainline(mountedTree), rootFen: serializedTreeRootFen(mountedTree) },
    );
    const rows = body.decisions.filter(
      (row) => support.validate(row) && (row as { ply: number }).ply <= covered,
    );
    return rows.length ? support.overlay(rows) : null;
  } catch {
    return null;
  }
}
