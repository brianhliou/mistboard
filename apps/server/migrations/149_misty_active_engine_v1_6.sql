-- 149_misty_active_engine_v1_6.sql
-- Point the public Misty profile at the fog chess engine new games actually
-- run. MISTY_DARK_CHESS_ACTIVE_ENGINE_ID moved to python-v2-v1.6 on 2026-08-23,
-- but the row migration 111 created still said python-v2-v1.5, so /api/bots
-- advertised v1.5 in activeEngineId and play.engineId while rooms played v1.6.
-- Ratings and records key on the bot id, not the engine id, and v1.5 stays in
-- the bot's attributionEngineIds, so past games keep attributing to Misty.
-- The unlisted pre-consolidation 'misty-dark-chess' row is left as history.

UPDATE bot_profiles
   SET active_engine_id = 'python-v2-v1.6',
       updated_at = now()
 WHERE id = 'misty'
   AND active_engine_id <> 'python-v2-v1.6';
