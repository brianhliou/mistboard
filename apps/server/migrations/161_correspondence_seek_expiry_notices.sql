-- 161_correspondence_seek_expiry_notices.sql
-- One bell notice per public board seek that lapsed with no taker.
--
-- Board seeks lapse CORRESPONDENCE_SEEK_TTL_MS after posting and the deadline
-- sweeper deletes them. Until this table the creator was never told: their
-- offer just vanished from the board. The sweep now writes a row here in the
-- SAME statement that deletes the seek (a data-modifying CTE), so the notice
-- and the delete commit together or not at all, and seek_id as the primary
-- key makes a second write for one seek impossible.
--
-- The row keeps the seek's terms so the bell can offer "post it again" with
-- them prefilled. Per-row seen_at rather than a users.*_seen_at watermark: the
-- notice's own expired_at comes from the sweeper's clock, so comparing it with
-- a watermark written by a request would let a skewed clock hide or resurface
-- a notice. Opening the bell stamps seen_at and the row leaves the panel.

CREATE TABLE IF NOT EXISTS correspondence_seek_expiry_notices (
  seek_id         TEXT             PRIMARY KEY,
  user_id         TEXT             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_spec_id    TEXT             NOT NULL,
  days_per_move   DOUBLE PRECISION NOT NULL,
  preferred_color TEXT             NOT NULL,
  rated           BOOLEAN          NOT NULL DEFAULT false,
  posted_at       TIMESTAMPTZ      NOT NULL,
  expired_at      TIMESTAMPTZ      NOT NULL,
  seen_at         TIMESTAMPTZ
);

-- The bell's read: this account's unseen notices, newest first.
CREATE INDEX IF NOT EXISTS correspondence_seek_expiry_notices_unseen_idx
  ON correspondence_seek_expiry_notices (user_id, expired_at DESC)
  WHERE seen_at IS NULL;
