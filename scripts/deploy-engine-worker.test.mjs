import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './deploy-engine-worker.mjs';
import {
  appendDeployment,
  baselineMatchesDeployment,
  checkEngineCi,
  compareEngine,
  evaluateEngineCi,
  lockDeployment,
  newDeploymentId,
  printDeploymentPlan,
  readBaseline,
} from './lib/engine-deploy-plan.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const WORKER = 'c'.repeat(40);
const CLI = fileURLToPath(new URL('./deploy-engine-worker.mjs', import.meta.url));
const greenRun = {
  databaseId: 10,
  headSha: HEAD,
  headBranch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  url: 'https://github.com/example/actions/runs/10',
};

function temp(t) {
  const directory = mkdtempSync(join(tmpdir(), 'engine-deploy-safety-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('CI accepts only completed success on the exact SHA, main, and push; a newer failure/pending run wins', () => {
  assert.equal(evaluateEngineCi([greenRun], HEAD).passed, true);
  for (const change of [
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { conclusion: 'skipped' },
    { status: 'in_progress', conclusion: '' },
    { status: 'queued', conclusion: null },
    { headSha: BASE },
    { headBranch: 'experiment' },
    { event: 'pull_request' },
  ])
    assert.equal(evaluateEngineCi([{ ...greenRun, ...change }], HEAD).passed, false);
  assert.equal(
    evaluateEngineCi([greenRun, { ...greenRun, databaseId: 11, conclusion: 'failure' }], HEAD)
      .passed,
    false,
  );
  // A rerun replaces the status on that run ID, so a single pending rerun fails.
  assert.equal(
    evaluateEngineCi([{ ...greenRun, status: 'in_progress', conclusion: '' }], HEAD).passed,
    false,
  );
  assert.equal(evaluateEngineCi([], HEAD).passed, false);
  assert.throws(() => evaluateEngineCi([], 'aaaaaaa'), /full commit/);
});

test('CI lookup pins the workflow and full SHA; missing/error responses fail closed', () => {
  let invocation;
  assert.equal(
    checkEngineCi(HEAD, (command, args) => {
      invocation = [command, args];
      return JSON.stringify([greenRun]);
    }).passed,
    true,
  );
  assert.equal(invocation[0], 'gh');
  assert.ok(invocation[1].includes(HEAD));
  assert.ok(invocation[1].includes('ci.yml'));
  assert.throws(() => checkEngineCi(HEAD, () => '{}'), /Invalid/);
  assert.throws(
    () =>
      checkEngineCi(HEAD, () => {
        throw new Error('unavailable');
      }),
    /unavailable/,
  );
});

test('journal uses only the most recent healthy deployment, and detects manual/new deployments', (t) => {
  const file = join(temp(t), 'deployments.jsonl');
  assert.equal(readBaseline(file), null);
  appendDeployment(file, {
    engineSha: HEAD,
    mistboardSha: WORKER,
    deploymentId: 'worker-1',
    status: 'healthy',
  });
  const baseline = readBaseline(file);
  assert.equal(baseline.engineSha, HEAD);
  assert.equal(baselineMatchesDeployment(baseline, [{ id: 'worker-1', status: 'SUCCESS' }]), true);
  assert.equal(
    baselineMatchesDeployment(baseline, [{ id: 'manual-deploy', status: 'SUCCESS' }]),
    false,
  );
  assert.equal(baselineMatchesDeployment(baseline, [{ id: 'worker-1', status: 'CRASHED' }]), false);
  for (const status of ['started', 'upload-failed', 'boot-failed', 'unknown']) {
    appendDeployment(file, { engineSha: HEAD, mistboardSha: WORKER, status });
    assert.equal(readBaseline(file), null);
  }
  assert.throws(() => readBaseline(file, { baselineEngine: HEAD }), /both/);
  assert.equal(
    readBaseline(file, { baselineEngine: BASE, baselineMistboard: WORKER }).source,
    'explicit verified baseline',
  );
  writeFileSync(file, 'corrupt');
  assert.throws(() => readBaseline(file), /Cannot read/);
});

test('the deployment lock excludes another session and is removed after release', (t) => {
  const file = join(temp(t), 'deployments.jsonl');
  const release = lockDeployment(file, { engineSha: HEAD });
  assert.throws(() => lockDeployment(file, {}), /lock exists/);
  release();
  assert.equal(existsSync(`${file}.lock`), false);
});

test('new deployment selection refuses missing or ambiguous IDs', () => {
  const before = [{ id: 'old' }];
  assert.equal(newDeploymentId([{ id: 'new' }, ...before], before), 'new');
  assert.throws(() => newDeploymentId(before, before), /uniquely/);
  assert.throws(() => newDeploymentId([{ id: 'new' }, { id: 'other' }], before), /uniquely/);
});

function comparison(changes = {}) {
  return [
    {
      status: 'ahead',
      base: BASE,
      mergeBase: BASE,
      total_commits: 1,
      commits: [{ sha: HEAD, subject: 'runtime fix and lab work' }],
      files: [
        { filename: 'src/live_move.py', status: 'modified' },
        { filename: 'lab/bakeoff.py', status: 'added' },
      ],
      ...changes,
    },
  ];
}

test('engine changes expose runtime files beside lab work and reject incomplete comparisons', () => {
  const changes = compareEngine(BASE, HEAD, () => JSON.stringify(comparison()));
  assert.deepEqual(
    changes.files.map((file) => file.kind),
    ['runtime/build', 'lab'],
  );
  const renamed = compareEngine(BASE, HEAD, () =>
    JSON.stringify(
      comparison({
        files: [{ filename: 'lab/old.py', previous_filename: 'src/live.py', status: 'renamed' }],
      }),
    ),
  );
  assert.equal(renamed.files[0].kind, 'runtime/build');
  for (const change of [
    { status: 'diverged' },
    { mergeBase: WORKER },
    { total_commits: 2 },
    { commits: [{ sha: WORKER }] },
    {
      files: Array.from({ length: 300 }, (_, n) => ({ filename: `src/${n}.py`, status: 'added' })),
    },
  ])
    assert.throws(
      () => compareEngine(BASE, HEAD, () => JSON.stringify(comparison(change))),
      /incomplete/,
    );
  const output = [];
  printDeploymentPlan(
    { engineSha: HEAD, mistboardSha: WORKER, ci: { description: 'success' }, baseline: null },
    (line) => output.push(line),
  );
  assert.match(output.join('\n'), /baseline UNKNOWN/);
  assert.doesNotMatch(output.join('\n'), /commits included: 0/);
});

test('argument parsing rejects accidental override, incomplete value and conflicting bump/deploy', () => {
  assert.equal(
    parseArgs(['--override-engine-ci', 'urgent recovery']).overrideReason,
    'urgent recovery',
  );
  for (const args of [
    ['--override-engine-ci'],
    ['--override-engine-ci', '--deploy'],
    ['--override-engine-ci', ' '],
    ['--bump', '--deploy'],
    ['--baseline-engine', HEAD, '--baseline-engine', HEAD],
  ]) {
    assert.throws(() => parseArgs(args));
  }
});

function fixture(t) {
  const directory = temp(t);
  const repo = join(directory, 'repo');
  const bin = join(directory, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  const gitBinary = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  const git = (...args) => {
    const result = spawnSync(gitBinary, args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('config', 'user.name', 'Engine deploy test');
  git('config', 'user.email', 'engine-deploy@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(
    join(repo, 'railpack.json'),
    JSON.stringify({ build: ['echo cachebust-engine-aaaaaaa'] }),
  );
  writeFileSync(join(repo, 'engine.ref'), HEAD);
  writeFileSync(
    join(repo, 'railway.engine-worker.json'),
    JSON.stringify({
      build: {
        watchPatterns: [
          '/apps/server/**',
          '!/apps/server/**/*.test.ts',
          '/scripts/fetch-release-asset.sh',
        ],
      },
    }),
  );
  git('add', '.');
  git('commit', '-qm', 'baseline');
  const baseline = git('rev-parse', 'HEAD');
  mkdirSync(join(repo, 'apps/server/src/engines'), { recursive: true });
  writeFileSync(join(repo, 'apps/server/src/engines/registry.ts'), 'new engine id');
  git('add', '.');
  git('commit', '-qm', 'worker registry rider');
  mkdirSync(join(repo, 'scripts'));
  writeFileSync(join(repo, 'scripts/fetch-release-asset.sh'), 'new binary asset');
  git('add', '.');
  git('commit', '-qm', 'binary asset rider');
  writeFileSync(join(repo, 'README.md'), 'unrelated web documentation');
  git('add', '.');
  git('commit', '-qm', 'unrelated docs');
  const executable = (name, source) =>
    writeFileSync(join(bin, name), `#!${process.execPath}\n${source}`, { mode: 0o755 });
  executable(
    'git',
    `const {spawnSync}=require('node:child_process'); const args=process.argv.slice(2); if(args[0]==='ls-remote'){ console.log('${HEAD} refs/heads/main'); } else {const r=spawnSync(${JSON.stringify(gitBinary)},args,{stdio:'inherit'});process.exitCode=r.status??1;}`,
  );
  executable(
    'gh',
    `const args=process.argv.slice(2); if(args.includes('--slurp')&&args.includes('--jq'))process.exit(1); if(process.env.ENGINE_TEST_CI==='unavailable'){process.stderr.write('fixture-private-value');process.exit(1);} if(args[0]==='run') {console.log(JSON.stringify([{...${JSON.stringify(greenRun)},conclusion:process.env.ENGINE_TEST_CI==='red'?'failure':'success'}]));} else {console.log(${JSON.stringify(JSON.stringify(comparison()))});}`,
  );
  const marker = join(directory, 'railway-up-called');
  executable(
    'railway',
    `const {writeFileSync,existsSync}=require('node:fs');const a=process.argv.slice(2);const healthy=process.env.ENGINE_TEST_UPLOAD==='healthy';const uploaded=existsSync(${JSON.stringify(marker)});if(a[0]==='status')console.log(JSON.stringify({id:'edd519d3-638e-40da-81b4-a8a70eb7eb94'}));else if(a[0]==='deployment')console.log(JSON.stringify(uploaded&&healthy?[{id:'new-worker',status:'SUCCESS'},{id:'old',status:'SUCCESS'}]:[{id:'old',status:'SUCCESS'}]));else if(a[0]==='up'){writeFileSync(${JSON.stringify(marker)},JSON.stringify(a));process.exit(healthy?0:7);}else if(a[0]==='logs'){writeFileSync(${JSON.stringify(`${marker}.logs`)},JSON.stringify(a));console.log(JSON.stringify({timestamp:new Date(Date.now()+1000).toISOString(),message:'engine_warmup_complete'}));}else process.exit(9);`,
  );
  const run = (ci, args = [], upload = 'fail') =>
    spawnSync(process.execPath, [CLI, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        ENGINE_TEST_CI: ci,
        ENGINE_TEST_UPLOAD: upload,
      },
      timeout: 35_000,
    });
  return {
    repo,
    baseline,
    run,
    marker,
    git,
    baselineArgs: ['--baseline-engine', BASE, '--baseline-mistboard', baseline],
  };
}

test('CLI refuses a planted red engine SHA before Railway upload; unavailable CI is also refused without leaking output', (t) => {
  const f = fixture(t);
  for (const ci of ['red', 'unavailable']) {
    const result = f.run(ci, ['--deploy', ...f.baselineArgs]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(f.marker), false);
    assert.match(result.stderr, ci === 'red' ? /CI completed\/failure/ : /metadata lookup failed/);
    assert.doesNotMatch(result.stderr, /fixture-private-value/);
  }
});

test('CLI check-only lists a planted runtime engine change and worker/binary riders; it never deploys', (t) => {
  const f = fixture(t);
  const result = f.run('green', f.baselineArgs);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[runtime\/build\] modified src\/live_move.py/);
  assert.match(result.stdout, /\[lab\] added lab\/bakeoff.py/);
  assert.match(result.stdout, /worker registry rider/);
  assert.match(result.stdout, /binary asset rider/);
  assert.doesNotMatch(result.stdout, /unrelated docs/);
  assert.match(result.stdout, /check-only/);
  assert.equal(existsSync(f.marker), false);
});

test('urgent override is visible and durable; an upload failure cannot become the next baseline', (t) => {
  const f = fixture(t);
  const result = f.run('red', [
    '--deploy',
    '--override-engine-ci',
    'urgent recovery',
    ...f.baselineArgs,
  ]);
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stdout, /URGENT ENGINE CI OVERRIDE: urgent recovery/);
  assert.equal(existsSync(f.marker), true);
  const file = join(f.repo, '.git/engine-worker-deployments.jsonl');
  const rows = readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    rows.map((row) => row.status),
    ['started', 'upload-failed'],
  );
  assert.ok(
    rows.every(
      (row) =>
        row.overrideReason === 'urgent recovery' &&
        row.engineSha === HEAD &&
        row.mistboardSha === f.git('rev-parse', 'HEAD'),
    ),
  );
  assert.equal(readBaseline(file), null);
  assert.equal(existsSync(`${file}.lock`), false);
  const invocation = JSON.parse(readFileSync(f.marker, 'utf8'));
  assert.ok(invocation.includes('production'));
  assert.ok(invocation.includes('edd519d3-638e-40da-81b4-a8a70eb7eb94'));
});

test('unknown baseline and uncommitted files refuse deployment before upload', (t) => {
  const f = fixture(t);
  const unknown = f.run('green', ['--deploy']);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stdout, /baseline UNKNOWN/);
  writeFileSync(join(f.repo, 'uncommitted.txt'), 'work in progress');
  const dirty = f.run('green', ['--deploy', ...f.baselineArgs]);
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /uncommitted/);
  assert.equal(existsSync(f.marker), false);
});

test('a successful simulated deployment records both exact SHAs and verifies only the new deployment logs', (t) => {
  const f = fixture(t);
  const result = f.run('green', ['--deploy', ...f.baselineArgs], 'healthy');
  assert.equal(result.status, 0, result.stderr);
  const file = join(f.repo, '.git/engine-worker-deployments.jsonl');
  const rows = readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    rows.map((row) => row.status),
    ['started', 'healthy'],
  );
  const baseline = readBaseline(file);
  assert.equal(baseline.engineSha, HEAD);
  assert.equal(baseline.mistboardSha, f.git('rev-parse', 'HEAD'));
  assert.equal(baseline.deploymentId, 'new-worker');
  const logArgs = JSON.parse(readFileSync(`${f.marker}.logs`, 'utf8'));
  assert.deepEqual(logArgs.slice(0, 2), ['logs', 'new-worker']);
  assert.ok(logArgs.includes('--since'));
  assert.ok(logArgs.includes('--lines'));
  assert.equal(existsSync(`${file}.lock`), false);
});
