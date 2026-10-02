-- 158_allow_crazyhouse_xiangqi_rating_bucket.sql
-- Allow Crazyhouse Xiangqi games to have rating/profile buckets, keeping the
-- user_ratings allowlist in sync with the RatingVariant type (game-specs.ts).
--
-- The step 147 took for atomic: rated lobby play reaches every variant
-- (2026-10-02), and without the pool in this CHECK a rated crazyhouse game
-- would fail at the point of WRITING the result. With it come the profile
-- rail row, the leaderboard ladder and the Games-tab filter.
--
-- Same shape as 147 / 142: drop and re-add the whole allowlist, because a
-- CHECK cannot be extended in place.

ALTER TABLE user_ratings
  DROP CONSTRAINT IF EXISTS user_ratings_variant_check;

ALTER TABLE user_ratings
  ADD CONSTRAINT user_ratings_variant_check
  CHECK (variant IN ('fog', 'fog_draft960', 'dark_mini_xiangqi', 'drop_mini_xiangqi', 'dark_xiangqi', 'crossroads_chess_open', 'crossroads_chess', 'jieqi', 'banqi', 'reveal_chess', 'dark_shogi', 'dark_crazyhouse', 'kriegspiel', 'jungle', 'jungle_flip', 'fortress_xiangqi', 'xiangqi', 'duck_xiangqi', 'atomic_xiangqi', 'crazyhouse_xiangqi'));
