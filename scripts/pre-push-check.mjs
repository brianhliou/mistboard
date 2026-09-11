#!/usr/bin/env node
// Path-aware local pre-push gate for pushes to main.

import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import {
  DEFAULT_TEST_DATABASE_URL,
  isDatabaseReachable,
  needsPersistenceGate,
  persistenceGateWarning,
} from './persistence-gate.mjs';

const ZERO_SHA = /^0{40}$/;
const DIST_DIRS = [
  'packages/board-render/dist',
  'packages/game/dist',
  'packages/mahjong/dist',
  'apps/server/dist',
  'apps/web/dist',
];

const options = parseArgs(process.argv.slice(2));
const files =
  options.files.length > 0
    ? unique(options.files)
    : changedFiles(options.localSha, options.remoteSha);
const plan = buildPlan(files, options);

printPlan(files, plan);
if (options.planOnly) process.exit(0);

if (plan.cleanDist) cleanDist();
for (const command of plan.commands) run(command);
if (plan.persistenceGate) await runPersistenceGate();
console.log('pre-push: ok');

function parseArgs(args) {
  const options = {
    planOnly: false,
    explicitFiles: false,
    files: [],
    localSha: null,
    remoteSha: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--plan') {
      options.planOnly = true;
    } else if (arg === '--files') {
      options.explicitFiles = true;
      index += 1;
      while (index < args.length && !args[index].startsWith('--')) {
        options.files.push(args[index]);
        index += 1;
      }
      index -= 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!options.localSha) {
      options.localSha = arg;
    } else if (!options.remoteSha) {
      options.remoteSha = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (options.files.length === 0 && (!options.localSha || !options.remoteSha)) {
    throw new Error('expected <local-sha> <remote-sha> or --files <paths...>');
  }

  return options;
}

function changedFiles(localSha, remoteSha) {
  if (!localSha || ZERO_SHA.test(localSha)) return [];
  if (!remoteSha || ZERO_SHA.test(remoteSha)) {
    return gitLines(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', localSha]);
  }
  return gitLines(['diff', '--name-only', remoteSha, localSha]);
}

function buildPlan(files, options) {
  const persistenceGate = needsPersistenceGate(files);

  if (files.length === 0) {
    return {
      kind: 'empty',
      reason: 'no changed files detected for main push',
      cleanDist: false,
      persistenceGate: false,
      commands: [],
    };
  }

  if (files.every(isDocsOrMetaOnly)) {
    return {
      kind: 'docs',
      reason: 'docs/meta-only push; CI and Railway path filters do not run for this set',
      cleanDist: false,
      persistenceGate: false,
      commands: [['npm', 'run', 'check:drift']],
    };
  }

  if (
    files.some(needsBroadColdGate) ||
    (!options.explicitFiles && (!options.remoteSha || ZERO_SHA.test(options.remoteSha)))
  ) {
    return {
      kind: 'broad',
      reason: 'repo tooling, package, workflow, deploy, or shared package files changed',
      cleanDist: true,
      persistenceGate,
      // ci:quick runs check:drift as its first command (scripts/ci-checks.mjs),
      // so the drift invariants still fail fast without a separate prefix here.
      commands: [['npm', 'run', 'ci:quick']],
    };
  }

  if (files.some(isCiOrDeployWatchedPath)) {
    const command = options.remoteSha
      ? ['npm', 'run', 'verify', '--', '--since', options.remoteSha]
      : ['npm', 'run', 'verify', '--', '--changed'];
    return {
      kind: 'targeted',
      reason: 'app-level deploy-affecting files changed',
      cleanDist: false,
      persistenceGate,
      // Fast-fail drift prefix: a new source file missing from INDEX.md (or a
      // dropped redaction guard) lands via this branch, which verify does not catch.
      // Whole-repo lint runs here because hosted CI lints the whole repo: latent
      // format debt in an untouched file fails CI on an app-only push and silently
      // freezes the Railway auto-deploy (reds of 2026-07-01). i18n:check runs for
      // the same reason: hosted CI checks catalog policy on every app push.
      commands: [
        ['npm', 'run', 'check:drift'],
        ['npm', 'run', 'lint'],
        ['npm', 'run', 'i18n:check'],
        command,
      ],
    };
  }

  return {
    kind: 'unmapped',
    reason: 'no CI/Railway-watched files changed',
    cleanDist: false,
    persistenceGate,
    commands: [['npm', 'run', 'check:drift']],
  };
}

function isDocsOrMetaOnly(file) {
  // Markdown under apps/, packages/, or scripts/ is NOT docs-only: those
  // trees are in the hosted CI path filters (and Railway watch paths), so a
  // push touching them does trigger CI and a deploy.
  if (file.startsWith('apps/') || file.startsWith('packages/') || file.startsWith('scripts/')) {
    return false;
  }
  return file.startsWith('docs/') || file.endsWith('.md');
}

function needsBroadColdGate(file) {
  return (
    file.startsWith('.github/') ||
    file.startsWith('.githooks/') ||
    file.startsWith('scripts/') ||
    file.startsWith('packages/game/') ||
    file.startsWith('packages/board-render/') ||
    file.startsWith('packages/mahjong/') ||
    file === 'package.json' ||
    file === 'package-lock.json' ||
    file.endsWith('/package.json') ||
    file.endsWith('/package-lock.json') ||
    file === 'docker-compose.yml' ||
    file === 'railpack.json' ||
    /^railway.*\.json$/.test(file) ||
    /^tsconfig.*\.json$/.test(file) ||
    file.includes('vite.config')
  );
}

function isCiOrDeployWatchedPath(file) {
  return (
    file.startsWith('apps/') ||
    file.startsWith('packages/') ||
    file.startsWith('scripts/') ||
    file === 'package.json' ||
    file === 'package-lock.json' ||
    file === 'docker-compose.yml' ||
    file === 'railpack.json' ||
    file === '.github/workflows/ci.yml' ||
    /^railway.*\.json$/.test(file) ||
    /^tsconfig.*\.json$/.test(file)
  );
}

function printPlan(files, plan) {
  console.log(`pre-push: ${plan.kind} gate`);
  console.log(`pre-push: ${plan.reason}`);
  console.log(`pre-push: changed files (${files.length})`);
  for (const file of files.slice(0, 30)) console.log(`  ${file}`);
  if (files.length > 30) console.log(`  ... ${files.length - 30} more`);
  if (plan.cleanDist) console.log('pre-push: will clean dist/ before running commands');
  if (plan.commands.length === 0) {
    console.log('pre-push: commands: none');
  } else {
    console.log('pre-push: commands:');
    for (const command of plan.commands) console.log(`  $ ${command.join(' ')}`);
  }
  if (plan.persistenceGate) {
    console.log(
      'pre-push: persistence-watched files changed; will run test:persistent if local Postgres is reachable (else warn)',
    );
  }
}

async function runPersistenceGate() {
  if (process.env.MISTBOARD_SKIP_PREPUSH_DB === '1') {
    console.log('pre-push: persistence gate skipped via MISTBOARD_SKIP_PREPUSH_DB=1');
    return;
  }
  const databaseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const reachable = await isDatabaseReachable(databaseUrl);
  if (reachable) {
    run(['npm', 'run', 'test:persistent']);
    return;
  }
  console.warn(persistenceGateWarning('pre-push'));
}

function cleanDist() {
  console.log('pre-push: cleaning dist/ to reproduce CI cold-build assumptions');
  for (const dir of DIST_DIRS) rmSync(dir, { recursive: true, force: true });
}

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

function gitLines(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)].sort();
}

function printHelp() {
  console.log(`Usage:
  node scripts/pre-push-check.mjs <local-sha> <remote-sha>
  node scripts/pre-push-check.mjs --plan --files docs/process-improvement-track.md

The git hook passes the local and remote main SHAs. --files is for validating
the planner without synthesizing commits.`);
}
