-- 184_study_chapter_score_series.sql
-- Optional named score series on a study chapter, drawn as a win-chance graph
-- under the board in the study embed.
--
-- Shape (validated in the application, parseChapterScoreSeries, not here):
--   { "side": "red" | "black",
--     "series": [ { "name": "AB-JChess", "color": "a", "values": [0.5, ...] } ] }
-- Each value is one win chance in [0, 1] for `side`; index 0 is the start
-- position and index n is after mainline ply n.
--
-- Its own column rather than inside `root`: the study page autosaves the tree
-- from the client's model, which knows nothing of series and would drop them on
-- the first edit, and `denorm` is rewritten from the tree on every save. A tree
-- edit that changes the mainline length leaves the series stale; the reader
-- draws nothing when the lengths disagree, so a stale series is hidden, never
-- misdrawn.

ALTER TABLE study_chapters
  ADD COLUMN IF NOT EXISTS score_series JSONB;
