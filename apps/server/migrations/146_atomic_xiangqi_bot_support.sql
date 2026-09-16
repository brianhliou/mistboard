-- 146_atomic_xiangqi_bot_support.sql
-- Add atomic xiangqi to the Fairy-Stockfish ladder's supported variants.
--
-- first-party-bots.ts names the ENGINE for a (bot, variant) pair; this column
-- is what decides whether the pair is allowed at all (routes/rooms.ts checks
-- bot.supportedGameSpecIds), and a new variant needs both. Migration 138 is
-- the scar: duck shipped with the code half only and every bot create answered
-- 400 bot_game_spec_conflict.
--
-- Idempotent by construction: array_append only when the id is absent.

UPDATE bot_profiles
SET
  supported_game_spec_ids = array_append(supported_game_spec_ids, 'atomic-xiangqi'),
  bio =
    'Level '
    || substring(id from 'fairy-stockfish-level-(\d+)$')
    || ' of Mistboard''s eight-level ladder, backed by Fairy-Stockfish. Plays standard, fortress, duck, and atomic xiangqi.',
  updated_at = now()
WHERE id ~ '^fairy-stockfish-level-[1-8]$'
  AND NOT ('atomic-xiangqi' = ANY (supported_game_spec_ids));
