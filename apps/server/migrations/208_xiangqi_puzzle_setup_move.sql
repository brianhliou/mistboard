-- Credit puzzles may publish one opponent move, never a source-game prefix.
ALTER TABLE puzzles DROP CONSTRAINT puzzles_position_only_payload;
ALTER TABLE puzzles ADD CONSTRAINT puzzles_position_only_payload CHECK (
  NOT position_only OR COALESCE(
    variant = 'xiangqi' AND jsonb_typeof(data::jsonb) = 'object'
    AND jsonb_typeof(data::jsonb->'credit') = 'object'
    AND NOT (data::jsonb ?| ARRAY['sourceGame', 'history', 'showcaseSourceGameId'])
    AND jsonb_typeof(data::jsonb->'initial') = 'object'
    AND NOT ((data::jsonb->'initial') ?| ARRAY['moveLog', 'history', 'sourceGame'])
    AND data::jsonb#>'{initial,positionCounts}' = '{}'::jsonb
    AND data::jsonb#>'{initial,moveNumber}' = '1'::jsonb
    AND data::jsonb#>'{initial,progressClock}' = '0'::jsonb
    AND (
      (NOT (data::jsonb ? 'setupMove') AND NOT ((data::jsonb->'initial') ? 'lastMove'))
      OR (
        jsonb_typeof(data::jsonb->'setupMove') = 'object'
        AND (data::jsonb->'setupMove') ?& ARRAY['from', 'to', 'captured']
        AND (data::jsonb->'setupMove') - ARRAY['from', 'to', 'captured'] = '{}'::jsonb
        AND data::jsonb#>>'{setupMove,from}' ~ '^[a-i]([1-9]|10)$'
        AND data::jsonb#>>'{setupMove,to}' ~ '^[a-i]([1-9]|10)$'
        AND jsonb_typeof(data::jsonb#>'{initial,lastMove}') = 'object'
        AND data::jsonb#>'{initial,lastMove}' = (data::jsonb->'setupMove') - 'captured'
        AND (
          data::jsonb#>'{setupMove,captured}' = 'null'::jsonb
          OR (
            jsonb_typeof(data::jsonb#>'{setupMove,captured}') = 'object'
            AND (data::jsonb#>'{setupMove,captured}') - ARRAY['color', 'role'] = '{}'::jsonb
            AND data::jsonb#>>'{setupMove,captured,color}' = data::jsonb#>>'{initial,status,turn}'
            AND data::jsonb#>>'{setupMove,captured,role}' IN
              ('advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier')
          )
        )
      )
    ), false
  )
);

-- Permit a single additive repair. The approved board, solution, credit and
-- all other fields remain immutable; an existing setup cannot be replaced.
CREATE OR REPLACE FUNCTION guard_position_only_puzzle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.position_only AND (
    NOT NEW.position_only OR (
      NEW.data::jsonb IS DISTINCT FROM OLD.data::jsonb AND NOT (
        OLD.id LIKE 'xq-mined-dpxq-%'
        AND NOT (OLD.data::jsonb ? 'setupMove')
        AND NOT ((OLD.data::jsonb->'initial') ? 'lastMove')
        AND NEW.data::jsonb ? 'setupMove'
        AND (NEW.data::jsonb - 'setupMove') #- '{initial,lastMove}' = OLD.data::jsonb
      )
    )
  ) THEN
    RAISE EXCEPTION 'published position-only puzzle is immutable';
  END IF;
  RETURN NEW;
END $$;
