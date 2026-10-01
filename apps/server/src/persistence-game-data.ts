// Queries behind the /data page (game-data-files.ts): which finished games a
// monthly download holds, the imported collections, and the table the built
// files live in (migration 153).
//
// A monthly file holds the games the site's own counts call games
// (countedHumanGame: completed pvp/pve, since launch, both sides moved, no seat
// of a stats-excluded account or browser) that are also public. The count shown
// on the page and the rooms a build reads come from the same WHERE clause, so
// the two cannot disagree about what "the games of September" means.

import { countedHumanGame } from './persistence-counted-games.js';
import { getPool } from './persistence-db.js';

export function publishedGame(gamesAlias = 'g'): string {
  return `${countedHumanGame(gamesAlias)} AND ${gamesAlias}.visibility = 'public'`;
}

export type PublishedMonthCount = { month: string; variant: string; games: number };

// Per (closed month, variant) game counts. `before` is the start of the
// current month (UTC): nothing at or after it is listed.
export async function countPublishedGamesByMonth(
  variants: readonly string[],
  before: Date,
): Promise<PublishedMonthCount[]> {
  const { rows } = await getPool().query<{ month: string; variant: string; games: number }>(
    `SELECT to_char(date_trunc('month', g.ended_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
            g.variant,
            count(*)::int AS games
     FROM games g
     WHERE ${publishedGame('g')}
       AND g.variant = ANY($1)
       AND g.ended_at < $2
     GROUP BY 1, 2
     ORDER BY 1 DESC, 2`,
    [[...variants], before],
  );
  return rows;
}

// The rooms of one monthly file, oldest first (room id breaks ties), so a
// rebuilt file would list the same games in the same order. `variants` is one
// variant for a per-variant file, every data variant for the all-variants one.
export async function listPublishedRoomIds(
  variants: readonly string[],
  from: Date,
  to: Date,
): Promise<string[]> {
  const { rows } = await getPool().query<{ room_id: string }>(
    `SELECT g.room_id
     FROM games g
     WHERE ${publishedGame('g')}
       AND g.variant = ANY($1)
       AND g.ended_at >= $2
       AND g.ended_at < $3
     ORDER BY g.ended_at, g.room_id`,
    [[...variants], from, to],
  );
  return rows.map((row) => row.room_id);
}

// ── Collections ──────────────────────────────────────────────────────────────
// An imported corpus (mode 'imported', engine-match-import.ts) is a collection
// when its games are public and its first game's room-created event carries
// the import's origin. The event name and credit come from that origin, the
// same record the game pages render, so a later import shows up with no edit.

export type CollectionRow = {
  corpusId: string;
  variants: string[];
  games: number;
  firstStartedAt: Date;
  lastEndedAt: Date;
  origin: unknown;
};

const COLLECTION_WHERE = `g.mode = 'imported' AND g.status = 'completed'
  AND g.visibility = 'public' AND g.corpus_id IS NOT NULL`;

export async function listCollectionRows(): Promise<CollectionRow[]> {
  const { rows } = await getPool().query<{
    corpus_id: string;
    variants: string[];
    games: number;
    first_started_at: Date;
    last_ended_at: Date;
    sample_room_id: string;
  }>(
    `SELECT g.corpus_id,
            array_agg(DISTINCT g.variant ORDER BY g.variant) AS variants,
            count(*)::int AS games,
            min(g.started_at) AS first_started_at,
            max(g.ended_at) AS last_ended_at,
            min(g.room_id) AS sample_room_id
     FROM games g
     WHERE ${COLLECTION_WHERE}
     GROUP BY g.corpus_id
     ORDER BY max(g.ended_at) DESC, g.corpus_id`,
  );
  if (rows.length === 0) return [];
  const { rows: origins } = await getPool().query<{ room_id: string; origin: unknown }>(
    `SELECT room_id, payload->'origin' AS origin
     FROM events
     WHERE room_id = ANY($1) AND seq = 0`,
    [rows.map((row) => row.sample_room_id)],
  );
  const originByRoom = new Map(origins.map((row) => [row.room_id, row.origin]));
  return rows.map((row) => ({
    corpusId: row.corpus_id,
    variants: row.variants,
    games: row.games,
    firstStartedAt: row.first_started_at,
    lastEndedAt: row.last_ended_at,
    origin: originByRoom.get(row.sample_room_id) ?? null,
  }));
}

export async function listCollectionRoomIds(corpusId: string): Promise<string[]> {
  const { rows } = await getPool().query<{ room_id: string }>(
    `SELECT g.room_id
     FROM games g
     WHERE ${COLLECTION_WHERE} AND g.corpus_id = $1
     ORDER BY g.started_at, g.room_id`,
    [corpusId],
  );
  return rows.map((row) => row.room_id);
}

// ── Stored files ─────────────────────────────────────────────────────────────

export type StoredDataFileMeta = {
  key: string;
  gameCount: number;
  byteSize: number;
  sha256: string;
  builtAt: Date;
};

export type StoredDataFile = StoredDataFileMeta & { content: Buffer };

export type NewDataFile = {
  key: string;
  kind: 'monthly' | 'collection';
  format: 'jsonl' | 'pgn';
  gameCount: number;
  byteSize: number;
  sha256: string;
  content: Buffer;
};

export async function listStoredDataFiles(): Promise<StoredDataFileMeta[]> {
  const { rows } = await getPool().query<{
    file_key: string;
    game_count: number;
    byte_size: number;
    sha256: string;
    built_at: Date;
  }>(`SELECT file_key, game_count, byte_size, sha256, built_at FROM game_data_files`);
  return rows.map((row) => ({
    key: row.file_key,
    gameCount: row.game_count,
    byteSize: row.byte_size,
    sha256: row.sha256,
    builtAt: row.built_at,
  }));
}

export async function getStoredDataFile(key: string): Promise<StoredDataFile | null> {
  const { rows } = await getPool().query<{
    file_key: string;
    game_count: number;
    byte_size: number;
    sha256: string;
    built_at: Date;
    content: Buffer;
  }>(
    `SELECT file_key, game_count, byte_size, sha256, built_at, content
     FROM game_data_files WHERE file_key = $1`,
    [key],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    key: row.file_key,
    gameCount: row.game_count,
    byteSize: row.byte_size,
    sha256: row.sha256,
    builtAt: row.built_at,
    content: row.content,
  };
}

// First writer wins: a file is written once and never replaced, so a second
// builder that lost the race (another instance, same moment) stores nothing and
// its caller serves the row that is already there.
export async function insertDataFileIfAbsent(file: NewDataFile): Promise<boolean> {
  const result = await getPool().query(
    `INSERT INTO game_data_files
       (file_key, kind, format, game_count, byte_size, sha256, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (file_key) DO NOTHING`,
    [file.key, file.kind, file.format, file.gameCount, file.byteSize, file.sha256, file.content],
  );
  return (result.rowCount ?? 0) > 0;
}
