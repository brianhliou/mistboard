import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { fetchAbjchessBrowserNet, PIN, zipMember } from './fetch-abjchess-browser-net.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A minimal zip: each entry as [path, bytes, method 0 (stored) or 8 (deflate)]. */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [path, bytes, method] of entries) {
    const name = Buffer.from(path);
    const data = method === 8 ? deflateRawSync(bytes) : Buffer.from(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const net = Buffer.from('fixture jieqi net bytes');
const zip = makeZip([
  ['AB-JChess-20261031/README.txt', Buffer.from('readme'), 0],
  [`AB-JChess-20261031/${PIN.file}`, net, 8],
]);
const pin = {
  ...PIN,
  bytes: net.length,
  sha256: sha(net),
  zipBytes: zip.length,
  zipSha256: sha(zip),
};

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'abjchess-net-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, target: join(dir, PIN.file) };
}

test('the browser pin is the net the server fetches, from the same release zip', async () => {
  const server = await readFile(new URL('./fetch-abjchess-net.sh', import.meta.url), 'utf8');
  assert.ok(server.includes(`url=${PIN.zipUrl}`));
  assert.ok(server.includes(`zip_sha=${PIN.zipSha256}`));
  assert.ok(server.includes(`net=${PIN.file}`));
  assert.ok(server.includes(`net_sha=${PIN.sha256}`));
});

test('downloads the release zip, installs only the verified net, then reuses it', async (t) => {
  const { dir, target } = await fixture(t);
  const state = await fetchAbjchessBrowserNet(target, {
    pin,
    fetchImpl: async (url, options) => {
      assert.equal(url, PIN.zipUrl);
      assert.equal(options.headers, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(zip);
    },
  });
  assert.equal(state, 'downloaded');
  assert.deepEqual(await readFile(target), net);
  assert.deepEqual(await readdir(dir), [PIN.file]);
  const noDownload = () => assert.fail('no download expected');
  assert.equal(await fetchAbjchessBrowserNet(target, { pin, fetchImpl: noDownload }), 'present');
});

test('a wrong zip, a wrong net or a failed download installs nothing', async (t) => {
  const { dir, target } = await fixture(t);
  const tampered = makeZip([[`AB-JChess-20261031/${PIN.file}`, Buffer.from('other weights'), 8]]);
  const cases = [
    [new Response(tampered), /release zip does not match/],
    [new Response('missing', { status: 404 }), /HTTP 404/],
  ];
  for (const [response, message] of cases) {
    await assert.rejects(
      fetchAbjchessBrowserNet(target, { pin, fetchImpl: async () => response }),
      message,
    );
  }
  // The zip itself matches its pin, but the net inside does not.
  const wrongNetPin = { ...pin, zipBytes: tampered.length, zipSha256: sha(tampered) };
  await assert.rejects(
    fetchAbjchessBrowserNet(target, {
      pin: wrongNetPin,
      fetchImpl: async () => new Response(tampered),
    }),
    /abjchess-20261030\.nnue does not match/,
  );
  assert.deepEqual(await readdir(dir), []);
});

test('zipMember reads stored and deflated members and names a missing one', () => {
  assert.deepEqual(Buffer.from(zipMember(zip, 'README.txt')), Buffer.from('readme'));
  assert.deepEqual(Buffer.from(zipMember(zip, PIN.file)), net);
  assert.throws(() => zipMember(zip, 'absent.nnue'), /zip has no absent\.nnue/);
  assert.throws(() => zipMember(Buffer.from('not a zip at all, just text'), PIN.file), /not a zip/);
});
