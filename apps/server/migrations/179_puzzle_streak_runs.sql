-- One-sitting Puzzle Streak (#375), separate from calendar-day streaks.
-- The random run UUID is an anonymous bearer capability; account ownership
-- comes only from the session. Canonical moves and scores stay on the server.
CREATE TABLE puzzle_streak_runs (
  id UUID PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX puzzle_streak_runs_best_idx
  ON puzzle_streak_runs (user_id, ((state->>'score')::integer) DESC)
  WHERE user_id IS NOT NULL;
