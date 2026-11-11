import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const script = join(scriptsDir, 'safe-deploy.mjs');

test('safe deploy reaches zero, then commits the restart notification', async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/health') return json(response, 200, { ok: true });
    if (request.url === '/api/server-status') {
      return json(response, 200, { activeGames: 0, restartAt: null });
    }
    if (request.url === '/admin/drain') {
      const body = JSON.parse(await requestBody(request));
      requests.push(body);
      return json(
        response,
        200,
        body.phase === 'restarting'
          ? { ok: true, phase: 'restarting' }
          : { ok: true, phase: 'pending', restartAt: Date.now() + 1_000 },
      );
    }
    json(response, 404, { error: 'not_found' });
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const result = await runScript([
    '--base-url',
    baseUrl,
    '--window-ms',
    '1000',
    '--poll-ms',
    '5',
    '--yes',
    '--commit',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(requests, [{ windowMs: 1000 }, { phase: 'restarting' }]);
  assert.match(result.stdout, /restart-now notification broadcast/);
  assert.match(result.stdout, /"restartCommitted":true/);
});

test('safe deploy cancels instead of allowing a deploy when games remain', async (t) => {
  let cancelled = false;
  const server = createServer(async (request, response) => {
    if (request.url === '/health') return json(response, 200, { ok: true });
    if (request.url === '/api/server-status') {
      return json(response, 200, { activeGames: 1, restartAt: null });
    }
    if (request.url === '/admin/drain/cancel') {
      cancelled = true;
      return json(response, 200, { ok: true, draining: false });
    }
    if (request.url === '/admin/drain') {
      await requestBody(request);
      return json(response, 200, { ok: true, phase: 'pending', restartAt: Date.now() + 20 });
    }
    json(response, 404, { error: 'not_found' });
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const result = await runScript([
    '--base-url',
    baseUrl,
    '--window-ms',
    '20',
    '--poll-ms',
    '5',
    '--yes',
    '--commit',
  ]);

  assert.equal(result.status, 4);
  assert.equal(cancelled, true);
  assert.match(result.stderr, /deployment blocked/);
  assert.match(result.stderr, /drain cancelled/);
});

// release-prod reads the hold off this file for its "new games held" line.
test('safe deploy writes what the hold cost to --result-file after the commit', async (t) => {
  const server = createServer(async (request, response) => {
    if (request.url === '/health') return json(response, 200, { ok: true });
    if (request.url === '/api/server-status') {
      return json(response, 200, { activeGames: 0, restartAt: null });
    }
    if (request.url === '/admin/drain') {
      const body = JSON.parse(await requestBody(request));
      return json(
        response,
        200,
        body.phase === 'restarting'
          ? { ok: true, phase: 'restarting', commitWaitMs: 4321, refusedCreates: 2 }
          : { ok: true, phase: 'pending', restartAt: Date.now() + 1_000 },
      );
    }
    json(response, 404, { error: 'not_found' });
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const resultFile = join(mkdtempSync(join(tmpdir(), 'safe-deploy-')), 'result.json');

  const result = await runScript([
    '--base-url',
    baseUrl,
    '--window-ms',
    '1000',
    '--poll-ms',
    '5',
    '--yes',
    '--commit',
    '--result-file',
    resultFile,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(resultFile, 'utf8')), {
    commitWaitMs: 4321,
    refusedCreates: 2,
  });
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing test server address');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function runScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: join(scriptsDir, '..'),
      env: { ...process.env, MISTBOARD_DRAIN_TOKEN: 'test-drain-token' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function requestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
