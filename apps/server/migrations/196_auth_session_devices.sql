-- Browser attribution only; never seat authority or part of session summaries.
-- No historical backfill: pre-migration sign-ins have no browser evidence.
ALTER TABLE account_sessions ADD COLUMN device_id TEXT
  CHECK (device_id IS NULL OR device_id ~ '^[a-zA-Z0-9:_-]{8,80}$');
CREATE INDEX account_sessions_device_created_idx
  ON account_sessions (device_id, created_at) WHERE device_id IS NOT NULL;
