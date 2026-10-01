// The /data page's downloads: every closed month's finished games, one gzip
// file per variant and format, plus one file per imported collection.
//
// Hosting (decided 2026-10-01): no object store and no cron. A file is built the
// first time someone asks for it, straight from the games table, gzipped, and
// stored once in Postgres (game_data_files, migration 153) with its sha256 and
// size; every later request is served from that row with immutable cache
// headers. Only closed months are offered, so a stored file never goes stale.
// Move the bytes to Cloudflare R2 when one month's file passes about 100 MB, or
// when download bandwidth starts to cost money. The file key is already the
// object path.
//
// Every line is the game's single-game export: each game goes through
// resolveGameExport, the function behind GET /api/games/:id/export.{json,pgn},
// with the record and event log that route loads. There is no second
// serializer, so a JSONL line equals that game's export.json byte for byte, and
// a PGN game equals its export.pgn.

import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createGzip } from 'node:zlib';
import {
  CANONICAL_VARIANT_ORDER,
  exportFormatsForVariant,
  GAME_EXPORT_FORMATS,
  type GameExportFormat,
  isGameExportVariant,
} from '@mistboard/game';
import { LICENSE, SCHEMA_VERSION } from './game-export-shared.js';
import { resolveGameExport } from './game-export-tenant.js';
import type { RecentEveGameRecord } from './persistence.js';
import type {
  CollectionRow,
  NewDataFile,
  PublishedMonthCount,
  StoredDataFile,
  StoredDataFileMeta,
} from './persistence-game-data.js';
import { isTenantGameOrigin, type TenantGameOrigin } from './variant-tenant/tenant.js';

export type DataFileFormat = 'jsonl' | 'pgn';

const EXPORT_FORMAT_FOR: Record<DataFileFormat, GameExportFormat> = { jsonl: 'json', pgn: 'pgn' };
const FILE_FORMAT_FOR: Record<GameExportFormat, DataFileFormat> = { json: 'jsonl', pgn: 'pgn' };

function canonicalIndex(variant: string): number {
  const index = (CANONICAL_VARIANT_ORDER as readonly string[]).indexOf(variant);
  return index === -1 ? CANONICAL_VARIANT_ORDER.length : index;
}

/**
 * Export-table variants /data does not offer yet, with the reason a download
 * answers. A hidden-piece game's export names the squares a piece moved from or
 * was turned over on, but neither the deal nor what each reveal turned out to
 * be, so nobody can replay it (#484). Landing #484 removes these entries; the
 * per-game export route is unaffected.
 */
export const DATA_WITHHELD_VARIANTS: Readonly<Record<string, string>> = {
  jieqi: 'hidden_piece_format_pending',
  banqi: 'hidden_piece_format_pending',
  'jungle-flip': 'hidden_piece_format_pending',
};

function isWithheldVariant(variant: string): boolean {
  return Object.hasOwn(DATA_WITHHELD_VARIANTS, variant);
}

/** The variants a monthly file can be built for: the single-game export table
 *  minus DATA_WITHHELD_VARIANTS, in the site's rail order (play menu, rules,
 *  /games). The all-variants file holds exactly these. */
export const DATA_VARIANTS: readonly string[] = Object.keys(GAME_EXPORT_FORMATS)
  .filter((variant) => !isWithheldVariant(variant))
  .sort((a, b) => canonicalIndex(a) - canonicalIndex(b));

/**
 * The one monthly key that is not a variant: every variant's games of the month
 * in one file. Each JSONL line already names its variant; there is no mixed PGN
 * (a PGN reader takes one game type per file).
 */
export const ALL_VARIANTS_KEY = 'all';

/** File formats for a variant, in the export table's order (PGN first where it exists). */
export function dataFormatsForVariant(variant: string): DataFileFormat[] {
  if (variant === ALL_VARIANTS_KEY) return ['jsonl'];
  return exportFormatsForVariant(variant).map((format) => FILE_FORMAT_FOR[format]);
}

/** A monthly file's variant key: an offered export-table variant, or 'all'. Nothing else. */
export function isDataVariantKey(variant: string): boolean {
  return (
    variant === ALL_VARIANTS_KEY || (isGameExportVariant(variant) && !isWithheldVariant(variant))
  );
}

// ── Months ───────────────────────────────────────────────────────────────────

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type MonthRange = { month: string; from: Date; to: Date };

export function parseMonth(month: string): MonthRange | null {
  const match = MONTH_RE.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return {
    month,
    from: new Date(Date.UTC(year, index, 1)),
    to: new Date(Date.UTC(year, index + 1, 1)),
  };
}

/** The first instant of the current UTC month: every month before it is closed. */
export function currentMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function isClosedMonth(range: MonthRange, now: Date): boolean {
  return range.to.getTime() <= currentMonthStart(now).getTime();
}

// ── Keys, paths and file names ───────────────────────────────────────────────

export const DATA_API_PREFIX = '/api/data';

export type DataFileTarget =
  | { kind: 'monthly'; month: string; variant: string; format: DataFileFormat }
  | { kind: 'collection'; corpusId: string; format: DataFileFormat };

export function dataFileKey(target: DataFileTarget): string {
  return target.kind === 'monthly'
    ? `monthly/${target.month}/${target.variant}.${target.format}.gz`
    : `collections/${target.corpusId}.${target.format}.gz`;
}

export function dataFilePath(target: DataFileTarget): string {
  return `${DATA_API_PREFIX}/${dataFileKey(target)}`;
}

/** What the browser saves the file as, lichess style: mistboard_<what>_<month>. */
export function dataFileName(target: DataFileTarget): string {
  return target.kind === 'monthly'
    ? `mistboard_${target.variant}_${target.month}.${target.format}.gz`
    : `mistboard_${target.corpusId}.${target.format}.gz`;
}

const SLUG = '[a-z0-9][a-z0-9-]{0,119}';
const MONTHLY_PATH_RE = new RegExp(
  `^${DATA_API_PREFIX}/monthly/([^/]+)/(${SLUG})\\.(jsonl|pgn)\\.gz$`,
);
const COLLECTION_PATH_RE = new RegExp(
  `^${DATA_API_PREFIX}/collections/(${SLUG})\\.(jsonl|pgn)\\.gz$`,
);

export type ParsedDataPath =
  | { ok: true; target: DataFileTarget }
  | { ok: false; status: 400 | 404; error: string };

/**
 * A download path, shape only: the month must be a real YYYY-MM (else 400), and
 * a monthly variant must be in the export table, or 'all', with that format
 * (else 404, fail closed: no variant falls back to another's exporter), and not
 * withheld (404 naming why, DATA_WITHHELD_VARIANTS). Whether the month
 * is closed and has games, or the collection exists, is the route's question.
 */
export function parseDataFilePath(pathname: string): ParsedDataPath | null {
  const monthly = MONTHLY_PATH_RE.exec(pathname);
  if (monthly) {
    const [, month, variant, format] = monthly as unknown as [
      string,
      string,
      string,
      DataFileFormat,
    ];
    if (!parseMonth(month)) return { ok: false, status: 400, error: 'invalid_month' };
    if (isWithheldVariant(variant)) {
      return { ok: false, status: 404, error: DATA_WITHHELD_VARIANTS[variant]! };
    }
    if (!isDataVariantKey(variant)) return { ok: false, status: 404, error: 'unknown_variant' };
    if (!dataFormatsForVariant(variant).includes(format)) {
      return { ok: false, status: 404, error: 'format_not_available' };
    }
    return { ok: true, target: { kind: 'monthly', month, variant, format } };
  }
  const collection = COLLECTION_PATH_RE.exec(pathname);
  if (collection) {
    const [, corpusId, format] = collection as unknown as [string, string, DataFileFormat];
    return { ok: true, target: { kind: 'collection', corpusId, format } };
  }
  if (pathname.startsWith(`${DATA_API_PREFIX}/monthly/`)) {
    return { ok: false, status: 404, error: 'not_found' };
  }
  if (pathname.startsWith(`${DATA_API_PREFIX}/collections/`)) {
    return { ok: false, status: 404, error: 'not_found' };
  }
  return null;
}

// ── Listing ──────────────────────────────────────────────────────────────────

export type DataFileEntry = {
  format: DataFileFormat;
  path: string;
  fileName: string;
  /** Games the file holds: the stored count once built, the live count before. */
  games: number;
  /** Null until someone has downloaded the file once. */
  built: { bytes: number; sha256: string; builtAt: string } | null;
};

export type DataMonthVariant = { variant: string; games: number; files: DataFileEntry[] };
export type DataMonth = {
  month: string;
  games: number;
  /** The mixed file of every variant's games that month (JSONL only). */
  files: DataFileEntry[];
  variants: DataMonthVariant[];
};

export type DataCollection = {
  id: string;
  event: string;
  credit: TenantGameOrigin['credit'] | null;
  variant: string;
  games: number;
  firstStartedAt: string;
  lastEndedAt: string;
  files: DataFileEntry[];
};

export type DataListing = {
  license: string;
  schemaVersion: string;
  /** Variants with at least one listed game, in the site's rail order. */
  variants: string[];
  /** Closed months with games, newest first. */
  months: DataMonth[];
  collections: DataCollection[];
};

export type ListedCollection = {
  corpusId: string;
  variant: string;
  games: number;
  origin: TenantGameOrigin;
  firstStartedAt: Date;
  lastEndedAt: Date;
};

/** Collections the page can offer: one variant, a valid import origin. */
export function listableCollections(rows: readonly CollectionRow[]): ListedCollection[] {
  const listed: ListedCollection[] = [];
  for (const row of rows) {
    if (row.variants.length !== 1) continue;
    const variant = row.variants[0]!;
    if (!isGameExportVariant(variant)) continue;
    if (!isTenantGameOrigin(row.origin)) continue;
    listed.push({
      corpusId: row.corpusId,
      variant,
      games: row.games,
      origin: row.origin,
      firstStartedAt: row.firstStartedAt,
      lastEndedAt: row.lastEndedAt,
    });
  }
  return listed;
}

function fileEntry(
  target: DataFileTarget,
  games: number,
  stored: ReadonlyMap<string, StoredDataFileMeta>,
): DataFileEntry {
  const built = stored.get(dataFileKey(target));
  return {
    format: target.format,
    path: dataFilePath(target),
    fileName: dataFileName(target),
    games: built ? built.gameCount : games,
    built: built
      ? { bytes: built.byteSize, sha256: built.sha256, builtAt: built.builtAt.toISOString() }
      : null,
  };
}

export function buildDataListing(input: {
  counts: readonly PublishedMonthCount[];
  stored: readonly StoredDataFileMeta[];
  collections: readonly ListedCollection[];
  now: Date;
}): DataListing {
  const stored = new Map(input.stored.map((file) => [file.key, file]));
  const byMonth = new Map<string, DataMonthVariant[]>();
  const seenVariants = new Set<string>();
  for (const count of input.counts) {
    const range = parseMonth(count.month);
    if (!range || !isClosedMonth(range, input.now)) continue;
    if (!isDataVariantKey(count.variant) || count.variant === ALL_VARIANTS_KEY) continue;
    if (count.games <= 0) continue;
    seenVariants.add(count.variant);
    const files = dataFormatsForVariant(count.variant).map((format) =>
      fileEntry(
        { kind: 'monthly', month: count.month, variant: count.variant, format },
        count.games,
        stored,
      ),
    );
    const list = byMonth.get(count.month) ?? [];
    list.push({ variant: count.variant, games: count.games, files });
    byMonth.set(count.month, list);
  }
  const order = (variant: string) => DATA_VARIANTS.indexOf(variant);
  const months: DataMonth[] = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([month, variants]) => {
      variants.sort((a, b) => order(a.variant) - order(b.variant));
      const games = variants.reduce((sum, v) => sum + v.games, 0);
      const files = dataFormatsForVariant(ALL_VARIANTS_KEY).map((format) =>
        fileEntry({ kind: 'monthly', month, variant: ALL_VARIANTS_KEY, format }, games, stored),
      );
      return { month, games, files, variants };
    });
  const collections: DataCollection[] = input.collections.map((collection) => ({
    id: collection.corpusId,
    event: collection.origin.event,
    credit: collection.origin.credit ?? null,
    variant: collection.variant,
    games: collection.games,
    firstStartedAt: collection.firstStartedAt.toISOString(),
    lastEndedAt: collection.lastEndedAt.toISOString(),
    files: dataFormatsForVariant(collection.variant).map((format) =>
      fileEntry(
        { kind: 'collection', corpusId: collection.corpusId, format },
        collection.games,
        stored,
      ),
    ),
  }));
  return {
    license: LICENSE,
    schemaVersion: SCHEMA_VERSION,
    variants: DATA_VARIANTS.filter((variant) => seenVariants.has(variant)),
    months,
    collections,
  };
}

// ── Building ─────────────────────────────────────────────────────────────────

export type BuildDeps = {
  getGameSummaries(roomIds: readonly string[]): Promise<Map<string, RecentEveGameRecord>>;
  loadRoomsEvents(roomIds: readonly string[]): Promise<Map<string, readonly unknown[]>>;
  /** The build's clock for its time slices (milliseconds); tests inject one. */
  now?: () => number;
};

export type BuiltDataFile = {
  content: Buffer;
  gameCount: number;
  byteSize: number;
  sha256: string;
  skipped: string[];
};

// Small enough that a batch of long fog games stays a few MB in memory.
const BUILD_BATCH = 100;

// The build runs in the live web process: replaying a game is synchronous CPU
// work, and a month is thousands of games. Without a yield, the first download
// of 2026-09/all.jsonl.gz held the event loop for seconds between database
// reads (event-loop lag p99 622 ms on prod, 2026-10-01), stalling every live
// game's moves and clocks. Hand the loop back whenever one slice has run this
// long; a setImmediate costs microseconds, so the build itself is no slower.
export const BUILD_SLICE_MS = 10;

// Uncompressed text handed to the gzip stream at a time. zlib compresses on the
// libuv threadpool, so the main thread only copies the string.
const GZIP_WRITE_BYTES = 1 << 20;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Concatenate each room's single-game export, in the order given. JSONL: one
 * export.json body per line. PGN: export.pgn bodies separated by a blank line.
 * A room whose export is not a 200 (its log no longer replays as a finished
 * game of its variant) is skipped and named, never patched up here.
 *
 * Never blocks the event loop for more than about one slice plus one game:
 * replay yields every BUILD_SLICE_MS, and the gzip and sha256 run as a stream
 * beside it, off the main thread.
 */
export async function buildDataFileContent(
  roomIds: readonly string[],
  format: DataFileFormat,
  deps: BuildDeps,
): Promise<BuiltDataFile> {
  const now = deps.now ?? (() => performance.now());
  const exportFormat = EXPORT_FORMAT_FOR[format];
  const gzipStream = createGzip({ level: 9 });
  const chunks: Buffer[] = [];
  const hash = createHash('sha256');
  gzipStream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    hash.update(chunk);
  });
  const ended = once(gzipStream, 'end');
  // Observed so an error before the final await is not an unhandled rejection.
  ended.catch(() => undefined);
  let pending: string[] = [];
  let pendingBytes = 0;
  const flush = async () => {
    if (pending.length === 0) return;
    const text = pending.join('');
    pending = [];
    pendingBytes = 0;
    if (!gzipStream.write(text)) await once(gzipStream, 'drain');
  };
  const skipped: string[] = [];
  let gameCount = 0;
  try {
    for (let start = 0; start < roomIds.length; start += BUILD_BATCH) {
      const batch = roomIds.slice(start, start + BUILD_BATCH);
      const [summaries, eventsByRoom] = await Promise.all([
        deps.getGameSummaries(batch),
        deps.loadRoomsEvents(batch),
      ]);
      // The reads resolve in the poll phase, and a setImmediate queued from
      // there runs in the same turn's check phase, skipping the timers phase:
      // the batch's first two slices would run back to back. Hop to the check
      // phase first, so every later yield crosses a full turn (timers, I/O).
      await yieldToEventLoop();
      let sliceStart = now();
      for (const roomId of batch) {
        if (now() - sliceStart >= BUILD_SLICE_MS) {
          await yieldToEventLoop();
          sliceStart = now();
        }
        const resolved = resolveGameExport({
          roomId,
          format: exportFormat,
          summary: summaries.get(roomId) ?? null,
          events: eventsByRoom.get(roomId) ?? null,
        });
        if (resolved.status !== 200) {
          skipped.push(roomId);
          continue;
        }
        // A JSON body has no newline, so this ends the line; a PGN body already
        // ends in one, so this is the blank line between two games.
        const part = `${resolved.body}\n`;
        pending.push(part);
        pendingBytes += part.length;
        gameCount += 1;
        if (pendingBytes >= GZIP_WRITE_BYTES) await flush();
      }
    }
    await flush();
    gzipStream.end();
    await ended;
  } catch (error) {
    gzipStream.destroy();
    throw error;
  }
  const content = Buffer.concat(chunks);
  return {
    content,
    gameCount,
    byteSize: content.byteLength,
    sha256: hash.digest('hex'),
    skipped,
  };
}

export class EmptyDataFileError extends Error {
  constructor(key: string) {
    super(`data file ${key} has no exportable games`);
    this.name = 'EmptyDataFileError';
  }
}

export type EnsureDeps = BuildDeps & {
  getStoredDataFile(key: string): Promise<StoredDataFile | null>;
  insertDataFileIfAbsent(file: NewDataFile): Promise<boolean>;
  log?: (message: string) => void;
};

// One build at a time per process: a build reads every game of a month into
// memory, and the first download of a new month can arrive as a burst. A
// second request for the SAME file joins the build already running instead of
// queueing a duplicate.
let buildQueue: Promise<unknown> = Promise.resolve();
const inFlight = new Map<string, Promise<StoredDataFile>>();

function enqueueBuild<T>(task: () => Promise<T>): Promise<T> {
  const run = buildQueue.then(task, task);
  buildQueue = run.catch(() => undefined);
  return run;
}

/**
 * The stored file for a target, building and storing it first if this is its
 * first request. Idempotent: concurrent first requests in one process share one
 * build; across processes the insert is first-writer-wins, and every caller
 * serves the stored row, so the bytes and sha256 never differ between two
 * downloads of one file.
 */
export function ensureDataFile(
  target: DataFileTarget,
  roomIds: () => Promise<readonly string[]>,
  deps: EnsureDeps,
): Promise<StoredDataFile> {
  const key = dataFileKey(target);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const job = (async () => {
    const existing = await deps.getStoredDataFile(key);
    if (existing) return existing;
    return enqueueBuild(async () => {
      const again = await deps.getStoredDataFile(key);
      if (again) return again;
      const built = await buildDataFileContent(await roomIds(), target.format, deps);
      if (built.skipped.length > 0) {
        deps.log?.(
          `[data] ${key}: skipped ${built.skipped.length} game(s) whose export failed: ${built.skipped.slice(0, 20).join(', ')}`,
        );
      }
      // Nothing exported (every log failed its export): store nothing, so a
      // fixed log can still produce the file later, and answer 404.
      if (built.gameCount === 0) throw new EmptyDataFileError(key);
      await deps.insertDataFileIfAbsent({
        key,
        kind: target.kind,
        format: target.format,
        gameCount: built.gameCount,
        byteSize: built.byteSize,
        sha256: built.sha256,
        content: built.content,
      });
      const stored = await deps.getStoredDataFile(key);
      if (!stored) throw new Error(`data file ${key} missing after insert`);
      return stored;
    });
  })();
  inFlight.set(key, job);
  const clear = () => {
    if (inFlight.get(key) === job) inFlight.delete(key);
  };
  job.then(clear, clear);
  return job;
}
