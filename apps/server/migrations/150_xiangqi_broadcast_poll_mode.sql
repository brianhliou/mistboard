-- Broadcast tours poll by mode, not a checkbox. poll_enabled (083) had one
-- writer, the ops console, so an upcoming event imported nothing unless
-- someone flipped it by hand and a live event left off stopped silently.
--
-- poll_mode:
--   auto  polls inside the event's window, starts_at - 12h to ends_at + 7 days
--         (one missing date reads as a one-day event on the other; no dates,
--         no polling). The default, so a newly created tour turns on by itself.
--   on    always polls (operator override).
--   off   never polls.
-- The window is derived at read time (xiangqi-broadcast-poll-window.ts), never
-- written, so a moved end date resumes an auto tour with no operator step.
--
-- Existing rows: a tour polling today stays `on` only while it is inside its
-- window or has no dates (it would stop under auto otherwise, or never poll);
-- every other row is `auto`. That includes the ones switched off, since a
-- past event is outside its window anyway and an upcoming one should start.
--
-- poll_enabled stays for one release so a rollback reads a sane value; the
-- server no longer reads it and writes it as poll_mode = 'on'.
ALTER TABLE xiangqi_broadcast_tours
  ADD COLUMN IF NOT EXISTS poll_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (poll_mode IN ('auto', 'on', 'off'));

UPDATE xiangqi_broadcast_tours
   SET poll_mode = 'on'
 WHERE poll_enabled
   AND (
     (starts_at IS NULL AND ends_at IS NULL)
     OR now() BETWEEN COALESCE(starts_at, ends_at) - interval '12 hours'
                  AND COALESCE(ends_at, starts_at) + interval '7 days'
   );
