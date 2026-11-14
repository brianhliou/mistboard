-- Account-owned credentials remain valid only while their event grant is active.
CREATE TABLE xiangqi_broadcast_push_grants (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tour_slug TEXT NOT NULL REFERENCES xiangqi_broadcast_tours(slug) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX xiangqi_broadcast_push_grants_active_idx
  ON xiangqi_broadcast_push_grants (account_id, tour_slug) WHERE revoked_at IS NULL;

ALTER TABLE xiangqi_broadcast_push_tokens
  ADD COLUMN account_id TEXT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX xiangqi_broadcast_push_tokens_account_idx
  ON xiangqi_broadcast_push_tokens (account_id, tour_slug) WHERE revoked_at IS NULL;
