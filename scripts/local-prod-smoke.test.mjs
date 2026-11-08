import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createEngineBootCheckReader,
  isLocalBuild,
  localBaseUrl,
  localSmokePlan,
  runLocalSmokes,
} from './local-prod-smoke.mjs';

function bootCheck(missing, checked = 11) {
  const reader = createEngineBootCheckReader();
  const log = `${[
    'unstructured startup output',
    JSON.stringify({ kind: 'boot', msg: 'observability started' }),
    ...missing.map((engine) => JSON.stringify({ kind: 'engine_binary_missing', ...engine })),
    JSON.stringify({
      kind: 'engine_boot_check',
      checked,
      present: checked - missing.length,
      missing: missing.length,
    }),
  ].join('\n')}\n`;
  // Real stdout chunks can split a record anywhere, including inside its kind.
  for (let index = 0; index < log.length; index += 17) reader.write(log.slice(index, index + 17));
  return reader.result();
}

test('the server boot-check reader waits for a complete and consistent report', () => {
  assert.deepEqual(bootCheck([]), { checked: 11, missing: [] });
  const missing = [{ variant: 'duck-xiangqi', binary: 'fairy-stockfish-duck-xiangqi' }];
  assert.deepEqual(bootCheck(missing), { checked: 11, missing });
  const reader = createEngineBootCheckReader();
  reader.write(`${JSON.stringify({ kind: 'engine_binary_missing', ...missing[0] })}\n`);
  assert.equal(reader.result(), null, 'health alone cannot finish the boot check');
  reader.write(JSON.stringify({ kind: 'engine_boot_check', checked: 11, present: 9, missing: 2 }));
  assert.equal(reader.result(), null, 'a partial summary must not finish the boot check');
  reader.write('\n');
  assert.throws(() => reader.result(), /incomplete or inconsistent/);
});

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

test('missing Mac binaries skip only their probes; present engines and unrelated failures still gate', async () => {
  const visited = [];
  const logs = [];
  await assert.rejects(
    runLocalSmokes('http://localhost:3099', {
      missingEngines: bootCheck([
        { variant: 'duck-xiangqi', binary: 'fairy-stockfish-duck-xiangqi' },
        { variant: 'atomic-xiangqi', binary: 'fairy-stockfish-atomic-xiangqi' },
        { variant: 'jieqi', binary: 'ab-jchess' },
        { variant: 'jungle-flip', binary: 'jungle-flip-engine' },
      ]).missing,
      log: (line) => logs.push(line),
      async run(command) {
        const script = command[1].replace('scripts/', '');
        visited.push(script);
        if (
          [
            'prod-banqi-smoke.mjs',
            'prod-ceval-smoke.mjs',
            'prod-engine-smoke.mjs',
            'prod-dxq-smoke.mjs',
          ].includes(script)
        ) {
          throw new Error('planted failure unrelated to a missing native binary');
        }
      },
    }),
    /4\/10 local smokes failed: prod-engine-smoke.mjs, prod-dxq-smoke.mjs, prod-banqi-smoke.mjs, prod-ceval-smoke.mjs/,
  );
  assert.deepEqual(
    visited,
    localSmokePlan('http://localhost:3099')
      .map(({ script }) => script)
      .filter((script) => !['prod-duck-smoke.mjs', 'prod-jungle-flip-smoke.mjs'].includes(script)),
  );
  assert.deepEqual(
    logs.filter((line) => line.startsWith('local smoke SKIPPED:')),
    [
      'local smoke SKIPPED: prod-duck-smoke.mjs: missing fairy-stockfish-duck-xiangqi (set MISTBOARD_FSF_DUCK_XIANGQI_PATH)',
      'local smoke SKIPPED: prod-jungle-flip-smoke.mjs: missing jungle-flip-engine (set MISTBOARD_JUNGLE_FLIP_ENGINE_PATH)',
    ],
  );
});

test('each native dependency skips exactly its probe, never browser WASM or another engine family', () => {
  for (const [binary, script, supplyEnv] of [
    ['fairy-stockfish-duck-xiangqi', 'prod-duck-smoke.mjs', 'MISTBOARD_FSF_DUCK_XIANGQI_PATH'],
    ['fairy-stockfish', 'prod-xiangqi-smoke.mjs', 'MISTBOARD_FSF_PATH'],
    ['pikafish-jieqi', 'prod-jieqi-smoke.mjs', 'MISTBOARD_PIKAFISH_PATH'],
    ['banqi-engine', 'prod-banqi-smoke.mjs', 'MISTBOARD_BANQI_ENGINE_PATH'],
    ['jungle-engine', 'prod-jungle-smoke.mjs', 'MISTBOARD_JUNGLE_ENGINE_PATH'],
    ['jungle-flip-engine', 'prod-jungle-flip-smoke.mjs', 'MISTBOARD_JUNGLE_FLIP_ENGINE_PATH'],
    ['pikafish'],
    ['ab-jchess'],
    ['jqe'],
    ['katago-jungle'],
    ['fairy-stockfish-atomic-xiangqi'],
    ['unknown-engine'],
  ]) {
    const skipped = localSmokePlan('http://localhost:3099', {
      missingEngines: [{ binary }],
    }).filter((probe) => probe.missingBinary);
    assert.deepEqual(
      skipped.map((probe) => probe.script),
      script ? [script] : [],
      binary,
    );
    if (script) assert.equal(skipped[0].supplyEnv, supplyEnv);
  }
});

test('successful partial coverage reports skips separately from passed probes', async () => {
  const logs = [];
  let ran = 0;
  await runLocalSmokes('http://localhost:3099', {
    missingEngines: bootCheck([{ variant: 'banqi', binary: 'banqi-engine' }]).missing,
    run: async () => {
      ran++;
    },
    log: (line) => logs.push(line),
  });
  assert.equal(ran, 11);
  assert.equal(logs.at(-1), 'local production smokes: ok (11 probes, 1 skipped)');
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
  assert.match(source, /await runLocalSmokes\(baseUrl, \{ revision, missingEngines: missing \}\)/);
  assert.match(source, /server.stdout.on\('data',[\s\S]*engineBootCheck.write\(chunk\)/);
  assert.match(source, /if \(engineBootCheck.result\(\)\) return/);
  assert.match(source, /spawn\(process\.execPath, \['apps\/server\/dist\/main.js'\]/);
  assert.match(source, /finally \{[\s\S]*server.kill\('SIGTERM'\)/);
  assert.match(source, /isLocalBuild\(state, revision, buildAt\)/);
});
