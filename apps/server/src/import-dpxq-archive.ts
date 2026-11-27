// Import finished dpxq events from the local archive copy as broadcast tours.
//
//   tsx src/import-dpxq-archive.ts <events.tsv> [--dry-run] [--only <slug>] [--archive <dir>]
//
// The archive (~/projects/xiangqi-corpus/dpxq-archive) holds each event's game
// list (index/movelist_<tour>.html.gz) and every game page
// (pages/<id/1000>/view_m_<id>.html.gz) as dpxq served them. This writes the
// same tour, round and board rows the broadcast poller writes for a dpxq
// event, through the same persistence calls, and makes no network request.
//
// Every tour is written listed with polling off: the event is over, and the
// poller must never re-fetch an archived event. An event with any game missing
// from disk or failing to convert is refused whole, so a tour never goes up
// with holes in it. Each event is one transaction; re-running changes nothing
// (tour and round rows are written only when they differ, and boards go
// through the poller's own unchanged check).
//
// --dry-run only reads (it runs under `prod:db --read-only`): it prints each
// event's plan, its rounds and boards, and any clash with a stored tour. It
// runs no migrations, in either mode.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  dpxqTourIdForTour,
  XIANGQI_BROADCAST_SCHEMA,
  type XiangqiBroadcastBoard,
  type XiangqiBroadcastRound,
  type XiangqiBroadcastTour,
} from '@mistboard/game';
import type pg from 'pg';
import { close, getPool, init, withTransaction } from './persistence-db.js';
import {
  applyXiangqiBroadcastBoardUpdateOn,
  importXiangqiBroadcastPackOn,
  type XiangqiBroadcastBoardUpdateStatus,
} from './persistence-xiangqi-broadcasts.js';
import { archiveBoardUrl } from './xiangqi-broadcast-discovery-dpxq-tour.js';
import { looksLikeDpxqPage, normalizeDpxqPageToFrameHtml } from './xiangqi-broadcast-dpxq.js';
import { roundPageUrl } from './xiangqi-broadcast-dpxq-pairings.js';
import { decodeSourceBody } from './xiangqi-broadcast-fetch.js';
import {
  translatedXiangqiBroadcastBoard,
  translatedXiangqiBroadcastRound,
  translatedXiangqiBroadcastTour,
  translateXiangqiEventName,
} from './xiangqi-broadcast-translate.js';
import { convertWxfDhtmlXqPageToSnapshot } from './xiangqi-broadcast-wxf-dhtmlxq.js';

export const DEFAULT_DPXQ_ARCHIVE_DIR = join(homedir(), 'projects/xiangqi-corpus/dpxq-archive');

/** One row of the event list: which dpxq event, under which slug and name. */
export type DpxqArchiveEvent = {
  slug: string;
  dpxqId: string;
  /** The English name the site must compute from `nameZh`; a mismatch refuses. */
  nameEn: string;
  /** dpxq's own event name, stored as the tour name like the poller does. */
  nameZh: string;
  /** dpxq's listed start day, used only when no game states its date. */
  startsOn?: string;
};

/** Reads the archive copy. `null` means the page is not on disk. */
export type DpxqArchiveReader = {
  gameList(tourId: string): string | null;
  gamePage(gameId: string): string | null;
};

export type DpxqArchivePlan =
  | {
      ok: true;
      event: DpxqArchiveEvent;
      tour: XiangqiBroadcastTour;
      rounds: XiangqiBroadcastRound[];
      boards: XiangqiBroadcastBoard[];
      /** Rounds none of whose games states a date (they take the tour's start). */
      undatedRounds: number;
      /** Boards published without a replayable record (`recordWithheld`). */
      withheldBoards: number;
    }
  | { ok: false; event: DpxqArchiveEvent; problems: string[] };

export function parseDpxqArchiveEventList(tsv: string): DpxqArchiveEvent[] {
  const lines = tsv.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = (lines.shift() ?? '').split('\t');
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`event list has no ${name} column`);
    return index;
  };
  const slug = column('slug');
  const dpxqId = column('dpxq_id');
  const nameEn = column('name_en');
  const nameZh = column('name_zh');
  const startsOn = header.indexOf('starts_on');
  return lines.map((line) => {
    const cells = line.split('\t');
    const event: DpxqArchiveEvent = {
      slug: cells[slug] ?? '',
      dpxqId: cells[dpxqId] ?? '',
      nameEn: cells[nameEn] ?? '',
      nameZh: cells[nameZh] ?? '',
    };
    const day = startsOn >= 0 ? cells[startsOn] : undefined;
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) event.startsOn = day;
    if (!/^[a-z0-9-]+$/.test(event.slug) || !/^\d+$/.test(event.dpxqId) || !event.nameZh) {
      throw new Error(`bad event list row: ${line}`);
    }
    return event;
  });
}

export type DpxqGameListRow = { roundNumber?: number; table?: number; ids: string[] };

/**
 * Every record link on a tour's game list, row by row. Unlike the poller's
 * `parseDpxqTourGameList`, which keeps the first link of a row, this keeps all
 * of them: a rapid match's row links each of its games (谱1, 谱2), and the
 * archive is the event's full record.
 */
export function parseDpxqGameListRows(html: string): DpxqGameListRow[] {
  const rows: DpxqGameListRow[] = [];
  const seen = new Set<string>();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const body = row[1] ?? '';
    const ids: string[] = [];
    for (const link of body.matchAll(/view_m_(\d+)\.html/gi)) {
      const id = link[1]!;
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    if (ids.length === 0) continue;
    const text = body.replace(/<[^>]+>/g, ' ');
    const round = Number(text.match(/第\s*(\d+)\s*轮/)?.[1]);
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
      (cell[1] ?? '').replace(/<[^>]+>/g, '').trim(),
    );
    const table = /^\d+$/.test(cells[1] ?? '') ? Number(cells[1]) : Number.NaN;
    rows.push({
      ids,
      ...(Number.isInteger(round) && round > 0 ? { roundNumber: round } : {}),
      ...(Number.isInteger(table) && table > 0 ? { table } : {}),
    });
  }
  return rows;
}

const pad2 = (value: number) => String(value).padStart(2, '0');
const DAY = /^(\d{4}-\d{2}-\d{2})/;

/** A game's moment for ordering: a date-only value is that day's start in China. */
function playedMs(playedAt: string): number {
  return Date.parse(playedAt.includes('T') ? playedAt : `${playedAt}T00:00:00+08:00`);
}

function earliestPlayed(values: Array<string | undefined>): string | undefined {
  let best: string | undefined;
  for (const value of values) {
    if (!value || Number.isNaN(playedMs(value))) continue;
    if (!best || playedMs(value) < playedMs(best)) best = value;
  }
  return best;
}

function latestPlayed(values: Array<string | undefined>): string | undefined {
  let best: string | undefined;
  for (const value of values) {
    if (!value || Number.isNaN(playedMs(value))) continue;
    if (!best || playedMs(value) > playedMs(best)) best = value;
  }
  return best;
}

/** The poller's seeded form: a day stored as its midnight in China. */
function asMoment(playedAt: string): string {
  return playedAt.includes('T') ? playedAt : `${playedAt}T00:00:00+08:00`;
}

export function dpxqArchiveTourSourceUrl(event: Pick<DpxqArchiveEvent, 'slug' | 'dpxqId'>): string {
  return `mistboard-discover://dpxq-tour?tour=${event.dpxqId}&tourSlug=${event.slug}`;
}

/**
 * Turn one archived event into the rows the poller would write, or say why it
 * cannot be imported. Pure: reads only through `reader`.
 */
export function planDpxqArchiveEvent(
  event: DpxqArchiveEvent,
  reader: DpxqArchiveReader,
): DpxqArchivePlan {
  const problems: string[] = [];
  const computedEn = translateXiangqiEventName(event.nameZh);
  if (computedEn !== event.nameEn) {
    problems.push(`English name is "${computedEn ?? ''}", list says "${event.nameEn}"`);
  } else if (/\p{Script=Han}/u.test(computedEn)) {
    problems.push(`English name still carries Chinese: "${computedEn}"`);
  }
  const list = reader.gameList(event.dpxqId);
  if (list === null) {
    return { ok: false, event, problems: [...problems, `movelist_${event.dpxqId} not on disk`] };
  }
  const rows = parseDpxqGameListRows(list);
  if (rows.length === 0) problems.push(`movelist_${event.dpxqId} lists no games`);

  const byRound = new Map<number, DpxqGameListRow[]>();
  for (const row of rows) {
    if (row.roundNumber === undefined) {
      problems.push(`game ${row.ids.join(',')} has no round on the game list`);
      continue;
    }
    const list = byRound.get(row.roundNumber) ?? [];
    list.push(row);
    byRound.set(row.roundNumber, list);
  }

  const missing: string[] = [];
  const boards: XiangqiBroadcastBoard[] = [];
  const roundDrafts: Array<{ number: number; boards: XiangqiBroadcastBoard[] }> = [];
  let withheldBoards = 0;
  for (const number of [...byRound.keys()].sort((a, b) => a - b)) {
    const roundRows = byRound.get(number)!;
    const roundId = `${event.slug}-r${pad2(number)}`;
    // Board ids follow the table when every row is one game at its own table;
    // a team or multi-game round is numbered by its order on the list instead,
    // because its table numbers repeat.
    const tables = roundRows.map((row) => row.table);
    const byTable =
      roundRows.every((row) => row.ids.length === 1 && row.table !== undefined) &&
      new Set(tables).size === tables.length;
    const roundBoards: XiangqiBroadcastBoard[] = [];
    let rank = 0;
    for (const row of roundRows) {
      for (const id of row.ids) {
        rank += 1;
        const page = reader.gamePage(id);
        if (page === null) {
          missing.push(id);
          continue;
        }
        const boardNumber = byTable ? row.table! : rank;
        const sourceBoardId = byTable
          ? `r${pad2(number)}t${pad2(row.table!)}`
          : `r${pad2(number)}b${pad2(rank)}`;
        const converted = convertArchivedGamePage(page, {
          tourSlug: event.slug,
          tourName: event.nameZh,
          roundId,
          roundName: `第${number}轮`,
          boardNumber,
          sourceBoardId,
          sourceUrl: archiveBoardUrl(id),
        });
        if (!converted.ok) {
          problems.push(`game ${id}: ${converted.message}`);
          continue;
        }
        if (converted.board.recordWithheld) withheldBoards += 1;
        roundBoards.push(converted.board);
      }
    }
    boards.push(...roundBoards);
    roundDrafts.push({ number, boards: roundBoards });
  }
  if (missing.length > 0) {
    problems.push(`${missing.length} game pages not on disk: ${missing.slice(0, 10).join(', ')}`);
  }
  const ids = new Set<string>();
  for (const board of boards) {
    if (ids.has(board.id)) problems.push(`two games map to board ${board.id}`);
    ids.add(board.id);
  }
  if (problems.length > 0) return { ok: false, event, problems };

  const played = boards.map((board) => board.details?.playedAt);
  const first = earliestPlayed(played);
  const last = latestPlayed(played);
  const startDay = first?.match(DAY)?.[1] ?? event.startsOn;
  const endDay = last?.match(DAY)?.[1] ?? startDay;
  const tour: XiangqiBroadcastTour = {
    schema: XIANGQI_BROADCAST_SCHEMA,
    slug: event.slug,
    name: event.nameZh,
    sourceUrl: dpxqArchiveTourSourceUrl(event),
    ...(startDay ? { startsAt: `${startDay}T00:00:00+08:00` } : {}),
    ...(endDay ? { endsAt: `${endDay}T23:59:59+08:00` } : {}),
  };
  let undatedRounds = 0;
  const rounds = roundDrafts.map(({ number, boards: roundBoards }): XiangqiBroadcastRound => {
    const earliest = earliestPlayed(roundBoards.map((board) => board.details?.playedAt));
    if (!earliest) undatedRounds += 1;
    const startsAt = earliest ? asMoment(earliest) : tour.startsAt;
    return {
      schema: XIANGQI_BROADCAST_SCHEMA,
      id: `${event.slug}-r${pad2(number)}`,
      tourSlug: event.slug,
      name: `第${number}轮`,
      sourceUrl: roundPageUrl(event.dpxqId, number),
      ...(startsAt ? { startsAt } : {}),
    };
  });
  return { ok: true, event, tour, rounds, boards, undatedRounds, withheldBoards };
}

function convertArchivedGamePage(
  page: string,
  options: {
    tourSlug: string;
    tourName: string;
    roundId: string;
    roundName: string;
    boardNumber: number;
    sourceBoardId: string;
    sourceUrl: string;
  },
): { ok: true; board: XiangqiBroadcastBoard } | { ok: false; message: string } {
  let html = page;
  if (!page.includes('[DhtmlXQiFrame]')) {
    if (!looksLikeDpxqPage(page)) return { ok: false, message: 'not a dpxq game page' };
    const normalized = normalizeDpxqPageToFrameHtml(page);
    if (!normalized.ok) return { ok: false, message: `cannot normalize: ${normalized.reason}` };
    html = normalized.html;
  }
  const result = convertWxfDhtmlXqPageToSnapshot(html, options);
  if (!result.ok) {
    return { ok: false, message: result.issues.map((issue) => issue.message).join('; ') };
  }
  if (result.issues.length > 0) {
    return { ok: false, message: result.issues.map((issue) => issue.message).join('; ') };
  }
  const boards = result.snapshot.boards;
  if (boards.length !== 1) return { ok: false, message: `page holds ${boards.length} games` };
  const board = boards[0]!;
  if (board.moves.length === 0 && !board.recordWithheld) {
    return { ok: false, message: 'record has no moves' };
  }
  return { ok: true, board };
}

/** Reads the archive copy on disk: gzipped pages, decoded the way a fetch is. */
export function fileDpxqArchiveReader(dir = DEFAULT_DPXQ_ARCHIVE_DIR): DpxqArchiveReader {
  const read = (path: string): string | null => {
    let bytes: Buffer;
    try {
      bytes = gunzipSync(readFileSync(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return decodeSourceBody(new Uint8Array(bytes), null);
  };
  return {
    gameList: (tourId) => read(join(dir, 'index', `movelist_${tourId}.html.gz`)),
    gamePage: (gameId) =>
      read(
        join(dir, 'pages', String(Math.floor(Number(gameId) / 1000)), `view_m_${gameId}.html.gz`),
      ),
  };
}

type Queryable = Pick<pg.Pool, 'query'>;

type StoredTourRow = {
  slug: string;
  source_url: string | null;
  poll_mode: string;
  listed: boolean;
  payload: Record<string, unknown>;
};

/** Key-order-free JSON equality, for a payload read back from JSONB. */
function sameJson(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export type DpxqArchiveStoredState =
  | { kind: 'new' }
  | {
      kind: 'ours';
      storedBoards: number;
      newBoards: number;
      tourCurrent: boolean;
      staleRounds: number;
    }
  | { kind: 'clash'; reason: string };

/**
 * What is already stored for a planned event. A tour counts as this importer's
 * own only when its slug, its dpxq event and its polling (off) all match and
 * it holds no board the plan does not; anything else is a clash, skipped.
 */
export async function storedStateForPlan(
  db: Queryable,
  plan: Extract<DpxqArchivePlan, { ok: true }>,
  tours: StoredTourRow[],
): Promise<DpxqArchiveStoredState> {
  const { event } = plan;
  const sameEvent = tours.filter(
    (tour) =>
      tour.slug !== event.slug &&
      dpxqTourIdForTour({ slug: tour.slug, sourceUrl: tour.source_url }) === event.dpxqId,
  );
  if (sameEvent.length > 0) {
    return {
      kind: 'clash',
      reason: `dpxq ${event.dpxqId} is already relayed as ${sameEvent.map((tour) => tour.slug).join(', ')}`,
    };
  }
  const stored = tours.find((tour) => tour.slug === event.slug);
  if (!stored) return { kind: 'new' };
  const storedId = dpxqTourIdForTour({ slug: stored.slug, sourceUrl: stored.source_url });
  if (storedId !== event.dpxqId) {
    return {
      kind: 'clash',
      reason: `slug ${event.slug} is taken by ${stored.source_url ?? 'a tour with no source'}`,
    };
  }
  if (stored.poll_mode !== 'off') {
    return {
      kind: 'clash',
      reason: `slug ${event.slug} is stored with poll_mode=${stored.poll_mode} (live relay or pilot)`,
    };
  }
  const { rows: boardRows } = await db.query<{ id: string }>(
    `SELECT id FROM xiangqi_broadcast_boards WHERE tour_slug = $1`,
    [event.slug],
  );
  const planned = new Set(plan.boards.map((board) => board.id));
  const foreign = boardRows.filter((row) => !planned.has(row.id));
  if (foreign.length > 0) {
    return {
      kind: 'clash',
      reason: `${event.slug} holds ${foreign.length} boards this import would not write (${foreign[0]!.id})`,
    };
  }
  const storedIds = new Set(boardRows.map((row) => row.id));
  const { rows: roundRows } = await db.query<{ id: string; payload: Record<string, unknown> }>(
    `SELECT id, payload FROM xiangqi_broadcast_rounds WHERE tour_slug = $1`,
    [event.slug],
  );
  const storedRounds = new Map(roundRows.map((row) => [row.id, row.payload]));
  const staleRounds = plan.rounds.filter(
    (round) => !sameJson(storedRounds.get(round.id), translatedXiangqiBroadcastRound(round)),
  ).length;
  return {
    kind: 'ours',
    storedBoards: boardRows.length,
    newBoards: plan.boards.filter((board) => !storedIds.has(board.id)).length,
    tourCurrent:
      stored.listed && sameJson(stored.payload, translatedXiangqiBroadcastTour(plan.tour)),
    staleRounds,
  };
}

async function listStoredTours(db: Queryable): Promise<StoredTourRow[]> {
  const { rows } = await db.query<StoredTourRow>(
    `SELECT slug, source_url, poll_mode, listed, payload FROM xiangqi_broadcast_tours`,
  );
  return rows;
}

export type DpxqArchiveWriteResult = {
  tourWritten: boolean;
  roundsWritten: number;
  boards: Partial<Record<XiangqiBroadcastBoardUpdateStatus, number>>;
};

/** Write one planned event inside an open transaction. */
export async function writeDpxqArchivePlan(
  client: pg.PoolClient,
  plan: Extract<DpxqArchivePlan, { ok: true }>,
): Promise<DpxqArchiveWriteResult> {
  const { rows } = await client.query<StoredTourRow>(
    `SELECT slug, source_url, poll_mode, listed, payload FROM xiangqi_broadcast_tours
      WHERE slug = $1 FOR UPDATE`,
    [plan.tour.slug],
  );
  const stored = rows[0];
  const tourCurrent = stored
    ? sameJson(stored.payload, translatedXiangqiBroadcastTour(plan.tour))
    : false;
  const { rows: roundRows } = await client.query<{ id: string; payload: Record<string, unknown> }>(
    `SELECT id, payload FROM xiangqi_broadcast_rounds WHERE tour_slug = $1`,
    [plan.tour.slug],
  );
  const storedRounds = new Map(roundRows.map((row) => [row.id, row.payload]));
  const staleRounds = plan.rounds.filter(
    (round) => !sameJson(storedRounds.get(round.id), translatedXiangqiBroadcastRound(round)),
  );
  let tourWritten = false;
  if (!tourCurrent || staleRounds.length > 0) {
    await importXiangqiBroadcastPackOn(client, {
      tour: plan.tour,
      rounds: staleRounds,
      boards: [],
    });
    tourWritten = !tourCurrent;
  }
  // Archived events are listed and never polled; a fresh row defaults to
  // poll_mode 'auto', which would poll a past event's window.
  const flags = await client.query(
    `UPDATE xiangqi_broadcast_tours
        SET listed = true, poll_mode = 'off', poll_enabled = false, updated_at = now()
      WHERE slug = $1 AND (listed IS DISTINCT FROM true OR poll_mode <> 'off' OR poll_enabled)`,
    [plan.tour.slug],
  );
  if ((flags.rowCount ?? 0) > 0) tourWritten = true;
  const boards: DpxqArchiveWriteResult['boards'] = {};
  // The board update compares details by JSON text, and JSONB hands a stored
  // payload back with its keys reordered, so an unchanged archived game would
  // read as an update on every run. Skip the boards whose stored payload
  // already matches, key order aside.
  const { rows: boardRows } = await client.query<{ id: string; payload: Record<string, unknown> }>(
    `SELECT id, payload FROM xiangqi_broadcast_boards WHERE tour_slug = $1`,
    [plan.tour.slug],
  );
  const storedBoards = new Map(boardRows.map((row) => [row.id, row.payload]));
  for (const board of plan.boards) {
    if (sameJson(storedBoards.get(board.id), translatedXiangqiBroadcastBoard(board))) {
      boards.unchanged = (boards.unchanged ?? 0) + 1;
      continue;
    }
    const result = await applyXiangqiBroadcastBoardUpdateOn(client, board, {
      allowCorrection: true,
      source: board.sourceUrl,
    });
    if (!result.ok) {
      throw new Error(`board ${board.id} rejected: ${JSON.stringify(result)}`);
    }
    boards[result.status] = (boards[result.status] ?? 0) + 1;
  }
  return { tourWritten, roundsWritten: staleRounds.length, boards };
}

export type DpxqArchiveRunOptions = {
  events: DpxqArchiveEvent[];
  reader: DpxqArchiveReader;
  dryRun: boolean;
  only?: string;
  log?: (line: string) => void;
};

export type DpxqArchiveRunSummary = {
  planned: number;
  refused: Array<{ slug: string; problems: string[] }>;
  clashes: Array<{ slug: string; reason: string }>;
  imported: Array<{ slug: string; result: DpxqArchiveWriteResult }>;
  wouldImport: Array<{ slug: string; rounds: number; boards: number; newBoards: number }>;
  boards: number;
};

export async function runDpxqArchiveImport(
  options: DpxqArchiveRunOptions,
): Promise<DpxqArchiveRunSummary> {
  const log = options.log ?? ((line: string) => console.log(line));
  const events = options.only
    ? options.events.filter((event) => event.slug === options.only)
    : options.events;
  if (options.only && events.length === 0) throw new Error(`no event ${options.only} in the list`);
  const summary: DpxqArchiveRunSummary = {
    planned: 0,
    refused: [],
    clashes: [],
    imported: [],
    wouldImport: [],
    boards: 0,
  };
  const tours = await listStoredTours(getPool());
  for (const event of events) {
    const plan = planDpxqArchiveEvent(event, options.reader);
    if (!plan.ok) {
      summary.refused.push({ slug: event.slug, problems: plan.problems });
      log(`refused ${event.slug} (dpxq ${event.dpxqId}): ${plan.problems.join(' | ')}`);
      continue;
    }
    summary.planned += 1;
    const state = await storedStateForPlan(getPool(), plan, tours);
    if (state.kind === 'clash') {
      summary.clashes.push({ slug: event.slug, reason: state.reason });
      log(`clash ${event.slug}: ${state.reason}`);
      continue;
    }
    const span = `${plan.tour.startsAt?.slice(0, 10) ?? '?'}..${plan.tour.endsAt?.slice(0, 10) ?? '?'}`;
    const extras = [
      plan.undatedRounds ? `undated rounds ${plan.undatedRounds}` : '',
      plan.withheldBoards ? `withheld ${plan.withheldBoards}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    const newBoards = state.kind === 'new' ? plan.boards.length : state.newBoards;
    log(
      `${options.dryRun ? 'plan' : 'import'} ${event.slug} dpxq=${event.dpxqId} ${state.kind} ` +
        `rounds=${plan.rounds.length} boards=${plan.boards.length} new=${newBoards} ${span}` +
        `${extras ? ` (${extras})` : ''} "${event.nameEn}"`,
    );
    summary.boards += plan.boards.length;
    if (options.dryRun) {
      summary.wouldImport.push({
        slug: event.slug,
        rounds: plan.rounds.length,
        boards: plan.boards.length,
        newBoards,
      });
      continue;
    }
    const result = await withTransaction((client) => writeDpxqArchivePlan(client, plan));
    summary.imported.push({ slug: event.slug, result });
    log(
      `  wrote tour=${result.tourWritten ? 'yes' : 'no'} rounds=${result.roundsWritten} boards=${JSON.stringify(result.boards)}`,
    );
  }
  log(
    `${options.dryRun ? 'dry run' : 'done'}: ${summary.planned} events ready, ${summary.boards} boards, ` +
      `${summary.clashes.length} clashes, ${summary.refused.length} refused`,
  );
  return summary;
}

function parseArgs(argv: string[]) {
  let list: string | undefined;
  let only: string | undefined;
  let archive = DEFAULT_DPXQ_ARCHIVE_DIR;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--only') only = argv[++index];
    else if (arg === '--archive') archive = argv[++index] ?? archive;
    else if (!arg.startsWith('--') && !list) list = arg;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!list) {
    throw new Error(
      'usage: import-dpxq-archive <events.tsv> [--dry-run] [--only <slug>] [--archive <dir>]',
    );
  }
  return { list, only, archive, dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const events = parseDpxqArchiveEventList(readFileSync(args.list, 'utf-8'));
  init(url);
  try {
    const summary = await runDpxqArchiveImport({
      events,
      reader: fileDpxqArchiveReader(args.archive),
      dryRun: args.dryRun,
      ...(args.only ? { only: args.only } : {}),
    });
    if (summary.refused.length > 0) process.exitCode = 2;
  } finally {
    await close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
