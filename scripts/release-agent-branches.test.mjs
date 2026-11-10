import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertAgentBranchesAccountedFor,
  readUnshippedAgentBranches,
} from './lib/agent-branches.mjs';

// Keep the tooling suite's Node runner and targeted Vitest invocations compatible.
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');

const releaseScript = new URL('./release-prod.mjs', import.meta.url).pathname;
const packageScripts = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url)),
).scripts;

function repository(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'mistboard-agent-branches-'));
  (t.after ?? t.onTestFinished)(() => rmSync(directory, { recursive: true, force: true }));
  const run = (command, args, cwd = directory) =>
    spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
        MISTBOARD_RELEASE_LOG: path.join(directory, 'release.jsonl'),
        MISTBOARD_RELEASE_LOCK: path.join(directory, 'release.lock'),
      },
    });
  const git = (...args) => {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', '--local', 'user.name', 'Fixture');
  git('config', '--local', 'user.email', 'fixture@example.test');
  git('config', '--local', 'core.hooksPath', '/dev/null');
  let commitCount = 0;
  const commit = () => git('commit', '-qm', `fixture ${++commitCount}`, '--allow-empty');
  commit();
  const base = git('rev-parse', 'HEAD');
  git('remote', 'add', 'origin', directory);
  git('update-ref', 'refs/remotes/origin/main', base);
  git('switch', '-qc', 'agent/ship-fixture');
  // The real npm entrypoints run in the fixture, never the operator's repo.
  symlinkSync(new URL('.', import.meta.url).pathname, path.join(directory, 'scripts'), 'dir');
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({
      scripts: Object.fromEntries(
        ['branch:park', 'branch:unpark', 'branch:parked'].map((name) => [
          name,
          packageScripts[name],
        ]),
      ),
    }),
  );
  writeFileSync(path.join(directory, '.gitignore'), 'scripts\npackage.json\nrelease.jsonl\n');
  git('add', '.gitignore');
  commit();
  const plant = (branch) => {
    git('switch', '-qc', branch, base);
    commit();
    git('switch', '-q', 'agent/ship-fixture');
  };
  const dryRun = (...args) =>
    run(process.execPath, [
      releaseScript,
      '--dry-run',
      '--plan-file',
      'scripts/example.mjs',
      '--smoke',
      'none',
      ...args,
    ]);
  const npm = (...args) => run('npm', ['run', ...args]);
  const check = () => {
    const lines = [];
    assertAgentBranchesAccountedFor({ root: directory, log: (line) => lines.push(line) });
    return lines.join('\n');
  };
  return { directory, git, run, plant, dryRun, npm, check, base };
}

test('a planted unmarked branch refuses dry run and push planning with its exact park command', (t) => {
  const repo = repository(t);
  repo.plant('agent/forgotten');
  repo.plant('agent/also-forgotten');
  for (const args of [[], ['--push']]) {
    const result = repo.dryRun(...args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /agent_branches: refuse \(2 unmarked, 0 parked\)/);
    for (const branch of ['agent/forgotten', 'agent/also-forgotten']) {
      assert.ok(result.stdout.includes(`npm run branch:park -- '${branch}' "<reason>"`));
      assert.ok(result.stderr.includes(branch));
    }
    assert.doesNotMatch(result.stdout, /release lock: held by this release|git push/);
  }
  assert.throws(repo.check, /release refused/);
});

test('a parked branch passes and the dry run lists its date and reason', (t) => {
  const repo = repository(t);
  repo.plant('agent/later');
  const mark = repo.npm('branch:park', '--', 'agent/later', 'waiting for review');
  assert.equal(mark.status, 0, mark.stderr);
  const result = repo.dryRun();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agent_branches: allow \(0 unmarked, 1 parked\)/);
  assert.match(result.stdout, /parked: \d{4}-\d{2}-\d{2} waiting for review/);
  assert.match(result.stdout, /# release plan \(dry run\)/);
});

test('branches merged into HEAD or origin/main are ignored, as are agent/ship-* branches', (t) => {
  const repo = repository(t);
  repo.plant('agent/in-batch');
  repo.git('merge', '--no-edit', 'agent/in-batch');
  repo.plant('agent/already-shipped');
  repo.git('update-ref', 'refs/remotes/origin/main', 'agent/already-shipped');
  repo.plant('agent/ship-other-batch');
  repo.plant('unrelated/topic');
  assert.equal(
    new Set(
      ['agent/in-batch', 'agent/already-shipped', 'agent/ship-other-batch'].map((branch) =>
        repo.git('rev-parse', branch),
      ),
    ).size,
    3,
  );
  assert.deepEqual(readUnshippedAgentBranches({ root: repo.directory }), []);
  assert.match(repo.check(), /agent_branches: allow \(0 unmarked, 0 parked\)/);
  const result = repo.dryRun();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /park: npm run branch:park/);
});

test('new commits on a partly merged branch remain unaccounted for', (t) => {
  const repo = repository(t);
  repo.plant('agent/partial');
  repo.git('merge', '--no-edit', 'agent/partial');
  repo.git('switch', '-q', 'agent/partial');
  repo.git('commit', '-qm', 'new work', '--allow-empty');
  repo.git('switch', '-q', 'agent/ship-fixture');
  assert.throws(repo.check, /agent\/partial/);
});

test('a branch contained in another ship batch is automatically parked without a config mark', (t) => {
  const repo = repository(t);
  repo.plant('agent/riding-next-batch');
  repo.git('branch', 'agent/ship-next', 'agent/riding-next-batch');
  const result = repo.dryRun();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /in batch agent\/ship-next/);
  assert.match(result.stdout, /agent_branches: allow \(0 unmarked, 1 parked\)/);
  assert.doesNotMatch(result.stdout, /park: npm run branch:park/);
  assert.equal(
    repo.run('git', ['config', '--get', 'branch.agent/riding-next-batch.mistboardParked']).status,
    1,
  );
});

test('a branch outside every batch still refuses, including new work after a batch merge', (t) => {
  const repo = repository(t);
  repo.plant('agent/partly-in-next-batch');
  repo.git('branch', 'agent/ship-next', 'agent/partly-in-next-batch');
  repo.git('switch', '-q', 'agent/partly-in-next-batch');
  repo.git('commit', '-qm', 'work after batch assembly', '--allow-empty');
  repo.git('switch', '-q', 'agent/ship-fixture');
  repo.plant('agent/in-no-batch');
  const result = repo.dryRun();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /agent_branches: refuse \(2 unmarked, 0 parked\)/);
  assert.match(result.stderr, /agent\/in-no-batch/);
  assert.match(result.stderr, /agent\/partly-in-next-batch/);
  assert.doesNotMatch(result.stdout, /in batch agent\/ship-next/);
});

test('npm park/list/unpark round-trip uses local config shared across worktrees', (t) => {
  const repo = repository(t);
  repo.plant('agent/round-trip');
  const other = path.join(repo.directory, 'other-worktree');
  repo.git('worktree', 'add', '-q', '--detach', other, repo.base);
  const script = new URL('./branch-park.mjs', import.meta.url).pathname;
  const parked = repo.run(
    process.execPath,
    [script, 'park', 'agent/round-trip', 'needs a decision'],
    other,
  );
  assert.equal(parked.status, 0, parked.stderr);
  const stored = repo.git('config', '--local', '--get', 'branch.agent/round-trip.mistboardParked');
  assert.match(stored, /^\d{4}-\d{2}-\d{2} needs a decision$/);
  const listed = repo.npm('branch:parked');
  assert.equal(listed.status, 0, listed.stderr);
  assert.ok(listed.stdout.includes(`agent/round-trip\t${stored.replace(' ', '\t')}`));
  assert.doesNotThrow(repo.check);
  const unparked = repo.npm('branch:unpark', '--', 'agent/round-trip');
  assert.equal(unparked.status, 0, unparked.stderr);
  assert.equal(
    repo.run('git', ['config', '--local', '--get', 'branch.agent/round-trip.mistboardParked'])
      .status,
    1,
  );
  assert.throws(repo.check, /agent\/round-trip/);
  assert.equal(repo.npm('branch:unpark', '--', 'agent/round-trip').status, 0);
  assert.doesNotMatch(repo.npm('branch:parked').stdout, /needs a decision/);
});

test('blank reasons, nonexistent branches and malformed marks cannot satisfy the gate', (t) => {
  const repo = repository(t);
  repo.plant('agent/invalid');
  for (const args of [
    ['agent/invalid', '   '],
    ['agent/missing', 'waiting'],
    ['agent/invalid', 'two\nlines'],
  ]) {
    assert.equal(repo.npm('branch:park', '--', ...args).status, 1);
  }
  repo.git('config', '--local', 'branch.agent/invalid.mistboardParked', '2026-11-08 ');
  assert.throws(repo.check, /agent\/invalid/);
  repo.git('update-ref', '-d', 'refs/remotes/origin/main');
  assert.throws(repo.check, /git rev-parse failed/);
});
