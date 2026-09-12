-- 144_drop_retired_variant_data.sql
-- Stage 3 of the variant retirement (docs-private/variant-retirement-plan.md,
-- #396). Every retired variant's code left main on 2026-09-12, between
-- 314e08f0 (crossroads) and ef6d463e (dark-draft960 + the Fog Chess draft
-- phase); this drops the data shapes that only they used.
--
-- Counted on prod before writing (2026-09-12): user_ratings holds no row in
-- any dead pool (119 reset them), puzzles holds no mini-family row (the seed
-- sync removed them once the seed lost them; 143 had withheld them), two
-- puzzle_daily_selections rows still point at mini puzzles, and no games row
-- has hidden_draft960 = true. Finished games of the dead variants stay: they
-- are real games in real players' histories.

-- 1. The live rating pools are exactly the RatingVariant union in
--    packages/game/src/game-specs.ts. Same drop-and-re-add shape as 142.
DELETE FROM user_ratings
WHERE variant NOT IN ('fog', 'dark_xiangqi', 'jieqi', 'banqi', 'jungle', 'jungle_flip', 'fortress_xiangqi', 'xiangqi', 'duck_xiangqi');

ALTER TABLE user_ratings
  DROP CONSTRAINT IF EXISTS user_ratings_variant_check;

ALTER TABLE user_ratings
  ADD CONSTRAINT user_ratings_variant_check
  CHECK (variant IN ('fog', 'dark_xiangqi', 'jieqi', 'banqi', 'jungle', 'jungle_flip', 'fortress_xiangqi', 'xiangqi', 'duck_xiangqi'));

-- 2. The mini-family puzzles and everything keyed on them. Sessions cascade
--    from puzzles; the other tables carry the variant themselves.
DELETE FROM puzzle_daily_selections
WHERE variant IN ('mini-xiangqi', 'drop-mini-xiangqi', 'dark-mini-xiangqi');
DELETE FROM puzzle_attempts
WHERE variant IN ('mini-xiangqi', 'drop-mini-xiangqi', 'dark-mini-xiangqi');
DELETE FROM puzzle_ratings
WHERE variant IN ('mini-xiangqi', 'drop-mini-xiangqi', 'dark-mini-xiangqi');
DELETE FROM user_puzzle_ratings
WHERE variant IN ('mini-xiangqi', 'drop-mini-xiangqi', 'dark-mini-xiangqi');
DELETE FROM puzzle_source_games
WHERE variant IN ('mini-xiangqi', 'drop-mini-xiangqi', 'dark-mini-xiangqi');
DELETE FROM puzzles
WHERE variant IN ('mini-xiangqi', 'drop-mini-xiangqi', 'dark-mini-xiangqi');

-- 3. The Draft960 flag on games. Nothing has written or read it since
--    ef6d463e; the pool it fed (fog_draft960) is gone above.
ALTER TABLE games
  DROP COLUMN IF EXISTS hidden_draft960;
