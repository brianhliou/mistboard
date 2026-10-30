-- Evidence survives puzzle edits and review; one vote per account or guest
-- browser per puzzle prevents reloads from reaching the withholding threshold.
CREATE TABLE puzzle_reports (
  puzzle_id text NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  reporter text NOT NULL,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  device_id text,
  reason text NOT NULL CHECK (reason IN (
    'wrong-solution', 'second-winning-move', 'wrong-theme', 'other'
  )),
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  decision text CHECK (decision IN ('dismiss', 'retire')),
  PRIMARY KEY (puzzle_id, reporter)
);

CREATE INDEX puzzle_reports_pending_idx ON puzzle_reports (puzzle_id, created_at)
  WHERE reviewed_at IS NULL;
