-- 163_study_chapter_analysis.sql
-- Whole-game engine analysis of a study chapter's mainline (issue #510; the
-- first version covers studies owned by the site account, produced by
-- `npm run study:analyse`).
--
-- Not game_analysis (079): that table is keyed by an immutable game, and a
-- chapter is a document its owner keeps editing. So each row records the exact
-- line it ran on (`moves`, the chapter tree's own UCI strings, plus `root_fen`
-- for a chapter that starts from a set-up position), and a reader is shown
-- only the prefix of the analysis that still matches the chapter's current
-- mainline, the way lichess charts mainline.slice(0, analysedPathLength). An
-- edit after the run leaves the later moves uncovered instead of showing evals
-- for positions that are no longer on the board.
--
-- One row per chapter: a re-run replaces it. `plies` is the same PlyEval[]
-- the game analysis endpoints serve (Red POV, best/pv in our square notation).
-- `source` says where the evals came from: 'engine' for a run of its own, or
-- 'broadcast:<boardId>' when the chapter is a broadcast game whose stored
-- analysis was copied rather than recomputed.

CREATE TABLE IF NOT EXISTS study_chapter_analysis (
  chapter_id TEXT        PRIMARY KEY REFERENCES study_chapters(id) ON DELETE CASCADE,
  engine_id  TEXT        NOT NULL,
  depth      INTEGER     NOT NULL,
  root_fen   TEXT,
  moves      JSONB       NOT NULL,
  plies      JSONB       NOT NULL,
  source     TEXT        NOT NULL DEFAULT 'engine',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
