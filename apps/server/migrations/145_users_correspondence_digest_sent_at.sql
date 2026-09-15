-- 145_users_correspondence_digest_sent_at.sql
-- When the daily correspondence "your move" digest last went to this account
-- (correspondence-turn-digest.ts). One timestamp per user is the whole
-- throttle: the sweeper sends at most once per UTC day, and only after a
-- successful send, so a provider failure retries on the next tick rather than
-- silently skipping the day. NULL means never sent, which is fine: the digest
-- only fires when a game has been waiting on the account for a while anyway.

ALTER TABLE users ADD COLUMN IF NOT EXISTS correspondence_digest_sent_at TIMESTAMPTZ;
