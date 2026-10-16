-- 166_user_achievements.sql
-- The achievements ledger (docs-private/competitive-layer-2026-10.md section d).
--
-- One row per (account, achievement), written once and never revoked. The
-- definitions live as data in packages/game/src/achievements.ts; this table
-- holds only who earned what, when, and from which event, so a new achievement
-- is a new id here, never a migration. Writers go through awardAchievements
-- (persistence-achievements.ts) with INSERT ... ON CONFLICT DO NOTHING, so the
-- live hooks and scripts/backfill-achievements.mjs can both run any number of
-- times and the earliest award stands.
--
--   awarded_at   when the qualifying event happened (a backfilled award keeps
--                the date of the game, puzzle or post that earned it).
--   source_kind  what source_id names. source_id is never shown publicly: it
--   source_id    can point at a private game or a hidden post.
--   context      small JSON for the award (variant, rating); optional.
--   seen_at      reserved for the notification step (when the account saw the
--                award); nothing sets it yet.
--
-- Accounts only: guests have no profile to show an award on. Stats-excluded
-- accounts earn like anyone else; public holder counts filter them out.

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id  TEXT        NOT NULL CHECK (achievement_id ~ '^[a-z0-9][a-z0-9:-]{0,79}$'),
  awarded_at      TIMESTAMPTZ NOT NULL,
  source_kind     TEXT        NOT NULL
                  CHECK (source_kind IN ('game', 'puzzle', 'forum_post', 'study', 'tournament')),
  source_id       TEXT        NOT NULL,
  context         JSONB,
  seen_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS user_achievements_achievement_idx
  ON user_achievements (achievement_id);
