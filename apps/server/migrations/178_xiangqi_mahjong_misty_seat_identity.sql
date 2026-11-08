-- 178_xiangqi_mahjong_misty_seat_identity.sql
-- Xiangqi Mahjong bot seats stored under the engine id instead of the bot.
--
-- A PvE room created without a botId (the setup dialog, a rematch) took the
-- engine id 'misty-xiangqi-mahjong' as its bot id, so the finished seat was
-- written subject_type 'bot' / subject_id 'misty-xiangqi-mahjong'. No bot
-- profile has that id, so those games were missing from /bot/misty (8 of 12
-- on 2026-10-28). The code fix seats the bot as 'misty' on every path; this
-- corrects the rows already written.
--
-- Safe as a plain data migration:
--   * Misty is the only bot that has ever fronted the tile bot
--     (first-party-bots.ts), so the mapping is total.
--   * The engine stays on the row: engine_id already holds
--     'misty-xiangqi-mahjong' for every such seat (they were all written after
--     migration 148); COALESCE fills it for any that somehow lack it.
--   * A bot game never rates, so there is no rating row to move. The primary
--     key is (game_id, color), so the rename cannot collide.
--
-- Idempotent: only rows still carrying the old id change.

UPDATE game_participants
SET subject_id = 'misty',
    engine_id = COALESCE(engine_id, 'misty-xiangqi-mahjong')
WHERE subject_type = 'bot'
  AND subject_id = 'misty-xiangqi-mahjong';
