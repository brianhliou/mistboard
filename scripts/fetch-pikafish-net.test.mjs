import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fetchPikafishNet, PIN } from './fetch-pikafish-net.mjs';

const bytes = Buffer.from('fixture CC0 net');
const pin = {
  ...PIN,
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
const noDownload = () => assert.fail('no download expected');

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pikafish-cc0-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, target: join(dir, pin.file) };
}

test('the CC0 pin matches the native FSF source, size and checksum', async () => {
  const native = await readFile(new URL('./fetch-fsf-xiangqi-net.sh', import.meta.url), 'utf8');
  assert.equal(PIN.file, 'xiangqi-c07e94a5c7cb.nnue');
  assert.equal(PIN.netCommit, '0f4dce21530775b1dc862b7c84aa707548183097');
  assert.equal(
    PIN.url,
    `https://raw.githubusercontent.com/fairy-stockfish/Fairy-Stockfish-NNUE/${PIN.netCommit}/${PIN.file}`,
  );
  assert.equal(PIN.engineCommit, '6a59ee2f7b105bff64d9efc2692591107787e2b1');
  assert.equal(PIN.bytes, 11_261_932);
  assert.equal(PIN.sha256, 'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11');
  assert.ok(native.includes(`net=${PIN.file}`));
  assert.ok(native.includes(`${PIN.netCommit}/$net`));
  assert.ok(native.includes(`net_sha=${PIN.sha256}`));
});

test('public download uses no credentials and installs only verified bytes', async (t) => {
  const { dir, target } = await fixture(t);
  const state = await fetchPikafishNet(target, {
    pin,
    fetchImpl: async (url, options) => {
      assert.equal(url, PIN.url);
      assert.equal(options.headers, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(bytes);
    },
  });
  assert.equal(state, 'downloaded');
  assert.deepEqual(await readFile(target), bytes);
  assert.deepEqual(await readdir(dir), [pin.file]);
  assert.equal(await fetchPikafishNet(target, { pin, fetchImpl: noDownload }), 'present');
});

test('corrupt cached files are replaced only by a verified download', async (t) => {
  const { dir, target } = await fixture(t);
  const old = Buffer.alloc(bytes.length, 0);
  await writeFile(target, old);
  for (const invalid of [Buffer.from('truncated'), Buffer.alloc(bytes.length, 1)]) {
    await assert.rejects(
      fetchPikafishNet(target, { pin, fetchImpl: async () => new Response(invalid) }),
      /does not match net.json/,
    );
    assert.deepEqual(await readFile(target), old);
    assert.deepEqual(await readdir(dir), [pin.file]);
  }
  await fetchPikafishNet(target, { pin, fetchImpl: async () => new Response(bytes) });
  assert.deepEqual(await readFile(target), bytes);
});

test('HTTP and network errors leave no partial net or temporary files', async (t) => {
  const { dir, target } = await fixture(t);
  for (const fetchImpl of [
    async () => new Response('not found', { status: 404 }),
    async () => {
      throw new Error('connection failed');
    },
  ]) {
    await assert.rejects(fetchPikafishNet(target, { pin, fetchImpl }), /404|connection failed/);
    assert.deepEqual(await readdir(dir), []);
  }
});
