// Run one shard of the Postgres-backed server suite.
//
// `test:persistent` runs the WHOLE compiled server suite (241 files, ~1,800
// tests) at --test-concurrency=1 against a real database, and that serial run
// is the longest job in hosted CI. Three measurements shaped this:
//
//   - Concurrency does not help. At --test-concurrency=4 the wall clock is
//     unchanged AND 157 tests fail: the suite is bound by the one shared
//     database, not by CPU, and the serial setting is load-bearing.
//   - There is no fat test to cut. Per-test durations sum to 57s of an 80s
//     run; the slowest two are 1.6s timeout tests and the rest is a long tail
//     averaging 37ms.
//   - Splitting by directory does nothing: one flat directory holds 80s of the
//     87s.
//
// So the only lever is more databases. Each CI shard is its own job with its
// own Postgres service, staying serial within itself.
//
//   SHARD_INDEX=1 SHARD_TOTAL=3 node scripts/persistent-shard.mjs
//
// Unset (or SHARD_TOTAL=1) runs every file, which is what a local
// `npm run test:persistent` does.
import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import { pruneOrphanDist } from './prune-orphan-dist.mjs';
import {
  checkServerTestDiscovery,
  readServerTestScripts,
  serverTestGlobs,
} from './server-test-discovery.mjs';

const SERVER_DIR = resolve(import.meta.dirname, '..', 'apps', 'server');

/**
 * Deal sorted files round-robin across shards. Round-robin rather than
 * contiguous slices: file cost is a long tail with no usable static proxy, and
 * dealing spreads any local clustering (a directory of slow room tests, say)
 * across every shard instead of landing it all in one.
 *
 * @param {string[]} files unsorted file paths
 * @param {number} index 1-based shard number
 * @param {number} total shard count
 */
export function shardFiles(files, index, total) {
  if (!Number.isInteger(total) || total < 1) throw new Error(`bad SHARD_TOTAL: ${total}`);
  if (!Number.isInteger(index) || index < 1 || index > total) {
    throw new Error(`bad SHARD_INDEX: ${index} (expected 1..${total})`);
  }
  return [...files].sort().filter((_, i) => i % total === index - 1);
}

function readEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer, got ${raw}`);
  return value;
}

function main() {
  const total = readEnvInt('SHARD_TOTAL', 1);
  const index = readEnvInt('SHARD_INDEX', 1);
  const discovery = checkServerTestDiscovery(SERVER_DIR);
  if (discovery.issues.length > 0) throw new Error(discovery.issues.join('\n'));
  // Same guard test:persistent gets from its pretest hook: tsc leaves the
  // output of a deleted source behind, and these globs would keep running it.
  pruneOrphanDist(SERVER_DIR);
  const patterns = serverTestGlobs(
    readServerTestScripts(SERVER_DIR)['test:persistent'],
    'test:persistent',
  );
  const all = [...new Set(patterns.flatMap((pattern) => globSync(pattern, { cwd: SERVER_DIR })))];
  if (all.length === 0) {
    throw new Error(`no compiled test files under ${SERVER_DIR}; run tsc first`);
  }
  const files = shardFiles(all, index, total);
  console.log(`persistent shard ${index}/${total}: ${files.length} of ${all.length} file(s)`);
  if (files.length === 0) return 0;

  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
    cwd: SERVER_DIR,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`persistent shard exited with signal ${result.signal}`);
  return result.status ?? 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
