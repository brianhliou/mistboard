// Recompute cached English translations (tour/round nameEn, player nameEn and
// federationEn, a board's matchEn) for stored xiangqi broadcast rows, without
// re-importing from source.
//
// Usage:
//   npm run backfill:xiangqi-broadcast-translations --workspace @mistboard/server -- \
//     --tour <slug> [--apply]
//
// A dry run is the default: it prints every old -> new value and writes
// nothing, and it does not run migrations. --apply runs migrations, then writes.
// --tour limits the pass to one event; without it every tour is read.
//
// A player's page slug is built from the stored nameEn, so a changed player
// name moves a /players/<slug> URL. Give the old slug a hop in
// RENAMED_PLAYER_SLUGS (player-pages.ts) and ship it before applying.

import { parseArgs } from 'node:util';
import pg from 'pg';
import { runMigrations } from './migrate.js';
import {
  backfillXiangqiBroadcastTranslations,
  close,
  init,
  type XiangqiBroadcastTranslationBackfillResult,
} from './persistence.js';

export type BackfillCliOptions = { apply: boolean; tourSlug?: string };

export function parseBackfillCliArgs(argv: string[]): BackfillCliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      apply: { type: 'boolean', default: false },
      // Accepted for old invocations; a dry run is already the default.
      'dry-run': { type: 'boolean', default: false },
      tour: { type: 'string' },
    },
  });
  if (values.apply && values['dry-run']) {
    throw new Error('--apply and --dry-run contradict each other');
  }
  const tourSlug = values.tour?.trim();
  if (values.tour !== undefined && !tourSlug) throw new Error('--tour needs a slug');
  return { apply: Boolean(values.apply), ...(tourSlug ? { tourSlug } : {}) };
}

/** The persistence options a parsed command line runs with. */
export function backfillOptions(options: BackfillCliOptions): {
  dryRun: boolean;
  tourSlug?: string;
} {
  return {
    dryRun: !options.apply,
    ...(options.tourSlug ? { tourSlug: options.tourSlug } : {}),
  };
}

/** One line per changed field, old -> new, then the totals. */
export function backfillReportLines(result: XiangqiBroadcastTranslationBackfillResult): string[] {
  const lines: string[] = [];
  for (const change of result.changes) {
    for (const [field, { before, after }] of Object.entries(change.fields)) {
      lines.push(
        `  ${change.kind}=${change.id} ${field}: ${before ?? '(none)'} -> ${after ?? '(none)'}`,
      );
    }
  }
  const label = result.dryRun ? 'translate-backfill dry-run' : 'translate-backfill applied';
  lines.push(
    `${label} tours=${result.toursSeen} rounds=${result.roundsSeen} boards=${result.boardsSeen} changed=${result.changes.length}`,
  );
  if (result.dryRun && result.changes.length > 0) {
    lines.push('nothing written; re-run with --apply to write these changes');
  }
  return lines;
}

async function main(): Promise<void> {
  let options: BackfillCliOptions;
  try {
    options = parseBackfillCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  // A dry run reads only: no migrations, so it is safe under a read-only
  // session (prod:db --read-only) and never changes a schema to preview data.
  if (options.apply) {
    const migrationClient = new pg.Client({ connectionString: databaseUrl });
    await migrationClient.connect();
    try {
      const applied = await runMigrations(migrationClient);
      if (applied.length > 0) console.log(`migrations applied: ${applied.join(', ')}`);
    } finally {
      await migrationClient.end();
    }
  }

  init(databaseUrl);
  try {
    const result = await backfillXiangqiBroadcastTranslations(backfillOptions(options));
    if (options.tourSlug && result.toursSeen === 0) {
      console.error(`no stored tour has slug ${options.tourSlug}`);
      process.exitCode = 1;
      return;
    }
    for (const line of backfillReportLines(result)) console.log(line);
  } finally {
    await close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
