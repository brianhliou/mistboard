-- 138_duck_xiangqi_bot_support.sql
-- Add duck xiangqi to the Fairy-Stockfish ladder's supported variants.
--
-- The launch flip (2026-09-11) put duck on every public surface and gave the
-- ladder a per-variant engine in first-party-bots.ts, but a bot's playable
-- variants are NOT read from that file at request time: `routes/rooms.ts`
-- checks `bot.supportedGameSpecIds`, which is the `supported_game_spec_ids`
-- COLUMN on bot_profiles, last written by migration 111. So prod answered
-- /api/rooms with 400 `bot_game_spec_conflict` for every duck bot game, and
-- /api/bots advertised the ladder as "xiangqi, fortress-xiangqi" only.
--
-- first-party-bots.ts and this column have to agree. The code half names the
-- ENGINE for a (bot, variant) pair; this column is what decides whether the
-- pair is allowed at all, and a new variant needs both.
--
-- Idempotent by construction: array_append only when the id is absent, so a
-- rerun is a no-op and a hand-edited row is not clobbered.

UPDATE bot_profiles
SET
  supported_game_spec_ids = array_append(supported_game_spec_ids, 'duck-xiangqi'),
  bio =
    'Level '
    || substring(id from 'fairy-stockfish-level-(\d+)$')
    || ' of Mistboard''s eight-level ladder, backed by Fairy-Stockfish. Plays standard, fortress, and duck xiangqi.',
  updated_at = now()
WHERE id ~ '^fairy-stockfish-level-[1-8]$'
  AND NOT ('duck-xiangqi' = ANY (supported_game_spec_ids));
