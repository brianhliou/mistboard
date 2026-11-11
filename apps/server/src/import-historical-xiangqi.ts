// Import historical standard-xiangqi games into the compact archive tables.
//
// Dry run:
//   npm run import:historical-xiangqi --workspace @mistboard/server -- \
//     --dir <folder> --source-slug famous-xiangqi --source-name "Famous Xiangqi"
//
// Persist:
//   env DATABASE_URL=... npm run import:historical-xiangqi --workspace @mistboard/server -- \
//     --dir <folder> --source-slug famous-xiangqi --source-name "Famous Xiangqi" \
//     --license-status cleared --source-license "permission from ..." --persist
//
// Clearing a source is the same command with --license-status cleared: the
// source upsert flips its license_status, and re-importing the same files
// updates the existing game rows (content hash) instead of duplicating them.
// DPXQ (东萍象棋网), cleared 2026-10-28 on the operator's standing yes, on the
// condition that every puzzle credits it with an http link to the original
// game (packages/game/src/puzzles-xiangqi-attribution.ts enforces that):
//
//   env DATABASE_URL=... npm run import:historical-xiangqi --workspace @mistboard/server -- \
//     --dir ../xiangqi-corpus/dpxq-viewm --source-slug dpxq-archive-test \
//     --source-name "东萍象棋网 (DPXQ)" --source-url http://www.dpxq.com/ \
//     --license-status cleared \
//     --source-license "Operator permission: mining with credit and an http link to each game" \
//     --persist
//
// Each game keeps its own [DhtmlXQ_source_url] as source_url, the link the
// credit points at.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { importXiangqiPaste, type XiangqiMove, type XiangqiMoveFormat } from '@mistboard/game';
import pg from 'pg';
import { runMigrations } from './migrate.js';
import {
  close,
  createHistoricalXiangqiImportBatch,
  finishHistoricalXiangqiImportBatch,
  type HistoricalXiangqiResult,
  type HistoricalXiangqiSourceLicenseStatus,
  type HistoricalXiangqiVisibility,
  init,
  insertHistoricalXiangqiGame,
  upsertHistoricalXiangqiSource,
} from './persistence.js';

type Args = {
  dir: string;
  limit: number;
  persist: boolean;
  sourceLicense: string | null;
  sourceLicenseStatus: HistoricalXiangqiSourceLicenseStatus;
  sourceName: string;
  sourceNotes: string | null;
  sourceSlug: string;
  sourceType: string;
  sourceUrl: string | null;
  visibility: HistoricalXiangqiVisibility | null;
};

type ParsedHistoricalXiangqiGame = {
  blackNameRaw: string | null;
  eventName: string | null;
  file: string;
  moveFormat: XiangqiMoveFormat;
  moves: XiangqiMove[];
  playedOn: string | null;
  redNameRaw: string | null;
  result: HistoricalXiangqiResult;
  sourceGameId: string;
  sourceUrl: string | null;
  tags: Record<string, unknown>;
};

type ImportPlan =
  | { ok: true; game: ParsedHistoricalXiangqiGame }
  | { ok: false; file: string; reason: string };

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tagValue(raw: string, name: string): string {
  const dhtml = raw.match(new RegExp(`\\[DhtmlXQ_${name}\\]([^\\[]*)`, 'i'));
  if (dhtml) return dhtml[1]!.trim();
  const pgn = raw.match(new RegExp(`\\[${name}\\s+"([^"]*)"\\]`, 'i'));
  return pgn ? pgn[1]!.trim() : '';
}

function parseResult(rawResult: string): HistoricalXiangqiResult {
  if (!rawResult) return '*';
  if (/^(1-0|红胜|紅勝|红方胜|紅方勝|红先胜|紅先勝|黑负|黑負)$/i.test(rawResult)) return '1-0';
  if (/^(0-1|黑胜|黑勝|黑方胜|黑方勝|红负|紅負)$/i.test(rawResult)) return '0-1';
  if (/^(1\/2-1\/2|和|和棋|draw)$/i.test(rawResult)) return '1/2-1/2';
  if (/[红紅].*[胜勝]|黑.*[负負]/.test(rawResult)) return '1-0';
  if (/黑.*[胜勝]|[红紅].*[负負]/.test(rawResult)) return '0-1';
  if (/和|draw/i.test(rawResult)) return '1/2-1/2';
  return '*';
}

function parsePlayedOn(rawDate: string): string | null {
  if (!rawDate) return null;
  const normalized = rawDate.replace(/[./]/g, '-');
  // dpxq date tags often carry a time ("2026-04-01 09:00"); keep the date part.
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(normalized);
  if (!match) return null;
  const y = match[1]!;
  const m = match[2]!.padStart(2, '0');
  const d = match[3]!.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLicenseStatus(value: string | undefined): HistoricalXiangqiSourceLicenseStatus {
  if (!value) return 'unknown';
  if (
    value === 'unknown' ||
    value === 'test-only' ||
    value === 'permission-requested' ||
    value === 'cleared' ||
    value === 'restricted'
  ) {
    return value;
  }
  console.error(
    'invalid --license-status; expected unknown, test-only, permission-requested, cleared, or restricted',
  );
  process.exit(1);
}

function parseVisibility(value: string | undefined): HistoricalXiangqiVisibility | null {
  if (!value) return null;
  if (value === 'private' || value === 'unlisted' || value === 'public') return value;
  console.error('invalid --visibility; expected private, unlisted, or public');
  process.exit(1);
}

function defaultVisibilityForSource(
  licenseStatus: HistoricalXiangqiSourceLicenseStatus,
): HistoricalXiangqiVisibility {
  return licenseStatus === 'cleared' ? 'public' : 'unlisted';
}

function importVisibility(args: Args): HistoricalXiangqiVisibility {
  return args.visibility ?? defaultVisibilityForSource(args.sourceLicenseStatus);
}

function validateImportRights(args: Args): void {
  const visibility = importVisibility(args);
  if (args.sourceLicenseStatus === 'cleared' && !args.sourceLicense?.trim()) {
    console.error('--source-license is required when --license-status=cleared');
    process.exit(1);
  }
  if (visibility === 'public' && args.sourceLicenseStatus !== 'cleared') {
    console.error(
      `refusing public import for --license-status=${args.sourceLicenseStatus}; use --visibility unlisted or clear source rights first`,
    );
    process.exit(1);
  }
}

function parseCliArgs(argv: string[]): Args {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string' },
      limit: { type: 'string', default: '0' },
      persist: { type: 'boolean', default: false },
      'license-status': { type: 'string', default: 'unknown' },
      'source-license': { type: 'string' },
      'source-name': { type: 'string' },
      'source-notes': { type: 'string' },
      'source-slug': { type: 'string' },
      'source-type': { type: 'string', default: 'scrape' },
      'source-url': { type: 'string' },
      visibility: { type: 'string' },
    },
  });
  if (!values.dir || !values['source-slug'] || !values['source-name']) {
    console.error(
      'usage: import-historical-xiangqi --dir <folder> --source-slug <slug> --source-name <name> [--persist]',
    );
    process.exit(1);
  }
  return {
    dir: values.dir,
    limit: Math.max(0, Number.parseInt(values.limit ?? '0', 10) || 0),
    persist: Boolean(values.persist),
    sourceLicenseStatus: parseLicenseStatus(values['license-status']),
    sourceLicense: values['source-license'] ?? null,
    sourceName: values['source-name'],
    sourceNotes: values['source-notes'] ?? null,
    sourceSlug: values['source-slug'],
    sourceType: values['source-type'] ?? 'scrape',
    sourceUrl: values['source-url'] ?? null,
    visibility: parseVisibility(values.visibility),
  };
}

function supportedGameFile(file: string): boolean {
  return ['.dhtmlxq', '.txt', '.pgn', '.wxf'].includes(extname(file).toLowerCase());
}

export function parseHistoricalGame(file: string, raw: string): ImportPlan {
  // Paste-aware on purpose: `.pgn` is an accepted extension here, and a real
  // PGN carries a tag block that the bare notation sniffer cannot read past.
  const imported = importXiangqiPaste(raw);
  if (imported.error || !imported.format || imported.moves.length === 0) {
    return { ok: false, file, reason: imported.error ?? 'no moves imported' };
  }
  const title = tagValue(raw, 'title');
  const eventName = tagValue(raw, 'event') || title || null;
  const redNameRaw = tagValue(raw, 'red') || tagValue(raw, 'White') || null;
  const blackNameRaw = tagValue(raw, 'black') || tagValue(raw, 'Black') || null;
  const rawDate = tagValue(raw, 'date') || tagValue(raw, 'Date');
  const rawResult = tagValue(raw, 'result') || tagValue(raw, 'Result');
  return {
    ok: true,
    game: {
      blackNameRaw,
      eventName,
      file,
      moveFormat: imported.format,
      moves: imported.moves,
      playedOn: parsePlayedOn(rawDate),
      redNameRaw,
      result: parseResult(rawResult),
      sourceGameId: basename(file, extname(file)),
      sourceUrl: tagValue(raw, 'source_url') || null,
      tags: {
        rawFile: file,
        ...(title ? { title } : {}),
        ...(rawDate ? { rawDate } : {}),
        ...(rawResult ? { rawResult } : {}),
      },
    },
  };
}

async function buildImportPlans(args: Args): Promise<{ inputHash: string; plans: ImportPlan[] }> {
  const dir = resolve(args.dir);
  const files = (await readdir(dir)).filter(supportedGameFile).sort();
  const bounded = args.limit > 0 ? files.slice(0, args.limit) : files;
  const plans: ImportPlan[] = [];
  const hash = createHash('sha256');
  for (const file of bounded) {
    const raw = await readFile(join(dir, file), 'utf-8');
    hash.update(file).update('\0').update(raw).update('\0');
    plans.push(parseHistoricalGame(file, raw));
  }
  return { inputHash: hash.digest('hex'), plans };
}

async function persistPlans(args: Args, inputHash: string, plans: ImportPlan[]): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required with --persist');
    process.exit(1);
  }

  const migrationClient = new pg.Client({ connectionString: databaseUrl });
  await migrationClient.connect();
  try {
    const applied = await runMigrations(migrationClient);
    if (applied.length > 0) console.log(`migrations applied: ${applied.join(', ')}`);
  } finally {
    await migrationClient.end();
  }

  init(databaseUrl);
  try {
    const source = await upsertHistoricalXiangqiSource({
      slug: args.sourceSlug,
      name: args.sourceName,
      sourceType: args.sourceType,
      sourceUrl: args.sourceUrl,
      license: args.sourceLicense,
      licenseStatus: args.sourceLicenseStatus,
      notes: args.sourceNotes,
    });
    const batch = await createHistoricalXiangqiImportBatch({
      sourceId: source.id,
      inputUri: resolve(args.dir),
      inputSha256: inputHash,
    });
    let inserted = 0;
    for (const plan of plans) {
      if (!plan.ok) continue;
      const game = await insertHistoricalXiangqiGame({
        sourceId: source.id,
        importBatchId: batch.id,
        sourceGameId: plan.game.sourceGameId,
        sourceUrl: plan.game.sourceUrl,
        eventName: plan.game.eventName,
        playedOn: plan.game.playedOn,
        redNameRaw: plan.game.redNameRaw,
        blackNameRaw: plan.game.blackNameRaw,
        result: plan.game.result,
        moveFormat: plan.game.moveFormat,
        moves: plan.game.moves,
        tags: plan.game.tags,
        visibility: importVisibility(args),
      });
      inserted += 1;
      console.log(`  ${plan.game.file} -> ${game.id} (${game.plyCount} plies)`);
    }
    const skipped = plans.filter((plan) => !plan.ok).length;
    await finishHistoricalXiangqiImportBatch(batch.id, 'completed', {
      total: plans.length,
      imported: inserted,
      skipped,
    });
    console.log(
      `persisted source=${source.slug} batch=${batch.id} imported=${inserted} skipped=${skipped}`,
    );
  } finally {
    await close();
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.persist) validateImportRights(args);
  const { inputHash, plans } = await buildImportPlans(args);
  const ok = plans.filter((plan) => plan.ok);
  const failed = plans.filter((plan) => !plan.ok);
  console.log(
    `historical xiangqi import: files=${plans.length} ok=${ok.length} skipped=${failed.length} input=${sha256(inputHash).slice(0, 12)}`,
  );
  console.log(
    `source rights: status=${args.sourceLicenseStatus} license=${args.sourceLicense ?? 'none'} visibility=${importVisibility(args)}`,
  );
  for (const plan of plans) {
    if (plan.ok) {
      const g = plan.game;
      console.log(
        `  ok   ${g.file} ${g.redNameRaw ?? 'Red'} vs ${g.blackNameRaw ?? 'Black'} ${g.result} ${g.moves.length} plies (${g.moveFormat})`,
      );
    } else {
      console.log(`  skip ${plan.file}: ${plan.reason}`);
    }
  }
  if (!args.persist) {
    console.log('dry run; pass --persist with DATABASE_URL to write historical archive rows.');
    return;
  }
  await persistPlans(args, inputHash, plans);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
