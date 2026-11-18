-- Acceptance ledger, independent of the short-lived deadline/seek rows.
-- Never retain email bodies or addresses. Challenges have no room/seat yet;
-- digests have one row per included game, sharing the provider message ID.
CREATE TABLE correspondence_notifications (
  id BIGSERIAL PRIMARY KEY,
  room_id TEXT,
  seat TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  seek_id TEXT,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  provider_email_id TEXT,
  CHECK (room_id IS NOT NULL OR seek_id IS NOT NULL)
);
CREATE INDEX correspondence_notifications_room ON correspondence_notifications (room_id, sent_at);
CREATE INDEX correspondence_notifications_provider ON correspondence_notifications (provider_email_id);
