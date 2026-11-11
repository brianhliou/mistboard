-- 168_allow_xiangqi_mahjong_rating_bucket.sql
-- Allow Xiangqi Mahjong matches to write a rating, keeping the user_ratings
-- allowlist in sync with the RatingVariant type (game-specs.ts).
--
-- Brian approved rated xiangqi mahjong (2026-10-15). The rated unit is the
-- whole four-hand match: the room finishes, and the game row is written, when
-- the match does. Without the pool in this CHECK a rated match would fail at
-- the point of WRITING the result.
--
-- The spec is still allowlisted (139), so the pool stays off the leaderboard
-- and public profiles in code (persistence-variant-access.ts), not here.
--
-- Same shape as 158 / 147 / 142: drop and re-add the whole allowlist, because
-- a CHECK cannot be extended in place.

ALTER TABLE user_ratings
  DROP CONSTRAINT IF EXISTS user_ratings_variant_check;

ALTER TABLE user_ratings
  ADD CONSTRAINT user_ratings_variant_check
  CHECK (variant IN ('fog', 'fog_draft960', 'dark_mini_xiangqi', 'drop_mini_xiangqi', 'dark_xiangqi', 'crossroads_chess_open', 'crossroads_chess', 'jieqi', 'banqi', 'reveal_chess', 'dark_shogi', 'dark_crazyhouse', 'kriegspiel', 'jungle', 'jungle_flip', 'fortress_xiangqi', 'xiangqi', 'duck_xiangqi', 'atomic_xiangqi', 'crazyhouse_xiangqi', 'xiangqi_mahjong'));
