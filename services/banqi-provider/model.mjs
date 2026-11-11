import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

const MAX_MODEL_BYTES = 16 * 1024 * 1024;
const pinDefault = typeof __BANQI_MODEL_PIN__ === 'undefined' ? null : __BANQI_MODEL_PIN__;
export const modelPin = () => pinDefault;
async function body(response, limit) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('model-download');
  }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new Error('model-size');
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new Error('model-size');
      chunks.push(chunk);
    }
  } finally {
    await response.body.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

/** Pin is injected from the existing public fetch-private-net.sh recipe at build.
 * Authorization stays in memory and is never forwarded to GitHub's asset CDN. */
export async function loadModel(env = process.env, runtimeRoot = tmpdir(), pin = pinDefault) {
  const token = env.MISTBOARD_BANQI_MODEL_DOWNLOAD_TOKEN;
  delete env.MISTBOARD_BANQI_MODEL_DOWNLOAD_TOKEN;
  delete env.MISTBOARD_PRIVATE_ASSETS_TOKEN;
  const sha = env.MISTBOARD_BANQI_MODEL_SHA256,
    path = env.MISTBOARD_BANQI_MODEL_PATH;
  if (
    !/^[a-f0-9]{64}$/.test(sha ?? '') ||
    (pin && sha !== pin.sha) ||
    env.MISTBOARD_BANQI_MODEL_URL
  )
    throw new Error('model-configuration');
  let bytes;
  if (path) {
    if (!isAbsolute(path)) throw new Error('model-configuration');
    const info = await stat(path);
    if (!info.isFile() || info.size === 0 || info.size > MAX_MODEL_BYTES)
      throw new Error('model-size');
    bytes = await readFile(path);
  } else {
    if (!pin || typeof token !== 'string' || token.length < 16 || /[\r\n\0]/.test(token))
      throw new Error('model-configuration');
    const signal = AbortSignal.timeout(30000);
    const api = `https://api.github.com/repos/${pin.repo}/releases`;
    const headers = {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'mistboard-banqi-host',
    };
    const metadata = JSON.parse(
      (
        await body(
          await fetch(`${api}/tags/${pin.tag}`, { headers, signal, redirect: 'manual' }),
          1024 * 1024,
        )
      ).toString('utf8'),
    );
    const assets = metadata.assets?.filter((a) => a.name === pin.asset);
    const asset = assets?.[0];
    if (
      metadata.tag_name !== pin.tag ||
      assets?.length !== 1 ||
      !Number.isSafeInteger(asset.id) ||
      asset.id <= 0 ||
      !Number.isInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > MAX_MODEL_BYTES
    )
      throw new Error('model-metadata');
    let url = new URL(`${api}/assets/${asset.id}`),
      response;
    for (let hop = 0; hop < 4; hop++) {
      response = await fetch(url, {
        headers:
          hop === 0
            ? { ...headers, accept: 'application/octet-stream' }
            : { accept: 'application/octet-stream' },
        signal,
        redirect: 'manual',
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || hop === 3) throw new Error('model-redirect');
      const next = new URL(location, url);
      if (
        next.protocol !== 'https:' ||
        next.username ||
        next.password ||
        next.hash ||
        !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(
          next.hostname,
        )
      )
        throw new Error('model-redirect');
      url = next;
    }
    bytes = await body(response, MAX_MODEL_BYTES);
    if (bytes.length !== asset.size) throw new Error('model-size');
  }
  if (!bytes.length || createHash('sha256').update(bytes).digest('hex') !== sha)
    throw new Error('model-checksum');
  if (path) return { path, close: async () => {} };
  const dir = await mkdtemp(join(runtimeRoot, 'banqi-model-'));
  await chmod(dir, 0o700);
  try {
    const target = join(dir, 'model.bqnn');
    await writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
    return {
      path: target,
      ownedDir: dir,
      close: () => rm(dirname(target), { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
