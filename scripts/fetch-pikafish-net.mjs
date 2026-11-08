#!/usr/bin/env node
// One private, checksummed source for native builds, browser builds and local tests.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const webDir = fileURLToPath(new URL('../apps/web/public/engine/pikafish/', import.meta.url));
export const PIN = JSON.parse(readFileSync(join(webDir, 'net.json'), 'utf8'));
const execFileAsync = promisify(execFile);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function matches(bytes, pin) {
  return bytes.length === pin.bytes && digest(bytes) === pin.sha256;
}

async function ghDownload(directory, pin, env) {
  try {
    await execFileAsync(
      'gh',
      [
        'release',
        'download',
        pin.releaseTag,
        '-R',
        pin.releaseRepo,
        '-p',
        pin.file,
        '-D',
        directory,
      ],
      { env, timeout: 120_000 },
    );
  } catch {
    // Never forward subprocess diagnostics or fetch errors that could contain credentials.
    throw new Error(
      'Private Pikafish net download failed. Sign in with gh or set MISTBOARD_PRIVATE_ASSETS_TOKEN.',
    );
  }
}

export async function fetchPikafishNet(
  target = join(webDir, PIN.file),
  {
    env = process.env,
    fetchImpl = fetch,
    downloadWithGh = ghDownload,
    pin = PIN,
    requireToken = false,
  } = {},
) {
  const token = env.MISTBOARD_PRIVATE_ASSETS_TOKEN;
  const automated =
    requireToken || env.CI || env.NODE_ENV === 'production' || env.RAILWAY_ENVIRONMENT_ID;
  // A pinned copy already on disk (CI cache, earlier step) needs no credential.
  try {
    if (matches(await readFile(target), pin)) return 'present';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!token && automated) {
    throw new Error(
      'MISTBOARD_PRIVATE_ASSETS_TOKEN is required to fetch the private Pikafish net in CI and production builds.',
    );
  }
  await mkdir(dirname(target), { recursive: true });
  const temporary = await mkdtemp(join(dirname(target), '.pikafish-net-'));
  try {
    const staged = join(temporary, pin.file);
    if (token) {
      let response;
      try {
        response = await fetchImpl(pin.url, {
          headers: { Accept: 'application/octet-stream', Authorization: `Bearer ${token}` },
          redirect: 'manual',
          signal: AbortSignal.timeout(120_000),
        });
        // GitHub redirects to signed asset storage. Never send Authorization there.
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = new URL(response.headers.get('location'), pin.url);
          if (location.protocol !== 'https:' || location.username || location.password) {
            throw new Error('Invalid asset redirect');
          }
          await response.body?.cancel();
          response = await fetchImpl(location.href, {
            redirect: 'follow',
            signal: AbortSignal.timeout(120_000),
          });
        }
        if (!response.ok) throw new Error('Asset request failed');
        await writeFile(staged, new Uint8Array(await response.arrayBuffer()));
      } catch {
        throw new Error(
          'Private Pikafish asset request failed. Check MISTBOARD_PRIVATE_ASSETS_TOKEN and private repository access.',
        );
      }
    } else {
      await downloadWithGh(temporary, pin, env);
    }
    if (!matches(await readFile(staged), pin)) {
      throw new Error(
        `Pikafish net does not match net.json (${pin.bytes} bytes, sha256 ${pin.sha256}). Not installed.`,
      );
    }
    await rename(staged, target);
    return 'downloaded';
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const requireToken = args.includes('--require-token');
  const paths = args.filter((arg) => arg !== '--require-token');
  if (paths.length > 1 || paths.some((arg) => arg.startsWith('--'))) {
    console.error('Usage: node scripts/fetch-pikafish-net.mjs [target-file] [--require-token]');
    process.exitCode = 1;
  } else {
    try {
      const state = await fetchPikafishNet(paths[0] ? resolve(paths[0]) : undefined, {
        requireToken,
      });
      console.log(`pikafish net: ${state} (${PIN.bytes} bytes, sha256 ok)`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
