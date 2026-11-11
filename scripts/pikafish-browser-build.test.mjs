import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const assets = new URL('../apps/web/public/engine/pikafish/', import.meta.url);
const net = 'xiangqi-c07e94a5c7cb.nnue';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pikafish-browser-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const wasm = join(root, 'wasm');
  const src = join(root, 'src');
  const tools = join(root, 'tools');
  const out = join(root, 'dist/wasm');
  for (const dir of [
    wasm,
    tools,
    join(src, 'nnue/features'),
    join(src, 'universal'),
    join(src, 'temp_builds'),
  ]) {
    await mkdir(dir, { recursive: true });
  }
  for (const file of ['build.sh', 'source.patch', 'pikafish-cc0-net.patch']) {
    await writeFile(join(wasm, file), await readFile(new URL(file, assets)));
  }
  await writeFile(join(root, 'Copying.txt'), 'fixture GPL license');
  await writeFile(join(src, 'evaluate.h'), `#define EvalFileDefaultName "${net}"\n`);
  await writeFile(join(src, 'main.cpp'), 'void pikafish_initialize() {}');
  for (const file of [
    'nnue/features/full_threats.cpp',
    'nnue/features/half_ka_v2_hm.cpp',
    'nnue/features/half_ka_v2_xq.cpp',
    'universal/shim.cpp',
    'temp_builds/duplicate.cpp',
  ]) {
    await writeFile(join(src, file), 'fixture source');
  }
  const log = join(root, 'compiler-args.json');
  await writeFile(
    join(tools, 'em++'),
    `#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));
`,
    { mode: 0o755 },
  );
  const run = () =>
    execFileSync('bash', [join(wasm, 'build.sh')], {
      env: { ...process.env, PATH: `${tools}:${process.env.PATH}` },
      encoding: 'utf8',
      stdio: 'pipe',
    });
  return { src, out, log, run };
}

test('browser build excludes obsolete CC0 feature sources and ships both patches plus GPL license', async (t) => {
  const { src, out, log, run } = await fixture(t);
  run();
  const args = JSON.parse(await readFile(log, 'utf8'));
  assert.deepEqual(
    args.filter((arg) => arg.endsWith('.cpp')),
    [join(src, 'main.cpp'), join(src, 'nnue/features/half_ka_v2_xq.cpp')],
  );
  assert.ok(args.includes('-msimd128'));
  assert.ok(args.includes('-pthread'));
  assert.ok(args.includes('-sPTHREAD_POOL_SIZE=8'));
  for (const file of ['source.patch', 'pikafish-cc0-net.patch']) {
    assert.deepEqual(await readFile(join(out, file)), await readFile(new URL(file, assets)));
  }
  assert.equal(await readFile(join(out, 'COPYING.txt'), 'utf8'), 'fixture GPL license');
});

test('browser build refuses a checkout missing either required patch', async (t) => {
  const { src, run } = await fixture(t);
  await writeFile(join(src, 'evaluate.h'), '// unpatched engine');
  assert.throws(run, /Apply source.patch and pikafish-cc0-net.patch/);
  await writeFile(join(src, 'evaluate.h'), `#define EvalFileDefaultName "${net}"\n`);
  await writeFile(join(src, 'main.cpp'), '// no browser entry points');
  assert.throws(run, /Apply source.patch before building/);
});
