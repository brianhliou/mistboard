import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
export async function banqiModelPin() {
  const script = await readFile(join(root, 'scripts/fetch-private-net.sh'), 'utf8');
  const block = script.match(/\n {2}banqi-net\)([\s\S]*?);;/)?.[1];
  const repo = block?.match(/repo=([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/)?.[1],
    tag = block?.match(/tag=([a-zA-Z0-9_.-]+)/)?.[1],
    asset = block?.match(/asset=([a-zA-Z0-9_.-]+)/)?.[1],
    sha = block?.match(/sha=([a-f0-9]{64})/)?.[1];
  if (!repo || !tag || !asset || !sha) throw new Error('Invalid public model pin');
  const engineScript = await readFile(join(root, 'scripts/fetch-release-asset.sh'), 'utf8');
  const engineBlock = engineScript.match(/\n {2}banqi-engine\)([\s\S]*?);;/)?.[1];
  const engineTag = engineBlock?.match(/tag=(v[0-9.]+)/)?.[1],
    engineSha = engineBlock?.match(/sha=([a-f0-9]{64})/)?.[1];
  if (!engineTag || !engineSha) throw new Error('Invalid public engine pin');
  return { repo, tag, asset, sha, engineTag, engineSha };
}
export async function createHostContext(out) {
  if (out) await mkdir(out, { mode: 0o700 });
  else out = await mkdtemp(join(tmpdir(), 'mistboard-banqi-host-'));
  const bundle = await build({
    entryPoints: [join(root, 'services/banqi-provider/host.mjs')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    define: { __BANQI_MODEL_PIN__: JSON.stringify(await banqiModelPin()) },
    write: false,
    metafile: true,
    treeShaking: true,
    plugins: [
      {
        name: 'standalone-provider',
        setup(build) {
          build.onResolve({ filter: /^@mistboard\/game$/ }, () => ({
            path: join(root, 'packages/game/src/index.ts'),
          }));
          build.onResolve({ filter: /^\.\/obs\.js$/ }, (args) =>
            args.importer === join(root, 'apps/server/src/uci-engine-harness.ts')
              ? { path: join(root, 'services/banqi-provider/observability.mjs') }
              : undefined,
          );
        },
      },
    ],
  });
  // Bundle inputs, rather than the checkout, are the security boundary.
  for (const input of Object.keys(bundle.metafile.inputs)) {
    if (input === '<define:__BANQI_MODEL_PIN__>') continue;
    const path = resolve(root, input);
    if (
      !path.startsWith(join(root, 'packages/game/src/')) &&
      !path.startsWith(join(root, 'node_modules/')) &&
      ![
        'services/banqi-provider/host.mjs',
        'services/banqi-provider/model.mjs',
        'services/banqi-provider/observability.mjs',
        'apps/server/src/banqi-provider.ts',
        'apps/server/src/banqi-provider-protocol.ts',
        'apps/server/src/banqi-provider-bridge.ts',
        'apps/server/src/uci-engine-harness.ts',
      ].some((p) => path === join(root, p))
    )
      throw new Error('Unexpected worker bundle input');
  }
  await writeFile(join(out, 'worker.mjs'), bundle.outputFiles[0].contents, {
    flag: 'wx',
    mode: 0o600,
  });
  for (const [from, to] of [
    ['services/banqi-provider/Dockerfile', 'Dockerfile'],
    ['services/banqi-provider/Dockerfile.dockerignore', '.dockerignore'],
    ['scripts/fetch-release-asset.sh', 'fetch-release-asset.sh'],
    ['LICENSE', 'LICENSE'],
    ['services/banqi-provider/ENGINE-LICENSE', 'ENGINE-LICENSE'],
  ])
    await copyFile(join(root, from), join(out, to));
  const files = (await readdir(out)).sort();
  if (
    files.join(',') !==
    '.dockerignore,Dockerfile,ENGINE-LICENSE,LICENSE,fetch-release-asset.sh,worker.mjs'
  )
    throw new Error('Unexpected worker context file');
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--out');
  console.log(await createHostContext(i < 0 ? undefined : resolve(process.argv[i + 1])));
}
