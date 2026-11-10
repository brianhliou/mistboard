import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findReusableBatchCi, readBatchRun, runBatchCi } from './lib/batch-ci.mjs';

// The repository tooling uses Node; the task's targeted checks use Vitest.
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
const script = new URL('./batch-ci.mjs', import.meta.url).pathname;
const releaseSource = readFileSync(new URL('./release-prod.mjs', import.meta.url), 'utf8');

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'mistboard-batch-ci-'));
  (t.after ?? t.onTestFinished)(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'worktree');
  const remote = path.join(directory, 'origin.git');
  const bin = path.join(directory, 'bin');
  for (const dir of [root, bin]) mkdirSync(dir);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', '--local', 'user.name', 'Fixture');
  git('config', '--local', 'user.email', 'fixture@example.test');
  git('config', '--local', 'core.hooksPath', '/dev/null');
  git('init', '-q', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  writeFileSync(path.join(root, 'app.txt'), 'application\n');
  writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n');
  const commit = () => {
    git('add', '-A');
    git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const revision = commit();
  const commands = path.join(directory, 'commands.jsonl');
  const state = path.join(directory, 'state.json');
  writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(commands)}, JSON.stringify(args) + '\\n');
const state = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
console.log(JSON.stringify(args[1] === 'view' ? { jobs: state.jobs } : state.runs));
`,
  );
  chmodSync(path.join(bin, 'gh'), 0o755);
  const green = (sha = revision) => ({
    databaseId: 123,
    headSha: sha,
    status: 'completed',
    conclusion: 'success',
    url: 'https://example.test/ci/123',
  });
  const setState = (runs, jobs = []) => writeFileSync(state, JSON.stringify({ runs, jobs }));
  setState([green()]);
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const invoke = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: directory,
      encoding: 'utf8',
      env,
    });
  const withGh = (work) => {
    const previous = process.env.PATH;
    process.env.PATH = env.PATH;
    try {
      return work();
    } finally {
      process.env.PATH = previous;
    }
  };
  return { root, remote, git, commit, revision, green, setState, invoke, withGh, commands };
}

test('batch:ci pushes the target worktree HEAD and queries only its exact candidate push run', (t) => {
  const repo = fixture(t);
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts;
  assert.equal(scripts['batch:ci'], 'node scripts/batch-ci.mjs');
  const result = repo.invoke(repo.root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /hosted CI passed: https:\/\/example.test\/ci\/123/);
  assert.equal(
    repo.git('--git-dir', repo.remote, 'rev-parse', `refs/heads/release/${repo.revision}`),
    repo.revision,
  );
  assert.equal(
    repo.git('--git-dir', repo.remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/main'),
    '',
  );
  const command = JSON.parse(readFileSync(repo.commands, 'utf8').trim());
  for (const [flag, value] of [
    ['--branch', `release/${repo.revision}`],
    ['--commit', repo.revision],
    ['--workflow', 'ci.yml'],
    ['--event', 'push'],
  ])
    assert.equal(command[command.indexOf(flag) + 1], value);
});

test('batch:ci prints failed jobs and exits nonzero without publishing main', (t) => {
  const repo = fixture(t);
  repo.setState(
    [{ ...repo.green(), conclusion: 'failure' }],
    [
      { name: 'Build', conclusion: 'failure' },
      { name: 'Lint', conclusion: 'success' },
    ],
  );
  const result = repo.invoke(repo.root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /failed job: Build \(failure\)/);
  assert.doesNotMatch(result.stdout, /failed job: Lint/);
  assert.match(result.stderr, /hosted CI failed/);
  assert.equal(
    repo.git('--git-dir', repo.remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/main'),
    '',
  );
});

test('batch:ci refuses dirty tracked or untracked work before pushing', (t) => {
  const repo = fixture(t);
  for (const file of ['app.txt', 'untracked.txt']) {
    writeFileSync(path.join(repo.root, file), 'uncommitted\n');
    const result = repo.invoke(repo.root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /clean worktree/);
    repo.git('checkout', '--', 'app.txt');
  }
  assert.equal(repo.git('--git-dir', repo.remote, 'for-each-ref', '--format=%(refname)'), '');
});

test('batch wait handles missing, wrong-SHA and in-progress runs before exact success', async (t) => {
  const repo = fixture(t);
  const states = [
    null,
    repo.green('f'.repeat(40)),
    { ...repo.green(), status: 'in_progress' },
    repo.green(),
  ];
  let time = 0;
  const result = await runBatchCi({
    root: repo.root,
    log: () => {},
    readRun: () => states.shift(),
    now: () => time,
    pollMs: 1,
    timeoutMs: 10,
    wait: async () => {
      time++;
    },
  });
  assert.equal(result.headSha, repo.revision);
  assert.equal(time, 3);
});

test('batch wait times out and rejects every completed non-success conclusion', async (t) => {
  const repo = fixture(t);
  let time = 0;
  await assert.rejects(
    runBatchCi({
      root: repo.root,
      log: () => {},
      readRun: () => null,
      now: () => time,
      pollMs: 1,
      timeoutMs: 2,
      wait: async () => {
        time++;
      },
    }),
    /timed out/,
  );
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', null]) {
    let printed = false;
    await assert.rejects(
      runBatchCi({
        root: repo.root,
        log: () => {},
        readRun: () => ({ ...repo.green(), conclusion }),
        failedJobs: () => {
          printed = true;
        },
      }),
      /hosted CI failed/,
    );
    assert.equal(printed, true);
  }
});

test('CI lookup never selects an older green attempt or a different SHA', (t) => {
  const repo = fixture(t);
  repo.setState([
    repo.green('f'.repeat(40)),
    { ...repo.green(), conclusion: 'failure' },
    repo.green(),
  ]);
  const run = repo.withGh(() => readBatchRun({ root: repo.root, revision: repo.revision }));
  assert.equal(run.conclusion, 'failure');
});

test('a green batch run can cover the same HEAD or its sole changelog child', (t) => {
  const repo = fixture(t);
  const queries = [];
  const findRun = (revision, branch) => {
    queries.push([revision, branch]);
    return revision === repo.revision ? repo.green() : null;
  };
  assert.equal(
    findReusableBatchCi({ root: repo.root, headRevision: repo.revision, findRun }).headSha,
    repo.revision,
  );
  writeFileSync(path.join(repo.root, 'CHANGELOG.md'), '# Changelog\n\nNew entry\n');
  const headRevision = repo.commit();
  assert.equal(
    findReusableBatchCi({ root: repo.root, headRevision, findRun }).headSha,
    repo.revision,
  );
  assert.deepEqual(queries.at(-1), [repo.revision, `release/${repo.revision}`]);
});

test('any tree change beyond CHANGELOG.md prevents reuse of the assembled batch', (t) => {
  const repo = fixture(t);
  // Each planted path, including a misleading leading space, must invalidate reuse.
  for (const file of ['app.txt', ' CHANGELOG.md']) {
    repo.git('reset', '--hard', repo.revision);
    writeFileSync(path.join(repo.root, 'CHANGELOG.md'), 'new entry\n');
    writeFileSync(path.join(repo.root, file), 'changed\n');
    const headRevision = repo.commit();
    const queried = [];
    const reused = findReusableBatchCi({
      root: repo.root,
      headRevision,
      findRun: (revision) => {
        queried.push(revision);
        return revision === repo.revision ? repo.green() : null;
      },
    });
    assert.equal(reused, null);
    assert.deepEqual(queried, [headRevision]);
  }
});

test('failed, cancelled, pending and mismatched runs cannot be reused', (t) => {
  const repo = fixture(t);
  for (const run of [
    { ...repo.green(), conclusion: 'failure' },
    { ...repo.green(), conclusion: 'cancelled' },
    { ...repo.green(), status: 'in_progress' },
    repo.green('f'.repeat(40)),
    null,
  ]) {
    assert.equal(
      findReusableBatchCi({ root: repo.root, headRevision: repo.revision, findRun: () => run }),
      null,
    );
  }
});

test('release uses the tree-checked lookup and falls back to fresh CI if lookup fails', (t) => {
  const repo = fixture(t);
  const start = releaseSource.indexOf('function findReusableBatchRun(');
  assert.ok(start > 0);
  const declaration = releaseSource.slice(start, releaseSource.indexOf('\n}', start) + 2);
  const logs = [];
  const build = (findGithubRun) =>
    new Function(
      'findReusableBatchCi',
      'workdir',
      'release',
      'findGithubRun',
      'console',
      `${declaration}\nreturn findReusableBatchRun();`,
    )(findReusableBatchCi, repo.root, { headRevision: repo.revision }, findGithubRun, {
      log: (line) => logs.push(line),
    });
  assert.equal(build(() => repo.green()).headSha, repo.revision);
  assert.equal(
    build(() => {
      throw new Error('GitHub unavailable');
    }),
    null,
  );
  assert.match(logs.join('\n'), /testing a fresh candidate/);
});
