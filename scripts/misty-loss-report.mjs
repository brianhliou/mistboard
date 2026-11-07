#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  buildMistyLossReport,
  renderMistyLossReport,
  withMistyStockfishGrader,
} from '../apps/server/src/misty-loss-report.ts';
import { close, init } from '../apps/server/src/persistence-db.ts';
import { loadMistyLosses } from '../apps/server/src/persistence-misty-losses.ts';

try {
  const { values } = parseArgs({
    options: {
      since: { type: 'string' },
      until: { type: 'string' },
      game: { type: 'string' },
      depth: { type: 'string', default: '18' },
      stockfish: { type: 'string' },
      out: { type: 'string' },
      format: { type: 'string', default: 'markdown' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: npm run engine:loss-report -- --out <private-file> [--since ISO] [--until ISO] [--game ID-prefix] [--depth 18] [--stockfish PATH] [--format markdown|json]',
    );
  } else {
    const until = values.until ? new Date(values.until) : new Date();
    const since = values.since ? new Date(values.since) : new Date(until.getTime() - 7 * 86400000);
    const depth = Number(values.depth);
    if (
      !values.out ||
      !['markdown', 'json'].includes(values.format) ||
      !Number.isSafeInteger(depth) ||
      depth < 1 ||
      depth > 30 ||
      !Number.isFinite(since.getTime()) ||
      !Number.isFinite(until.getTime()) ||
      since >= until
    ) {
      throw new Error('invalid arguments');
    }
    if (!process.env.DATABASE_URL) throw new Error('database required');
    init(process.env.DATABASE_URL, { maxPoolConnections: 1, statementTimeoutMs: 30000 });
    try {
      const games = await loadMistyLosses(since, until, values.game ?? null);
      const report =
        games.length === 0
          ? { gamesAnalyzed: 0, ranked: [], skipped: [] }
          : await withMistyStockfishGrader((grade) => buildMistyLossReport(games, grade), {
              bin: values.stockfish,
              depth,
            });
      const metadata = { since: since.toISOString(), until: until.toISOString(), depth };
      const output =
        values.format === 'json'
          ? `${JSON.stringify({ version: 1, ...metadata, ...report }, null, 2)}\n`
          : `Window: ${metadata.since} to ${metadata.until} (exclusive); Stockfish depth ${depth}, Threads 1, Hash 64 MiB.\n\n${renderMistyLossReport(report)}`;
      // Refuse to overwrite an earlier report; do not leave a partial report on
      // an engine/database failure. Truth-board output belongs in private files.
      writeFileSync(values.out, output, { flag: 'wx', mode: 0o600 });
      console.log(
        `Analyzed ${report.gamesAnalyzed} losses; ranked ${report.ranked.length} games; skipped ${report.skipped.length} moves.`,
      );
    } finally {
      await close();
    }
  }
} catch {
  // Database/engine exceptions can contain connection parameters or payloads.
  console.error(
    'Misty loss report failed; check arguments (--help), database access, Stockfish and that --out is a new writable file.',
  );
  process.exitCode = 1;
}
