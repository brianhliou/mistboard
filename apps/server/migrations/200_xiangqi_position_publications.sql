-- Audited position-only puzzle publications, independent of source-game rows.
-- Receipts contain bounded derived analysis, never the recorded source game.
ALTER TABLE puzzles ADD COLUMN position_only boolean NOT NULL DEFAULT false;
ALTER TABLE puzzles ADD CONSTRAINT puzzles_position_only_payload CHECK (
  NOT position_only OR COALESCE(
    variant = 'xiangqi' AND jsonb_typeof(data::jsonb) = 'object'
    AND jsonb_typeof(data::jsonb->'credit') = 'object'
    AND NOT (data::jsonb ?| ARRAY['sourceGame', 'history', 'showcaseSourceGameId'])
    AND jsonb_typeof(data::jsonb->'initial') = 'object'
    AND NOT ((data::jsonb->'initial') ?| ARRAY['moveLog', 'history', 'lastMove', 'sourceGame'])
    AND data::jsonb#>'{initial,positionCounts}' = '{}'::jsonb
    AND data::jsonb#>'{initial,moveNumber}' = '1'::jsonb
    AND data::jsonb#>'{initial,progressClock}' = '0'::jsonb,
    false
  )
);
CREATE FUNCTION guard_position_only_puzzle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.position_only AND (NOT NEW.position_only OR NEW.data::jsonb IS DISTINCT FROM OLD.data::jsonb) THEN
    RAISE EXCEPTION 'published position-only puzzle is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_position_only_puzzle_update BEFORE UPDATE OF data, position_only ON puzzles
FOR EACH ROW EXECUTE FUNCTION guard_position_only_puzzle();

CREATE TABLE xiangqi_position_publications (
  puzzle_id text PRIMARY KEY REFERENCES puzzles(id) ON DELETE RESTRICT,
  packet_sha256 text NOT NULL CHECK (packet_sha256 ~ '^[0-9a-f]{64}$'),
  puzzle_sha256 text NOT NULL CHECK (puzzle_sha256 ~ '^[0-9a-f]{64}$'),
  position_key text NOT NULL UNIQUE,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  operator_note text NOT NULL CHECK (length(btrim(operator_note)) > 0),
  published_at timestamptz NOT NULL DEFAULT now()
);
