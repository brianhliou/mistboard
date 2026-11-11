import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { commitLink } from './lib/changelog-entry.mjs';
import { gitFreeEnv } from './lib/git-free-env.mjs';

const script = path.resolve(import.meta.dirname, 'release-prod.mjs');

// Real disposable Git refs, index and release lock; only production reads and
// gate subprocesses are replaced. An accidental commit would change HEAD, and
// a remote write is trapped before it can touch even the fixture's remote.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-rehearse-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repo');
  const remote = path.join(directory, 'remote.git');
  mkdirSync(root);
  const env = {
    ...gitFreeEnv(),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.test',
    GIT_COMMITTER_EMAIL: 'fixture@example.test',
    MISTBOARD_RELEASE_LOCK: path.join(directory, 'release.lock'),
    MISTBOARD_RELEASE_LOG: path.join(directory, 'releases.jsonl'),
    MISTBOARD_GATE_STAMP_DIR: path.join(directory, 'stamps'),
    FIXTURE_EVENTS: path.join(directory, 'events.jsonl'),
  };
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (name, text) => writeFileSync(path.join(root, name), text);
  const commit = (subject) => {
    git('add', '.');
    git('commit', '-qm', subject);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'core.hooksPath', '/dev/null');
  write('CHANGELOG.md', '# Changelog\n');
  write('package-lock.json', '{}\n');
  write('feature.txt', 'before\n');
  commit('initial');
  git('clone', '--bare', '-q', root, remote);
  git('remote', 'add', 'origin', remote);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write('feature.txt', 'after\n');
  commit('fix: fixture feature');

  const preload = path.join(directory, 'effects.mjs');
  writeFileSync(
    preload,
    `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const original = childProcess.spawnSync;
const result = (stdout = '', status = 0) => ({ stdout, stderr: '', status });
childProcess.spawnSync = (command, args, options) => {
  appendFileSync(process.env.FIXTURE_EVENTS, JSON.stringify({ command, args,
    locked: existsSync(process.env.MISTBOARD_RELEASE_LOCK),
    changelog: readFileSync('CHANGELOG.md', 'utf8') }) + '\\n');
  if (command === 'git') {
    if (args.includes('push')) throw new Error('unexpected remote write');
    return original(command, args, options);
  }
  if (command === 'node' && args[0] === 'scripts/prod-smoke-plan.mjs') {
    return result('prod-smoke-plan: deploy_required=' + (process.env.FIXTURE_NO_DEPLOY ? 'false' : 'true') + '\\nreason: fixture\\n');
  }
  if (command === 'node' && args[0] === 'scripts/pre-push-check.mjs') {
    return result(JSON.stringify({ kind: 'targeted', reason: 'fixture', commands: [['npm', 'run', 'fixture-gate']] }));
  }
  if (command === 'npm') return result('', args.includes(process.env.FIXTURE_FAIL) ? 17 : 0);
  throw new Error('unexpected command: ' + command + ' ' + args.join(' '));
};
syncBuiltinESMExports();
globalThis.fetch = async () => ({ ok: true, json: async () => ({ activeGames: 0 }) });
`,
  );
  const snapshot = () => ({
    head: git('rev-parse', 'HEAD'),
    refs: git('show-ref'),
    remote: git('--git-dir', remote, 'show-ref'),
    index: git('write-tree'),
    status: git('status', '--porcelain'),
    changelog: readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'),
  });
  const run = (args, extraEnv = {}) => {
    writeFileSync(env.FIXTURE_EVENTS, '');
    const result = spawnSync(process.execPath, ['--import', preload, script, ...args], {
      cwd: root,
      env: { ...env, ...extraEnv },
      encoding: 'utf8',
    });
    const events = readFileSync(env.FIXTURE_EVENTS, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { ...result, output: result.stdout + result.stderr, events };
  };
  return { directory, root, remote, env, git, write, commit, snapshot, run };
}

test('changelog files combine with arguments and validate each line before any stage', (t) => {
  const f = fixture(t);
  const file = path.join(f.directory, 'entries.txt');
  writeFileSync(file, 'fixed: File entry\r\n\r\nTechnical: Second entry\r\n');
  const before = f.snapshot();
  const result = f.run([
    '--dry-run',
    '--plan-file',
    'CHANGELOG.md',
    '--changelog',
    'Site: Argument entry',
    '--changelog-file',
    file,
  ]);
  assert.equal(result.status, 0, result.output);
  for (const text of ['File entry', 'Second entry', 'Argument entry'])
    assert.match(result.stdout, new RegExp(text));
  assert.deepEqual(f.snapshot(), before);
  writeFileSync(file, 'Fixed: Invalid period.\n');
  const invalid = f.run(['--rehearse', '--changelog-file', file]);
  assert.equal(invalid.status, 2, invalid.output);
  assert.match(invalid.stderr, /entries\.txt:1.*no trailing period/);
  assert.match(invalid.stderr, /# rehearsal stage summary/);
  assert.deepEqual(invalid.events, []);
  assert.deepEqual(f.snapshot(), before);
});

test('rehearsal enforces the ship window before taking a lock or running gates', (t) => {
  const f = fixture(t);
  writeFileSync(
    f.env.MISTBOARD_RELEASE_LOG,
    `${JSON.stringify({
      push: true,
      pushCompleted: true,
      deployRequired: true,
      pushedAt: new Date().toISOString(),
      head: f.git('--git-dir', f.remote, 'rev-parse', 'main'),
    })}\n`,
  );
  const before = f.snapshot();
  const result = f.run(['--rehearse']);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /release refused before the release lock/);
  assert.match(result.output, /ship window before lock: failed/);
  assert.equal(existsSync(f.env.MISTBOARD_RELEASE_LOCK), false);
  assert.ok(!result.events.some((event) => event.command === 'npm'));
  assert.deepEqual(f.snapshot(), before);
});

test('rehearsal refuses a main catch-up that would change HEAD', (t) => {
  const f = fixture(t);
  const tree = f.git('--git-dir', f.remote, 'rev-parse', 'main^{tree}');
  const parent = f.git('--git-dir', f.remote, 'rev-parse', 'main');
  const moved = f.git('--git-dir', f.remote, 'commit-tree', tree, '-p', parent, '-m', 'moved main');
  f.git('--git-dir', f.remote, 'update-ref', 'refs/heads/main', moved);
  const before = f.snapshot();
  const result = f.run(['--rehearse']);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /merge it before --rehearse/);
  assert.equal(f.git('rev-parse', 'HEAD'), before.head);
  assert.equal(f.git('--git-dir', f.remote, 'show-ref'), before.remote);
  assert.ok(
    !result.events.some((event) => event.args.includes('commit') || event.command === 'npm'),
  );
  assert.equal(existsSync(f.env.MISTBOARD_RELEASE_LOCK), false);
});

test('a non-deploy rehearsal runs the gate and skips production smokes', (t) => {
  const f = fixture(t);
  const before = f.snapshot();
  const result = f.run(['--rehearse'], { FIXTURE_NO_DEPLOY: '1' });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(
    result.events.filter((event) => event.command === 'npm').map((event) => event.args[1]),
    ['fixture-gate'],
  );
  assert.deepEqual(f.snapshot(), before);
});

test('rehearsal gates and smokes without changing HEAD, local refs, remote refs or changelog', (t) => {
  const f = fixture(t);
  const before = f.snapshot();
  const result = f.run(['--rehearse', '--changelog', 'Fixed: Rehearsal entry']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /hosted_ci_required=true/);
  assert.match(result.stdout, /rehearsal: ok/);
  assert.match(result.stdout, /# rehearsal stage summary/);
  const commands = result.events.filter((event) => event.command === 'npm');
  assert.deepEqual(
    commands.map((event) => event.args[1]),
    ['test:unit', 'fixture-gate', 'release:local-smoke'],
  );
  assert.match(commands[0].changelog, /Rehearsal entry/);
  assert.ok(commands.every((event) => event.locked));
  assert.ok(
    !result.events.some((event) => event.args.includes('push') || event.args.includes('commit')),
  );
  assert.deepEqual(f.snapshot(), before);
  assert.equal(existsSync(f.env.MISTBOARD_RELEASE_LOCK), false);
  assert.equal(existsSync(f.env.MISTBOARD_RELEASE_LOG), false);
});

for (const stage of ['test:unit', 'fixture-gate', 'release:local-smoke']) {
  test(`rehearsal stops on failed ${stage}, restores the changelog and drops its lock`, (t) => {
    const f = fixture(t);
    const before = f.snapshot();
    const result = f.run(['--rehearse', '--changelog', 'Fixed: Rehearsal entry'], {
      FIXTURE_FAIL: stage,
    });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /# rehearsal stage summary/);
    assert.match(result.output, /failed/);
    const commands = result.events.filter((event) => event.command === 'npm');
    assert.equal(commands.at(-1).args[1], stage);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(existsSync(f.env.MISTBOARD_RELEASE_LOCK), false);
  });
}

for (const flag of ['--push', '--dry-run', '--gate-only', '--skip-local-ci']) {
  test(`rehearsal rejects ${flag}`, (t) => {
    const f = fixture(t);
    const result = f.run(['--rehearse', flag]);
    assert.equal(result.status, 2, result.output);
    assert.match(result.stderr, /--rehearse cannot be combined/);
    assert.deepEqual(result.events, []);
  });
}

test('a changelog HEAD reuses exactly its own additions and reports differing headings or lines', (t) => {
  const f = fixture(t);
  f.write(
    'CHANGELOG.md',
    `# Changelog\n\n## 2026-11\n\n### Site\n\n- Earlier entry ${commitLink('11111111')}\n`,
  );
  f.write('feature.txt', 'earlier\n');
  f.commit('fix: earlier entry');
  const prior = readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8');
  f.write(
    'CHANGELOG.md',
    `${prior}\n### Fixed\n\n- Retry one ${commitLink('22222222')}\n- Retry two ${commitLink('22222222')}\n`,
  );
  f.commit('docs(changelog): fixture retry');
  const before = f.snapshot();
  const run = (...lines) =>
    f.run([
      '--dry-run',
      '--plan-file',
      'CHANGELOG.md',
      ...lines.flatMap((line) => ['--changelog', line]),
    ]);
  const same = run('Fixed: Retry two', 'Fixed: Retry one');
  assert.equal(same.status, 0, same.output);
  assert.match(same.stdout, /reuse committed lines/);
  for (const lines of [
    ['Fixed: Retry one'],
    ['Site: Retry one', 'Fixed: Retry two'],
    ['Fixed: Different entry', 'Fixed: Retry two'],
    ['Site: Earlier entry', 'Fixed: Retry one', 'Fixed: Retry two'],
  ]) {
    const result = run(...lines);
    assert.equal(result.status, 1, result.output);
    assert.match(result.stderr, /changelog commit differs/);
    assert.match(result.stderr, /[-+] (Fixed|Site):/);
  }
  assert.deepEqual(f.snapshot(), before);
});
