import { getPool, isInitialized } from './persistence-db.js';
import {
  STUDY_DECISION_VARIANTS,
  type StudyDecisionsInput,
  validateStudyDecisions,
} from './study-chapter-decisions.js';

export type StudyChapterDecisionsRecord = StudyDecisionsInput & {
  chapterId: string;
  updatedAt: Date;
};
type Row = {
  chapter_id: string;
  engine_id: string;
  source: string;
  decisions: unknown;
  updated_at: Date;
  variant: string;
  root: unknown;
};
function record(row: Row): StudyChapterDecisionsRecord | null {
  // Validate reads too: legacy/direct SQL rows cannot bypass the public payload boundary.
  try {
    return {
      ...validateStudyDecisions(row.variant, row.root, {
        engineId: row.engine_id,
        source: row.source,
        decisions: row.decisions,
      }),
      chapterId: row.chapter_id,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}
export async function getStudyChapterDecisions(
  chapterId: string,
): Promise<StudyChapterDecisionsRecord | null> {
  if (!isInitialized()) return null;
  const { rows } = await getPool().query<Row>(
    `SELECT d.*, c.variant, c.root FROM study_chapter_decisions d JOIN study_chapters c ON c.id = d.chapter_id WHERE c.id = $1`,
    [chapterId],
  );
  return rows[0] ? record(rows[0]) : null;
}
export async function getStudyChapterDecisionsForRead(studyId: string, chapterId: string) {
  if (!isInitialized()) return null;
  const { rows } = await getPool().query<Row & { visibility: string; owner_id: string }>(
    `SELECT d.*, c.variant, c.root, s.visibility, s.owner_id FROM study_chapters c JOIN studies s ON s.id = c.study_id LEFT JOIN study_chapter_decisions d ON d.chapter_id = c.id WHERE c.id = $2 AND c.study_id = $1`,
    [studyId, chapterId],
  );
  const row = rows[0];
  return row
    ? {
        visibility: row.visibility,
        ownerId: row.owner_id,
        decisions: row.chapter_id ? record(row) : null,
      }
    : null;
}
export async function decidedStudyChapterIds(chapterIds: readonly string[]): Promise<Set<string>> {
  if (!isInitialized() || !chapterIds.length) return new Set<string>();
  const { rows } = await getPool().query<{ chapter_id: string }>(
    `SELECT d.chapter_id FROM study_chapter_decisions d JOIN study_chapters c ON c.id = d.chapter_id WHERE c.variant = ANY($2::text[]) AND c.id = ANY($1::text[])`,
    [chapterIds, Object.keys(STUDY_DECISION_VARIANTS)],
  );
  return new Set(rows.map((row) => row.chapter_id));
}
export async function saveStudyChapterDecisions(
  input: StudyDecisionsInput & { chapterId: string },
): Promise<void> {
  if (!isInitialized()) return;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ variant: string; root: unknown }>(
      'SELECT variant, root FROM study_chapters WHERE id = $1 FOR UPDATE',
      [input.chapterId],
    );
    if (!rows[0]) throw new Error('chapter not found');
    const checked = validateStudyDecisions(rows[0].variant, rows[0].root, {
      engineId: input.engineId,
      source: input.source,
      decisions: input.decisions,
    });
    await client.query(
      `INSERT INTO study_chapter_decisions (chapter_id, engine_id, source, decisions) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (chapter_id) DO UPDATE SET engine_id = EXCLUDED.engine_id, source = EXCLUDED.source, decisions = EXCLUDED.decisions, updated_at = now()`,
      [input.chapterId, checked.engineId, checked.source, JSON.stringify(checked.decisions)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
