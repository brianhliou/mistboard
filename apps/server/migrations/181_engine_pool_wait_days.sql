-- Aggregate capacity warnings survive web restarts, so twice-daily deploys
-- cannot continually reset a 24-hour digest timer. No game or player data.
CREATE TABLE IF NOT EXISTS engine_pool_wait_days (
  day date NOT NULL,
  pool text NOT NULL,
  wait_count integer NOT NULL DEFAULT 0,
  max_wait_ms integer NOT NULL DEFAULT 0,
  max_queue_depth integer NOT NULL DEFAULT 0,
  digest_sent_at timestamptz,
  PRIMARY KEY (day, pool)
);
