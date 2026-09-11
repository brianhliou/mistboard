-- 137_room_seat_tokens_device_id.sql
-- The browser's device id on a seat token, so a GUEST seat can be attributed
-- to a browser at game end (game_participants.subject_id for subject_type
-- 'guest', which has been NULL since migration 008).
--
-- Until now every "players" number the database could produce was signed-in
-- accounts only: the client id on a seat is minted per room, so two guest
-- games from one browser had nothing in common. The device id is a random
-- UUID the web client keeps in localStorage (`mistboard.device`), sent on the
-- WebSocket connect, never a cookie and never shared with anyone else. It
-- makes guest weekly players, new-vs-returning, and retention countable, and
-- lets the operator's own signed-out testing be excluded the way accounts
-- are. The id is redacted on every read path that reaches a browser; only the
-- aggregate queries see it.
--
-- Nullable: rooms hydrated from before this migration, pre-issued rematch
-- seats before the holder reconnects, and clients without localStorage.

ALTER TABLE room_seat_tokens
  ADD COLUMN IF NOT EXISTS device_id TEXT;

-- Browsers whose guest games are not site activity: recorded automatically
-- the first time a stats-excluded account (users.stats_excluded_at) connects
-- to a live room from a browser carrying a device id. From then on that
-- browser's signed-out games are left out of every count too, which is what
-- the account flag alone could never do (the operator's fog chess testing was
-- 197 guest games no flag could reach). No UI; rows are only ever added here.
CREATE TABLE IF NOT EXISTS stats_excluded_devices (
  device_id     TEXT PRIMARY KEY,
  account_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
