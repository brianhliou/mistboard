-- Unrated three-minute Puzzle Storm runs (#715). Versioned server state is the
-- retry boundary; bests are updated in the same transaction as each accepted move.
CREATE TABLE puzzle_storm_runs (
  id UUID PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX puzzle_storm_runs_recent_idx
  ON puzzle_storm_runs (user_id, created_at DESC);

CREATE TABLE puzzle_storm_bests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  PRIMARY KEY (user_id, day)
);
