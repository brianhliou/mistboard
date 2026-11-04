#!/usr/bin/env node
// Named local confidence gates for agent and contributor handoffs.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkLoopback } from './lib/loopback-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The root `test:unit` is `test:tooling && npm run test:unit --workspaces`, which
// stops at the first workspace that fails. One command per workspace lets the
// keep-going gate report a web failure and a server failure in the same run
// (2026-11-01: they surfaced one release attempt apart). Read from disk so a new
// workspace joins without an edit here; packages first, as npm orders them.
export function unitTestCommands(root = ROOT) {
  const commands = [['npm', 'run', 'test:tooling']];
  for (const group of ['packages', 'apps']) {
    let dirs = [];
    try {
      dirs = readdirSync(path.join(root, group), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      continue;
    }
    for (const dir of dirs) {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(path.join(root, group, dir, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      if (pkg.scripts?.['test:unit']) {
        commands.push(['npm', 'run', 'test:unit', '--workspace', pkg.name]);
      }
    }
  }
  return commands;
}

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
    ...unitTestCommands(),
    ['npm', 'run', 'check:cycles'],
  ],
  local: [
    ['npm', 'run', 'check:drift'],
    ['npm', 'run', 'lint'],
    ['npm', 'run', 'i18n:check'],
    ['npm', 'run', 'build'],
    ['npm', 'run', 'typecheck'],
    ...unitTestCommands(),
    ['npm', 'run', 'check:cycles'],
    ['npm', 'run', 'test:integration', '--workspace', '@mistboard/server'],
  ],
};

// Importable so release:prod can append persistence results to the SAME
// summary and use the actual build verdict, rather than stale dist files.
export async function runCiChecks({
  suiteName = 'quick',
  keepGoing = suiteName === 'quick',
  run = spawnCommand,
  summarize = true,
} = {}) {
  if (!suites[suiteName]) throw new Error(`unknown CI gate: ${suiteName}`);
  const commands = [...suites[suiteName]];
  if (suiteName === 'local') {
    if (process.env.MISTBOARD_RUN_DB_CHECKS === '1') {
      commands.push(['npm', 'run', 'test:persistent']);
    } else {
      console.log('skip: Postgres-backed tests require MISTBOARD_RUN_DB_CHECKS=1');
    }
  }
  console.log(`# ci:${suiteName}`);
  const results = [];
  let loopbackSucceeded = true;
  try {
    await checkLoopback();
  } catch (error) {
    loopbackSucceeded = false;
    results.push({
      command: ['loopback preflight'],
      status: 'failed',
      exitCode: 1,
      detail: error.message,
    });
  }
  let buildSucceeded = false;
  for (const command of commands) {
    const script = command[2];
    const isTest = script.startsWith('test:');
    let reason;
    if (!keepGoing && results.some((result) => result.status === 'failed')) {
      reason = 'earlier command failed';
    } else if ((isTest || script === 'typecheck') && !buildSucceeded) {
      reason = 'build failed';
    } else if (isTest && !loopbackSucceeded) {
      reason = 'loopback preflight failed';
    }
    const result = reason ? skippedCommand(command, reason) : runGateCommand(command, run);
    results.push(result);
    if (script === 'build') buildSucceeded = result.status === 'passed';
  }
  const ok = results.every((result) => result.status === 'passed');
  if (summarize) printGateSummary(`ci:${suiteName}`, results);
  return { ok, results, buildSucceeded, loopbackSucceeded };
}

export function runGateCommand(command, run = spawnCommand) {
  try {
    const result = run(command);
    if (result.error) throw result.error;
    if (result.signal) {
      return { command, status: 'failed', exitCode: 1, detail: `signal ${result.signal}` };
    }
    const exitCode = result.status ?? 1;
    return { command, status: exitCode === 0 ? 'passed' : 'failed', exitCode };
  } catch (error) {
    return { command, status: 'failed', exitCode: error.exitCode ?? 1, detail: error.message };
  }
}

export function skippedCommand(command, reason) {
  return { command, status: 'skipped', reason };
}

export function printGateSummary(label, results) {
  console.log(`\n# gate summary: ${label}`);
  for (const result of results) {
    const verdict =
      result.status === 'skipped'
        ? `skipped: ${result.reason}`
        : `${result.status} (exit ${result.exitCode}${result.detail ? `; ${result.detail}` : ''})`;
    console.log(`  ${result.command.join(' ')}: ${verdict}`);
  }
  const failed = results.filter((result) => result.status === 'failed').length;
  console.log(`${label}: ${failed > 0 ? `${failed} failed` : 'ok'}`);
}

function spawnCommand(command) {
  console.log(`\n$ ${command.join(' ')}`);
  return spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
  } else {
    try {
      const suiteName = args[0]?.startsWith('--') ? 'quick' : (args.shift() ?? 'quick');
      let keepGoing = suiteName === 'quick';
      for (const arg of args) {
        if (arg === '--keep-going') keepGoing = true;
        else if (arg === '--no-keep-going') keepGoing = false;
        else throw new Error(`unknown argument: ${arg}`);
      }
      const result = await runCiChecks({ suiteName, keepGoing });
      process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

function printHelp() {
  console.log(`Usage:
  npm run ci:quick
  npm run ci:local -- --keep-going

Both gates first check IPv4 loopback connectivity (3s timeout).
--keep-going runs independent commands after a failure (the quick default).
--no-keep-going stops after the first failure (the local default).
Every run ends with command exit codes and explicit dependency skips. Tests
and typecheck are skipped if the build fails; tests also require loopback.

ci:quick runs the drift check (INDEX/SQL-enum/redaction invariants), checks
formatting and translation-catalog policy, runs the local build so unit tests
that spawn dist entrypoints do not read stale or missing output, then runs
typecheck, unit tests, and the dependency-cycle check.

ci:local runs the full local build, typecheck, unit tests, cycle check, and
server integration tests. Set MISTBOARD_RUN_DB_CHECKS=1 to include the
Postgres-backed persistent test command.`);
}
