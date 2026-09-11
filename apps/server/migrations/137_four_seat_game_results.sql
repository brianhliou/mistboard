-- 137_four_seat_game_results.sql
-- Let a finished game have four seats and a winner who is not red or black.
--
-- Every constraint on these two columns was written when every game on this
-- platform had exactly two players. Mahjong has four, and its seats are winds:
-- east, south, west, north. Neither `games.result` nor
-- `game_participants.color` can currently hold any of that.
--
-- This is not a cosmetic limit. These are CHECK constraints, so a value outside
-- them fails the whole recordGameEnd transaction: the games row AND its
-- participants roll back, the postgame API 404s, and a game that was played and
-- finished simply has no record. Migration 114 exists because Flip Jungle
-- shipped exactly that failure with 'dead-position', and it went unnoticed.
--
-- Widening a CHECK cannot invalidate an existing row, so this is additive and
-- needs no backfill.
--
-- Deliberately NOT touched: the user_ratings CHECK. Mahjong is unrated, and
-- rating a four-player game is a different question from recording one. A rated
-- mahjong ladder owes its own migration.

ALTER TABLE games
  DROP CONSTRAINT IF EXISTS games_result_check,
  ADD CONSTRAINT games_result_check
    CHECK (
      result IS NULL
      OR result IN (
        'white-wins',
        'black-wins',
        'red-wins',
        -- Mahjong's four winds. A hand has one winner, or nobody.
        'east-wins',
        'south-wins',
        'west-wins',
        'north-wins',
        'draw'
      )
    );

ALTER TABLE game_participants
  DROP CONSTRAINT IF EXISTS game_participants_color_check,
  ADD CONSTRAINT game_participants_color_check
    CHECK (color IN ('white', 'black', 'red', 'east', 'south', 'west', 'north'));
