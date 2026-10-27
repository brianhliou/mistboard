-- The first outcome and its rating delta remain immutable. A later solve of a
-- failed puzzle records its first repair separately, without becoming a solve
-- in the original attempt statistics. Existing failures start unresolved.
ALTER TABLE puzzle_attempts ADD COLUMN repaired_at TIMESTAMPTZ;

ALTER TABLE puzzle_attempts ADD CONSTRAINT puzzle_attempts_repair_requires_failure
  CHECK (repaired_at IS NULL OR solved = FALSE);

CREATE INDEX puzzle_attempts_unresolved_idx
  ON puzzle_attempts (user_id, created_at DESC, puzzle_id)
  WHERE solved = FALSE AND repaired_at IS NULL;
