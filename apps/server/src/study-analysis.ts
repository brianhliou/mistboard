// Whole-game engine analysis for study chapters (#510, first version: studies
// owned by the site account). The analysis is the one a finished xiangqi game
// gets (analyzeXiangqiPostgame: Pikafish at the analysis node budget, MultiPV 2,
// the offered-piece pass), run on the chapter's mainline and stored with that
// line (study_chapter_analysis, migration 163). The reader charts only the
// prefix that still matches the chapter (studyAnalysisCoveredPlies), so a
// chapter edited after its run shows fewer evals, never wrong ones.
//
// This module decides, per chapter, what to do (planChapterAnalysis) and does
// it (runChapterAnalysis) behind injectable engine/storage seams; the CLI in
// study-analysis-cli.ts wires the live ones. Who may have analysis made is the
// caller's business: the CLI picks @mistboard's studies, and a later request
// path (#510) only has to change that choice, not anything here.

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  fsfUciToXiangqiSquares,
  serializedTreeMainline,
  serializedTreeRootFen,
  studyAnalysisCoveredPlies,
  type XiangqiMove,
  xiangqiMoveToFsfUci,
} from '@mistboard/game';
import { isVacuousAnalysis } from './game-analysis-sweep.js';
import type { StoredPlyEval } from './persistence-game-analysis.js';

/** The longest line one chapter's run analyses: the game-analysis route's own
 *  cap. A longer mainline is analysed up to it, and the chart covers that much. */
export const STUDY_ANALYSIS_MAX_PLIES = 300;

export type StudyChapterForAnalysis = {
  chapterId: string;
  variant: string;
  /** The chapter's SerializedTree. */
  root: unknown;
  practice: boolean;
  gamebook: boolean;
};

export type StoredChapterAnalysis = {
  engineId: string;
  rootFen: string | null;
  moves: readonly string[];
} | null;

export type ChapterAnalysisPlan =
  | { kind: 'skip'; reason: string }
  /** The stored analysis already covers this exact line with this engine. */
  | { kind: 'current'; plies: number }
  /** Copy the evals a broadcast game already has; no engine run. */
  | { kind: 'reuse'; boardId: string; ucis: string[]; replaces: boolean }
  | { kind: 'run'; ucis: string[]; moves: XiangqiMove[]; replaces: boolean };

/**
 * The chapter's mainline as the board will play it: decoded from the tree's
 * UCI strings and replayed from the standard start, stopping at the first move
 * the kernel refuses (an illegal move, or any move after the game ended), the
 * same place the study board's own replay stops. Capped at `maxPlies`.
 */
export function xiangqiChapterLine(
  root: unknown,
  maxPlies = STUDY_ANALYSIS_MAX_PLIES,
): { ucis: string[]; moves: XiangqiMove[] } {
  const ucis: string[] = [];
  const moves: XiangqiMove[] = [];
  let state = createInitialXiangqiState('study-analysis');
  for (const uci of serializedTreeMainline(root)) {
    if (moves.length >= maxPlies) break;
    const move = fsfUciToXiangqiSquares(uci);
    if (!move) break;
    const next = applyStandardXiangqiMove(state, move);
    if (next === state) break;
    state = next;
    // Store the canonical spelling, which is also what the tree serializer
    // writes, so the reader's prefix comparison is string equality.
    ucis.push(xiangqiMoveToFsfUci(move));
    moves.push(move);
  }
  return { ucis, moves };
}

/** Finished broadcast games with stored analysis, looked up by their opening
 *  moves so a chapter made from one finds it without a scan per chapter. */
export type BroadcastAnalysisIndex = {
  /** A board whose moves begin with `ucis` (equal or longer), if any. */
  find(ucis: readonly string[]): string | null;
};

const INDEX_KEY_PLIES = 12;

export function buildBroadcastAnalysisIndex(
  boards: ReadonlyArray<{ id: string; moves: readonly XiangqiMove[] }>,
): BroadcastAnalysisIndex {
  const byKey = new Map<string, Array<{ id: string; ucis: string[] }>>();
  const keyOf = (ucis: readonly string[]) => ucis.slice(0, INDEX_KEY_PLIES).join(' ');
  for (const board of boards) {
    const ucis = board.moves.map((move) => xiangqiMoveToFsfUci(move));
    // A board can only serve a chapter at least as long as the key, so the
    // key is taken at every length up to it: a 6-ply chapter looks up 6 plies.
    for (let length = 1; length <= Math.min(INDEX_KEY_PLIES, ucis.length); length += 1) {
      const key = keyOf(ucis.slice(0, length));
      const list = byKey.get(key);
      if (list) list.push({ id: board.id, ucis });
      else byKey.set(key, [{ id: board.id, ucis }]);
    }
  }
  return {
    find(ucis) {
      if (ucis.length === 0) return null;
      const candidates = byKey.get(keyOf(ucis)) ?? [];
      // Prefer the board that IS the chapter's game, then any longer one.
      let longer: string | null = null;
      for (const candidate of candidates) {
        if (candidate.ucis.length < ucis.length) continue;
        if (!ucis.every((uci, index) => candidate.ucis[index] === uci)) continue;
        if (candidate.ucis.length === ucis.length) return candidate.id;
        longer ??= candidate.id;
      }
      return longer;
    },
  };
}

export function planChapterAnalysis(
  chapter: StudyChapterForAnalysis,
  stored: StoredChapterAnalysis,
  opts: { engineId: string; force?: boolean; broadcasts?: BroadcastAnalysisIndex | null },
): ChapterAnalysisPlan {
  if (chapter.variant !== 'xiangqi') return { kind: 'skip', reason: `variant ${chapter.variant}` };
  // A practice chapter's tree is never read (the engine plays the side), and a
  // gamebook opens in the lesson player, which has no chart to put it in.
  if (chapter.practice) return { kind: 'skip', reason: 'practice chapter' };
  if (chapter.gamebook) return { kind: 'skip', reason: 'gamebook chapter' };
  // The analysis session replays from the standard start; a set-up position
  // needs `position fen` and a side-to-move POV, which it does not do yet.
  if (serializedTreeRootFen(chapter.root)) return { kind: 'skip', reason: 'set-up position' };
  const { ucis, moves } = xiangqiChapterLine(chapter.root);
  if (moves.length === 0) return { kind: 'skip', reason: 'no moves' };
  const replaces = stored !== null;
  if (
    !opts.force &&
    stored &&
    stored.engineId === opts.engineId &&
    stored.rootFen === null &&
    studyAnalysisCoveredPlies(
      { moves: stored.moves, rootFen: stored.rootFen },
      { moves: ucis, rootFen: null },
    ) === ucis.length &&
    stored.moves.length === ucis.length
  ) {
    return { kind: 'current', plies: ucis.length };
  }
  const boardId = opts.broadcasts?.find(ucis) ?? null;
  if (boardId) return { kind: 'reuse', boardId, ucis, replaces };
  return { kind: 'run', ucis, moves, replaces };
}

export type ChapterAnalysisDeps = {
  /** The whole-game engine pass over `moves` from the standard start. */
  analyse(moves: readonly XiangqiMove[]): Promise<{
    engineId: string;
    depth: number;
    plies: StoredPlyEval[];
  }>;
  /** A broadcast board's stored evals under the analysis engine, or null. */
  broadcastPlies(boardId: string): Promise<StoredPlyEval[] | null>;
  save(record: {
    chapterId: string;
    engineId: string;
    depth: number;
    rootFen: string | null;
    moves: readonly string[];
    plies: readonly StoredPlyEval[];
    source: string;
  }): Promise<void>;
  engineId: string;
  depth: number;
};

/** Carry out a `reuse` or `run` plan and store the result. Returns the plies
 *  stored, or throws (an all-null sweep is refused, never stored). */
export async function runChapterAnalysis(
  chapterId: string,
  plan: Extract<ChapterAnalysisPlan, { kind: 'reuse' | 'run' }>,
  deps: ChapterAnalysisDeps,
): Promise<{ plies: number; source: string }> {
  if (plan.kind === 'reuse') {
    const all = await deps.broadcastPlies(plan.boardId);
    // The board was indexed because it had a row; one deleted since is a run.
    if (!all) throw new Error(`broadcast ${plan.boardId} has no stored analysis`);
    const plies = all.filter((entry) => entry.ply <= plan.ucis.length);
    if (plies.length !== plan.ucis.length + 1) {
      throw new Error(`broadcast ${plan.boardId} analysis is missing plies`);
    }
    const source = `broadcast:${plan.boardId}`;
    await deps.save({
      chapterId,
      engineId: deps.engineId,
      depth: deps.depth,
      rootFen: null,
      moves: plan.ucis,
      plies,
      source,
    });
    return { plies: plan.ucis.length, source };
  }
  const result = await deps.analyse(plan.moves);
  if (isVacuousAnalysis(result.plies)) {
    throw new Error('engine returned no scores (is the Pikafish binary and net reachable?)');
  }
  await deps.save({
    chapterId,
    engineId: result.engineId,
    depth: result.depth,
    rootFen: null,
    moves: plan.ucis,
    plies: result.plies,
    source: 'engine',
  });
  return { plies: plan.ucis.length, source: 'engine' };
}
