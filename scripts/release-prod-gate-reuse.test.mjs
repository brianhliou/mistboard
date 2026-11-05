import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureGateStamp, readGateStamp, writeGateStamp } from './lib/gate-stamp.mjs';

function repository(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'mistboard-real-gate-'));
  const root = path.join(directory, 'repo');
  const previous = process.env.MISTBOARD_GATE_STAMP_DIR;
  process.env.MISTBOARD_GATE_STAMP_DIR = path.join(directory, 'stamps');
  t.after(() => {
    if (previous === undefined) delete process.env.MISTBOARD_GATE_STAMP_DIR;
    else process.env.MISTBOARD_GATE_STAMP_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q', root);
  const repoGit = (...args) => git('-C', root, ...args);
  const commit = () =>
    repoGit(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-qm',
      'fixture',
      '--allow-empty',
    );
  const write = (name, value) => writeFileSync(path.join(root, name), value);
  write('package-lock.json', '{"lockfileVersion":3}');
  write('source.txt', 'original');
  repoGit('add', '-A');
  commit();
  return { root, git: repoGit, commit, write, snapshot: () => captureGateStamp({ root }) };
}

test('release evidence covers working files without changing the real index or keying on HEAD', (t) => {
  const repo = repository(t);
  const initial = repo.snapshot();
  assert.ok(initial);
  const lock = createHash('sha256')
    .update(readFileSync(path.join(repo.root, 'package-lock.json')))
    .digest('hex');
  assert.equal(path.basename(initial.path), `${repo.git('write-tree')}-${lock}.json`);
  repo.commit();
  const sameTree = repo.snapshot();
  assert.notEqual(sameTree.head, initial.head);
  assert.equal(sameTree.path, initial.path, 'metadata-only commits keep the same gate key');

  repo.write('source.txt', 'staged');
  repo.git('add', 'source.txt');
  const indexPath = path.join(repo.root, '.git/index');
  const stagedIndex = readFileSync(indexPath);
  const staged = repo.snapshot();
  assert.notEqual(staged.path, initial.path);
  assert.deepEqual(readFileSync(indexPath), stagedIndex);

  repo.write('source.txt', 'unstaged on top of staged');
  const unstaged = repo.snapshot();
  assert.notEqual(unstaged.path, staged.path);
  assert.deepEqual(readFileSync(indexPath), stagedIndex);

  repo.write('new.txt', 'untracked');
  const untracked = repo.snapshot();
  assert.notEqual(untracked.path, unstaged.path);
  assert.deepEqual(readFileSync(indexPath), stagedIndex);

  unlinkSync(path.join(repo.root, 'source.txt'));
  const deleted = repo.snapshot();
  assert.notEqual(deleted.path, untracked.path);
  assert.deepEqual(readFileSync(indexPath), stagedIndex);
});

test('release rejects failed, skipped, malformed and changed-during-run evidence', (t) => {
  const repo = repository(t);
  const snapshot = repo.snapshot();
  const results = [
    { command: ['npm', 'run', 'lint'], status: 'passed', durationMs: 12 },
    { command: ['npm', 'run', 'build'], status: 'failed', durationMs: 34 },
    { command: ['npm', 'run', 'typecheck'], status: 'skipped', durationMs: 0 },
  ];
  writeGateStamp(snapshot, 'quick', results, { root: repo.root });
  assert.deepEqual(readGateStamp(snapshot), [{ name: 'npm run lint', ok: true, ms: 12 }]);
  repo.write('source.txt', 'changed during gate');
  assert.deepEqual(readGateStamp(repo.snapshot()), []);
  writeGateStamp(snapshot, 'quick', results, { root: repo.root });
  assert.deepEqual(readGateStamp(snapshot), [], 'a mixed-tree gate must not certify either tree');
  writeFileSync(snapshot.path, '{partial');
  assert.deepEqual(readGateStamp(snapshot), []);
});

test('release help documents the force-run escape hatch', () => {
  const result = spawnSync(process.execPath, ['scripts/release-prod.mjs', '--help'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--no-gate-reuse\s+Run every selected gate stage/);
});

test("the release's own changelog commit keeps the pre-ship gate key; other edits do not", (t) => {
  const repo = repository(t);
  repo.write('CHANGELOG.md', '## 2026-11\n');
  repo.git('add', 'CHANGELOG.md');
  repo.commit();
  const preship = repo.snapshot();
  repo.write('CHANGELOG.md', '## 2026-11\n\n### Fixed\n\n- A line the release inserts\n');
  repo.git('add', 'CHANGELOG.md');
  repo.commit();
  assert.equal(
    repo.snapshot().path,
    preship.path,
    '--changelog runs before the gate and must not miss',
  );
  repo.write('source.txt', 'a code change');
  assert.notEqual(repo.snapshot().path, preship.path);
});
