-- #343: make the historical fastest-of-two-mates admission set queryable
-- without a mining-table join. This is descriptive; never change hidden_reason.
ALTER TABLE puzzles ADD COLUMN mate_speed_only boolean;

COMMENT ON COLUMN puzzles.mate_speed_only IS
  'True when a passing audit found bestMate > 1 and secondMate > 0 at any solver ply. False when audited mate scores rule that out; NULL means unknown/unaudited or not a checkmate puzzle. Independent of hidden_reason.';

-- Use publication's judgment ordering, retaining the latest passing audit.
-- The verify record
-- only covers the first solver move; later moves must be included too.
WITH audit AS (
  SELECT DISTINCT ON (candidate_id) candidate_id, evidence
    FROM xiangqi_puzzle_mining_judgments
   WHERE stage = 'audit' AND verdict = 'pass'
   ORDER BY candidate_id, created_at DESC, id DESC
), classified AS (
  SELECT audit.candidate_id,
         CASE
           WHEN bool_or(CASE
             WHEN jsonb_typeof(ply->'bestMate') = 'number'
              AND jsonb_typeof(ply->'secondMate') = 'number'
             THEN (ply->>'bestMate')::numeric > 1 AND (ply->>'secondMate')::numeric > 0
             ELSE false
           END) THEN true
           WHEN bool_and(
             COALESCE(jsonb_typeof(ply->'bestMate') IN ('number', 'null'), false)
             AND COALESCE(jsonb_typeof(ply->'secondMate') IN ('number', 'null'), false)
           ) THEN false
           ELSE NULL
         END AS mate_speed_only
    FROM audit
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(audit.evidence->'plies') = 'array'
           THEN audit.evidence->'plies' ELSE '[]'::jsonb END
    ) ply
   GROUP BY audit.candidate_id
)
UPDATE puzzles p
   SET mate_speed_only = classified.mate_speed_only
  FROM classified
 WHERE p.mining_candidate_id = classified.candidate_id
   AND p.variant = 'xiangqi' AND p.goal_type = 'checkmate';

CREATE INDEX puzzles_mate_speed_only_idx ON puzzles (variant, seq, id)
  WHERE mate_speed_only IS TRUE;
