-- 165_correspondence_seek_outcomes.sql
-- What happened to a correspondence seek once it left correspondence_seeks (#527).
--
-- Accept, cancel, decline and the expiry sweep all hard-delete the seek row, and
-- the room an accept creates carries no seek id, so a dead /challenge/<id> link
-- could only say "no longer open". One row here per closed seek lets the landing
-- page say "Taken by X · Watch", "Withdrawn", "Declined" or "Expired" instead.
--
--   taken     written by the accept route after the game is created (room_id and
--             accepter_user_id set). A failed create writes nothing.
--   cancelled the creator withdrew it.
--   declined  the named target of a direct challenge refused it.
--   expired   the deadline sweeper reclaimed it, in the same statement as the
--             delete (public board seeks also leave a 161 bell notice).
--
-- The seek's creator, target and visibility are copied here because the seek row
-- is gone by the time anyone reads this: the route reveals an outcome to anyone
-- only for a public board seek, and otherwise only to the people involved, so a
-- stranger to a private challenge still gets a plain 404. seek_id as the primary
-- key keeps one outcome per seek: the first writer wins.

CREATE TABLE IF NOT EXISTS correspondence_seek_outcomes (
  seek_id           TEXT        PRIMARY KEY,
  outcome           TEXT        NOT NULL
                    CHECK (outcome IN ('taken', 'cancelled', 'declined', 'expired')),
  creator_user_id   TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id    TEXT        REFERENCES users(id) ON DELETE SET NULL,
  visibility        TEXT        NOT NULL CHECK (visibility IN ('public', 'private')),
  room_id           TEXT,
  accepter_user_id  TEXT        REFERENCES users(id) ON DELETE SET NULL,
  at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
