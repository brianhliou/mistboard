-- 153_game_data_files.sql
-- The /data page's downloads (game-data-files.ts): one gzip file per variant per
-- closed month, one all-variants JSONL file per month, and one per imported
-- collection, built from the games table the first time someone asks for it and
-- served from this row forever after. A closed month never changes, so a file is
-- written once and never updated.
--
-- No object store on purpose: at today's volume a month is kilobytes, and
-- Postgres already holds the games. Move the bytes to Cloudflare R2 when a
-- single month's file passes about 100 MB, or when download bandwidth starts to
-- cost money; the key column below is already the object path.

CREATE TABLE IF NOT EXISTS game_data_files (
  -- 'monthly/2026-09/xiangqi.jsonl.gz', 'monthly/2026-09/all.jsonl.gz' (every
  -- variant) or 'collections/<corpus id>.jsonl.gz'.
  file_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('monthly', 'collection')),
  format TEXT NOT NULL CHECK (format IN ('jsonl', 'pgn')),
  -- Games actually written (a game whose log fails its export is skipped and
  -- logged, so this can sit below the listing's estimate).
  game_count INTEGER NOT NULL CHECK (game_count >= 0),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content BYTEA NOT NULL,
  built_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
