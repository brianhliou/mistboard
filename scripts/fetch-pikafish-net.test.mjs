import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fetchPikafishNet, PIN } from './fetch-pikafish-net.mjs';

const bytes = Buffer.from('fixture private net');
const pin = {
  ...PIN,
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
const noDownload = () => assert.fail('no download expected');

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pikafish-private-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, target: join(dir, pin.file) };
}

test('the private pin names the exact API asset, size and checksum', () => {
  assert.equal(
    PIN.url,
    'https://api.github.com/repos/brianhliou/mistboard-nets/releases/assets/723355852',
  );
  assert.equal(PIN.releaseRepo, 'brianhliou/mistboard-nets');
  assert.equal(PIN.releaseTag, 'pikafish-net-7d13d735');
  assert.equal(PIN.bytes, 50_706_378);
  assert.equal(PIN.sha256, '7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e');
});

test('API fetch authenticates only to GitHub and checks the redirected asset', async (t) => {
  const { dir, target } = await fixture(t);
  const requests = [];
  const state = await fetchPikafishNet(target, {
    pin,
    env: { MISTBOARD_PRIVATE_ASSETS_TOKEN: 'fixture-token', CI: 'true' },
    downloadWithGh: noDownload,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/fixture' },
        });
      }
      return new Response(bytes);
    },
  });
  assert.equal(state, 'downloaded');
  assert.equal(requests[0].url, PIN.url);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.equal(requests[0].options.headers.Accept, 'application/octet-stream');
  assert.equal(requests[0].options.redirect, 'manual');
  assert.equal(requests[1].options.headers, undefined);
  assert.deepEqual(await readFile(target), bytes);
  assert.deepEqual(await readdir(dir), [pin.file]);
});

test('an API 200 works without a redirect, and a valid cache skips all downloads', async (t) => {
  const { target } = await fixture(t);
  const options = {
    pin,
    env: { MISTBOARD_PRIVATE_ASSETS_TOKEN: 'fixture-token' },
    downloadWithGh: noDownload,
  };
  assert.equal(
    await fetchPikafishNet(target, { ...options, fetchImpl: async () => new Response(bytes) }),
    'downloaded',
  );
  assert.equal(await fetchPikafishNet(target, { ...options, fetchImpl: noDownload }), 'present');
  assert.equal(
    await fetchPikafishNet(target, { ...options, env: {}, fetchImpl: noDownload }),
    'present',
  );
});

test('local missing token uses gh against the private release, then checks the file', async (t) => {
  const { target } = await fixture(t);
  assert.equal(
    await fetchPikafishNet(target, {
      pin,
      env: {},
      fetchImpl: noDownload,
      downloadWithGh: async (directory, actualPin) => {
        assert.equal(actualPin.releaseRepo, 'brianhliou/mistboard-nets');
        assert.equal(actualPin.releaseTag, 'pikafish-net-7d13d735');
        await writeFile(join(directory, actualPin.file), bytes);
      },
    }),
    'downloaded',
  );
  assert.deepEqual(await readFile(target), bytes);
});

test('CI and production need the named token to download, never gh, but a valid cached net needs none', async (t) => {
  const { target } = await fixture(t);
  const automated = [
    { env: { CI: 'true' } },
    { env: { NODE_ENV: 'production' } },
    { env: { RAILWAY_ENVIRONMENT_ID: 'fixture' } },
    { env: {}, requireToken: true },
  ];
  for (const options of automated) {
    await assert.rejects(
      fetchPikafishNet(target, {
        pin,
        fetchImpl: noDownload,
        downloadWithGh: noDownload,
        ...options,
      }),
      /MISTBOARD_PRIVATE_ASSETS_TOKEN is required/,
    );
  }
  await writeFile(target, bytes);
  for (const options of automated) {
    assert.equal(
      await fetchPikafishNet(target, {
        pin,
        fetchImpl: noDownload,
        downloadWithGh: noDownload,
        ...options,
      }),
      'present',
    );
  }
});

test('corrupt cached files are replaced only by a verified download', async (t) => {
  const { dir, target } = await fixture(t);
  const old = Buffer.alloc(bytes.length, 0);
  await writeFile(target, old);
  for (const invalid of [Buffer.from('truncated'), Buffer.alloc(bytes.length, 1)]) {
    await assert.rejects(
      fetchPikafishNet(target, {
        pin,
        env: { MISTBOARD_PRIVATE_ASSETS_TOKEN: 'fixture-token' },
        fetchImpl: async () => new Response(invalid),
        downloadWithGh: noDownload,
      }),
      /does not match net.json/,
    );
    assert.deepEqual(await readFile(target), old);
    assert.deepEqual(await readdir(dir), [pin.file]);
  }
  await fetchPikafishNet(target, {
    pin,
    env: {},
    fetchImpl: noDownload,
    downloadWithGh: async (directory) => writeFile(join(directory, pin.file), bytes),
  });
  assert.deepEqual(await readFile(target), bytes);
});

test('gh downloads also reject a checksum mismatch', async (t) => {
  const { dir, target } = await fixture(t);
  await assert.rejects(
    fetchPikafishNet(target, {
      pin,
      env: {},
      fetchImpl: noDownload,
      downloadWithGh: async (directory) =>
        writeFile(join(directory, pin.file), Buffer.alloc(bytes.length)),
    }),
    /does not match net.json/,
  );
  assert.deepEqual(await readdir(dir), []);
});

test('API errors never fall back to gh or expose request diagnostics', async (t) => {
  const { dir, target } = await fixture(t);
  for (const fetchImpl of [
    async () => new Response('private failure', { status: 403 }),
    async () => {
      throw new Error('fixture-token signed-url');
    },
    async () =>
      new Response(null, { status: 302, headers: { location: 'http://example.com/fixture' } }),
  ]) {
    await assert.rejects(
      fetchPikafishNet(target, {
        pin,
        env: { MISTBOARD_PRIVATE_ASSETS_TOKEN: 'fixture-token' },
        fetchImpl,
        downloadWithGh: noDownload,
      }),
      (error) => {
        assert.match(error.message, /MISTBOARD_PRIVATE_ASSETS_TOKEN/);
        assert.doesNotMatch(error.message, /fixture-token|signed-url/);
        return true;
      },
    );
    assert.deepEqual(await readdir(dir), []);
  }
});

test('the real local gh adapter passes only the private release coordinates and sanitizes failures', async (t) => {
  const { dir, target } = await fixture(t);
  const tools = join(dir, 'tools');
  const log = join(dir, 'gh-args.json');
  await mkdir(tools);
  const gh = join(tools, 'gh');
  await writeFile(
    gh,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(args));
fs.writeFileSync(require('node:path').join(args[args.indexOf('-D') + 1], 'pikafish.nnue'), 'bad fixture net');
`,
    { mode: 0o755 },
  );
  await assert.rejects(
    fetchPikafishNet(target, { env: { PATH: tools } }),
    /does not match net.json/,
  );
  const args = JSON.parse(await readFile(log, 'utf8'));
  assert.deepEqual(args.slice(0, 8), [
    'release',
    'download',
    PIN.releaseTag,
    '-R',
    PIN.releaseRepo,
    '-p',
    PIN.file,
    '-D',
  ]);
  assert.ok(args[8].startsWith(join(dir, '.pikafish-net-')));
  await writeFile(
    gh,
    `#!${process.execPath}
console.error('fixture-sensitive-diagnostic'); process.exit(1);
`,
    { mode: 0o755 },
  );
  await assert.rejects(fetchPikafishNet(target, { env: { PATH: tools } }), (error) => {
    assert.match(error.message, /Sign in with gh or set MISTBOARD_PRIVATE_ASSETS_TOKEN/);
    assert.doesNotMatch(error.message, /fixture-sensitive-diagnostic/);
    return true;
  });
});
