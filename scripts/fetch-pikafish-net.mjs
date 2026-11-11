#!/usr/bin/env node
// Public CC0 network (about 11 MB), pinned by commit, size and sha256.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = fileURLToPath(new URL('../apps/web/public/engine/pikafish/', import.meta.url));
export const PIN = JSON.parse(readFileSync(join(webDir, 'net.json'), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function matches(bytes, pin) {
  return bytes.length === pin.bytes && digest(bytes) === pin.sha256;
}

export async function fetchPikafishNet(
  target = join(webDir, PIN.file),
  { fetchImpl = fetch, pin = PIN } = {},
) {
  try {
    if (matches(await readFile(target), pin)) return 'present';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(target), { recursive: true });
  const temporary = await mkdtemp(join(dirname(target), '.pikafish-net-'));
  try {
    const staged = join(temporary, pin.file);
    const response = await fetchImpl(pin.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`CC0 Pikafish net download failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!matches(bytes, pin)) {
      throw new Error(
        `Pikafish net does not match net.json (${pin.bytes} bytes, sha256 ${pin.sha256}). Not installed.`,
      );
    }
    await writeFile(staged, bytes);
    await rename(staged, target);
    return 'downloaded';
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2);
  if (paths.length > 1 || paths.some((arg) => arg.startsWith('--'))) {
    console.error('Usage: node scripts/fetch-pikafish-net.mjs [target-file]');
    process.exitCode = 1;
  } else {
    try {
      const state = await fetchPikafishNet(paths[0] ? resolve(paths[0]) : undefined);
      console.log(`pikafish net: ${state} (${PIN.bytes} bytes, sha256 ok)`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
