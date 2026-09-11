#!/usr/bin/env node
// Path-aware verification planner.

import { execFileSync, spawnSync } from 'node:child_process';

const options = parseArgs(process.argv.slice(2));
const files = changedFiles(options);
const plan = buildPlan(files, options);

printPlan(files, plan, options);
if (options.planOnly) process.exit(0);

for (const check of plan.commands) run(check.command);

function parseArgs(args) {
  const result = {
    mode: 'changed',
    since: null,
    planOnly: false,
    includeDb: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--changed') {
      result.mode = 'changed';
    } else if (arg === '--staged') {
      result.mode = 'staged';
    } else if (arg === '--since') {
      result.mode = 'since';
      result.since = requiredValue(args, ++index, '--since');
    } else if (arg === '--plan' || arg === '--no-run') {
      result.planOnly = true;
    } else if (arg === '--include-db') {
      result.includeDb = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (result.mode === 'since' && !result.since) {
    throw new Error('--since requires a ref');
  }
  return result;
}

function changedFiles(options) {
  if (options.mode === 'staged') return gitLines(['diff', '--name-only', '--cached']);
  if (options.mode === 'since') {
    const range = `${options.since}...HEAD`;
    const files = gitLines(['diff', '--name-only', range], { allowFailure: true });
    return files.length > 0 ? files : gitLines(['diff', '--name-only', options.since]);
  }

  return unique([
    ...gitLines(['diff', '--name-only']),
    ...gitLines(['diff', '--name-only', '--cached']),
    ...gitLines(['ls-files', '--others', '--exclude-standard']),
  ]);
}

function buildPlan(files, options) {
  const commands = new Map();
  const notes = [];
  const areas = new Set();
  const has = (predicate) => files.some(predicate);
  const starts = (prefix) => (file) => file.startsWith(prefix);
  const add = (key, label, command) => {
    if (!commands.has(key)) commands.set(key, { label, command });
  };

  const game = has(starts('packages/game/'));
  const boardRender = has(starts('packages/board-render/'));
  const mahjong = has(starts('packages/mahjong/'));
  const serverTestTooling = has(
    (file) => file === 'apps/server/package.json' || file.startsWith('apps/server/scripts/'),
  );
  const server =
    has(
      (file) => file.startsWith('apps/server/src/') || file.startsWith('apps/server/integration/'),
    ) || serverTestTooling;
  const serverIntegration = has(starts('apps/server/integration/')) || serverTestTooling;
  const persistence = has(
    (file) =>
      file.startsWith('apps/server/migrations/') ||
      file.includes('persistence') ||
      file.includes('seat-token'),
  );
  const web = has(starts('apps/web/src/'));
  const visual = has(
    (file) =>
      file === 'apps/web/src/styles.css' ||
      file.includes('live-render') ||
      file.includes('replay') ||
      file.includes('landing'),
  );
  const broad = has(
    (file) =>
      file === 'package.json' ||
      file === 'package-lock.json' ||
      file.startsWith('.github/') ||
      file.startsWith('.githooks/') ||
      file.startsWith('scripts/') ||
      file.includes('tsconfig') ||
      file.includes('vite.config'),
  );

  if (game) {
    areas.add('game');
    add('build-game', 'refresh @mistboard/game dist declarations', [
      'npm',
      'run',
      'build',
      '--workspace',
      '@mistboard/game',
    ]);
    add('game-unit', 'game unit tests', [
      'npm',
      'run',
      'test:unit',
      '--workspace',
      '@mistboard/game',
    ]);
  }

  if (boardRender) {
    areas.add('board-render');
    add('build-board-render', 'refresh @mistboard/board-render dist declarations', [
      'npm',
      'run',
      'build',
      '--workspace',
      '@mistboard/board-render',
    ]);
  }

  if (mahjong) {
    areas.add('mahjong');
    add('build-mahjong', 'refresh @mistboard/mahjong dist declarations', [
      'npm',
      'run',
      'build',
      '--workspace',
      '@mistboard/mahjong',
    ]);
    add('mahjong-unit', 'mahjong unit tests', [
      'npm',
      'run',
      'test:unit',
      '--workspace',
      '@mistboard/mahjong',
    ]);
  }

  if (server) {
    areas.add('server');
    add('server-build', 'server build for dist-backed tests', [
      'npm',
      'run',
      'build',
      '--workspace',
      '@mistboard/server',
    ]);
    add('server-typecheck', 'server typecheck', [
      'npm',
      'run',
      'typecheck',
      '--workspace',
      '@mistboard/server',
    ]);
    add('server-unit', 'server unit tests', [
      'npm',
      'run',
      'test:unit',
      '--workspace',
      '@mistboard/server',
    ]);
    if (serverIntegration) {
      add('server-integration', 'server integration tests', [
        'npm',
        'run',
        'test:integration',
        '--workspace',
        '@mistboard/server',
      ]);
    }
  }

  if (persistence) {
    areas.add('persistence');
    if (options.includeDb) {
      add('persistent', 'Postgres-backed persistent tests', ['npm', 'run', 'test:persistent']);
    } else {
      notes.push('skip: Postgres-backed persistence tests require --include-db and a local DB.');
    }
  }

  if (web || boardRender) {
    areas.add('web');
    add('web-typecheck', 'web typecheck', [
      'npm',
      'run',
      'typecheck',
      '--workspace',
      '@mistboard/web',
    ]);
    add('web-unit', 'web unit tests', ['npm', 'run', 'test:unit', '--workspace', '@mistboard/web']);
  }

  if (broad) {
    areas.add('repo-tooling');
    add('root-build', 'root build', ['npm', 'run', 'build']);
    add('root-typecheck', 'root typecheck', ['npm', 'run', 'typecheck']);
    add('root-unit', 'root unit tests', ['npm', 'run', 'test:unit']);
    add('cycles', 'dependency cycle check', ['npm', 'run', 'check:cycles']);
  }

  if (visual) {
    notes.push(
      'recommend: visual/live layout touched; run npm run test:e2e:smoke with dev server up.',
    );
    notes.push(
      'recommend: mobile/article layout touched; run npm run test:mobile:shots with dev server up.',
    );
  }

  return {
    areas: [...areas],
    commands: [...commands.values()],
    notes,
  };
}

function printPlan(files, plan, options) {
  console.log(`# verify ${options.mode}${options.since ? ` ${options.since}` : ''}`);
  console.log(`changed files: ${files.length}`);
  for (const file of files.slice(0, 30)) console.log(`  ${file}`);
  if (files.length > 30) console.log(`  ... ${files.length - 30} more`);

  console.log(`areas: ${plan.areas.length > 0 ? plan.areas.join(', ') : 'docs/unknown'}`);
  if (plan.commands.length === 0) {
    console.log(
      'commands: none mapped; inspect manually or run npm run ci:quick for broad confidence.',
    );
  } else {
    console.log('commands:');
    for (const check of plan.commands) {
      console.log(`  # ${check.label}`);
      console.log(`  $ ${check.command.join(' ')}`);
    }
  }
  if (plan.notes.length > 0) {
    console.log('notes:');
    for (const note of plan.notes) console.log(`  - ${note}`);
  }
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

function gitLines(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    if (allowFailure) return [];
    throw error;
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp() {
  console.log(`Usage:
  npm run verify -- --changed
  npm run verify -- --staged --plan
  npm run verify -- --since origin/main

Options:
  --changed      Use unstaged, staged, and untracked files (default)
  --staged       Use staged files only
  --since <ref>  Use files changed from a base ref to HEAD
  --plan         Print the plan without running commands
  --include-db   Include Postgres-backed persistence tests when mapped`);
}
