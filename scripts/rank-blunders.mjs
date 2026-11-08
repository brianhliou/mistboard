#!/usr/bin/env node
// Run with node --import tsx scripts/rank-blunders.mjs <fixture.json> [--limit N].
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rankBlunders } from '../apps/server/src/offline-blunder-ranker.ts';

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { limit: { type: 'string', default: '20' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log('Usage: node --import tsx scripts/rank-blunders.mjs <fixture.json> [--limit N]');
  } else {
    if (positionals.length !== 1) throw new Error('expected one fixture JSON path; see --help');
    const fixture = JSON.parse(readFileSync(positionals[0], 'utf8'));
    const result = rankBlunders(fixture, Number(values.limit));
    console.log(JSON.stringify({ version: 1, ...result }, null, 2));
  }
} catch (error) {
  // Never echo fixture contents (including JSON.parse's excerpt on bad JSON).
  console.error(error instanceof SyntaxError ? 'Invalid fixture JSON' : error.message);
  process.exitCode = 1;
}
