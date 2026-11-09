import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { isLocalBuild, localBaseUrl, localSmokePlan, runLocalSmokes } from './local-prod-smoke.mjs';

test('local smokes require an explicit loopback origin before running any probe', () => {
  for (const base of [
    undefined,
    '',
    'https://mistboard.com',
    'http://localhost.example.com:3000',
    'http://127.0.0.1.example.com',
    'file:///tmp/smoke',
    'http://user:pass@localhost:3000',
    'http://localhost:3000/analysis',
    'http://localhost:3000/?target=prod',
    'http://localhost:3000/#prod',
  ]) {
    assert.throws(() => localSmokePlan(base), undefined, `must reject ${base}`);
  }
  assert.equal(localBaseUrl('http://localhost:3010/'), 'http://localhost:3010');
  assert.equal(localBaseUrl('http://127.0.0.1:3099'), 'http://127.0.0.1:3099');
  assert.equal(localBaseUrl('http://[::1]:3099'), 'http://[::1]:3099');
});

test('the local plan covers seven main variants, site checks, and every ceval backend', () => {
  const plan = localSmokePlan('http://127.0.0.1:3099/', { revision: 'abc123' });
  assert.deepEqual(
    plan.map(({ script }) => script),
    [
      'prod-lite-smoke.mjs',
      'prod-correspondence-smoke.mjs',
      'prod-smoke.mjs',
      'prod-engine-smoke.mjs',
      'prod-dxq-smoke.mjs',
      'prod-duck-smoke.mjs',
      'prod-xiangqi-smoke.mjs',
      'prod-jieqi-smoke.mjs',
      'prod-banqi-smoke.mjs',
      'prod-jungle-smoke.mjs',
      'prod-jungle-flip-smoke.mjs',
      'prod-ceval-smoke.mjs',
    ],
  );
  for (const { command } of plan) {
    assert.deepEqual(command.slice(2, 4), ['--base', 'http://127.0.0.1:3099']);
    assert.ok(existsSync(command[1]), `probe must exist: ${command[1]}`);
  }
  assert.deepEqual(plan[2].command.slice(4), ['--expect-revision', 'abc123']);
  assert.deepEqual(plan[3].command.slice(4), ['--engine', 'builtin-random-legal']);
  assert.deepEqual(plan.at(-1).command.slice(4), ['--backend', 'all']);
});

test('every local probe completes sequentially, including ceval after an engine failure', async () => {
  const visited = [];
  let active = 0;
  await assert.rejects(
    runLocalSmokes('http://localhost:3099', {
      log() {},
      async run(command) {
        assert.equal(active++, 0, 'smokes must not overlap on the shared host');
        await Promise.resolve();
        active--;
        visited.push(command[1]);
        if (command[1].includes('prod-dxq-')) throw new Error('engine unavailable');
        if (command[1].includes('prod-ceval-')) throw new Error('worker did not return an eval');
      },
    }),
    /2\/12 local smokes failed: prod-dxq-smoke.mjs, prod-ceval-smoke.mjs/,
  );
  assert.equal(visited.length, 12);
  assert.equal(visited.at(-1), 'scripts/prod-ceval-smoke.mjs');
});

test('a complete local smoke run reports success', async () => {
  const logs = [];
  await runLocalSmokes('http://localhost:3099', {
    run: async () => {},
    log: (line) => logs.push(line),
  });
  assert.equal(logs.at(-1), 'local production smokes: ok (12 probes)');
});

test('readiness accepts only this server instance, even when an old listener has the same SHA', () => {
  const status = { build: { revision: 'abc123', builtAt: '2026-10-30T01:50:00Z' } };
  assert.equal(isLocalBuild(status, 'abc123', '2026-10-30T01:50:00Z'), true);
  assert.equal(isLocalBuild(status, 'abc123', '2026-10-30T01:51:00Z'), false);
  assert.equal(isLocalBuild(status, 'other', status.build.builtAt), false);
  assert.equal(isLocalBuild({ ok: true }, 'abc123', status.build.builtAt), false);
});

test('the CLI plan overrides inherited prod URLs without making network requests', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/local-prod-smoke.mjs', '--base', 'http://localhost:3099', '--plan'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        MISTBOARD_BASE_URL: 'https://mistboard.com',
        MISTBOARD_WEB_URL: 'https://mistboard.com',
        MISTBOARD_CEVAL_SMOKE_BACKEND: 'fsf',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.length, 12);
  assert.ok(plan.every(({ command }) => command.includes('http://localhost:3099')));
  assert.ok(!result.stdout.includes('https://mistboard.com'));
  const invalid = spawnSync(process.execPath, ['scripts/local-prod-smoke.mjs', '--plan'], {
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /explicit --base/);
});

test('the managed local server invokes the same suite and owns its process cleanup', () => {
  const source = readFileSync(new URL('./release-local-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /await runLocalSmokes\(baseUrl, \{ revision \}\)/);
  assert.match(source, /spawn\(process\.execPath, \['apps\/server\/dist\/main.js'\]/);
  assert.match(source, /finally \{[\s\S]*server.kill\('SIGTERM'\)/);
  assert.match(source, /isLocalBuild\(state, revision, buildAt\)/);
});
