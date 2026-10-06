// Persistence for a study chapter's whole-game engine analysis (migration 163).
// One row per chapter, replaced by a re-run. The row carries the line it was
// computed on, so the reader can chart only the prefix that still matches the
// chapter (study-analysis.ts on the server, review/study-analysis.ts on the
// web). Reads return null / empty when persistence is disabled.

import type { XiangqiMove } from '@mistboard/game';
import { getPool, isInitialized } from './persistence-db.js';
import type { StoredPlyEval } from './persistence-game-analysis.js';

export type StudyChapterAnalysisRecord = {
  chapterId: string;
  engineId: string;
  depth: number;
  /** The chapter's hand-set start (SerializedTree.rootFen) the run started
   *  from; null for the standard start. */
  rootFen: string | null;
  /** The analysed mainline, in the chapter tree's own UCI strings. */
  moves: string[];
  /** PlyEval per position, 0..moves.length (Red POV). */
  plies: StoredPlyEval[];
  /** 'engine', or 'broadcast:<boardId>' when copied from a broadcast game. */
  source: string;
  updatedAt: Date;
};

type Row = {
  chapter_id: string;
  engine_id: string;
  depth: number;
  root_fen: string | null;
  moves: string[];
  plies: StoredPlyEval[];
  source: string;
  updated_at: Date;
};

function mapRow(row: Row): StudyChapterAnalysisRecord {
  return {
    chapterId: row.chapter_id,
    engineId: row.engine_id,
    depth: row.depth,
    rootFen: row.root_fen,
    moves: row.moves,
    plies: row.plies,
    source: row.source,
    updatedAt: row.updated_at,
  };
}

export async function getStudyChapterAnalysis(
  chapterId: string,
): Promise<StudyChapterAnalysisRecord | null> {
  if (!isInitialized()) return null;
  const { rows } = await getPool().query<Row>(
    `SELECT chapter_id, engine_id, depth, root_fen, moves, plies, source, updated_at
       FROM study_chapter_analysis WHERE chapter_id = $1`,
    [chapterId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * The analysis of one chapter together with what decides who may read it (the
 * study's visibility and owner), in one row, so the read endpoint never loads
 * a whole study's trees to answer for one chapter. Null when the chapter is
 * not in that study.
 */
export async function getStudyChapterAnalysisForRead(
  studyId: string,
  chapterId: string,
): Promise<{
  visibility: string;
  ownerId: string;
  analysis: StudyChapterAnalysisRecord | null;
} | null> {
  if (!isInitialized()) return null;
  const { rows } = await getPool().query<
    { visibility: string; owner_id: string } & { [K in keyof Row]: Row[K] | null }
  >(
    `SELECT s.visibility, s.owner_id,
            a.chapter_id, a.engine_id, a.depth, a.root_fen, a.moves, a.plies, a.source, a.updated_at
       FROM study_chapters c
       JOIN studies s ON s.id = c.study_id
       LEFT JOIN study_chapter_analysis a ON a.chapter_id = c.id
      WHERE c.id = $2 AND c.study_id = $1`,
    [studyId, chapterId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    visibility: row.visibility,
    ownerId: row.owner_id,
    analysis: row.chapter_id === null ? null : mapRow(row as Row),
  };
}

/** Which of these chapters have a stored analysis: one indexed read for the
 *  whole study, so the study payload can say which chapters to fetch. */
export async function analysedStudyChapterIds(chapterIds: readonly string[]): Promise<Set<string>> {
  if (!isInitialized() || chapterIds.length === 0) return new Set();
  const { rows } = await getPool().query<{ chapter_id: string }>(
    `SELECT chapter_id FROM study_chapter_analysis WHERE chapter_id = ANY($1::text[])`,
    [chapterIds],
  );
  return new Set(rows.map((row) => row.chapter_id));
}

/** Insert or replace the chapter's analysis. */
export async function saveStudyChapterAnalysis(input: {
  chapterId: string;
  engineId: string;
  depth: number;
  rootFen: string | null;
  moves: readonly string[];
  plies: readonly StoredPlyEval[];
  source: string;
}): Promise<void> {
  if (!isInitialized()) return;
  await getPool().query(
    `INSERT INTO study_chapter_analysis
       (chapter_id, engine_id, depth, root_fen, moves, plies, source)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
     ON CONFLICT (chapter_id) DO UPDATE SET
       engine_id = EXCLUDED.engine_id,
       depth = EXCLUDED.depth,
       root_fen = EXCLUDED.root_fen,
       moves = EXCLUDED.moves,
       plies = EXCLUDED.plies,
       source = EXCLUDED.source,
       updated_at = now()`,
    [
      input.chapterId,
      input.engineId,
      input.depth,
      input.rootFen,
      JSON.stringify(input.moves),
      JSON.stringify(input.plies),
      input.source,
    ],
  );
}

/**
 * Finished broadcast boards that already carry a stored analysis under
 * (engineId, depth), with their moves: the candidates a chapter made from a
 * broadcast game can copy its evals from instead of running the engine again.
 * `minPlies` keeps the scan to boards at least as long as the shortest chapter
 * asking.
 */
export async function analysedBroadcastBoards(input: {
  engineId: string;
  depth: number;
  minPlies: number;
}): Promise<Array<{ id: string; moves: XiangqiMove[] }>> {
  if (!isInitialized()) return [];
  // The payload's moves, which is what the broadcast analysis itself ran on
  // (getXiangqiBroadcastBoard spreads the payload).
  const { rows } = await getPool().query<{ id: string; moves: XiangqiMove[] }>(
    `SELECT b.id, COALESCE(b.payload->'moves', b.moves) AS moves FROM xiangqi_broadcast_boards b
      WHERE b.status = 'complete' AND b.ply_count >= $3
        AND EXISTS (
          SELECT 1 FROM game_analysis g
           WHERE g.room_id = 'broadcast:' || b.id AND g.engine_id = $1 AND g.depth = $2
        )`,
    [input.engineId, input.depth, Math.max(1, input.minPlies)],
  );
  return rows;
}
