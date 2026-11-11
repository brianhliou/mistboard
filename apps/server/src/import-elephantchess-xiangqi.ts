// Import ElephantChess's GPL-3.0 anonymized monthly PvP datasets into the
// historical xiangqi library.
//
// Dry run (ZIP, extracted directory, or one CSV):
//   npm run import:elephantchess-xiangqi --workspace @mistboard/server -- \
//     --input /path/to/pvp_game_moves_xiangqi_2026-06.zip
//
// Persist to local Postgres:
//   env DATABASE_URL=... npm run import:elephantchess-xiangqi --workspace @mistboard/server -- \
//     --input /path/to/pvp_game_moves_xiangqi_2026-06.zip --persist

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { parseArgs } from 'node:util';
import {
  applyXiangqiRecordMove,
  createInitialXiangqiState,
  isLegalMove,
  isStandardXiangqiLegalMove,
  pikafishUciToXiangqiSquares,
  type XiangqiMove,
  type XiangqiMoveFormat,
} from '@mistboard/game';
import pg from 'pg';
import { historicalXiangqiDigest } from './historical-xiangqi-digest.js';
import { runMigrations } from './migrate.js';
import {
  close,
  createHistoricalXiangqiImportBatch,
  finishHistoricalXiangqiImportBatch,
  type HistoricalXiangqiResult,
  type HistoricalXiangqiVisibility,
  init,
  insertHistoricalXiangqiGame,
  upsertHistoricalXiangqiSource,
} from './persistence.js';

const SOURCE_SLUG = 'elephantchess-pvp';
const SOURCE_NAME = 'ElephantChess PvP';
const SOURCE_URL = 'https://elephantchess.io/about/datasets';
const SOURCE_LICENSE = 'GPL-3.0';

const REQUIRED_COLUMNS = [
  'timestamp',
  'move_index',
  'move',
  'game_id',
  'red_player',
  'black_player',
  'red_elo_before',
  'red_elo_after',
  'black_elo_before',
  'black_elo_after',
  'time_control',
  'time_control_category',
  'rating_mode',
  'game_status',
  'outcome',
  'game_join_source',
  'cpl',
] as const;

// The July 2026 release renamed `analysis` to `move_analysis` and added an
// `engine_analysis` column beside it. Both releases are still downloadable and
// both are legitimate inputs, so the analysis column is resolved by alias
// rather than by one hardcoded name. A header carrying neither is a real
// schema break and still throws.
const ANALYSIS_COLUMN_ALIASES = ['analysis', 'move_analysis'] as const;

// Columns that exist in some releases and not others. A missing one reads as
// the empty string; it never fails the import. Keep genuinely load-bearing
// columns in REQUIRED_COLUMNS instead, so a silent schema drop stays loud.
const OPTIONAL_COLUMNS = [
  'engine_analysis',
  'red_account_age',
  'red_user_type',
  'black_account_age',
  'black_user_type',
] as const;

type ElephantChessColumn =
  | (typeof REQUIRED_COLUMNS)[number]
  | 'analysis'
  | (typeof OPTIONAL_COLUMNS)[number];

type Args = {
  input: string;
  limit: number;
  persist: boolean;
  verbose: boolean;
  visibility: HistoricalXiangqiVisibility;
};

export type CsvInput = {
  name: string;
  open(): Readable;
};

export type ElephantChessPlyRow = Record<ElephantChessColumn, string> & {
  moveIndex: number;
};

export type ElephantChessGame = {
  blackNameRaw: string | null;
  eventName: string;
  file: string;
  moveFormat: XiangqiMoveFormat;
  moves: XiangqiMove[];
  playedOn: string | null;
  redNameRaw: string | null;
  result: HistoricalXiangqiResult;
  sourceGameId: string;
  tags: Record<string, unknown>;
  termination: string | null;
};

export type ElephantChessGamePlan =
  | { ok: true; game: ElephantChessGame; rows: number }
  | { ok: false; file: string; gameId: string | null; reason: string; rows: number };

export type ElephantChessImportStats = {
  duplicates: number;
  files: number;
  games: number;
  imported: number;
  legal: number;
  ratedGames: number;
  rejected: number;
  rejectionCategories: Record<string, number>;
  rejectionSamples: Record<string, string[]>;
  resultCounts: Record<HistoricalXiangqiResult, number>;
  rows: number;
  timeControlCategories: Record<string, number>;
};

function parseCliArgs(argv: string[]): Args {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string' },
      limit: { type: 'string', default: '0' },
      persist: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      visibility: { type: 'string', default: 'public' },
    },
  });
  if (!values.input) {
    throw new Error('usage: import:elephantchess-xiangqi --input <zip|directory|csv> [--persist]');
  }
  if (!['private', 'unlisted', 'public'].includes(values.visibility ?? '')) {
    throw new Error('--visibility must be private, unlisted, or public');
  }
  return {
    input: resolve(values.input),
    limit: Math.max(0, Number.parseInt(values.limit ?? '0', 10) || 0),
    persist: Boolean(values.persist),
    verbose: Boolean(values.verbose),
    visibility: values.visibility as HistoricalXiangqiVisibility,
  };
}

// RFC 4180-style streaming records. ElephantChess's optional analysis column
// can contain commas and escaped quotes, so splitting lines is not safe.
export async function* parseCsvRecords(input: Readable): AsyncGenerator<string[]> {
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  let atFieldStart = true;

  const finishField = (): void => {
    record.push(field);
    field = '';
    atFieldStart = true;
    afterQuote = false;
  };

  for await (const chunk of input) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const char of text) {
      if (inQuotes) {
        if (char === '"') {
          inQuotes = false;
          afterQuote = true;
        } else {
          field += char;
        }
        continue;
      }

      if (afterQuote) {
        if (char === '"') {
          field += '"';
          inQuotes = true;
          afterQuote = false;
        } else if (char === ',') {
          finishField();
        } else if (char === '\n') {
          finishField();
          yield record;
          record = [];
        } else if (char !== '\r') {
          throw new Error(`unexpected character ${JSON.stringify(char)} after quoted CSV field`);
        }
        continue;
      }

      if (atFieldStart && char === '"') {
        inQuotes = true;
        atFieldStart = false;
      } else if (char === ',') {
        finishField();
      } else if (char === '\n') {
        finishField();
        yield record;
        record = [];
      } else if (char !== '\r') {
        field += char;
        atFieldStart = false;
      }
    }
  }

  if (inQuotes) throw new Error('unterminated quoted CSV field');
  if (afterQuote || field.length > 0 || record.length > 0) {
    finishField();
    yield record;
  }
}

// -1 means "this release does not carry the column". Only optional columns are
// ever allowed to land on it.
const MISSING_COLUMN = -1;

function columnIndexes(header: readonly string[]): Record<ElephantChessColumn, number> {
  const normalized = header.map((value, index) =>
    index === 0 ? value.replace(/^\uFEFF/, '') : value,
  );
  const indexes = {} as Record<ElephantChessColumn, number>;
  for (const column of REQUIRED_COLUMNS) {
    const index = normalized.indexOf(column);
    if (index < 0) throw new Error(`missing required ElephantChess CSV column: ${column}`);
    indexes[column] = index;
  }
  const analysis = ANALYSIS_COLUMN_ALIASES.map((alias) => normalized.indexOf(alias)).find(
    (index) => index >= 0,
  );
  if (analysis === undefined) {
    throw new Error(
      `missing required ElephantChess CSV column: one of ${ANALYSIS_COLUMN_ALIASES.join(', ')}`,
    );
  }
  indexes.analysis = analysis;
  for (const column of OPTIONAL_COLUMNS) {
    indexes[column] = normalized.indexOf(column);
  }
  return indexes;
}

function plyRow(
  record: readonly string[],
  indexes: Record<ElephantChessColumn, number>,
): ElephantChessPlyRow {
  const values = {} as Record<ElephantChessColumn, string>;
  for (const column of [...REQUIRED_COLUMNS, 'analysis' as const, ...OPTIONAL_COLUMNS]) {
    const index = indexes[column];
    values[column] = index === MISSING_COLUMN ? '' : (record[index] ?? '');
  }
  const moveIndex = Number.parseInt(values.move_index, 10);
  if (!Number.isInteger(moveIndex) || moveIndex < 0) {
    throw new Error(`invalid move_index ${JSON.stringify(values.move_index)}`);
  }
  if (!values.game_id) throw new Error('missing game_id');
  if (!/^[a-i][0-9][a-i][0-9]$/.test(values.move)) {
    throw new Error(`invalid ElephantChess move ${JSON.stringify(values.move)}`);
  }
  return { ...values, moveIndex };
}

function resultForOutcome(outcome: string): HistoricalXiangqiResult {
  const normalized = outcome.trim().toUpperCase();
  if (normalized.includes('RED') && normalized.includes('WIN')) return '1-0';
  if (normalized.includes('BLACK') && normalized.includes('WIN')) return '0-1';
  if (normalized.includes('DRAW') || normalized.includes('TIE')) return '1/2-1/2';
  return '*';
}

function nullableInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function playedOnForTimestamp(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  return match?.[1] ?? null;
}

function sourceMonthForFile(file: string): string | null {
  return /pvp_game_moves_xiangqi_(\d{4}-\d{2})/i.exec(file)?.[1] ?? null;
}

function anonymousName(id: string): string | null {
  return id ? `ElephantChess:${id}` : null;
}

function normalizeElephantChessMoves(
  gameId: string,
  rows: readonly ElephantChessPlyRow[],
): { moves: XiangqiMove[]; error?: string } {
  let state = createInitialXiangqiState(`elephantchess-${gameId}`);
  const moves: XiangqiMove[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const token = rows[index]!.move;
    const squares = pikafishUciToXiangqiSquares(token);
    const move = squares ? { from: squares.from, to: squares.to } : null;
    if (state.status.type !== 'playing') {
      return {
        moves,
        error: `move ${index + 1} (${token}) follows terminal ${state.status.type} status (${state.status.reason})`,
      };
    }
    if (!move || !isStandardXiangqiLegalMove(state, move)) {
      const detail = move
        ? isLegalMove(state, move)
          ? 'pseudo-legal but fails check-aware legality'
          : `not pseudo-legal; source=${JSON.stringify(state.board[move.from] ?? null)}`
        : 'invalid coordinates';
      return {
        moves,
        error: `move ${index + 1} (${token}) is not legal as uci-0indexed (${detail})`,
      };
    }
    state = applyXiangqiRecordMove(state, move);
    moves.push(move);
  }
  return { moves };
}

function buildGame(file: string, rows: readonly ElephantChessPlyRow[]): ElephantChessGamePlan {
  if (rows.length === 0)
    return { ok: false, file, gameId: null, reason: 'game has no rows', rows: 0 };
  const gameId = rows[0]!.game_id;
  const ordered = [...rows].sort((a, b) => a.moveIndex - b.moveIndex);
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index]!.moveIndex !== index) {
      return {
        ok: false,
        file,
        gameId,
        reason: `move indexes are not contiguous from zero at ply ${index}`,
        rows: rows.length,
      };
    }
  }
  const first = ordered[0]!;
  const imported = normalizeElephantChessMoves(gameId, ordered);
  if (imported.error || imported.moves.length !== ordered.length) {
    return {
      ok: false,
      file,
      gameId,
      reason: imported.error ?? 'move count changed during normalization',
      rows: rows.length,
    };
  }
  const redEloBefore = nullableInteger(first.red_elo_before);
  const redEloAfter = nullableInteger(first.red_elo_after);
  const blackEloBefore = nullableInteger(first.black_elo_before);
  const blackEloAfter = nullableInteger(first.black_elo_after);
  const analysisPlies = ordered.filter((row) => row.analysis.trim()).length;
  const cplPlies = ordered.filter((row) => row.cpl.trim()).length;
  const engineAnalysisPlies = ordered.filter((row) => row.engine_analysis.trim()).length;
  return {
    ok: true,
    rows: rows.length,
    game: {
      blackNameRaw: anonymousName(first.black_player),
      eventName: 'ElephantChess PvP',
      file,
      moveFormat: 'uci-0indexed',
      moves: imported.moves,
      playedOn: playedOnForTimestamp(first.timestamp),
      redNameRaw: anonymousName(first.red_player),
      result: resultForOutcome(first.outcome),
      sourceGameId: gameId,
      termination: first.game_status ? first.game_status.toLowerCase() : null,
      tags: {
        sourceFile: file,
        sourceMonth: sourceMonthForFile(file),
        sourceTimestamp: first.timestamp || null,
        redPlayerId: first.red_player || null,
        blackPlayerId: first.black_player || null,
        redEloBefore,
        redEloAfter,
        blackEloBefore,
        blackEloAfter,
        timeControl: first.time_control || null,
        timeControlCategory: first.time_control_category || null,
        ratingMode: first.rating_mode || null,
        gameStatus: first.game_status || null,
        rawOutcome: first.outcome || null,
        gameJoinSource: first.game_join_source || null,
        analysisPlies,
        cplPlies,
        // 0 on releases before July 2026, which carried no engine_analysis
        // column at all. Read it with sourceMonth, not on its own.
        engineAnalysisPlies,
        redUserType: first.red_user_type || null,
        blackUserType: first.black_user_type || null,
        redAccountAge: first.red_account_age || null,
        blackAccountAge: first.black_account_age || null,
      },
    },
  };
}

export async function* parseElephantChessCsv(
  input: Readable,
  file: string,
): AsyncGenerator<ElephantChessGamePlan> {
  let indexes: Record<ElephantChessColumn, number> | null = null;
  let currentGameId: string | null = null;
  let currentRows: ElephantChessPlyRow[] = [];
  const completedGameIds = new Set<string>();
  let recordNumber = 0;

  for await (const record of parseCsvRecords(input)) {
    recordNumber += 1;
    if (!indexes) {
      indexes = columnIndexes(record);
      continue;
    }
    if (record.length === 1 && record[0] === '') continue;
    let row: ElephantChessPlyRow;
    try {
      row = plyRow(record, indexes);
    } catch (error) {
      if (currentRows.length > 0) {
        yield buildGame(file, currentRows);
        completedGameIds.add(currentGameId!);
        currentRows = [];
        currentGameId = null;
      }
      yield {
        ok: false,
        file,
        gameId: null,
        reason: `CSV record ${recordNumber}: ${error instanceof Error ? error.message : String(error)}`,
        rows: 1,
      };
      continue;
    }
    if (currentGameId !== null && row.game_id !== currentGameId) {
      yield buildGame(file, currentRows);
      completedGameIds.add(currentGameId);
      currentRows = [];
      currentGameId = null;
    }
    if (completedGameIds.has(row.game_id)) {
      yield {
        ok: false,
        file,
        gameId: row.game_id,
        reason: 'game rows are not contiguous in the CSV',
        rows: 1,
      };
      continue;
    }
    currentGameId = row.game_id;
    currentRows.push(row);
  }

  if (!indexes) throw new Error(`${file}: empty CSV`);
  if (currentRows.length > 0) yield buildGame(file, currentRows);
}

function unzipEntry(zipPath: string, entry: string): Readable {
  const child = spawn('unzip', ['-p', zipPath, entry], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.on('error', (error) => child.stdout.destroy(error));
  child.on('exit', (code) => {
    if (code !== 0) child.stdout.destroy(new Error(`unzip failed for ${entry}: ${stderr.trim()}`));
  });
  return child.stdout;
}

async function zipEntries(zipPath: string): Promise<string[]> {
  return await new Promise((resolveEntries, reject) => {
    const child = spawn('unzip', ['-Z1', zipPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`could not list ZIP entries: ${stderr.trim()}`));
        return;
      }
      resolveEntries(
        stdout
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter((entry) => entry.toLowerCase().endsWith('.csv'))
          .sort(),
      );
    });
  });
}

export async function elephantChessCsvInputs(inputPath: string): Promise<CsvInput[]> {
  const resolved = resolve(inputPath);
  const inputStat = await stat(resolved);
  if (inputStat.isDirectory()) {
    return (await readdir(resolved))
      .filter((file) => extname(file).toLowerCase() === '.csv')
      .sort()
      .map((file) => ({ name: file, open: () => createReadStream(join(resolved, file)) }));
  }
  if (extname(resolved).toLowerCase() === '.csv') {
    return [{ name: basename(resolved), open: () => createReadStream(resolved) }];
  }
  if (extname(resolved).toLowerCase() === '.zip') {
    const entries = await zipEntries(resolved);
    return entries.map((entry) => ({ name: entry, open: () => unzipEntry(resolved, entry) }));
  }
  throw new Error('--input must be a CSV, a ZIP containing CSV files, or a directory of CSV files');
}

async function inputHash(inputs: readonly CsvInput[]): Promise<string> {
  const hash = createHash('sha256');
  for (const input of inputs) {
    hash.update(input.name).update('\0');
    for await (const chunk of input.open()) hash.update(chunk as Uint8Array);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function emptyStats(files: number): ElephantChessImportStats {
  return {
    duplicates: 0,
    files,
    games: 0,
    imported: 0,
    legal: 0,
    ratedGames: 0,
    rejected: 0,
    rejectionCategories: {},
    rejectionSamples: {},
    resultCounts: { '1-0': 0, '0-1': 0, '1/2-1/2': 0, '*': 0 },
    rows: 0,
    timeControlCategories: {},
  };
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function rejectionCategory(reason: string): string {
  if (reason.startsWith('CSV record')) return 'invalid_csv_row';
  if (reason.includes('not contiguous')) return 'move_index_gap';
  if (reason.includes('not legal as')) return 'illegal_move';
  if (reason.includes('no notation codec recognized')) return 'unknown_move_format';
  if (reason.includes('move count changed')) return 'move_count_changed';
  return 'other';
}

function recordRejection(stats: ElephantChessImportStats, reason: string): void {
  const category = rejectionCategory(reason);
  increment(stats.rejectionCategories, category);
  const samples = stats.rejectionSamples[category] ?? [];
  if (samples.length < 5 && !samples.includes(reason)) samples.push(reason);
  stats.rejectionSamples[category] = samples;
}

export async function scanElephantChessInputs(
  inputs: readonly CsvInput[],
  options: {
    limit?: number;
    onGame?: (game: ElephantChessGame) => Promise<void>;
    verbose?: boolean;
  } = {},
): Promise<ElephantChessImportStats> {
  const stats = emptyStats(inputs.length);
  const gameDigests = new Set<string>();
  const limit = Math.max(0, options.limit ?? 0);

  for (const input of inputs) {
    for await (const plan of parseElephantChessCsv(input.open(), input.name)) {
      stats.games += 1;
      stats.rows += plan.rows;
      if (!plan.ok) {
        stats.rejected += 1;
        recordRejection(stats, plan.reason);
        if (options.verbose)
          console.log(`reject ${input.name} ${plan.gameId ?? '-'}: ${plan.reason}`);
      } else {
        stats.legal += 1;
        stats.resultCounts[plan.game.result] += 1;
        const category = String(plan.game.tags.timeControlCategory ?? 'unknown') || 'unknown';
        increment(stats.timeControlCategories, category);
        if (plan.game.tags.ratingMode === 'rated') stats.ratedGames += 1;
        const digest = historicalXiangqiDigest(plan.game);
        if (gameDigests.has(digest)) {
          stats.duplicates += 1;
        } else {
          gameDigests.add(digest);
          await options.onGame?.(plan.game);
          if (options.onGame) stats.imported += 1;
        }
      }
      if (limit > 0 && stats.games >= limit) return stats;
    }
  }
  return stats;
}

async function preparePersistence(databaseUrl: string): Promise<void> {
  const migrationClient = new pg.Client({ connectionString: databaseUrl });
  await migrationClient.connect();
  try {
    const applied = await runMigrations(migrationClient);
    if (applied.length > 0) console.log(`migrations applied: ${applied.join(', ')}`);
  } finally {
    await migrationClient.end();
  }
  init(databaseUrl);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const inputs = await elephantChessCsvInputs(args.input);
  if (inputs.length === 0) throw new Error('input contains no CSV files');
  const hash = await inputHash(inputs);
  console.log(
    `ElephantChess xiangqi import: files=${inputs.length} input=${hash.slice(0, 12)} ` +
      `visibility=${args.visibility} license=${SOURCE_LICENSE}`,
  );

  let stats: ElephantChessImportStats;
  if (!args.persist) {
    stats = await scanElephantChessInputs(inputs, { limit: args.limit, verbose: args.verbose });
  } else {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required with --persist');
    await preparePersistence(databaseUrl);
    try {
      const source = await upsertHistoricalXiangqiSource({
        slug: SOURCE_SLUG,
        name: SOURCE_NAME,
        sourceType: 'platform-export',
        sourceUrl: SOURCE_URL,
        license: SOURCE_LICENSE,
        licenseStatus: 'cleared',
        notes: 'Anonymized games played on ElephantChess; monthly export supplied under GPL-3.0.',
      });
      const batch = await createHistoricalXiangqiImportBatch({
        sourceId: source.id,
        inputUri: args.input,
        inputSha256: hash,
      });
      try {
        stats = await scanElephantChessInputs(inputs, {
          limit: args.limit,
          verbose: args.verbose,
          onGame: async (game) => {
            await insertHistoricalXiangqiGame({
              sourceId: source.id,
              importBatchId: batch.id,
              sourceGameId: game.sourceGameId,
              eventName: game.eventName,
              playedOn: game.playedOn,
              redNameRaw: game.redNameRaw,
              blackNameRaw: game.blackNameRaw,
              result: game.result,
              termination: game.termination,
              moveFormat: game.moveFormat,
              moves: game.moves,
              tags: game.tags,
              visibility: args.visibility,
            });
          },
        });
        await finishHistoricalXiangqiImportBatch(batch.id, 'completed', stats);
      } catch (error) {
        await finishHistoricalXiangqiImportBatch(batch.id, 'failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } finally {
      await close();
    }
  }
  console.log(JSON.stringify({ kind: 'elephantchess-xiangqi-import', ...stats }));
  if (!args.persist)
    console.log('dry run; pass --persist with DATABASE_URL to write archive rows.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
