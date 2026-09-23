import type {
  XiangqiBroadcastBoard,
  XiangqiBroadcastPlayerTag,
  XiangqiBroadcastResult,
  XiangqiBroadcastRound,
  XiangqiBroadcastTour,
  XiangqiGameStatus,
  XiangqiMove,
} from '@mistboard/game';

// Ingesting a RECORD of a game is not the same as adjudicating live play. Our
// kernel auto-draws on repetition and on the progress clock; a real tournament
// game runs past both because an arbiter applies the perpetual-check/chase
// rules instead. Without this, our own auto-draw made every later move read as
// illegal and the board was skipped as `illegal_move` -- silently losing real
// games. Live play is unaffected; this option exists only on replay-to-validate
// paths. See docs-private/broadcast-october-2026-plan.md.
const INGEST_REPLAY_OPTIONS = { continuePastAdjudicatedDraw: true } as const;

import {
  replayXiangqiBroadcastBoard,
  validateXiangqiBroadcastBoard,
  validateXiangqiBroadcastRound,
  validateXiangqiBroadcastTour,
} from '@mistboard/game';
import type pg from 'pg';
import { getPool, withTransaction } from './persistence-db.js';
import type { XiangqiGameSort } from './persistence-historical-xiangqi.js';
import {
  translatedXiangqiBroadcastBoard,
  translatedXiangqiBroadcastRound,
  translatedXiangqiBroadcastTour,
} from './xiangqi-broadcast-translate.js';

export type StoredXiangqiBroadcastTour = XiangqiBroadcastTour & {
  pollEnabled: boolean;
  pollIntervalMs: number;
  createdAt: Date;
  updatedAt: Date;
};

export type XiangqiBroadcastTourSchedule = {
  slug: string;
  sourceUrl: string | null;
  pollEnabled: boolean;
  pollIntervalMs: number;
  /** The event's last day, ISO. The scheduler slows down past it and stops
   *  three weeks later; null means the tour has no end and polls as set. */
  endsAt: string | null;
};

export type XiangqiBroadcastBoardSearchFilters = {
  /** Must match the /games union's merge key; see XiangqiGameSort. */
  sort?: XiangqiGameSort;
  player?: string;
  event?: string;
  result?: XiangqiBroadcastResult;
  playedFrom?: string;
  playedTo?: string;
  plyMin?: number;
  plyMax?: number;
  limit?: number;
};

export type XiangqiBroadcastBoardSearchItem = {
  id: string;
  tourSlug: string;
  tourName: string;
  tourNameEn: string | null;
  roundId: string;
  roundName: string;
  roundNameEn: string | null;
  sourceBoardId: string;
  boardNumber: number;
  redName: string;
  redNameEn: string | null;
  blackName: string;
  blackNameEn: string | null;
  result: XiangqiBroadcastResult;
  plyCount: number;
  playedOn: string | null;
  sourceUrl: string | null;
  updatedAt: Date;
};

export type XiangqiBroadcastBoardSearchPage = {
  boards: XiangqiBroadcastBoardSearchItem[];
  total: number;
};

export type StoredXiangqiBroadcastRound = XiangqiBroadcastRound & {
  createdAt: Date;
  updatedAt: Date;
};

export type StoredXiangqiBroadcastBoard = XiangqiBroadcastBoard & {
  plyCount: number;
  finalStatus: XiangqiGameStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type XiangqiBroadcastSyncLogSeverity = 'info' | 'warning' | 'error';

export type XiangqiBroadcastSyncLog = {
  id: number;
  tourSlug: string | null;
  roundId: string | null;
  boardId: string | null;
  sourceBoardId: string | null;
  severity: XiangqiBroadcastSyncLogSeverity;
  kind: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type XiangqiBroadcastImportError = {
  boardId?: string;
  sourceBoardId?: string;
  kind: string;
  message: string;
};

export type XiangqiBroadcastImportResult = {
  tourSlug: string;
  roundsImported: number;
  boardsImported: number;
  boardsSkipped: number;
  errors: XiangqiBroadcastImportError[];
};

export type XiangqiBroadcastBoardUpdateStatus =
  | 'created'
  | 'unchanged'
  | 'extended'
  | 'updated'
  | 'corrected';

export type XiangqiBroadcastBoardUpdateResult =
  | {
      ok: true;
      boardId: string;
      status: XiangqiBroadcastBoardUpdateStatus;
      plyCount: number;
    }
  | {
      ok: false;
      boardId?: string;
      sourceBoardId?: string;
      kind: string;
      message: string;
    };

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

type TourRow = {
  slug: string;
  name: string;
  location: string | null;
  source_url: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  poll_enabled: boolean;
  poll_interval_ms: number;
  payload: XiangqiBroadcastTour;
  created_at: Date;
  updated_at: Date;
};

type RoundRow = {
  id: string;
  tour_slug: string;
  name: string;
  starts_at: Date | null;
  source_url: string | null;
  payload: XiangqiBroadcastRound;
  created_at: Date;
  updated_at: Date;
};

type BoardRow = {
  id: string;
  tour_slug: string;
  round_id: string;
  source_board_id: string;
  board_number: number;
  red: XiangqiBroadcastPlayerTag;
  black: XiangqiBroadcastPlayerTag;
  status: XiangqiBroadcastBoard['status'];
  result: XiangqiBroadcastResult;
  moves: XiangqiMove[];
  source_url: string | null;
  ply_count: number;
  final_status: XiangqiGameStatus;
  payload: XiangqiBroadcastBoard;
  created_at: Date;
  updated_at: Date;
};

type BoardSearchRow = {
  id: string;
  tour_slug: string;
  tour_name: string;
  tour_name_en: string | null;
  round_id: string;
  round_name: string;
  round_name_en: string | null;
  source_board_id: string;
  board_number: number;
  red_name: string | null;
  red_name_en: string | null;
  black_name: string | null;
  black_name_en: string | null;
  result: XiangqiBroadcastResult;
  ply_count: number;
  starts_at: Date | null;
  source_url: string | null;
  updated_at: Date;
};

type SyncLogRow = {
  id: string;
  tour_slug: string | null;
  round_id: string | null;
  board_id: string | null;
  source_board_id: string | null;
  severity: XiangqiBroadcastSyncLogSeverity;
  kind: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

function optionalDate(value: string | undefined): string | null {
  return value ?? null;
}

function optionalString(value: string | undefined): string | null {
  return value ?? null;
}

function tourFromRow(row: TourRow): StoredXiangqiBroadcastTour {
  return {
    ...row.payload,
    pollEnabled: row.poll_enabled,
    pollIntervalMs: row.poll_interval_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function roundFromRow(row: RoundRow): StoredXiangqiBroadcastRound {
  return {
    ...row.payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function boardFromRow(row: BoardRow): StoredXiangqiBroadcastBoard {
  return {
    ...row.payload,
    plyCount: row.ply_count,
    finalStatus: row.final_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getBoardById(
  client: Queryable,
  boardId: string,
): Promise<StoredXiangqiBroadcastBoard | null> {
  const { rows } = await client.query<BoardRow>(
    `SELECT * FROM xiangqi_broadcast_boards WHERE id = $1`,
    [boardId],
  );
  return rows[0] ? boardFromRow(rows[0]) : null;
}

function syncLogFromRow(row: SyncLogRow): XiangqiBroadcastSyncLog {
  return {
    id: Number(row.id),
    tourSlug: row.tour_slug,
    roundId: row.round_id,
    boardId: row.board_id,
    sourceBoardId: row.source_board_id,
    severity: row.severity,
    kind: row.kind,
    message: row.message,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

async function upsertTour(client: Queryable, tour: XiangqiBroadcastTour): Promise<void> {
  await client.query(
    `INSERT INTO xiangqi_broadcast_tours
       (slug, name, location, source_url, starts_at, ends_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       -- Scheduling and venue are CURATED: they are seeded before the event so
       -- the calendar can show it and the discovery adapter can resolve each
       -- poll's round. A converted game page states none of them, so a plain
       -- EXCLUDED nulls them on the first successful import -- which then
       -- leaves every later poll with no active round to resolve, and the
       -- event silently stops importing. Keep what is there unless the source
       -- actually says otherwise.
       location = COALESCE(EXCLUDED.location, xiangqi_broadcast_tours.location),
       source_url = EXCLUDED.source_url,
       starts_at = COALESCE(EXCLUDED.starts_at, xiangqi_broadcast_tours.starts_at),
       ends_at = COALESCE(EXCLUDED.ends_at, xiangqi_broadcast_tours.ends_at),
       -- Readers reconstruct a tour from the payload, not from the columns,
       -- so the same fields have to be preserved in both or the column keeps
       -- a date nothing reads.
       payload = EXCLUDED.payload || jsonb_strip_nulls(jsonb_build_object(
         'startsAt', COALESCE(EXCLUDED.payload->'startsAt', xiangqi_broadcast_tours.payload->'startsAt'),
         'endsAt', COALESCE(EXCLUDED.payload->'endsAt', xiangqi_broadcast_tours.payload->'endsAt'),
         'location', COALESCE(EXCLUDED.payload->'location', xiangqi_broadcast_tours.payload->'location')
       )),
       updated_at = now()`,
    [
      tour.slug,
      tour.name,
      optionalString(tour.location),
      optionalString(tour.sourceUrl),
      optionalDate(tour.startsAt),
      optionalDate(tour.endsAt),
      JSON.stringify(tour),
    ],
  );
}

async function upsertRound(client: Queryable, round: XiangqiBroadcastRound): Promise<void> {
  await client.query(
    `INSERT INTO xiangqi_broadcast_rounds
       (id, tour_slug, name, starts_at, source_url, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       tour_slug = EXCLUDED.tour_slug,
       name = EXCLUDED.name,
       -- The seeded round schedule is what resolveScheduledRound reads; a game
       -- page never states it. See the tour upsert above.
       starts_at = COALESCE(EXCLUDED.starts_at, xiangqi_broadcast_rounds.starts_at),
       source_url = EXCLUDED.source_url,
       -- roundFromRow spreads the payload, so this is the copy that actually
       -- reaches resolveScheduledRound.
       payload = EXCLUDED.payload || jsonb_strip_nulls(jsonb_build_object(
         'startsAt', COALESCE(EXCLUDED.payload->'startsAt', xiangqi_broadcast_rounds.payload->'startsAt')
       )),
       updated_at = now()`,
    [
      round.id,
      round.tourSlug,
      round.name,
      optionalDate(round.startsAt),
      optionalString(round.sourceUrl),
      JSON.stringify(round),
    ],
  );
}

async function upsertBoard(
  client: Queryable,
  board: XiangqiBroadcastBoard,
  plyCount: number,
  finalStatus: XiangqiGameStatus,
): Promise<void> {
  await client.query(
    `INSERT INTO xiangqi_broadcast_boards
       (id, tour_slug, round_id, source_board_id, board_number, red, black, status, result,
        moves, source_url, ply_count, final_status, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb,
             $11, $12, $13::jsonb, $14::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       tour_slug = EXCLUDED.tour_slug,
       round_id = EXCLUDED.round_id,
       source_board_id = EXCLUDED.source_board_id,
       board_number = EXCLUDED.board_number,
       red = EXCLUDED.red,
       black = EXCLUDED.black,
       status = EXCLUDED.status,
       result = EXCLUDED.result,
       moves = EXCLUDED.moves,
       source_url = EXCLUDED.source_url,
       ply_count = EXCLUDED.ply_count,
       final_status = EXCLUDED.final_status,
       payload = EXCLUDED.payload,
       updated_at = now()`,
    [
      board.id,
      board.tourSlug,
      board.roundId,
      board.sourceBoardId,
      board.boardNumber,
      JSON.stringify(board.red),
      JSON.stringify(board.black),
      board.status,
      board.result,
      JSON.stringify(board.moves),
      optionalString(board.sourceUrl),
      plyCount,
      JSON.stringify(finalStatus),
      JSON.stringify(board),
    ],
  );
}

// A derived board id (`b<hash>`, the converter's fallback for pages whose frame
// title names no board) changed shape on 2026-09-18 to include the source
// page's game id (#416). The first poll after that change files every derived
// board of a polling tour under a new id, and its record under the old id
// would otherwise stay behind as a duplicate. Before creating a derived board,
// retire the one record that is the same game under the old key: same tour,
// round, source page and pairing, itself derived, different id. Boards named
// by a frame title (`mr1t02`) are never touched -- two such boards can share a
// page and a pairing legitimately (a replay listed on the same round page).
async function retireRekeyedTwin(client: Queryable, board: XiangqiBroadcastBoard): Promise<void> {
  if (!board.sourceUrl || !/^b[0-9a-z]+$/.test(board.sourceBoardId)) return;
  const { rows } = await client.query<{ id: string }>(
    `DELETE FROM xiangqi_broadcast_boards
      WHERE tour_slug = $1 AND round_id = $2 AND source_url = $3
        AND red->>'name' = $4 AND black->>'name' = $5
        AND id <> $6 AND source_board_id ~ '^b[0-9a-z]+$'
      RETURNING id`,
    [board.tourSlug, board.roundId, board.sourceUrl, board.red.name, board.black.name, board.id],
  );
  for (const row of rows) {
    await appendSyncLog(client, {
      tourSlug: board.tourSlug,
      roundId: board.roundId,
      boardId: board.id,
      sourceBoardId: board.sourceBoardId,
      severity: 'info',
      kind: 'rekeyed',
      message: `retired ${row.id}: same game as ${board.id} under the pre-#416 board key`,
      payload: { retiredBoardId: row.id, sourceUrl: board.sourceUrl },
    });
  }
}

async function appendSyncLog(
  client: Queryable,
  input: {
    tourSlug?: string;
    roundId?: string;
    boardId?: string;
    sourceBoardId?: string;
    severity: XiangqiBroadcastSyncLogSeverity;
    kind: string;
    message: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO xiangqi_broadcast_sync_logs
       (tour_slug, round_id, board_id, source_board_id, severity, kind, message, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      input.tourSlug ?? null,
      input.roundId ?? null,
      input.boardId ?? null,
      input.sourceBoardId ?? null,
      input.severity,
      input.kind,
      input.message,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}

export async function recordXiangqiBroadcastSyncLog(input: {
  tourSlug?: string;
  roundId?: string;
  boardId?: string;
  sourceBoardId?: string;
  severity: XiangqiBroadcastSyncLogSeverity;
  kind: string;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await withTransaction(async (client) => {
    await appendSyncLog(client, input);
  });
}

function rawString(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return typeof raw[key] === 'string' ? raw[key] : undefined;
}

async function skipBoard(
  client: Queryable,
  rawBoard: unknown,
  kind: string,
  message: string,
  payload: Record<string, unknown>,
): Promise<XiangqiBroadcastImportError> {
  const boardId = rawString(rawBoard, 'id');
  const sourceBoardId = rawString(rawBoard, 'sourceBoardId');
  await appendSyncLog(client, {
    tourSlug: rawString(rawBoard, 'tourSlug'),
    roundId: rawString(rawBoard, 'roundId'),
    boardId,
    sourceBoardId,
    severity: 'error',
    kind,
    message,
    payload,
  });
  return {
    ...(boardId ? { boardId } : {}),
    ...(sourceBoardId ? { sourceBoardId } : {}),
    kind,
    message,
  };
}

function rejectedBoardUpdate(
  error: XiangqiBroadcastImportError,
): Extract<XiangqiBroadcastBoardUpdateResult, { ok: false }> {
  return { ok: false, ...error };
}

function movesEqual(a: readonly XiangqiMove[], b: readonly XiangqiMove[]): boolean {
  return (
    a.length === b.length &&
    a.every((move, index) => move.from === b[index]?.from && move.to === b[index]?.to)
  );
}

function isMovePrefix(prefix: readonly XiangqiMove[], value: readonly XiangqiMove[]): boolean {
  if (prefix.length > value.length) return false;
  return movesEqual(prefix, value.slice(0, prefix.length));
}

/**
 * A board's stored whole-game analysis describes the moves it was run on, and
 * game_analysis saves are insert-once, so a record whose moves change (a late
 * upload extending it, an operator correction) would keep the old evals for
 * good. Every row under its key goes, progress checkpoints included; the
 * sweep analyses it again once it is finished.
 */
async function dropBroadcastAnalysis(client: Queryable, boardId: string): Promise<void> {
  await client.query(`DELETE FROM game_analysis WHERE room_id = $1`, [`broadcast:${boardId}`]);
}

type BoardTags = Pick<
  XiangqiBroadcastBoard,
  'red' | 'black' | 'status' | 'result' | 'sourceUrl' | 'details'
>;

function boardTagsEqual(a: BoardTags, b: BoardTags): boolean {
  return (
    JSON.stringify(a.red) === JSON.stringify(b.red) &&
    JSON.stringify(a.black) === JSON.stringify(b.black) &&
    a.status === b.status &&
    a.result === b.result &&
    a.sourceUrl === b.sourceUrl &&
    // The game's details arrive on a re-read of a board stored before they
    // existed; same moves, new details is an update, not a duplicate.
    JSON.stringify(a.details ?? null) === JSON.stringify(b.details ?? null)
  );
}

async function roundBelongsToTour(
  client: Queryable,
  roundId: string,
  tourSlug: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `SELECT 1 FROM xiangqi_broadcast_rounds WHERE id = $1 AND tour_slug = $2`,
    [roundId, tourSlug],
  );
  return (rowCount ?? 0) > 0;
}

export async function applyXiangqiBroadcastBoardUpdate(
  rawBoard: unknown,
  options: { allowCorrection?: boolean; source?: string } = {},
): Promise<XiangqiBroadcastBoardUpdateResult> {
  return await withTransaction((client) =>
    applyXiangqiBroadcastBoardUpdateOn(client, rawBoard, options),
  );
}

export async function applyXiangqiBroadcastBoardUpdateOn(
  client: Queryable,
  rawBoard: unknown,
  options: { allowCorrection?: boolean; source?: string } = {},
): Promise<XiangqiBroadcastBoardUpdateResult> {
  {
    const boardResult = validateXiangqiBroadcastBoard(rawBoard);
    if (!boardResult.ok) {
      return rejectedBoardUpdate(
        await skipBoard(client, rawBoard, 'schema_validation_failed', boardResult.errors[0]!, {
          errors: boardResult.errors,
          source: options.source,
        }),
      );
    }

    // Recompute cached English names from the current Chinese values before
    // any comparison or write: deterministic, so idempotent re-polls still
    // compare equal, and stale caches self-heal on the next update.
    const board = translatedXiangqiBroadcastBoard(boardResult.value);
    if (!(await roundBelongsToTour(client, board.roundId, board.tourSlug))) {
      return rejectedBoardUpdate(
        await skipBoard(
          client,
          board,
          'reference_validation_failed',
          `unknown round ${board.roundId} for tour ${board.tourSlug}`,
          { source: options.source },
        ),
      );
    }

    const replay = replayXiangqiBroadcastBoard(board, INGEST_REPLAY_OPTIONS);
    if (!replay.ok) {
      return rejectedBoardUpdate(
        await skipBoard(client, board, 'illegal_move', replay.reason, {
          ply: replay.ply,
          move: replay.move,
          source: options.source,
        }),
      );
    }

    const existing = await getBoardById(client, board.id);
    if (!existing) {
      await retireRekeyedTwin(client, board);
      await upsertBoard(client, board, replay.plies, replay.finalStatus);
      return { ok: true, boardId: board.id, status: 'created', plyCount: replay.plies };
    }

    if (movesEqual(existing.moves, board.moves)) {
      if (boardTagsEqual(existing, board)) {
        return { ok: true, boardId: board.id, status: 'unchanged', plyCount: existing.plyCount };
      }
      await upsertBoard(client, board, replay.plies, replay.finalStatus);
      return { ok: true, boardId: board.id, status: 'updated', plyCount: replay.plies };
    }

    if (isMovePrefix(existing.moves, board.moves)) {
      await upsertBoard(client, board, replay.plies, replay.finalStatus);
      await dropBroadcastAnalysis(client, board.id);
      return { ok: true, boardId: board.id, status: 'extended', plyCount: replay.plies };
    }

    if (isMovePrefix(board.moves, existing.moves)) {
      return { ok: true, boardId: board.id, status: 'unchanged', plyCount: existing.plyCount };
    }

    if (options.allowCorrection) {
      await upsertBoard(client, board, replay.plies, replay.finalStatus);
      await dropBroadcastAnalysis(client, board.id);
      await appendSyncLog(client, {
        tourSlug: board.tourSlug,
        roundId: board.roundId,
        boardId: board.id,
        sourceBoardId: board.sourceBoardId,
        severity: 'warning',
        kind: 'corrected',
        message: 'accepted explicit correction for non-prefix board update',
        payload: {
          previousPlyCount: existing.plyCount,
          nextPlyCount: replay.plies,
          source: options.source,
        },
      });
      return { ok: true, boardId: board.id, status: 'corrected', plyCount: replay.plies };
    }

    return rejectedBoardUpdate(
      await skipBoard(
        client,
        board,
        'incompatible_update',
        'incoming move list is neither a duplicate, stale prefix, nor legal extension',
        {
          previousPlyCount: existing.plyCount,
          nextPlyCount: board.moves.length,
          source: options.source,
        },
      ),
    );
  }
}

export async function importXiangqiBroadcastPack(input: {
  tour: unknown;
  rounds: unknown[];
  boards: unknown[];
}): Promise<XiangqiBroadcastImportResult> {
  return await withTransaction((client) => importXiangqiBroadcastPackOn(client, input));
}

export async function importXiangqiBroadcastPackOn(
  client: Queryable,
  input: {
    tour: unknown;
    rounds: unknown[];
    boards: unknown[];
  },
): Promise<XiangqiBroadcastImportResult> {
  const tourResult = validateXiangqiBroadcastTour(input.tour);
  if (!tourResult.ok) throw new Error(`invalid broadcast tour: ${tourResult.errors.join('; ')}`);
  // English names are recomputed from the current Chinese values at write
  // time; the cached nameEn fields ride the payload JSONB.
  const tour = translatedXiangqiBroadcastTour(tourResult.value);

  const rounds: XiangqiBroadcastRound[] = [];
  for (const [index, rawRound] of input.rounds.entries()) {
    const result = validateXiangqiBroadcastRound(rawRound);
    if (!result.ok) {
      throw new Error(`invalid broadcast round ${index + 1}: ${result.errors.join('; ')}`);
    }
    if (result.value.tourSlug !== tour.slug) {
      throw new Error(`round ${result.value.id} belongs to ${result.value.tourSlug}`);
    }
    rounds.push(translatedXiangqiBroadcastRound(result.value));
  }
  const roundIds = new Set(rounds.map((round) => round.id));

  {
    await upsertTour(client, tour);
    for (const round of rounds) await upsertRound(client, round);

    let boardsImported = 0;
    let boardsSkipped = 0;
    const errors: XiangqiBroadcastImportError[] = [];

    for (const rawBoard of input.boards) {
      const boardResult = validateXiangqiBroadcastBoard(rawBoard);
      if (!boardResult.ok) {
        boardsSkipped += 1;
        errors.push(
          await skipBoard(client, rawBoard, 'schema_validation_failed', boardResult.errors[0]!, {
            errors: boardResult.errors,
          }),
        );
        continue;
      }

      const board = translatedXiangqiBroadcastBoard(boardResult.value);
      if (board.tourSlug !== tour.slug || !roundIds.has(board.roundId)) {
        boardsSkipped += 1;
        const message =
          board.tourSlug !== tour.slug
            ? `board belongs to ${board.tourSlug}, expected ${tour.slug}`
            : `unknown round ${board.roundId}`;
        errors.push(
          await skipBoard(client, board, 'reference_validation_failed', message, {
            tourSlug: tour.slug,
            roundIds: [...roundIds],
          }),
        );
        continue;
      }

      const replay = replayXiangqiBroadcastBoard(board, INGEST_REPLAY_OPTIONS);
      if (!replay.ok) {
        boardsSkipped += 1;
        errors.push(
          await skipBoard(client, board, 'illegal_move', replay.reason, {
            ply: replay.ply,
            move: replay.move,
          }),
        );
        continue;
      }

      await upsertBoard(client, board, replay.plies, replay.finalStatus);
      boardsImported += 1;
    }

    return {
      tourSlug: tour.slug,
      roundsImported: rounds.length,
      boardsImported,
      boardsSkipped,
      errors,
    };
  }
}

export async function getXiangqiBroadcastTour(
  slug: string,
): Promise<StoredXiangqiBroadcastTour | null> {
  const { rows } = await getPool().query<TourRow>(
    `SELECT * FROM xiangqi_broadcast_tours WHERE slug = $1`,
    [slug],
  );
  return rows[0] ? tourFromRow(rows[0]) : null;
}

// Remove a broadcast tour and everything under it (boards, rounds, sync logs).
// Schedule state lives in columns on the tour row, so deleting the tour clears
// it too. Returns false when no tour matched the slug.
export async function deleteXiangqiBroadcastTour(slug: string): Promise<boolean> {
  return await withTransaction(async (client) => {
    await client.query(`DELETE FROM xiangqi_broadcast_sync_logs WHERE tour_slug = $1`, [slug]);
    await client.query(`DELETE FROM xiangqi_broadcast_boards WHERE tour_slug = $1`, [slug]);
    await client.query(`DELETE FROM xiangqi_broadcast_rounds WHERE tour_slug = $1`, [slug]);
    const { rowCount } = await client.query(`DELETE FROM xiangqi_broadcast_tours WHERE slug = $1`, [
      slug,
    ]);
    return (rowCount ?? 0) > 0;
  });
}

export async function listXiangqiBroadcastTours(): Promise<StoredXiangqiBroadcastTour[]> {
  const { rows } = await getPool().query<TourRow>(
    `SELECT * FROM xiangqi_broadcast_tours ORDER BY starts_at DESC NULLS LAST, slug`,
  );
  return rows.map(tourFromRow);
}

// Every stored board, for a whole-corpus check (the readout's serving sweep).
// Takes the connection so the readout can run it on its own pool handle.
export async function listAllXiangqiBroadcastBoardsOn(
  client: Queryable,
): Promise<StoredXiangqiBroadcastBoard[]> {
  const { rows } = await client.query<BoardRow>(
    `SELECT * FROM xiangqi_broadcast_boards ORDER BY tour_slug, round_id, board_number, id`,
  );
  return rows.map(boardFromRow);
}

export async function listXiangqiBroadcastRounds(
  tourSlug: string,
): Promise<StoredXiangqiBroadcastRound[]> {
  const { rows } = await getPool().query<RoundRow>(
    `SELECT * FROM xiangqi_broadcast_rounds
      WHERE tour_slug = $1
      ORDER BY starts_at NULLS LAST, id`,
    [tourSlug],
  );
  return rows.map(roundFromRow);
}

export async function listXiangqiBroadcastBoards(
  roundId: string,
): Promise<StoredXiangqiBroadcastBoard[]> {
  const { rows } = await getPool().query<BoardRow>(
    `SELECT * FROM xiangqi_broadcast_boards
      WHERE round_id = $1
      ORDER BY board_number, id`,
    [roundId],
  );
  return rows.map(boardFromRow);
}

// The WHERE half of the completed-board search, shared by the page query and its
// count so a "showing 20 of N" readout can never describe a different slice than
// the rows above it.
function buildCompletedBoardSearchWhere(filters: XiangqiBroadcastBoardSearchFilters): {
  clause: string;
  values: unknown[];
} {
  const conditions: string[] = [`boards.result <> '*'`];
  const values: unknown[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.player) {
    const like = `%${filters.player}%`;
    conditions.push(
      `(boards.red->>'name' ILIKE ${bind(like)} OR boards.black->>'name' ILIKE ${bind(like)}
        OR boards.red->>'nameEn' ILIKE ${bind(like)} OR boards.black->>'nameEn' ILIKE ${bind(like)})`,
    );
  }
  if (filters.event) {
    const like = `%${filters.event}%`;
    conditions.push(
      `(tours.name ILIKE ${bind(like)} OR rounds.name ILIKE ${bind(like)}
        OR tours.payload->>'nameEn' ILIKE ${bind(like)} OR rounds.payload->>'nameEn' ILIKE ${bind(like)})`,
    );
  }
  if (filters.result) conditions.push(`boards.result = ${bind(filters.result)}`);
  if (filters.playedFrom) conditions.push(`rounds.starts_at >= ${bind(filters.playedFrom)}::date`);
  if (filters.playedTo) conditions.push(`rounds.starts_at < ${bind(filters.playedTo)}::date`);
  if (typeof filters.plyMin === 'number') {
    conditions.push(`boards.ply_count >= ${bind(filters.plyMin)}`);
  }
  if (typeof filters.plyMax === 'number') {
    conditions.push(`boards.ply_count <= ${bind(filters.plyMax)}`);
  }

  return { clause: conditions.join('\n       AND '), values };
}

/** ORDER BY per sort. The date key is the round start, which is what this
 *  lane reports as sortAt, so the merge comparator sees the same ordering. */
export function broadcastOrderBy(sort: XiangqiGameSort | undefined): string {
  switch (sort) {
    case 'oldest':
      return 'rounds.starts_at ASC NULLS LAST, boards.updated_at ASC, boards.id ASC';
    case 'longest':
      return 'boards.ply_count DESC, boards.id DESC';
    case 'shortest':
      return 'boards.ply_count ASC, boards.id ASC';
    default:
      return 'rounds.starts_at DESC NULLS LAST, boards.updated_at DESC, boards.id DESC';
  }
}

export async function queryCompletedXiangqiBroadcastBoards(
  filters: XiangqiBroadcastBoardSearchFilters,
): Promise<XiangqiBroadcastBoardSearchPage> {
  const limit = Math.max(1, Math.min(filters.limit ?? 200, 200));
  const { clause, values } = buildCompletedBoardSearchWhere(filters);

  const countResult = await getPool().query<{ total: number }>(
    `SELECT count(*)::int AS total
     FROM xiangqi_broadcast_boards boards
     JOIN xiangqi_broadcast_tours tours ON tours.slug = boards.tour_slug
     JOIN xiangqi_broadcast_rounds rounds ON rounds.id = boards.round_id
     WHERE ${clause}`,
    values,
  );
  const total = countResult.rows[0]?.total ?? 0;
  if (total === 0) return { boards: [], total: 0 };

  const pageValues = [...values, limit];
  const { rows } = await getPool().query<BoardSearchRow>(
    `SELECT boards.id,
            boards.tour_slug,
            tours.name AS tour_name,
            tours.payload->>'nameEn' AS tour_name_en,
            boards.round_id,
            rounds.name AS round_name,
            rounds.payload->>'nameEn' AS round_name_en,
            boards.source_board_id,
            boards.board_number,
            boards.red->>'name' AS red_name,
            boards.red->>'nameEn' AS red_name_en,
            boards.black->>'name' AS black_name,
            boards.black->>'nameEn' AS black_name_en,
            boards.result,
            boards.ply_count,
            rounds.starts_at,
            COALESCE(boards.source_url, rounds.source_url, tours.source_url) AS source_url,
            boards.updated_at
     FROM xiangqi_broadcast_boards boards
     JOIN xiangqi_broadcast_tours tours ON tours.slug = boards.tour_slug
     JOIN xiangqi_broadcast_rounds rounds ON rounds.id = boards.round_id
     WHERE ${clause}
     ORDER BY ${broadcastOrderBy(filters.sort)}
     LIMIT $${pageValues.length}`,
    pageValues,
  );
  const boards = rows.map((row) => ({
    id: row.id,
    tourSlug: row.tour_slug,
    tourName: row.tour_name,
    tourNameEn: row.tour_name_en,
    roundId: row.round_id,
    roundName: row.round_name,
    roundNameEn: row.round_name_en,
    sourceBoardId: row.source_board_id,
    boardNumber: row.board_number,
    redName: row.red_name ?? 'Red',
    redNameEn: row.red_name_en,
    blackName: row.black_name ?? 'Black',
    blackNameEn: row.black_name_en,
    result: row.result,
    plyCount: row.ply_count,
    playedOn: row.starts_at ? row.starts_at.toISOString().slice(0, 10) : null,
    sourceUrl: row.source_url,
    updatedAt: row.updated_at,
  }));
  return { boards, total };
}

export type AggregatableXiangqiBroadcastGame = {
  id: string;
  result: XiangqiBroadcastResult;
  moves: XiangqiMove[];
  redName: string | null;
  blackName: string | null;
  event: string | null;
  playedOn: string | null;
};

/**
 * Completed broadcast boards, for the opening explorer, ascending by id.
 *
 * Why this is not gated the way `listAggregatableXiangqiGames` is: that gate
 * exists because publishing aggregates republishes a corpus in statistical form,
 * which is the same decision as publishing the games. For broadcast boards that
 * decision is already made and already shipped — every one of these games is
 * displayed in full, move by move, at /broadcast/xiangqi with its source URL.
 * An aggregate over games we already serve in their entirety exposes strictly
 * less than the pages we already serve.
 *
 * What IS enforced here: only finished games (`result <> '*'`). A live board is
 * still being played and its move list grows underneath the build, so folding
 * one in would bake a half-game into the statistics and count it again at the
 * next rebuild.
 */
export async function listAggregatableXiangqiBroadcastGames(opts: {
  limit: number;
  afterId?: string | null;
}): Promise<AggregatableXiangqiBroadcastGame[]> {
  const { rows } = await getPool().query<{
    id: string;
    result: XiangqiBroadcastResult;
    moves: XiangqiMove[];
    red_name: string | null;
    black_name: string | null;
    tour_name: string | null;
    tour_name_en: string | null;
    starts_at: Date | null;
  }>(
    `SELECT boards.id,
            boards.result,
            boards.moves,
            COALESCE(boards.red->>'nameEn', boards.red->>'name') AS red_name,
            COALESCE(boards.black->>'nameEn', boards.black->>'name') AS black_name,
            tours.name AS tour_name,
            tours.payload->>'nameEn' AS tour_name_en,
            rounds.starts_at
     FROM xiangqi_broadcast_boards boards
     JOIN xiangqi_broadcast_tours tours ON tours.slug = boards.tour_slug
     JOIN xiangqi_broadcast_rounds rounds ON rounds.id = boards.round_id
     WHERE boards.result <> '*'
       AND boards.id > $1
     ORDER BY boards.id ASC
     LIMIT $2`,
    [opts.afterId ?? '', opts.limit],
  );
  return rows.map((row) => ({
    id: row.id,
    result: row.result,
    moves: row.moves,
    redName: row.red_name,
    blackName: row.black_name,
    event: row.tour_name_en ?? row.tour_name,
    playedOn: row.starts_at ? row.starts_at.toISOString().slice(0, 10) : null,
  }));
}

export async function getXiangqiBroadcastBoard(
  boardId: string,
): Promise<StoredXiangqiBroadcastBoard | null> {
  const { rows } = await getPool().query<BoardRow>(
    `SELECT * FROM xiangqi_broadcast_boards WHERE id = $1`,
    [boardId],
  );
  return rows[0] ? boardFromRow(rows[0]) : null;
}

export async function setXiangqiBroadcastTourSchedule(
  slug: string,
  schedule: { pollEnabled: boolean; pollIntervalMs: number },
): Promise<XiangqiBroadcastTourSchedule | null> {
  const { rows } = await getPool().query<TourRow>(
    `UPDATE xiangqi_broadcast_tours
        SET poll_enabled = $2, poll_interval_ms = $3, updated_at = now()
      WHERE slug = $1
      RETURNING *`,
    [slug, schedule.pollEnabled, schedule.pollIntervalMs],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    slug: row.slug,
    sourceUrl: row.source_url,
    pollEnabled: row.poll_enabled,
    pollIntervalMs: row.poll_interval_ms,
    endsAt: row.ends_at?.toISOString() ?? null,
  };
}

/**
 * The newest finished board with no stored whole-game analysis under
 * (engineId, depth), for the broadcast analysis sweep. Newest first, so the
 * round readers are opening fills before the archive. `skip` holds boards this
 * process already failed on, so one bad record cannot stall the sweep.
 */
export async function nextUnanalysedXiangqiBroadcastBoard(input: {
  engineId: string;
  depth: number;
  maxPlies: number;
  skip: readonly string[];
}): Promise<StoredXiangqiBroadcastBoard | null> {
  const { rows } = await getPool().query<BoardRow>(
    `SELECT b.* FROM xiangqi_broadcast_boards b
      WHERE b.status = 'complete'
        AND b.ply_count BETWEEN 1 AND $3
        AND NOT (b.id = ANY($4::text[]))
        AND NOT EXISTS (
          SELECT 1 FROM game_analysis g
           WHERE g.room_id = 'broadcast:' || b.id AND g.engine_id = $1 AND g.depth = $2
        )
      ORDER BY b.updated_at DESC, b.id
      LIMIT 1`,
    [input.engineId, input.depth, input.maxPlies, [...input.skip]],
  );
  return rows[0] ? boardFromRow(rows[0]) : null;
}

/** The final-position eval of each board's stored analysis, for the round
 *  grid's gauge: the last ply's score, Red's point of view. */
export async function listXiangqiBroadcastFinalEvals(input: {
  boardIds: readonly string[];
  engineId: string;
  depth: number;
}): Promise<Map<string, { cp: number | null; mate: number | null }>> {
  const evals = new Map<string, { cp: number | null; mate: number | null }>();
  if (input.boardIds.length === 0) return evals;
  const { rows } = await getPool().query<{
    room_id: string;
    last: { cp?: number | null; mate?: number | null } | null;
  }>(
    `SELECT room_id, plies -> (jsonb_array_length(plies) - 1) AS last
       FROM game_analysis
      WHERE room_id = ANY($1::text[]) AND engine_id = $2 AND depth = $3`,
    [input.boardIds.map((id) => `broadcast:${id}`), input.engineId, input.depth],
  );
  for (const row of rows) {
    if (!row.last) continue;
    evals.set(row.room_id.slice('broadcast:'.length), {
      cp: typeof row.last.cp === 'number' ? row.last.cp : null,
      mate: typeof row.last.mate === 'number' ? row.last.mate : null,
    });
  }
  return evals;
}

/** Every tour's source and end date, for the dpxq index sweep (which ones
 *  we already relay, and whose end date dpxq has since moved). */
export async function listXiangqiBroadcastTourSourcesOn(
  client: Queryable,
): Promise<Array<{ slug: string; sourceUrl: string | null; endsAt: string | null }>> {
  const { rows } = await client.query<Pick<TourRow, 'slug' | 'source_url' | 'ends_at'>>(
    `SELECT slug, source_url, ends_at FROM xiangqi_broadcast_tours ORDER BY slug`,
  );
  return rows.map((row) => ({
    slug: row.slug,
    sourceUrl: row.source_url,
    endsAt: row.ends_at?.toISOString() ?? null,
  }));
}

/**
 * Move a tour's end date later, column and payload together (readers
 * reconstruct the tour from the payload; see upsertTour). Never earlier: the
 * guard is in the WHERE so two sweeps racing cannot shorten it either.
 * Returns whether the row moved.
 */
export async function extendXiangqiBroadcastTourEndsAt(
  slug: string,
  endsAt: string,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE xiangqi_broadcast_tours
        SET ends_at = $2::timestamptz,
            -- $3 is the same value as text: a reuse of $2 would render
            -- Postgres's own timestamp format into the payload.
            payload = jsonb_set(payload, '{endsAt}', to_jsonb($3::text)),
            updated_at = now()
      WHERE slug = $1 AND (ends_at IS NULL OR ends_at < $2::timestamptz)`,
    [slug, endsAt, endsAt],
  );
  return (rowCount ?? 0) > 0;
}

export async function listXiangqiBroadcastScheduledTours(): Promise<
  XiangqiBroadcastTourSchedule[]
> {
  const { rows } = await getPool().query<TourRow>(
    `SELECT * FROM xiangqi_broadcast_tours WHERE poll_enabled ORDER BY slug`,
  );
  return rows.map((row) => ({
    slug: row.slug,
    sourceUrl: row.source_url,
    pollEnabled: row.poll_enabled,
    pollIntervalMs: row.poll_interval_ms,
    endsAt: row.ends_at?.toISOString() ?? null,
  }));
}

export type XiangqiBroadcastTranslationBackfillChange = {
  kind: 'tour' | 'round' | 'board';
  id: string;
  fields: Record<string, { before: string | null; after: string | null }>;
};

export type XiangqiBroadcastTranslationBackfillResult = {
  dryRun: boolean;
  toursSeen: number;
  roundsSeen: number;
  boardsSeen: number;
  changes: XiangqiBroadcastTranslationBackfillChange[];
};

function nameEnChange(
  before: { name: string; nameEn?: string },
  after: { name: string; nameEn?: string },
  key: string,
): Record<string, { before: string | null; after: string | null }> {
  if ((before.nameEn ?? null) === (after.nameEn ?? null)) return {};
  return { [key]: { before: before.nameEn ?? null, after: after.nameEn ?? null } };
}

// Player tags cache a second translation, the team affiliation. It needs its
// own comparison: a row whose nameEn is already correct but whose federationEn
// is missing would otherwise report no change and never be rewritten, which is
// exactly the state of every board imported before team names were carried.
function federationEnChange(
  before: { federationEn?: string },
  after: { federationEn?: string },
  key: string,
): Record<string, { before: string | null; after: string | null }> {
  if ((before.federationEn ?? null) === (after.federationEn ?? null)) return {};
  return { [key]: { before: before.federationEn ?? null, after: after.federationEn ?? null } };
}

// Recompute the cached English names for every stored tour, round, and board
// without re-importing from the source. Existing rows predating translation
// (or predating a glossary improvement) get their nameEn fields refreshed;
// rows whose recomputed translation matches are left untouched.
export async function backfillXiangqiBroadcastTranslations(
  options: { dryRun?: boolean } = {},
): Promise<XiangqiBroadcastTranslationBackfillResult> {
  const dryRun = options.dryRun ?? false;
  return await withTransaction(async (client) => {
    const changes: XiangqiBroadcastTranslationBackfillChange[] = [];

    const tours = await client.query<{ slug: string; payload: XiangqiBroadcastTour }>(
      `SELECT slug, payload FROM xiangqi_broadcast_tours ORDER BY slug`,
    );
    for (const row of tours.rows) {
      const translated = translatedXiangqiBroadcastTour(row.payload);
      const fields = nameEnChange(row.payload, translated, 'nameEn');
      if (Object.keys(fields).length === 0) continue;
      changes.push({ kind: 'tour', id: row.slug, fields });
      if (!dryRun) await upsertTour(client, translated);
    }

    const rounds = await client.query<{ id: string; payload: XiangqiBroadcastRound }>(
      `SELECT id, payload FROM xiangqi_broadcast_rounds ORDER BY id`,
    );
    for (const row of rounds.rows) {
      const translated = translatedXiangqiBroadcastRound(row.payload);
      const fields = nameEnChange(row.payload, translated, 'nameEn');
      if (Object.keys(fields).length === 0) continue;
      changes.push({ kind: 'round', id: row.id, fields });
      if (!dryRun) await upsertRound(client, translated);
    }

    const boards = await client.query<{ id: string; payload: XiangqiBroadcastBoard }>(
      `SELECT id, payload FROM xiangqi_broadcast_boards ORDER BY id`,
    );
    for (const row of boards.rows) {
      const translated = translatedXiangqiBroadcastBoard(row.payload);
      const fields = {
        ...nameEnChange(row.payload.red, translated.red, 'red.nameEn'),
        ...nameEnChange(row.payload.black, translated.black, 'black.nameEn'),
        ...federationEnChange(row.payload.red, translated.red, 'red.federationEn'),
        ...federationEnChange(row.payload.black, translated.black, 'black.federationEn'),
      };
      if (Object.keys(fields).length === 0) continue;
      changes.push({ kind: 'board', id: row.id, fields });
      if (!dryRun) {
        // Narrow update: names only. Moves/status/ply state are untouched, so
        // there is no need to re-run replay validation here.
        await client.query(
          `UPDATE xiangqi_broadcast_boards
              SET red = $2::jsonb, black = $3::jsonb, payload = $4::jsonb, updated_at = now()
            WHERE id = $1`,
          [
            row.id,
            JSON.stringify(translated.red),
            JSON.stringify(translated.black),
            JSON.stringify(translated),
          ],
        );
      }
    }

    return {
      dryRun,
      toursSeen: tours.rows.length,
      roundsSeen: rounds.rows.length,
      boardsSeen: boards.rows.length,
      changes,
    };
  });
}

export async function listXiangqiBroadcastSyncLogs(input: {
  tourSlug?: string;
  boardId?: string;
}): Promise<XiangqiBroadcastSyncLog[]> {
  const clauses: string[] = [];
  const values: string[] = [];
  if (input.tourSlug) {
    values.push(input.tourSlug);
    clauses.push(`tour_slug = $${values.length}`);
  }
  if (input.boardId) {
    values.push(input.boardId);
    clauses.push(`board_id = $${values.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await getPool().query<SyncLogRow>(
    `SELECT * FROM xiangqi_broadcast_sync_logs ${where} ORDER BY created_at DESC, id DESC`,
    values,
  );
  return rows.map(syncLogFromRow);
}
