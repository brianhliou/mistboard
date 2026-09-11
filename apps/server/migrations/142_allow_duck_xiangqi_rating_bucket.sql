-- 142_allow_duck_xiangqi_rating_bucket.sql
-- Allow Duck Xiangqi games to have rating/profile buckets, keeping the
-- user_ratings allowlist in sync with the RatingVariant type (game-specs.ts).
--
-- This is the migration 139's comment says user_ratings owes duck_xiangqi, and
-- the one game-specs.ts named as the reason duck shipped without `rated: true`:
-- the pool base existed, the constraint did not, so a rated duck game would
-- have failed at the point of WRITING the result rather than at the point of
-- creating the game. Landing the CHECK is what makes `rated: true` honest.
--
-- Same shape as 074 (xiangqi) and 065 (fortress): drop and re-add the whole
-- allowlist, because a CHECK cannot be extended in place.

ALTER TABLE user_ratings
  DROP CONSTRAINT IF EXISTS user_ratings_variant_check;

ALTER TABLE user_ratings
  ADD CONSTRAINT user_ratings_variant_check
  CHECK (variant IN ('fog', 'fog_draft960', 'dark_mini_xiangqi', 'drop_mini_xiangqi', 'dark_xiangqi', 'crossroads_chess_open', 'crossroads_chess', 'jieqi', 'banqi', 'reveal_chess', 'dark_shogi', 'dark_crazyhouse', 'kriegspiel', 'jungle', 'jungle_flip', 'fortress_xiangqi', 'xiangqi', 'duck_xiangqi'));
