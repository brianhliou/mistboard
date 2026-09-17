-- 147_allow_atomic_xiangqi_rating_bucket.sql
-- Allow Atomic Xiangqi games to have rating/profile buckets, keeping the
-- user_ratings allowlist in sync with the RatingVariant type (game-specs.ts).
--
-- The same step 142 took for duck: the pool base existed from launch, the
-- constraint did not, so a rated atomic game would have failed at the point
-- of WRITING the result. Landing the CHECK is what makes `rated: true` honest,
-- and with it the profile rail row, the leaderboard ladder and the Games-tab
-- filter, all of which key on the pool.
--
-- Same shape as 142 / 074 / 065: drop and re-add the whole allowlist, because
-- a CHECK cannot be extended in place.

ALTER TABLE user_ratings
  DROP CONSTRAINT IF EXISTS user_ratings_variant_check;

ALTER TABLE user_ratings
  ADD CONSTRAINT user_ratings_variant_check
  CHECK (variant IN ('fog', 'fog_draft960', 'dark_mini_xiangqi', 'drop_mini_xiangqi', 'dark_xiangqi', 'crossroads_chess_open', 'crossroads_chess', 'jieqi', 'banqi', 'reveal_chess', 'dark_shogi', 'dark_crazyhouse', 'kriegspiel', 'jungle', 'jungle_flip', 'fortress_xiangqi', 'xiangqi', 'duck_xiangqi', 'atomic_xiangqi'));
