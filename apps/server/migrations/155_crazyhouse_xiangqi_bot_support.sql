-- 155_crazyhouse_xiangqi_bot_support.sql
-- Add crazyhouse xiangqi to the Fairy-Stockfish ladder's supported variants.
--
-- first-party-bots.ts names the ENGINE for a (bot, variant) pair; this column
-- is what decides whether the pair is allowed at all (routes/rooms.ts checks
-- bot.supportedGameSpecIds), and a new variant needs both. Migration 138 is
-- the scar: duck shipped with the code half only and every bot create answered
-- 400 bot_game_spec_conflict.
--
-- The bio is left alone on purpose. Crazyhouse Xiangqi is an admin playtest
-- (publicSurface 'hidden', allowlisted in persistence-variant-access.ts): the
-- public bot pages filter hidden specs out of this list (routes/bots.ts), and a
-- bio naming it would be the one place a visitor could read that it exists.
--
-- Idempotent by construction: array_append only when the id is absent.

UPDATE bot_profiles
SET
  supported_game_spec_ids = array_append(supported_game_spec_ids, 'crazyhouse-xiangqi'),
  updated_at = now()
WHERE id ~ '^fairy-stockfish-level-[1-8]$'
  AND NOT ('crazyhouse-xiangqi' = ANY (supported_game_spec_ids));
