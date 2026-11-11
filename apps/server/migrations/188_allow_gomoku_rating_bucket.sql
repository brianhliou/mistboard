-- 188_allow_gomoku_rating_bucket.sql
-- Add the Gomoku pool while preserving every historical rating bucket.
-- Public visibility is controlled by the game spec, never this constraint.

ALTER TABLE user_ratings
  DROP CONSTRAINT IF EXISTS user_ratings_variant_check;

ALTER TABLE user_ratings
  ADD CONSTRAINT user_ratings_variant_check
  CHECK (variant IN ('fog', 'fog_draft960', 'dark_mini_xiangqi', 'drop_mini_xiangqi', 'dark_xiangqi', 'crossroads_chess_open', 'crossroads_chess', 'jieqi', 'banqi', 'reveal_chess', 'dark_shogi', 'dark_crazyhouse', 'kriegspiel', 'jungle', 'jungle_flip', 'fortress_xiangqi', 'xiangqi', 'duck_xiangqi', 'atomic_xiangqi', 'crazyhouse_xiangqi', 'xiangqi_mahjong', 'gomoku'));
