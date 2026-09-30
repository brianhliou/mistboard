// Import an off-site engine match (enriched lab jsonl) as finished jieqi games.
// Builds and kernel-validates every game (engine-match-import.ts), then writes
// each one in its own transaction: event log, games row (mode 'imported',
// corpus_id = the match slug), participants, and one engine-evals debug
// artifact. Idempotent: room ids derive from slug + game number, and a game
// already imported is left alone (--replace rewrites it).
//
// Usage (local dev DB):
//   DATABASE_URL=postgres://mistboard:mistboard@localhost:5435/mistboard \
//   npx tsx apps/server/src/import-engine-match.ts \
//     --manifest <match.json> --games <enriched.jsonl> \
//     [--dry-run] [--replace] [--only 45,63,366] [--skip-migrations]
//
// Exit code 1 when any game is rejected by the kernel, conflicts with a row
// already in the database, or fails to write; the other games are still written.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  assertEngineMatchManifest,
  buildImportedJieqiGame,
  ENGINE_MATCH_EVALS_ARTIFACT,
  type EngineMatchManifest,
  type ImportedEngineMatchGame,
  parseEnrichedMatchJsonl,
} from './engine-match-import.js';
import { runMigrations } from './migrate.js';
import { close, init } from './persistence.js';
import { withTransaction } from './persistence-db.js';

export type EngineMatchWriteOutcome = 'imported' | 'unchanged' | 'replaced' | 'conflict';

/**
 * Write one built game. Never touches a row that is not this match's imported
 * game: an existing room id with another mode or corpus is a conflict.
 */
export async function writeImportedEngineMatchGame(
  client: pg.PoolClient | pg.Client,
  game: ImportedEngineMatchGame,
  options: { replace?: boolean } = {},
): Promise<{ outcome: EngineMatchWriteOutcome; detail?: string }> {
  const { roomId, summary } = game;
  const existing = await client.query<{
    mode: string;
    corpus_id: string | null;
    result: string | null;
    termination: string | null;
    ply_count: number;
  }>(`SELECT mode, corpus_id, result, termination, ply_count FROM games WHERE room_id = $1`, [
    roomId,
  ]);
  const row = existing.rows[0];
  const eventCount = Number(
    (
      await client.query<{ n: string }>(`SELECT count(*) AS n FROM events WHERE room_id = $1`, [
        roomId,
      ])
    ).rows[0]?.n ?? 0,
  );
  if (row && (row.mode !== 'imported' || row.corpus_id !== summary.corpusId)) {
    return {
      outcome: 'conflict',
      detail: `room exists as mode=${row.mode} corpus=${row.corpus_id}`,
    };
  }
  if (!row && eventCount > 0) {
    return { outcome: 'conflict', detail: `${eventCount} events but no games row` };
  }
  if (row && !options.replace) {
    const same =
      row.result === summary.result &&
      row.termination === summary.termination &&
      row.ply_count === summary.plyCount &&
      eventCount === game.events.length;
    return same
      ? { outcome: 'unchanged' }
      : { outcome: 'conflict', detail: 'differs from the stored game (use --replace)' };
  }
  if (row) {
    // Participants, artifacts and favorites cascade from games; the event log
    // and the analysis cache are keyed by room id without a foreign key.
    await client.query(`DELETE FROM events WHERE room_id = $1`, [roomId]);
    await client.query(`DELETE FROM game_analysis WHERE room_id = $1`, [roomId]);
    await client.query(`DELETE FROM games WHERE room_id = $1`, [roomId]);
  }

  for (let seq = 0; seq < game.events.length; seq += 1) {
    const event = game.events[seq]!;
    await client.query(
      `INSERT INTO events (room_id, seq, type, payload, created_at)
       VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))`,
      [roomId, seq, event.type, event, event.at],
    );
  }
  await client.query(
    `INSERT INTO games
       (room_id, variant, result, termination, ply_count, started_at, ended_at,
        white_client, black_client, white_name, black_name, corpus_id,
        mode, status, review_status, visibility, rated, initial_ms, increment_ms, region)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, $10,
             'imported', 'completed', 'unreviewed', 'public', false, NULL, NULL, 'global')`,
    [
      roomId,
      summary.variant,
      summary.result,
      summary.termination,
      summary.plyCount,
      summary.startedAt,
      summary.endedAt,
      summary.whiteName,
      summary.blackName,
      summary.corpusId,
    ],
  );
  for (const participant of summary.participants ?? []) {
    await client.query(
      `INSERT INTO game_participants
         (game_id, color, subject_type, subject_id, display_name, visibility, engine_version,
          engine_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        roomId,
        participant.color,
        participant.subjectType,
        participant.subjectId,
        participant.displayName,
        participant.visibility,
        participant.engineVersion ?? null,
        participant.engineId ?? null,
      ],
    );
  }
  await client.query(
    `INSERT INTO game_debug_artifacts (game_id, ply, engine_color, artifact_type, storage, payload)
     VALUES ($1, NULL, NULL, $2, 'jsonb', $3)`,
    [roomId, ENGINE_MATCH_EVALS_ARTIFACT, game.evals],
  );
  return { outcome: row ? 'replaced' : 'imported' };
}

type Args = {
  manifest: string;
  games: string;
  dryRun: boolean;
  replace: boolean;
  skipMigrations: boolean;
  only: Set<number> | null;
};

function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const manifest = value('--manifest');
  const games = value('--games');
  if (!manifest || !games) {
    console.error(
      'usage: import-engine-match.ts --manifest <match.json> --games <enriched.jsonl> ' +
        '[--dry-run] [--replace] [--only 1,2,3] [--skip-migrations]',
    );
    process.exit(2);
  }
  const only = value('--only');
  return {
    manifest,
    games,
    dryRun: argv.includes('--dry-run'),
    replace: argv.includes('--replace'),
    skipMigrations: argv.includes('--skip-migrations'),
    only: only ? new Set(only.split(',').map((n) => Number.parseInt(n, 10))) : null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(args.manifest, 'utf8')) as EngineMatchManifest;
  assertEngineMatchManifest(manifest);
  const rows = parseEnrichedMatchJsonl(await readFile(args.games, 'utf8'));
  const total = rows.length;

  const built: ImportedEngineMatchGame[] = [];
  const rejected: string[] = [];
  const score = { aWins: 0, bWins: 0, draws: 0 };
  let completedSquares = 0;
  for (const row of rows) {
    if (args.only && !args.only.has(row.game)) continue;
    const result = buildImportedJieqiGame(manifest, row, total);
    if (!result.ok) {
      rejected.push(`game ${result.game} (${result.roomId}): ${result.error}`);
      continue;
    }
    built.push(result.value);
    completedSquares += result.value.completedSquares;
    if (row.winner === 'draw') score.draws += 1;
    else if (row.winner === row.a_color) score.aWins += 1;
    else score.bWins += 1;
  }
  console.log(
    `${manifest.eventName} (${manifest.slug}): ${built.length} valid, ${rejected.length} rejected; ` +
      `${manifest.engines.A.name} ${score.aWins}-${score.bWins}-${score.draws} ` +
      `vs ${manifest.engines.B.name}; ${completedSquares} never-revealed home squares completed`,
  );
  for (const line of rejected) console.warn(`  REJECTED ${line}`);
  if (args.dryRun) {
    for (const game of built.slice(0, 3)) {
      console.log(
        `  ${game.roomId}: ${game.summary.result}/${game.summary.termination}, ` +
          `${game.summary.plyCount} plies, ${game.summary.startedAt.toISOString()}`,
      );
    }
    process.exit(rejected.length > 0 ? 1 : 0);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (or pass --dry-run)');
    process.exit(2);
  }
  if (!args.skipMigrations) {
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
  const tally: Record<EngineMatchWriteOutcome | 'failed', number> = {
    imported: 0,
    unchanged: 0,
    replaced: 0,
    conflict: 0,
    failed: 0,
  };
  try {
    for (const game of built) {
      // One transaction per game: a database error rolls back that game only,
      // is reported, and the run moves on to the next one.
      try {
        const { outcome, detail } = await withTransaction((client) =>
          writeImportedEngineMatchGame(client, game, { replace: args.replace }),
        );
        tally[outcome] += 1;
        if (outcome === 'conflict') console.warn(`  CONFLICT ${game.roomId}: ${detail}`);
      } catch (err) {
        tally.failed += 1;
        console.error(`  FAILED ${game.roomId}: ${(err as Error).message}`);
      }
    }
  } finally {
    await close();
  }
  console.log(
    `done: ${tally.imported} imported, ${tally.replaced} replaced, ${tally.unchanged} unchanged, ` +
      `${tally.conflict} conflicts, ${tally.failed} failed, ${rejected.length} rejected`,
  );
  if (tally.conflict > 0 || tally.failed > 0 || rejected.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
