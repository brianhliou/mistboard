import { createHash } from 'node:crypto';
import type { XiangqiMove, XiangqiMoveFormat } from '@mistboard/game';
import type pg from 'pg';
import { historicalXiangqiDigest } from './historical-xiangqi-digest.js';
import { getPool, withTransaction } from './persistence-db.js';

export type HistoricalXiangqiResult = '1-0' | '0-1' | '1/2-1/2' | '*';
export type HistoricalXiangqiVisibility = 'private' | 'unlisted' | 'public';
export type HistoricalXiangqiImportBatchStatus = 'running' | 'completed' | 'failed' | 'canceled';
export type HistoricalXiangqiSourceLicenseStatus =
  | 'unknown'
  | 'test-only'
  | 'permission-requested'
  | 'cleared'
  | 'restricted';

export type HistoricalXiangqiSourceInput = {
  id?: string;
  slug: string;
  name: string;
  sourceType: string;
  sourceUrl?: string | null;
  license?: string | null;
  licenseStatus?: HistoricalXiangqiSourceLicenseStatus;
  notes?: string | null;
};

export type HistoricalXiangqiSource = Omit<HistoricalXiangqiSourceInput, 'id' | 'licenseStatus'> & {
  id: string;
  licenseStatus: HistoricalXiangqiSourceLicenseStatus;
  createdAt: Date;
};

export type HistoricalXiangqiPlayer = {
  id: string;
  displayName: string;
  normalizedName: string;
  country: string | null;
  externalRefs: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type HistoricalXiangqiImportBatch = {
  id: string;
  sourceId: string;
  status: HistoricalXiangqiImportBatchStatus;
  inputUri: string | null;
  inputSha256: string | null;
  stats: Record<string, unknown>;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
};

export type HistoricalXiangqiGameInput = {
  id?: string;
  sourceId: string;
  importBatchId?: string | null;
  sourceGameId?: string | null;
  sourceUrl?: string | null;
  eventName?: string | null;
  site?: string | null;
  round?: string | null;
  board?: string | null;
  playedOn?: string | null;
  redNameRaw?: string | null;
  blackNameRaw?: string | null;
  result: HistoricalXiangqiResult;
  termination?: string | null;
  moveFormat: XiangqiMoveFormat;
  moves: readonly XiangqiMove[];
  tags?: Record<string, unknown>;
  qualityFlags?: readonly string[];
  visibility?: HistoricalXiangqiVisibility;
};

export type HistoricalXiangqiGame = Omit<HistoricalXiangqiGameInput, 'id' | 'moves'> & {
  id: string;
  contentSha256: string;
  redPlayerId: string | null;
  blackPlayerId: string | null;
  plyCount: number;
  moves: XiangqiMove[];
  tags: Record<string, unknown>;
  qualityFlags: string[];
  visibility: HistoricalXiangqiVisibility;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type HistoricalXiangqiGameListItem = Pick<
  HistoricalXiangqiGame,
  | 'id'
  | 'sourceId'
  | 'sourceGameId'
  | 'sourceUrl'
  | 'eventName'
  | 'site'
  | 'round'
  | 'board'
  | 'playedOn'
  | 'redNameRaw'
  | 'blackNameRaw'
  | 'result'
  | 'plyCount'
  | 'moveFormat'
  | 'visibility'
  | 'createdAt'
  | 'updatedAt'
> & {
  sourceSlug: string;
  sourceName: string;
};

/** How a games listing is ordered. Shared across every lane of the /games
 *  union, because the union merges pages that were each ordered server-side:
 *  if one lane pushes a different key down than the merge sorts on, the page is
 *  "the longest games among the most recent N" rather than the longest games,
 *  and it looks entirely plausible. Keep lanes and comparator in lockstep. */
export type XiangqiGameSort = 'recent' | 'oldest' | 'longest' | 'shortest';

export const XIANGQI_GAME_SORTS: readonly XiangqiGameSort[] = [
  'recent',
  'oldest',
  'longest',
  'shortest',
];

export function isXiangqiGameSort(value: string): value is XiangqiGameSort {
  return (XIANGQI_GAME_SORTS as readonly string[]).includes(value);
}

export type HistoricalXiangqiGameQueryFilters = {
  sourceSlug?: string;
  sort?: XiangqiGameSort;
  player?: string;
  event?: string;
  result?: HistoricalXiangqiResult;
  playedFrom?: string;
  playedTo?: string;
  plyMin?: number;
  plyMax?: number;
  visibility?: HistoricalXiangqiVisibility;
  offset?: number;
  limit?: number;
};

/** ORDER BY for each sort, pushed down so the union's merge key matches. */
export function historicalOrderBy(sort: XiangqiGameSort | undefined): string {
  switch (sort) {
    case 'oldest':
      return 'games.played_on ASC NULLS LAST, games.id ASC';
    case 'longest':
      return 'games.ply_count DESC, games.id DESC';
    case 'shortest':
      return 'games.ply_count ASC, games.id ASC';
    default:
      return 'games.played_on DESC NULLS LAST, games.id DESC';
  }
}

export type HistoricalXiangqiGameQueryPage = {
  games: HistoricalXiangqiGameListItem[];
  total: number;
};

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

type SourceRow = {
  id: string;
  slug: string;
  name: string;
  source_type: string;
  source_url: string | null;
  license: string | null;
  license_status: HistoricalXiangqiSourceLicenseStatus;
  notes: string | null;
  created_at: Date;
};

type PlayerRow = {
  id: string;
  display_name: string;
  normalized_name: string;
  country: string | null;
  external_refs: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type BatchRow = {
  id: string;
  source_id: string;
  status: HistoricalXiangqiImportBatchStatus;
  input_uri: string | null;
  input_sha256: string | null;
  stats: Record<string, unknown>;
  started_at: Date;
  finished_at: Date | null;
  created_at: Date;
};

type GameRow = {
  id: string;
  source_id: string;
  import_batch_id: string | null;
  source_game_id: string | null;
  source_url: string | null;
  content_sha256: string;
  event_name: string | null;
  site: string | null;
  round: string | null;
  board: string | null;
  played_on: Date | string | null;
  red_player_id: string | null;
  black_player_id: string | null;
  red_name_raw: string | null;
  black_name_raw: string | null;
  result: HistoricalXiangqiResult;
  termination: string | null;
  ply_count: number;
  move_format: XiangqiMoveFormat;
  moves: XiangqiMove[];
  tags: Record<string, unknown>;
  quality_flags: string[];
  visibility: HistoricalXiangqiVisibility;
  indexed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type GameListRow = GameRow & {
  source_slug: string;
  source_name: string;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function prefixedHash(prefix: string, value: string): string {
  return `${prefix}_${sha256(value).slice(0, 24)}`;
}

export function normalizeHistoricalXiangqiPlayerName(name: string): string {
  return name.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase();
}

function sourceIdForSlug(slug: string): string {
  return prefixedHash('hxqs', slug);
}

function playerIdForName(normalizedName: string): string {
  return prefixedHash('hxqp', normalizedName);
}

// The writer's half of the identity contract. It MUST stay a thin call into the
// shared digest: this function once had its own copy keyed on sourceId and the
// anonymized player names, and because ElephantChess re-randomizes both every
// release, a re-import matched nothing and inserted the whole corpus again.
// The repair script was migrated to the shared digest in 2026-08 and this was
// not, which is worse than either alone -- the rows and the writer then disagree
// about what "the same game" is. Do not inline a variant here.
export function contentHashForHistoricalXiangqiGame(input: HistoricalXiangqiGameInput): string {
  return historicalXiangqiDigest({
    playedOn: input.playedOn ?? null,
    result: input.result,
    moves: input.moves,
  });
}

function sourceFromRow(row: SourceRow): HistoricalXiangqiSource {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    license: row.license,
    licenseStatus: row.license_status,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function playerFromRow(row: PlayerRow): HistoricalXiangqiPlayer {
  return {
    id: row.id,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    country: row.country,
    externalRefs: row.external_refs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function batchFromRow(row: BatchRow): HistoricalXiangqiImportBatch {
  return {
    id: row.id,
    sourceId: row.source_id,
    status: row.status,
    inputUri: row.input_uri,
    inputSha256: row.input_sha256,
    stats: row.stats,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

function gameFromRow(row: GameRow): HistoricalXiangqiGame {
  return {
    id: row.id,
    sourceId: row.source_id,
    importBatchId: row.import_batch_id,
    sourceGameId: row.source_game_id,
    sourceUrl: row.source_url,
    contentSha256: row.content_sha256,
    eventName: row.event_name,
    site: row.site,
    round: row.round,
    board: row.board,
    playedOn: dateOnlyFromRow(row.played_on),
    redPlayerId: row.red_player_id,
    blackPlayerId: row.black_player_id,
    redNameRaw: row.red_name_raw,
    blackNameRaw: row.black_name_raw,
    result: row.result,
    termination: row.termination,
    plyCount: row.ply_count,
    moveFormat: row.move_format,
    moves: row.moves,
    tags: row.tags,
    qualityFlags: row.quality_flags,
    visibility: row.visibility,
    indexedAt: row.indexed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function gameListItemFromRow(row: GameListRow): HistoricalXiangqiGameListItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceSlug: row.source_slug,
    sourceName: row.source_name,
    sourceGameId: row.source_game_id,
    sourceUrl: row.source_url,
    eventName: row.event_name,
    site: row.site,
    round: row.round,
    board: row.board,
    playedOn: dateOnlyFromRow(row.played_on),
    redNameRaw: row.red_name_raw,
    blackNameRaw: row.black_name_raw,
    result: row.result,
    plyCount: row.ply_count,
    moveFormat: row.move_format,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dateOnlyFromRow(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.toISOString().slice(0, 10);
}

export function buildHistoricalXiangqiGameQueryWhere(filters: HistoricalXiangqiGameQueryFilters): {
  clause: string;
  values: unknown[];
} {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.sourceSlug) conditions.push(`sources.slug = ${bind(filters.sourceSlug)}`);
  if (filters.player) {
    const normalized = normalizeHistoricalXiangqiPlayerName(filters.player);
    conditions.push(
      `(red_players.normalized_name LIKE ${bind(`%${normalized}%`)} OR black_players.normalized_name LIKE ${bind(`%${normalized}%`)})`,
    );
  }
  if (filters.event) conditions.push(`games.event_name ILIKE ${bind(`%${filters.event}%`)}`);
  if (filters.result) conditions.push(`games.result = ${bind(filters.result)}`);
  if (filters.playedFrom) conditions.push(`games.played_on >= ${bind(filters.playedFrom)}::date`);
  if (filters.playedTo) conditions.push(`games.played_on < ${bind(filters.playedTo)}::date`);
  if (typeof filters.plyMin === 'number')
    conditions.push(`games.ply_count >= ${bind(filters.plyMin)}`);
  if (typeof filters.plyMax === 'number')
    conditions.push(`games.ply_count <= ${bind(filters.plyMax)}`);
  if (filters.visibility) conditions.push(`games.visibility = ${bind(filters.visibility)}`);
  return {
    clause: conditions.length > 0 ? conditions.join('\n       AND ') : 'TRUE',
    values,
  };
}

export async function upsertHistoricalXiangqiSource(
  input: HistoricalXiangqiSourceInput,
): Promise<HistoricalXiangqiSource> {
  const id = input.id ?? sourceIdForSlug(input.slug);
  const { rows } = await getPool().query<SourceRow>(
    `INSERT INTO historical_xiangqi_sources
       (id, slug, name, source_type, source_url, license, license_status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       source_type = EXCLUDED.source_type,
       source_url = EXCLUDED.source_url,
       license = EXCLUDED.license,
       license_status = EXCLUDED.license_status,
       notes = EXCLUDED.notes
     RETURNING *`,
    [
      id,
      input.slug,
      input.name,
      input.sourceType,
      input.sourceUrl ?? null,
      input.license ?? null,
      input.licenseStatus ?? 'unknown',
      input.notes ?? null,
    ],
  );
  return sourceFromRow(rows[0]!);
}

export async function createHistoricalXiangqiImportBatch(input: {
  sourceId: string;
  inputUri?: string | null;
  inputSha256?: string | null;
}): Promise<HistoricalXiangqiImportBatch> {
  const id = prefixedHash(
    'hxqb',
    JSON.stringify({
      sourceId: input.sourceId,
      inputUri: input.inputUri ?? null,
      inputSha256: input.inputSha256 ?? null,
      at: Date.now(),
    }),
  );
  const { rows } = await getPool().query<BatchRow>(
    `INSERT INTO historical_xiangqi_import_batches
       (id, source_id, input_uri, input_sha256)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, input.sourceId, input.inputUri ?? null, input.inputSha256 ?? null],
  );
  return batchFromRow(rows[0]!);
}

export async function finishHistoricalXiangqiImportBatch(
  id: string,
  status: Exclude<HistoricalXiangqiImportBatchStatus, 'running'>,
  stats: Record<string, unknown>,
): Promise<HistoricalXiangqiImportBatch> {
  const { rows } = await getPool().query<BatchRow>(
    `UPDATE historical_xiangqi_import_batches
     SET status = $2,
         stats = $3::jsonb,
         finished_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, JSON.stringify(stats)],
  );
  return batchFromRow(rows[0]!);
}

export async function upsertHistoricalXiangqiPlayer(
  displayName: string,
  options: { country?: string | null; externalRefs?: Record<string, unknown> } = {},
  client: Queryable = getPool(),
): Promise<HistoricalXiangqiPlayer> {
  const normalizedName = normalizeHistoricalXiangqiPlayerName(displayName);
  const id = playerIdForName(normalizedName);
  const { rows } = await client.query<PlayerRow>(
    `INSERT INTO historical_xiangqi_players
       (id, display_name, normalized_name, country, external_refs)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (normalized_name) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       country = COALESCE(EXCLUDED.country, historical_xiangqi_players.country),
       external_refs = historical_xiangqi_players.external_refs || EXCLUDED.external_refs,
       updated_at = now()
     RETURNING *`,
    [
      id,
      displayName.trim(),
      normalizedName,
      options.country ?? null,
      JSON.stringify(options.externalRefs ?? {}),
    ],
  );
  return playerFromRow(rows[0]!);
}

export async function insertHistoricalXiangqiGame(
  input: HistoricalXiangqiGameInput,
): Promise<HistoricalXiangqiGame> {
  return withTransaction(async (client) => {
    const red = input.redNameRaw?.trim()
      ? await upsertHistoricalXiangqiPlayer(input.redNameRaw, {}, client)
      : null;
    const black = input.blackNameRaw?.trim()
      ? await upsertHistoricalXiangqiPlayer(input.blackNameRaw, {}, client)
      : null;
    const contentSha256 = contentHashForHistoricalXiangqiGame(input);
    const id = input.id ?? prefixedHash('hxq', contentSha256);
    const { rows } = await client.query<GameRow>(
      `INSERT INTO historical_xiangqi_games
         (id, source_id, import_batch_id, source_game_id, source_url, content_sha256,
          event_name, site, round, board, played_on, red_player_id, black_player_id,
          red_name_raw, black_name_raw, result, termination, ply_count, move_format,
          moves, tags, quality_flags, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13,
               $14, $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb, $22, $23)
       ON CONFLICT (content_sha256) DO UPDATE SET
         import_batch_id = COALESCE(EXCLUDED.import_batch_id, historical_xiangqi_games.import_batch_id),
         source_url = COALESCE(EXCLUDED.source_url, historical_xiangqi_games.source_url),
         event_name = COALESCE(EXCLUDED.event_name, historical_xiangqi_games.event_name),
         site = COALESCE(EXCLUDED.site, historical_xiangqi_games.site),
         round = COALESCE(EXCLUDED.round, historical_xiangqi_games.round),
         board = COALESCE(EXCLUDED.board, historical_xiangqi_games.board),
         played_on = COALESCE(EXCLUDED.played_on, historical_xiangqi_games.played_on),
         red_player_id = COALESCE(EXCLUDED.red_player_id, historical_xiangqi_games.red_player_id),
         black_player_id = COALESCE(EXCLUDED.black_player_id, historical_xiangqi_games.black_player_id),
         red_name_raw = COALESCE(EXCLUDED.red_name_raw, historical_xiangqi_games.red_name_raw),
         black_name_raw = COALESCE(EXCLUDED.black_name_raw, historical_xiangqi_games.black_name_raw),
         result = EXCLUDED.result,
         termination = COALESCE(EXCLUDED.termination, historical_xiangqi_games.termination),
         moves = EXCLUDED.moves,
         tags = historical_xiangqi_games.tags || EXCLUDED.tags,
         quality_flags = EXCLUDED.quality_flags,
         visibility = EXCLUDED.visibility,
         updated_at = now()
       RETURNING *`,
      [
        id,
        input.sourceId,
        input.importBatchId ?? null,
        input.sourceGameId ?? null,
        input.sourceUrl ?? null,
        contentSha256,
        input.eventName ?? null,
        input.site ?? null,
        input.round ?? null,
        input.board ?? null,
        input.playedOn ?? null,
        red?.id ?? null,
        black?.id ?? null,
        input.redNameRaw ?? null,
        input.blackNameRaw ?? null,
        input.result,
        input.termination ?? null,
        input.moves.length,
        input.moveFormat,
        JSON.stringify(input.moves),
        JSON.stringify(input.tags ?? {}),
        [...(input.qualityFlags ?? [])],
        input.visibility ?? 'public',
      ],
    );
    return gameFromRow(rows[0]!);
  });
}

export async function getHistoricalXiangqiGame(id: string): Promise<HistoricalXiangqiGame | null> {
  const { rows } = await getPool().query<GameRow>(
    `SELECT * FROM historical_xiangqi_games WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ? gameFromRow(rows[0]) : null;
}

// What a puzzle detail needs from its source game (the setup move #664, the
// moves before it, the players, whether the game page serves it), without
// pulling the whole row. Null when the game is not stored.
export async function getHistoricalXiangqiPuzzleSourceGame(id: string): Promise<{
  moves: XiangqiMove[];
  redNameRaw: string | null;
  blackNameRaw: string | null;
  visibility: HistoricalXiangqiVisibility;
} | null> {
  const { rows } = await getPool().query<
    Pick<GameRow, 'moves' | 'red_name_raw' | 'black_name_raw' | 'visibility'>
  >(
    `SELECT moves, red_name_raw, black_name_raw, visibility
       FROM historical_xiangqi_games WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    moves: row.moves,
    redNameRaw: row.red_name_raw,
    blackNameRaw: row.black_name_raw,
    visibility: row.visibility,
  };
}

export async function getHistoricalXiangqiSource(
  id: string,
): Promise<HistoricalXiangqiSource | null> {
  const { rows } = await getPool().query<SourceRow>(
    `SELECT * FROM historical_xiangqi_sources WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ? sourceFromRow(rows[0]) : null;
}

export type AggregatableXiangqiGame = {
  id: string;
  sourceSlug: string;
  result: HistoricalXiangqiResult;
  moves: XiangqiMove[];
  /** Average pre-game rating (sorts "Top games"), else null. */
  rating: number | null;
  /** Per-side pre-game ratings for display ("1008 vs 992"), else null. */
  redRating: number | null;
  blackRating: number | null;
  playedOn: string | null;
};

/**
 * Games the opening explorer is allowed to aggregate, ascending by id, one page
 * at a time (the corpus is far larger than any single response should be).
 *
 * The license gate is the point of this function and it is FAIL-CLOSED: only
 * sources explicitly marked `license_status = 'cleared'` qualify. A corpus we
 * merely possess (a scraped test corpus, an unlabelled import) is excluded, and
 * a NEW source stays excluded until someone records its clearance. Publishing
 * aggregates derived from a corpus republishes that corpus in statistical form,
 * so this is the same decision as publishing the games themselves.
 *
 * `visibility = 'private'` is excluded on top of that, so marking one game
 * private drops it from the explorer without touching its source.
 */
export async function listAggregatableXiangqiGames(opts: {
  limit: number;
  afterId?: string | null;
}): Promise<AggregatableXiangqiGame[]> {
  const { rows } = await getPool().query<{
    id: string;
    slug: string;
    result: HistoricalXiangqiResult;
    moves: XiangqiMove[];
    tags: Record<string, unknown>;
    played_on: Date | string | null;
    visibility: HistoricalXiangqiVisibility;
  }>(
    `SELECT games.id, sources.slug, games.result, games.moves, games.tags, games.played_on,
            games.visibility
     FROM historical_xiangqi_games games
     JOIN historical_xiangqi_sources sources ON sources.id = games.source_id
     WHERE sources.license_status = 'cleared'
       AND games.visibility <> 'private'
       AND games.id > $1
     ORDER BY games.id ASC
     LIMIT $2`,
    [opts.afterId ?? '', opts.limit],
  );
  return rows.map((row) => {
    const ratings = ratingsFromTags(row.tags);
    return {
      id: row.id,
      sourceSlug: row.slug,
      result: row.result,
      moves: row.moves,
      rating: ratings.avg,
      redRating: ratings.red,
      blackRating: ratings.black,
      playedOn: dateOnlyFromRow(row.played_on),
      // Only a publicly-listed corpus game may be shown as a clickable example.
      // Unlisted rows still count toward the statistics; they just never become
      // a front door onto a single game (xiangqi-content-integrity.md).
      publiclyListed: row.visibility === 'public',
    };
  });
}

export async function queryHistoricalXiangqiGames(
  filters: HistoricalXiangqiGameQueryFilters,
): Promise<HistoricalXiangqiGameQueryPage> {
  const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
  const offset = Math.max(0, filters.offset ?? 0);
  const { clause, values } = buildHistoricalXiangqiGameQueryWhere(filters);

  const countResult = await getPool().query<{ total: number }>(
    `SELECT count(*)::int AS total
     FROM historical_xiangqi_games games
     JOIN historical_xiangqi_sources sources ON sources.id = games.source_id
     LEFT JOIN historical_xiangqi_players red_players ON red_players.id = games.red_player_id
     LEFT JOIN historical_xiangqi_players black_players ON black_players.id = games.black_player_id
     WHERE ${clause}`,
    values,
  );
  const total = countResult.rows[0]?.total ?? 0;
  if (total === 0) return { games: [], total: 0 };

  const pageValues = [...values, limit, offset];
  const { rows } = await getPool().query<GameListRow>(
    `SELECT games.*,
            sources.slug AS source_slug,
            sources.name AS source_name
     FROM historical_xiangqi_games games
     JOIN historical_xiangqi_sources sources ON sources.id = games.source_id
     LEFT JOIN historical_xiangqi_players red_players ON red_players.id = games.red_player_id
     LEFT JOIN historical_xiangqi_players black_players ON black_players.id = games.black_player_id
     WHERE ${clause}
     ORDER BY ${historicalOrderBy(filters.sort)}
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  return { games: rows.map(gameListItemFromRow), total };
}

/**
 * Pre-game average rating from a source's tags. ElephantChess records
 * red/blackEloBefore; a source that records nothing yields null and its games
 * simply never lead the "Top games" list. Kept here rather than in the
 * aggregator so the aggregator stays free of any source's tag vocabulary.
 */
function ratingsFromTags(tags: Record<string, unknown> | null): {
  red: number | null;
  black: number | null;
  avg: number | null;
} {
  if (!tags) return { red: null, black: null, avg: null };
  const red = Number(tags.redEloBefore);
  const black = Number(tags.blackEloBefore);
  if (!Number.isFinite(red) || !Number.isFinite(black)) {
    return { red: null, black: null, avg: null };
  }
  return { red, black, avg: Math.round((red + black) / 2) };
}
