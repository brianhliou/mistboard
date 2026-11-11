// Local Linux container evidence. No secret is passed in argv, printed or saved.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createInitialBanqiState } from '@mistboard/game';
import {
  buildBanqiProviderRequest,
  parseBanqiProviderResponse,
} from '../apps/server/src/banqi-provider-protocol.ts';

const option = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const image = option('--image') ?? 'mistboard-banqi-host:1026';
const model = option('--model'),
  sha = option('--model-sha');
assert.ok(model && /^[a-f0-9]{64}$/.test(sha ?? ''), 'Required: --model PATH --model-sha SHA256');
const token = randomUUID(),
  version = 'MistyBanqi-0.3.0-iter14';
const env = {
  ...process.env,
  MISTBOARD_BANQI_PROVIDER_TOKEN: token,
  MISTBOARD_BANQI_MODEL_SHA256: sha,
  MISTBOARD_BANQI_TEST_PROVIDER_VERSION: version,
  MISTBOARD_BANQI_MODEL_DOWNLOAD_TOKEN: 'fixture-fetch-marker-not-a-real-token',
  MISTBOARD_PRIVATE_ASSETS_TOKEN: 'fixture-legacy-fetch-marker-not-a-real-token',
  DATABASE_URL: 'fixture-forbidden-web-variable',
};
const prefix = `mistboard-banqi-1026-${process.pid}`;
const owned = new Set();
async function run(cmd, args, extra = {}) {
  return new Promise((done, reject) => {
    const { captureStderr, ...options } = extra;
    const child = spawn(cmd, args, { env, ...options });
    let output = '',
      bytes = 0;
    const timeout = setTimeout(
      () => {
        child.kill();
        reject(new Error('Local proof command timed out'));
      },
      cmd === 'docker' ? 30000 : 300000,
    );
    timeout.unref();
    child.stdout?.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 2_000_000) {
        child.kill();
        reject(new Error('Command output exceeded bound'));
      } else output += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      if (captureStderr) {
        bytes += chunk.length;
        if (bytes > 2_000_000) {
          child.kill();
          reject(new Error('Command output exceeded bound'));
        } else output += chunk;
      }
    });
    child.once('error', () => reject(new Error('Local container command failed')));
    child.once('exit', (code) => {
      clearTimeout(timeout);
      code === 0 ? done(output) : reject(new Error('Local container command failed'));
    });
  });
}
const docker = (args) => run('docker', args, { captureStderr: args[0] === 'logs' });
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function start(suffix, extra = []) {
  const name = `${prefix}-${suffix}`;
  owned.add(name);
  await docker([
    'run',
    '-d',
    '--platform',
    'linux/amd64',
    '--name',
    name,
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    '--cpus',
    '1',
    '--memory',
    '1g',
    '--pids-limit',
    '64',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--tmpfs',
    `/run/banqi:rw,noexec,nosuid,size=32m,uid=${process.getuid()},gid=${process.getgid()},mode=700`,
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=16m',
    '-p',
    '127.0.0.1::8080',
    '--mount',
    `type=bind,src=${resolve(model)},dst=/model/model.bqnn,readonly`,
    '-e',
    'MISTBOARD_BANQI_PROVIDER_TOKEN',
    '-e',
    'MISTBOARD_BANQI_MODEL_DOWNLOAD_TOKEN',
    '-e',
    'MISTBOARD_PRIVATE_ASSETS_TOKEN',
    '-e',
    'DATABASE_URL',
    '-e',
    'MISTBOARD_BANQI_MODEL_SHA256',
    '-e',
    'MISTBOARD_BANQI_TEST_PROVIDER_VERSION',
    '-e',
    'MISTBOARD_BANQI_MODEL_PATH=/model/model.bqnn',
    ...extra,
    image,
  ]);
  const port = await docker(['port', name, '8080/tcp']).then(
    (value) => value.trim(),
    () => null,
  );
  return { name, base: `http://${port}` };
}
async function ready(base) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        assert.deepEqual(await response.json(), { status: 'ready' });
        return;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Container never became ready');
}
async function stop(name, expectedExitCode) {
  await docker(['stop', '--time', '12', name]);
  if (expectedExitCode !== undefined)
    assert.equal(
      Number((await docker(['inspect', '--format', '{{.State.ExitCode}}', name])).trim()),
      expectedExitCode,
      'Worker must exit gracefully rather than be killed',
    );
  await docker(['rm', name]);
  owned.delete(name);
}
try {
  const imageInfo = JSON.parse(
    await docker(['image', 'inspect', '--format', '{{json .Config}}', image]),
  );
  assert.equal(imageInfo.User, 'node');
  assert.ok(!JSON.stringify(imageInfo).includes(token));
  assert.ok(!JSON.stringify(imageInfo).includes(sha));
  assert.ok(!imageInfo.Env.some((entry) => /^MISTBOARD_.*=/.test(entry)));
  const arch = (await docker(['image', 'inspect', '--format', '{{.Architecture}}', image])).trim();
  assert.equal(arch, 'amd64');
  const host = await start('valid');
  try {
    await ready(host.base);
  } catch {
    const logs = await docker(['logs', host.name]);
    assert.ok(!logs.includes(token));
    const failed = logs
      .split('\n')
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .find((line) => line?.kind === 'banqi_host_startup_failed');
    const state = JSON.parse(await docker(['inspect', '--format', '{{json .State}}', host.name]));
    throw new Error(
      JSON.stringify({
        stage: failed?.stage ?? 'unknown',
        exitCode: state.ExitCode,
        oom: state.OOMKilled,
        execve: logs.includes('execve'),
        fatal: logs.includes('FATAL'),
        syntax: logs.includes('SyntaxError'),
        reference: logs.includes('ReferenceError'),
        type: logs.includes('TypeError'),
        module: logs.includes('Cannot find'),
      }),
    );
  }
  const clean = await docker([
    'exec',
    host.name,
    'node',
    '-e',
    "const v=require('fs').readFileSync('/proc/1/environ');if(v.includes(Buffer.from('MISTBOARD_PRIVATE_ASSETS_TOKEN='))||v.includes(Buffer.from('MISTBOARD_BANQI_MODEL_DOWNLOAD_TOKEN='))||v.includes(Buffer.from('DATABASE_URL=')))process.exit(1);console.log('allowlisted-runtime-environment');",
  ]);
  assert.equal(clean.trim(), 'allowlisted-runtime-environment');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  assert.equal(
    (
      await fetch(`${host.base}/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    401,
  );
  assert.equal((await fetch(`${host.base}/health`)).status, 401);
  assert.equal((await fetch(`${host.base}/health`, { headers })).status, 200);
  const turn = (budget = 3000) =>
    buildBanqiProviderRequest({
      state: createInitialBanqiState('linux-host-proof', undefined, {
        noProgressLimit: 60,
        chaseRule: 'repetition',
      }),
      requestId: randomUUID(),
      engineId: 'private-banqi-worker',
      nowMs: Date.now(),
      budgetMs: budget,
      remainingMs: 300000,
      incrementMs: 5000,
      nodes: 64,
    });
  const request = turn();
  const response = await fetch(`${host.base}/turn`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });
  assert.equal(response.status, 200);
  const result = parseBanqiProviderResponse(await response.json(), request);
  assert.ok(request.legalMoves.includes(result.move));
  const expired = structuredClone(turn());
  expired.limits.requestedAtUnixMs = Date.now() - 200;
  expired.limits.deadlineUnixMs = Date.now() - 100;
  assert.equal(
    (await fetch(`${host.base}/turn`, { method: 'POST', headers, body: JSON.stringify(expired) }))
      .status,
    504,
  );
  const long = turn(9000);
  assert.equal(
    (await fetch(`${host.base}/turn`, { method: 'POST', headers, body: JSON.stringify(long) }))
      .status,
    400,
  );
  assert.equal(
    (await fetch(`${host.base}/turn`, { method: 'POST', headers, body: 'x'.repeat(65537) })).status,
    413,
  );
  // Reuse the real web/room/WS driver; token stays only in child environment.
  const game = await run(process.execPath, [
    '--import',
    'tsx',
    'scripts/banqi-provider-game.mjs',
    '--endpoint',
    `${host.base}/turn`,
    '--version',
    version,
    '--uci-name',
    'MistyBanqi 0.3.0',
  ]);
  assert.ok(!game.includes(token));
  const record = game
    .trim()
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find((value) => value?.retiredRoomQuiescent);
  assert.ok(record && record.plies >= 32 && record.persistedHydration && record.counted === false);
  const config = JSON.parse(
    await docker(['inspect', '--format', '{{json .HostConfig}}', host.name]),
  );
  assert.equal(config.ReadonlyRootfs, true);
  assert.equal(config.PidsLimit, 64);
  assert.equal(config.Memory, 1073741824);
  assert.equal(config.NanoCpus, 1000000000);
  const logs = await docker(['logs', host.name]);
  assert.ok(!logs.includes(token) && !logs.includes(sha) && !logs.includes(model));
  await stop(host.name, 0);
  for (const [suffix, extra] of [
    ['bad-model', ['-e', `MISTBOARD_BANQI_MODEL_SHA256=${'0'.repeat(64)}`]],
    ['bad-version', ['-e', 'MISTBOARD_BANQI_TEST_PROVIDER_VERSION=MistyBanqi-0.3.0-wrong-net']],
  ]) {
    const bad = await start(suffix, extra);
    const code = (await docker(['wait', bad.name])).trim();
    assert.equal(code, '1');
    let alive = false;
    try {
      await fetch(`${bad.base}/readyz`, { signal: AbortSignal.timeout(500) });
      alive = true;
    } catch {}
    assert.equal(alive, false, 'Invalid startup must not expose readiness');
    try {
      await stop(bad.name);
    } catch {
      owned.delete(bad.name);
    }
  }
  console.log(
    JSON.stringify({
      image,
      architecture: arch,
      containerIsolationVerified: true,
      execEnvironmentVerified: true,
      authenticatedTurn: true,
      unauthorizedDenied: true,
      expiredDeadlineRejected: true,
      oversizedBodyRejected: true,
      wrongStartupRejected: true,
      gracefulStop: true,
      credentialsInImage: false,
      privateModelInImage: false,
      game: {
        roomId: record.roomId,
        plies: record.plies,
        terminal: record.terminal,
        highestQuiet: record.highestQuiet,
        reconnects: record.reconnects,
        persistedHydration: true,
        retiredRoomQuiescent: true,
        private: true,
        counted: false,
      },
    }),
  );
} finally {
  for (const name of owned)
    try {
      await stop(name);
    } catch {}
}
