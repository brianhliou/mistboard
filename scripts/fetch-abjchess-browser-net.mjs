#!/usr/bin/env node
// The AB-JChess jieqi net for the browser build. The authors allow mistboard.com
// to serve it (lxsgx23/AB-JChess#1) but it is never committed or re-hosted: each
// build fetches their release zip, checks the zip's and the net's sha256 against
// net.json, and installs the net only when both match. Like the Pikafish net, a
// failed fetch fails the build: a release without the net would serve an engine
// that cannot start (the panel would fall back to PikaJieQi for everyone).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const webDir = fileURLToPath(new URL('../apps/web/public/engine/ab-jchess/', import.meta.url));
export const PIN = JSON.parse(readFileSync(join(webDir, 'net.json'), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The bytes of the zip member whose path ends in `/<name>` (or is `<name>`). */
export function zipMember(zip, name) {
  const buf = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const path = buf.toString('utf8', at + 46, at + 46 + nameLength);
    if (path === name || path.endsWith(`/${name}`)) {
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('bad zip local header');
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + packed);
      if (method === 0) return new Uint8Array(data);
      if (method === 8) return new Uint8Array(inflateRawSync(data));
      throw new Error(`zip member ${path} uses unsupported method ${method}`);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`zip has no ${name}`);
}

/** 'present' | 'downloaded'; throws with the reason when nothing was installed. */
export async function fetchAbjchessBrowserNet(
  target = join(webDir, PIN.file),
  { fetchImpl = fetch, pin = PIN } = {},
) {
  try {
    const bytes = await readFile(target);
    if (bytes.length === pin.bytes && digest(bytes) === pin.sha256) return 'present';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetchImpl(pin.zipUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`release zip download failed: HTTP ${response.status}`);
  const zip = new Uint8Array(await response.arrayBuffer());
  if (zip.length !== pin.zipBytes || digest(zip) !== pin.zipSha256) {
    throw new Error(`release zip does not match net.json (sha256 ${pin.zipSha256})`);
  }
  const net = zipMember(zip, pin.file);
  if (net.length !== pin.bytes || digest(net) !== pin.sha256) {
    throw new Error(`${pin.file} does not match net.json (sha256 ${pin.sha256})`);
  }
  await mkdir(dirname(target), { recursive: true });
  const temporary = await mkdtemp(join(dirname(target), '.abjchess-net-'));
  try {
    const staged = join(temporary, pin.file);
    await writeFile(staged, net);
    await rename(staged, target);
    return 'downloaded';
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2);
  if (paths.length > 1 || paths.some((arg) => arg.startsWith('--'))) {
    console.error('Usage: node scripts/fetch-abjchess-browser-net.mjs [target-file]');
    process.exitCode = 1;
  } else {
    try {
      const state = await fetchAbjchessBrowserNet(paths[0] ? resolve(paths[0]) : undefined);
      console.log(`ab-jchess browser net: ${state} (${PIN.bytes} bytes, sha256 ok)`);
    } catch (error) {
      console.error(`ab-jchess browser net: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
