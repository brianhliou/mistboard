/**
 * Pins for `.githooks/pre-commit`'s MISTBOARD_PRECOMMIT_STASH=1 path (#330).
 * `git stash` mid-merge drops MERGE_HEAD, so the commit silently lands as a
 * single-parent commit. The hook must refuse the stash while a merge, rebase,
 * cherry-pick or revert is in progress, and keep the sequencer state intact.
 *
 * Each test drives the real hook in a throwaway repo with an `npm` stub on
 * PATH, so lint and typecheck are not what is under test.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const hook = join(scriptsDir, '..', '.githooks', 'pre-commit');

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'mistboard-precommit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'npm'), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith('MISTBOARD_') || key === 'SKIP_PRECOMMIT') delete env[key];
  }
  const git = (...args) => spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  writeFileSync(join(repo, 'b.txt'), 'other\n');
  git('add', 'a.txt', 'b.txt');
  git('commit', '-q', '-m', 'base');
  const runHook = (extraEnv = {}) =>
    spawnSync('sh', [hook], { cwd: repo, env: { ...env, ...extraEnv }, encoding: 'utf8' });
  const gitPath = (name) => join(repo, git('rev-parse', '--git-path', name).stdout.trim());
  return { repo, git, runHook, gitPath };
}

function conflictingBranches({ repo, git }) {
  git('checkout', '-q', '-b', 'topic');
  writeFileSync(join(repo, 'a.txt'), 'topic\n');
  git('commit', '-q', '-am', 'topic');
  git('checkout', '-q', 'main');
  writeFileSync(join(repo, 'a.txt'), 'main\n');
  git('commit', '-q', '-am', 'main');
}

function resolveAndLeaveUnstagedEdit({ repo, git }) {
  writeFileSync(join(repo, 'a.txt'), 'resolved\n');
  git('add', 'a.txt');
  writeFileSync(join(repo, 'b.txt'), 'unstaged edit\n');
}

test('stash path refuses mid-merge and keeps MERGE_HEAD', (t) => {
  const ctx = makeRepo(t);
  conflictingBranches(ctx);
  assert.notEqual(ctx.git('merge', 'topic').status, 0);
  resolveAndLeaveUnstagedEdit(ctx);

  const result = ctx.runHook({ MISTBOARD_PRECOMMIT_STASH: '1' });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /merge, rebase, cherry-pick or revert is in progress/);
  assert.ok(existsSync(ctx.gitPath('MERGE_HEAD')), 'MERGE_HEAD must survive the hook');
  assert.equal(ctx.git('stash', 'list').stdout, '', 'no stash may be created');
  assert.equal(readFileSync(join(ctx.repo, 'b.txt'), 'utf8'), 'unstaged edit\n');
});

test('stash path refuses mid-cherry-pick and keeps CHERRY_PICK_HEAD', (t) => {
  const ctx = makeRepo(t);
  conflictingBranches(ctx);
  assert.notEqual(ctx.git('cherry-pick', 'topic').status, 0);
  resolveAndLeaveUnstagedEdit(ctx);

  const result = ctx.runHook({ MISTBOARD_PRECOMMIT_STASH: '1' });

  assert.equal(result.status, 1, result.stderr);
  assert.ok(existsSync(ctx.gitPath('CHERRY_PICK_HEAD')), 'CHERRY_PICK_HEAD must survive');
  assert.equal(ctx.git('stash', 'list').stdout, '');
});

test('stash path refuses mid-rebase', (t) => {
  const ctx = makeRepo(t);
  conflictingBranches(ctx);
  ctx.git('checkout', '-q', 'topic');
  assert.notEqual(ctx.git('rebase', 'main').status, 0);
  resolveAndLeaveUnstagedEdit(ctx);

  const result = ctx.runHook({ MISTBOARD_PRECOMMIT_STASH: '1' });

  assert.equal(result.status, 1, result.stderr);
  assert.equal(ctx.git('stash', 'list').stdout, '');
});

test('a clean mid-merge tree commits without touching the stash guard', (t) => {
  const ctx = makeRepo(t);
  conflictingBranches(ctx);
  ctx.git('merge', 'topic');
  writeFileSync(join(ctx.repo, 'a.txt'), 'resolved\n');
  ctx.git('add', 'a.txt');

  const result = ctx.runHook();

  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(ctx.gitPath('MERGE_HEAD')));
});

test('outside a merge the stash path still sets unstaged edits aside and restores them', (t) => {
  const ctx = makeRepo(t);
  writeFileSync(join(ctx.repo, 'a.txt'), 'staged\n');
  ctx.git('add', 'a.txt');
  writeFileSync(join(ctx.repo, 'b.txt'), 'unstaged edit\n');

  const result = ctx.runHook({ MISTBOARD_PRECOMMIT_STASH: '1' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(ctx.repo, 'b.txt'), 'utf8'), 'unstaged edit\n');
  assert.equal(ctx.git('stash', 'list').stdout, '');
});

test('without the opt-in, unstaged edits are refused as before', (t) => {
  const ctx = makeRepo(t);
  writeFileSync(join(ctx.repo, 'b.txt'), 'unstaged edit\n');

  const result = ctx.runHook();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to auto-stash/);
});
