#!/usr/bin/env node
// Named local confidence gates for agent and contributor handoffs.

import { spawnSync } from 'node:child_process';
import { checkLoopback } from './lib/loopback-check.mjs';

const suites = {
  // check:drift runs first: it is near-instant and guards invariants (SQL enum
  // parity, fog-redaction payload guard) that nothing else on the release path
  // re-checks. release:prod pushes with --no-verify, so the pre-push hook's
  // drift check never runs there; this is the only drift gate on that path.
  quick: [
    ['npm', 'run', 'check:drift'],
    ['npm', 'run', 'lint'],
    ['npm', 'run', 'i18n:check'],
    ['npm', 'run', 'build'],
    ['npm', 'run', 'typecheck'],
    ['npm', 'run', 'test:unit'],
    ['npm', 'run', 'check:cycles'],
  ],
  local: [
    ['npm', 'run', 'check:drift'],
    ['npm', 'run', 'lint'],
    ['npm', 'run', 'i18n:check'],
    ['npm', 'run', 'build'],
    ['npm', 'run', 'typecheck'],
    ['npm', 'run', 'test:unit'],
    ['npm', 'run', 'check:cycles'],
    ['npm', 'run', 'test:integration', '--workspace', '@mistboard/server'],
  ],
};

const suiteName = process.argv[2] ?? 'quick';
if (suiteName === '--help' || suiteName === '-h') {
  printHelp();
  process.exit(0);
}

const commands = suites[suiteName];
if (!commands) {
  console.error(`unknown CI gate: ${suiteName}`);
  printHelp();
  process.exit(1);
}

console.log(`# ci:${suiteName}`);
try {
  await checkLoopback();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
for (const command of commands) run(command);

if (suiteName === 'local') {
  if (process.env.MISTBOARD_RUN_DB_CHECKS === '1') {
    run(['npm', 'run', 'test:persistent']);
  } else {
    console.log('skip: Postgres-backed tests require MISTBOARD_RUN_DB_CHECKS=1');
  }
}

console.log(`ci:${suiteName}: ok`);

function run(command) {
  console.log(`\n$ ${command.join(' ')}`);
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`${command[0]} exited with signal ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function printHelp() {
  console.log(`Usage:
  npm run ci:quick
  npm run ci:local

Both gates first check IPv4 loopback connectivity (3s timeout).

ci:quick runs the drift check (INDEX/SQL-enum/redaction invariants), checks
formatting and translation-catalog policy, runs the local build so unit tests
that spawn dist entrypoints do not read stale or missing output, then runs
typecheck, unit tests, and the dependency-cycle check.

ci:local runs the full local build, typecheck, unit tests, cycle check, and
server integration tests. Set MISTBOARD_RUN_DB_CHECKS=1 to include the
Postgres-backed persistent test command.`);
}
