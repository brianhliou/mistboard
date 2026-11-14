-- Event-scoped push credentials. The bearer value is never stored.
CREATE TABLE xiangqi_broadcast_push_tokens (
  id TEXT PRIMARY KEY CHECK (id ~ '^bpt_[0-9a-f]{8}$'),
  tour_slug TEXT NOT NULL REFERENCES xiangqi_broadcast_tours(slug) ON DELETE CASCADE,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX xiangqi_broadcast_push_tokens_tour_idx
  ON xiangqi_broadcast_push_tokens (tour_slug);

ALTER TABLE xiangqi_broadcast_boards
  ADD COLUMN last_accepted_seq DOUBLE PRECISION
    CHECK (last_accepted_seq > '-Infinity'::double precision
       AND last_accepted_seq < 'Infinity'::double precision);
