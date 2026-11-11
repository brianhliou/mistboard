import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitialBanqiState } from '@mistboard/game';
import {
  BanqiProviderError,
  buildBanqiProviderRequest,
  providerResponse,
} from '../../apps/server/src/banqi-provider-protocol.ts';
import { banqiModelPin, createHostContext } from '../../scripts/banqi-host-context.mjs';
import { hostConfiguration, loadModel, runtimeEnvironment, startHost } from './host.mjs';

const token = 'fixture-token-not-a-production-secret';
const version = 'MistyBanqi-0.3.0-test-model';
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const turn = (budget = 1000) =>
  buildBanqiProviderRequest({
    state: createInitialBanqiState('host-unit'),
    requestId: randomUUID(),
    engineId: 'test-engine',
    nowMs: Date.now(),
    budgetMs: budget,
    remainingMs: null,
    incrementMs: 0,
  });
test('host requires the image build identity, explicit model and matching SHA', async () => {
  const clean = runtimeEnvironment(
    { port: 8080, token, version },
    { path: '/model/model.bqnn' },
    '0'.repeat(64),
  );
  assert.equal(clean.MISTBOARD_BANQI_MODEL_DOWNLOAD_TOKEN, undefined);
  assert.equal(clean.MISTBOARD_PRIVATE_ASSETS_TOKEN, undefined);
  assert.equal(clean.DATABASE_URL, undefined);
  assert.deepEqual(Object.keys(clean).sort(), [
    'MISTBOARD_BANQI_MODEL_PATH',
    'MISTBOARD_BANQI_MODEL_SHA256',
    'MISTBOARD_BANQI_PROVIDER_TOKEN',
    'MISTBOARD_BANQI_TEST_PROVIDER_VERSION',
    'NODE_ENV',
    'PATH',
    'PORT',
  ]);
  assert.equal(
    hostConfiguration({
      MISTBOARD_BANQI_PROVIDER_TOKEN: token,
      MISTBOARD_BANQI_TEST_PROVIDER_VERSION: version,
    }).port,
    8080,
  );
  for (const value of ['MistyBanqi-0.2.7-test', 'unknown', 'MistyBanqi-0.3.0-'])
    assert.throws(() =>
      hostConfiguration({
        MISTBOARD_BANQI_PROVIDER_TOKEN: token,
        MISTBOARD_BANQI_TEST_PROVIDER_VERSION: value,
      }),
    );
  const pinned = { engineTag: 'v0.3.0', tag: 'banqi-iter14' };
  assert.ok(
    hostConfiguration(
      {
        MISTBOARD_BANQI_PROVIDER_TOKEN: token,
        MISTBOARD_BANQI_TEST_PROVIDER_VERSION: 'MistyBanqi-0.3.0-iter14',
      },
      pinned,
    ),
  );
  assert.throws(() =>
    hostConfiguration(
      {
        MISTBOARD_BANQI_PROVIDER_TOKEN: token,
        MISTBOARD_BANQI_TEST_PROVIDER_VERSION: 'MistyBanqi-0.3.0-wrong-net',
      },
      pinned,
    ),
  );
  const dir = await mkdtemp(join(tmpdir(), 'banqi-host-model-'));
  try {
    const file = join(dir, 'model.bqnn'),
      bytes = Buffer.from('fixture-model-only');
    await writeFile(file, bytes, { mode: 0o600 });
    const env = {
      MISTBOARD_BANQI_MODEL_PATH: file,
      MISTBOARD_BANQI_MODEL_SHA256: createHash('sha256').update(bytes).digest('hex'),
    };
    const loaded = await loadModel(env);
    assert.equal(loaded.path, file);
    await loaded.close();
    await assert.rejects(
      loadModel({ ...env, MISTBOARD_BANQI_MODEL_SHA256: '0'.repeat(64) }),
      /model-checksum/,
    );
    await assert.rejects(
      loadModel({ ...env, MISTBOARD_BANQI_MODEL_URL: 'https://model.example.test/private' }),
      /model-configuration/,
    );
    await assert.rejects(
      loadModel({
        MISTBOARD_BANQI_MODEL_URL: 'http://model.example.test/private',
        MISTBOARD_BANQI_MODEL_SHA256: env.MISTBOARD_BANQI_MODEL_SHA256,
      }),
      /model-configuration/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('private release fetch strips authorization at redirects, removes token from env and verifies pinned bytes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'banqi-host-fetch-')),
    bytes = Buffer.from('fixture-runtime-model');
  const pin = {
    repo: 'fixture/private-nets',
    tag: 'model-v1',
    asset: 'model.bqnn',
    sha: createHash('sha256').update(bytes).digest('hex'),
  };
  const configured = () => ({
    MISTBOARD_BANQI_MODEL_DOWNLOAD_TOKEN: token,
    MISTBOARD_BANQI_MODEL_SHA256: pin.sha,
  });
  const seen = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    seen.push({ url: String(url), headers: options.headers });
    assert.equal(options.redirect, 'manual');
    if (String(url).includes('/tags/'))
      return Response.json({
        tag_name: pin.tag,
        assets: [{ id: 7, name: pin.asset, size: bytes.length }],
      });
    if (String(url).includes('/assets/'))
      return new Response(null, {
        status: 302,
        headers: {
          location: 'https://release-assets.githubusercontent.com/file?signature=fixture-only',
        },
      });
    return new Response(bytes);
  });
  try {
    const env = { ...configured(), MISTBOARD_PRIVATE_ASSETS_TOKEN: 'legacy-fixture-only-token' },
      loaded = await loadModel(env, dir, pin);
    assert.deepEqual(await readFile(loaded.path), bytes);
    assert.equal(env.MISTBOARD_BANQI_MODEL_DOWNLOAD_TOKEN, undefined);
    assert.equal(env.MISTBOARD_PRIVATE_ASSETS_TOKEN, undefined);
    await loaded.close();
    assert.equal(seen[0].headers.authorization, `Bearer ${token}`);
    assert.equal(seen[1].headers.authorization, `Bearer ${token}`);
    assert.equal(seen[2].headers.authorization, undefined);
    fetch.mock.mockImplementation(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://evil.example.test' } }),
    );
    await assert.rejects(loadModel(configured(), dir, pin), /model-download/);
    fetch.mock.mockImplementation(async (url) =>
      String(url).includes('/tags/')
        ? Response.json({
            tag_name: pin.tag,
            assets: [{ id: 7, name: pin.asset, size: bytes.length }],
          })
        : new Response(null, { status: 302, headers: { location: 'https://evil.example.test' } }),
    );
    await assert.rejects(loadModel(configured(), dir, pin), /model-redirect/);
    fetch.mock.mockImplementation(async (url) =>
      String(url).includes('/tags/')
        ? Response.json({ tag_name: pin.tag, assets: [{ id: 7, name: pin.asset, size: 5 }] })
        : new Response('wrong'),
    );
    await assert.rejects(loadModel(configured(), dir, pin), /model-checksum/);
    await assert.rejects(
      loadModel({ ...configured(), MISTBOARD_BANQI_MODEL_SHA256: '0'.repeat(64) }, dir, pin),
      /model-configuration/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('public readiness reflects startup/bridge state; turn and version remain authenticated', async () => {
  await assert.rejects(
    startHost({
      provider: {
        turn: async () => {
          throw new Error('fixture-private-error');
        },
      },
      token,
      version,
      port: 0,
      host: '127.0.0.1',
    }),
  );
  let failure = false;
  const host = await startHost({
    provider: {
      turn: async (req) => {
        if (failure) throw new BanqiProviderError('transport');
        return providerResponse(req, req.legalMoves[0]);
      },
    },
    token,
    version,
    port: 0,
    host: '127.0.0.1',
  });
  const base = `http://127.0.0.1:${host.port}`;
  try {
    const publicValue = await (await fetch(`${base}/readyz`)).json();
    assert.deepEqual(publicValue, { status: 'ready' });
    assert.ok(!JSON.stringify(publicValue).includes(version));
    assert.equal((await fetch(`${base}/health`)).status, 401);
    assert.equal((await fetch(`${base}/turn`, { method: 'POST', body: '{}' })).status, 401);
    assert.deepEqual(await (await fetch(`${base}/health`, { headers })).json(), {
      protocol: 'mistboard-banqi/1',
      engineVersion: version,
    });
    assert.equal(
      (await fetch(`${base}/turn`, { method: 'POST', headers, body: JSON.stringify(turn()) }))
        .status,
      200,
    );
    assert.equal(
      (await fetch(`${base}/turn`, { method: 'POST', headers, body: 'x'.repeat(65537) })).status,
      413,
    );
    assert.equal(
      (await fetch(`${base}/turn`, { method: 'POST', headers, body: JSON.stringify(turn(9000)) }))
        .status,
      400,
    );
    failure = true;
    assert.equal(
      (await fetch(`${base}/turn`, { method: 'POST', headers, body: JSON.stringify(turn()) }))
        .status,
      502,
    );
    assert.deepEqual(await (await fetch(`${base}/readyz`)).json(), { status: 'unavailable' });
  } finally {
    await host.close();
  }
});

test('admission has one bounded waiting slot and request bodies have an absolute lifetime', async () => {
  let active = 0,
    release;
  const provider = {
    turn: async (req) => {
      if (req.gameId === 'host-startup') return providerResponse(req, req.legalMoves[0]);
      active++;
      await new Promise((done) => {
        release = done;
      });
      active--;
      return providerResponse(req, req.legalMoves[0]);
    },
  };
  const host = await startHost({ provider, token, version, port: 0, host: '127.0.0.1' }),
    base = `http://127.0.0.1:${host.port}`;
  try {
    const pending = fetch(`${base}/turn`, {
      method: 'POST',
      headers,
      body: JSON.stringify(turn()),
    });
    while (active === 0) await new Promise((done) => setTimeout(done, 5));
    // Hold a second slot with a partial body. The next request sheds immediately.
    const slow = new Promise((done, reject) => {
      const req = request(`${base}/turn`, { method: 'POST', headers }, (res) => {
        res.resume();
        res.once('end', () => done(res.statusCode));
      });
      req.on('error', reject);
      req.write('{');
    });
    await new Promise((done) => setTimeout(done, 20));
    assert.equal(
      (await fetch(`${base}/turn`, { method: 'POST', headers, body: JSON.stringify(turn()) }))
        .status,
      429,
    );
    assert.equal(await slow, 504);
    release();
    assert.equal((await pending).status, 200);
  } finally {
    release?.();
    await host.close();
  }
});

test('staged context has an exact public allowlist and no web/db/email dependency', async () => {
  const dir = await createHostContext();
  try {
    const bundle = await readFile(join(dir, 'worker.mjs'), 'utf8');
    for (const forbidden of [
      'persistence-db',
      'send-email',
      'RESEND_API_KEY',
      'docs-private',
      'DATABASE_URL',
      'python-pool',
    ])
      assert.equal(bundle.includes(forbidden), false, forbidden);
    assert.equal(bundle.includes(token), false);
    const pin = await banqiModelPin();
    assert.ok(bundle.includes(pin.sha) && bundle.includes(pin.tag) && bundle.includes(pin.asset));
    const dockerfile = await readFile(join(dir, 'Dockerfile'), 'utf8');
    assert.ok(!dockerfile.includes('COPY .'));
    assert.ok(dockerfile.includes('fetch-release-asset.sh'));
    assert.ok(dockerfile.includes('USER node'));
    await assert.rejects(createHostContext(dir), /EEXIST/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
