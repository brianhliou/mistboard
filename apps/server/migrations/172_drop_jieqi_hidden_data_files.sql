-- The jieqi postgame rule (b3b81f1e, 2026-10-16): a piece captured face-down is
-- known only to its capturer, and a piece that never moved is known to nobody,
-- in every export. Exports now carry the public record (no deal_fen / DealFEN,
-- no captured_hidden, no x=<role> tokens), but a stored /data file is served as
-- stored, so every file built before that release still carries the deal.
--
-- Drop every stored file that holds a jieqi game: the jieqi monthly files, the
-- all-variants files (human and engine), the engine-monthly jieqi files, and
-- the jieqi collections. Each rebuilds from the public export on its next
-- download, under a new content-hashed URL; the old hashed URLs then answer
-- 404 stale_hash at the origin. Copies a CDN already holds under those old URLs
-- are not touched by this; they need a purge by URL.
--
-- Idempotent: once the rows are gone a re-run deletes nothing (a file rebuilt
-- after this migration is public-only, and deleting it again only rebuilds it).

DELETE FROM game_data_files
WHERE file_key ~ '^(monthly|engine-monthly)/[^/]+/(jieqi|all)\.'
   OR file_key IN (
     SELECT 'collections/' || g.corpus_id || '.' || f.format || '.gz'
     FROM games g
     CROSS JOIN (VALUES ('jsonl'), ('pgn')) AS f(format)
     WHERE g.variant = 'jieqi' AND g.corpus_id IS NOT NULL
   );
