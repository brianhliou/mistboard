-- 143_withhold_retired_variant_puzzles.sql
-- Mini Xiangqi and Drop Mini Xiangqi are retired (docs-private/variant-
-- retirement-plan.md, #396). Their 36 puzzles are withheld, not deleted:
-- hidden_reason IS NULL is the serving set (puzzle-store.ts), so this takes
-- them out of list, random, daily and by-id in one stroke, and the seed
-- upsert does not touch hidden_reason, so a boot cannot bring them back.
-- The rows go in Stage 3 of the same plan.
UPDATE puzzles
SET hidden_reason = 'retired-variant'
WHERE variant IN ('mini-xiangqi', 'drop-mini-xiangqi')
  AND hidden_reason IS NULL;
