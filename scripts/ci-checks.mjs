#!/usr/bin/env node
// Named local confidence gates for agent and contributor handoffs.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPlan as buildBrowserSmokePlan } from './ci-browser-smoke-plan.mjs';
import { captureGateStamp, writeGateStamp } from './lib/gate-stamp.mjs';
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

const quickCommands = [
  // check:drift runs first: it is near-instant and guards invariants (SQL enum
  // parity, fog-redaction payload guard) that nothing else on the release path
  // re-checks. release:prod pushes with --no-verify, so the pre-push hook's
  // drift check never runs there; this is the only drift gate on that path.
  ['npm', 'run', 'check:drift'],
  ['npm', 'run', 'lint'],
  ['npm', 'run', 'i18n:check'],
  ['npm', 'run', 'build'],
  ['npm', 'run', 'typecheck'],
  ...unitTestCommands(),
  ['npm', 'run', 'check:cycles'],
];

const suites = {
  quick: quickCommands,
  local: [...quickCommands, ['npm', 'run', 'test:integration', '--workspace', '@mistboard/server']],
  preship: [
    ...quickCommands,
    {
      command: ['npm', 'run', 'test:integration', '--workspace', '@mistboard/server'],
      env: { MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE: 'true' },
    },
    ['npm', 'run', 'test:puzzles:corpus'],
    {
      command: ['npx', 'tsx', '--test', 'packages/game/src/variants-benedict-xiangqi.test.ts'],
      env: { MISTBOARD_DEEP_PERFT: '1' },
    },
    ['node', 'scripts/audit-prod-deps.mjs'],
  ],
};

function preshipBrowserPlan() {
  try {
    const files = [];
    // The working-tree diff includes staged and unstaged fixes on top of the
    // branch; include untracked paths too, without reading their contents.
    for (const args of [
      ['diff', '--name-only', '--diff-filter=ACDMRTUXB', 'origin/main'],
      ['ls-files', '--others', '--exclude-standard'],
    ]) {
      const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error('could not read changed paths against origin/main');
      files.push(...result.stdout.split('\n').filter(Boolean));
    }
    return buildBrowserSmokePlan({ changedFiles: [...new Set(files)] });
  } catch (error) {
    console.log(`browser smoke plan warning: ${error.message}; running conservatively`);
    return buildBrowserSmokePlan({ changedFiles: [], warning: error.message });
  }
}

// Importable so release:prod can append persistence results to the SAME
// summary and use the actual build verdict, rather than stale dist files.
export async function runCiChecks({
  suiteName = 'quick',
  keepGoing = suiteName !== 'local',
  run = spawnCommand,
  summarize = true,
  reuseStages = [],
  stamp = true,
} = {}) {
  if (!suites[suiteName]) throw new Error(`unknown CI gate: ${suiteName}`);
  const snapshot = stamp ? captureGateStamp() : null;
  const commands = [...suites[suiteName]];
  if (suiteName === 'preship') {
    const plan = preshipBrowserPlan();
    if (plan.runBrowserSmoke) {
      commands.push(['npm', 'run', 'test:study:persistent']);
    } else {
      console.log(`skip: npm run test:study:persistent: ${plan.reason} (0.00s)`);
    }
  }
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
  for (const stage of commands) {
    const { command, env } = Array.isArray(stage) ? { command: stage } : stage;
    const script = command[2];
    const isTest = script?.startsWith('test:') || command.includes('--test');
    let reason;
    if (
      suiteName !== 'preship' &&
      !keepGoing &&
      results.some((result) => result.status === 'failed')
    ) {
      reason = 'earlier command failed';
    } else if ((isTest || script === 'typecheck') && !buildSucceeded) {
      reason = 'build failed';
    } else if (isTest && !loopbackSucceeded) {
      reason = 'loopback preflight failed';
    }
    const result = reason
      ? skippedCommand(command, reason)
      : runGateCommand(command, run, env, reuseStages);
    results.push(result);
    if (script === 'build') buildSucceeded = result.status === 'passed';
  }
  const ok = results.every((result) => result.status === 'passed');
  if (summarize) printGateSummary(`ci:${suiteName}`, results);
  if (stamp) writeGateStamp(snapshot, suiteName, results);
  return { ok, results, buildSucceeded, loopbackSucceeded };
}

export function runGateCommand(command, run = spawnCommand, env, reuseStages = []) {
  if (reuseStages.some((stage) => stage.name === command.join(' ') && stage.ok === true)) {
    return { command, status: 'passed', exitCode: 0, durationMs: 0, reused: true };
  }
  console.log(`\n$ ${command.join(' ')}`);
  const started = performance.now();
  const finish = (result) => {
    const durationMs = performance.now() - started;
    console.log(`${command.join(' ')}: ${result.status} (${(durationMs / 1000).toFixed(2)}s)`);
    return { ...result, durationMs };
  };
  try {
    const result = run(command, env);
    if (result.error) throw result.error;
    if (result.signal) {
      return finish({ command, status: 'failed', exitCode: 1, detail: `signal ${result.signal}` });
    }
    const exitCode = result.status ?? 1;
    return finish({ command, status: exitCode === 0 ? 'passed' : 'failed', exitCode });
  } catch (error) {
    return finish({
      command,
      status: 'failed',
      exitCode: error.exitCode ?? 1,
      detail: error.message,
    });
  }
}

export function skippedCommand(command, reason) {
  return { command, status: 'skipped', reason, durationMs: 0 };
}

export function printGateSummary(label, results) {
  console.log(`\n# gate summary: ${label}`);
  for (const result of results) {
    const verdict =
      result.status === 'skipped'
        ? `skipped: ${result.reason}`
        : `${result.status}${result.reused ? ' (reused)' : ''} (exit ${result.exitCode}${result.detail ? `; ${result.detail}` : ''})`;
    const duration =
      result.durationMs === undefined ? '' : `; ${(result.durationMs / 1000).toFixed(2)}s`;
    console.log(`  ${result.command.join(' ')}: ${verdict}${duration}`);
  }
  const failed = results.filter((result) => result.status === 'failed').length;
  console.log(`${label}: ${failed > 0 ? `${failed} failed` : 'ok'}`);
}

function spawnCommand(command, env) {
  return spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
  } else {
    try {
      const suiteName = args[0]?.startsWith('--') ? 'quick' : (args.shift() ?? 'quick');
      let keepGoing = suiteName !== 'local';
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
  npm run ci:preship
  npm run ci:local -- --keep-going

All gates first check IPv4 loopback connectivity (3s timeout).
--keep-going runs independent commands after a failure (the quick/preship default).
--no-keep-going stops after the first failure for quick/local (the local default).
Preship always runs every independent stage, with each stage's duration printed.
Every run ends with command exit codes and explicit dependency skips. Tests
and typecheck are skipped if the build fails; tests also require loopback.
Results (including failures) are saved by working-tree hash and lockfile SHA-256
for release:prod to reuse. MISTBOARD_GATE_STAMP_DIR overrides the default
~/.local/share/mistboard/gate-stamps directory.

ci:quick runs the drift check (INDEX/SQL-enum/redaction invariants), checks
formatting and translation-catalog policy, runs the local build so unit tests
that spawn dist entrypoints do not read stale or missing output, then runs
typecheck, unit tests, and the dependency-cycle check.

ci:preship adds server integration (with the hosted in-memory persistence flag),
the puzzle corpus, deep perft, production dependency audit, and the study
persistence browser smoke. Browser smoke uses CI's patterns against origin/main,
including pending edits, and logs why it skips unrelated changes. Unknown or
empty diffs run it conservatively. Run this hours before a ship; it does not
release anything. Have local Postgres migrated (npm run db:up, npm run db:migrate)
and Playwright Chromium installed before running it.

ci:local runs the full local build, typecheck, unit tests, cycle check, and
server integration tests. Set MISTBOARD_RUN_DB_CHECKS=1 to include the
Postgres-backed persistent test command.`);
}
