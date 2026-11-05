// The engine recipe lives in scripts/engine-assets.sh; three other files have
// to agree with it by hand (the workflow's push paths, the Railway watch
// patterns, the railpack build step), and none of them typechecks. This test
// is the mirror check: a pin added to the recipe but not to the workflow would
// build once and never rebuild; one missing from the watch patterns would move
// the pin without a deploy; a railpack step that compiles again would put the
// 2.5 minutes back.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(repoRoot, 'scripts/engine-assets.sh');
const recipe = readFileSync(script, 'utf8');
const workflow = readFileSync(resolve(repoRoot, '.github/workflows/build-engines.yml'), 'utf8');
const railpack = readFileSync(resolve(repoRoot, 'railpack.json'), 'utf8');

function recipeInputs() {
  const line = recipe.match(/^RECIPE_INPUTS="([^"]+)"$/m);
  assert.ok(line, 'engine-assets.sh declares RECIPE_INPUTS on one line');
  return line[1].trim().split(/\s+/);
}

function run(...args) {
  return execFileSync('sh', [script, ...args], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

test('every recipe input exists and each .ref pins a full commit sha on line 1', () => {
  for (const input of recipeInputs()) {
    assert.ok(existsSync(resolve(repoRoot, input)), `${input} is listed but missing`);
    if (input.endsWith('.ref')) {
      const first = readFileSync(resolve(repoRoot, input), 'utf8').split('\n')[0].trim();
      assert.match(first, /^[0-9a-f]{40}$/, `${input} line 1 must be a 40-char sha`);
    }
  }
});

test('the recipe tag is engines-<12 hex> and deterministic', () => {
  const tag = run('tag');
  assert.match(tag, /^engines-[0-9a-f]{12}$/);
  assert.equal(run('tag'), tag);
  assert.equal(tag, `engines-${run('hash')}`);
});

test('the Build engines workflow re-runs on every recipe input, the script and itself', () => {
  const paths = workflow
    .split('\n')
    .filter((line) => /^\s{6}- \S/.test(line))
    .map((line) => line.trim().slice(2));
  for (const input of [
    ...recipeInputs(),
    'scripts/engine-assets.sh',
    '.github/workflows/build-engines.yml',
  ]) {
    assert.ok(paths.includes(input), `build-engines.yml on.push.paths must list ${input}`);
  }
});

test('every Railway service watches every recipe input, so a pin bump deploys', () => {
  for (const file of ['railway.web.json', 'railway.json', 'railway.engine-worker.json']) {
    const { build } = JSON.parse(readFileSync(resolve(repoRoot, file), 'utf8'));
    for (const input of [...recipeInputs(), 'scripts/engine-assets.sh']) {
      assert.ok(build.watchPatterns.includes(`/${input}`), `${file} must watch /${input}`);
    }
  }
});

test('railpack fetches the published engines, verifies them, and compiles none of them', () => {
  const fetch = railpack.indexOf('sh /app/scripts/engine-assets.sh fetch /app/bin');
  const verify = railpack.indexOf(
    'sh /app/scripts/engine-assets.sh verify /app/bin /app/apps/server/src',
  );
  const net = railpack.indexOf('sh /app/scripts/fetch-fsf-xiangqi-net.sh /app/bin');
  assert.ok(fetch > 0, 'railpack.json must fetch the engine assets');
  assert.ok(verify > fetch, 'verify runs after fetch');
  assert.ok(
    net > verify,
    'the xiangqi NNUE gate runs the fetched binary, so it comes after verify',
  );
  assert.doesNotMatch(
    railpack,
    /make -C \/tmp\/(fairy-stockfish|stockfish|pikafish)/,
    'no server engine is compiled at image build time any more',
  );
});

test('the recipe builds and verifies the same ten binaries the image expects', () => {
  const binaries = recipe.match(/^BINARIES="([^"]+)"$/m)[1].split(/\s+/);
  assert.deepEqual(binaries, [
    'fairy-stockfish-xiangqi',
    'fairy-stockfish-duck-xiangqi',
    'fairy-stockfish-atomic-xiangqi',
    'stockfish',
    'pikafish-jieqi',
    'pikafish',
    'ab-jchess',
    'katago-jungle',
    'jqe',
    'rapfi',
  ]);
  // Every binary is built with the ISA the container was measured for; AB-JChess
  // alone targets avx2 (its NNUE is its strength; ab-jchess.ref).
  assert.match(recipe, /^ARCH=x86-64-sse41-popcnt$/m);
  assert.match(recipe, /^ABJ_ARCH=x86-64-avx2$/m);
  // KataGo-AnimalChess: the Eigen CPU backend with AVX2, linked static (katago-jungle.ref).
  assert.match(recipe, /^KATA_CMAKE_FLAGS=".*-DUSE_BACKEND=EIGEN .*-DUSE_AVX2=1 .*-static"$/m);
  assert.match(recipe, /echo "kata-cmake=\$KATA_CMAKE_FLAGS"/, 'the cmake flags are in the hash');
});

test('Rapfi pins its native recipe, data extractor and full source SHA', async () => {
  assert.ok(recipeInputs().includes('rapfi.ref'));
  assert.ok(recipeInputs().includes('scripts/rapfi-assets.mjs'));
  assert.match(
    readFileSync(resolve(repoRoot, 'rapfi.ref'), 'utf8'),
    /^1387d11312190ec66665d361ff07a7c70221b78a\n/,
  );
  assert.match(
    recipe,
    /^RAPFI_CMAKE_FLAGS=".*-DUSE_SSE=ON .*-DUSE_AVX2=ON .*-DUSE_BMI2=ON .*-DNO_COMMAND_MODULES=OFF .*-march=haswell .*-static"$/m,
  );
  assert.match(recipe, /echo "rapfi-cmake=\$RAPFI_CMAKE_FLAGS"/);
  assert.match(recipe, /verify-rapfi\)/);
  assert.match(recipe, /rapfi_search_ok "\$bin"/);
  const { BUNDLE } = await import('./rapfi-assets.mjs');
  const webPin = JSON.parse(
    readFileSync(resolve(repoRoot, 'apps/web/public/engine/rapfi/net.json')),
  );
  assert.equal(BUNDLE.sha256, webPin.sha256);
  assert.equal(BUNDLE.bytes, webPin.bytes);
  assert.equal(BUNDLE.url, webPin.url);
});

async function withRapfiAssets(t, callback) {
  const bundle = resolve(repoRoot, 'apps/web/public/engine/rapfi/rapfi-single-simd128.data');
  if (!existsSync(bundle)) return t.skip('stage net.json data to exercise native extraction');
  const bin = mkdtempSync(resolve(tmpdir(), 'rapfi-assets-test-'));
  try {
    const assets = await import('./rapfi-assets.mjs');
    await assets.stage(bin, bundle);
    await callback(bin, assets, bundle);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

test('Rapfi extracts individually pinned native files from the checked web bundle', async (t) => {
  await withRapfiAssets(t, async (bin, assets, bundle) => {
    await assets.check(bin);
    const config = readFileSync(resolve(bin, 'config.toml'), 'utf8');
    for (const [, file] of config.matchAll(
      /(?:binary_file|weight_file(?:_black|_white)?) = "([^"]+)"/g,
    )) {
      assert.ok(
        assets.FILES.some((entry) => entry.name === file),
        `${file} must be pinned`,
      );
    }
    writeFileSync(resolve(bin, 'bad.data'), 'truncated bundle');
    await assert.rejects(
      assets.stage(bin, resolve(bin, 'bad.data')),
      /bundle.*SHA256|bundle.*size/i,
    );
    writeFileSync(resolve(bin, 'mix9svqfreestyle_bsmix.bin.lz4'), 'replaced net');
    await assert.rejects(assets.check(bin), /mix9svqfreestyle.*SHA256/);
    await assets.stage(bin, bundle);
    await assets.check(bin);
  });
});

function fakeRapfi(bin, mode) {
  const native = `#!/usr/bin/env node
const fs = require('node:fs');
const rl = require('node:readline').createInterface({input: process.stdin});
console.log('MESSAGE Evaluator set to mix9svq.');
rl.on('line', line => {
  fs.appendFileSync('commands.log', line + '\\n');
  if (line === 'YXNBEST 1') {
    if (${JSON.stringify(mode)} === 'hang') return;
    if (${JSON.stringify(mode)} === 'loaded') {
      console.log('MESSAGE mix9svq nnue: load weight from mix9svqfreestyle_bsmix.bin.lz4');
      console.log('MESSAGE mix9svq nnue: weight loaded in 20ms');
    }
    if (${JSON.stringify(mode)} === 'error') console.log('ERROR failed to load nnue weight');
    console.log('INFO PV 0');
    console.log('INFO DEPTH 3');
    console.log('INFO NODES 1024');
    console.log('INFO EVAL 20');
    console.log('INFO BESTLINE 6,6');
    console.log('INFO PV DONE');
    console.log('6,6');
  }
  if (line === 'END') process.exit(0);
});
`;
  writeFileSync(resolve(bin, 'rapfi'), native, { mode: 0o755 });
}

test('Rapfi startup gate requires loaded neural weights and a completed search, and bounds hangs', async (t) => {
  await withRapfiAssets(t, async (bin, assets) => {
    fakeRapfi(bin, 'loaded');
    await assets.search(bin);
    const commands = readFileSync(resolve(bin, 'commands.log'), 'utf8');
    assert.match(commands, /INFO max_memory 33554432/);
    assert.match(commands, /INFO thread_num 1/);
    assert.match(commands, /YXBOARD\n7,7,1\n8,7,2\n8,8,1\nDONE\nYXNBEST 1/);
    for (const mode of ['classical', 'error', 'hang']) {
      fakeRapfi(bin, mode);
      await assert.rejects(
        assets.search(bin, { timeoutMs: 300 }),
        /weight|search.*timed out|ERROR/i,
      );
    }
    fakeRapfi(bin, 'loaded');
    writeFileSync(resolve(bin, 'model210901.bin'), 'bad model');
    await assert.rejects(assets.search(bin), /model210901.*SHA256/);
  });
});

test('Rapfi native data and licences enter the tarball and checksum manifest', async (t) => {
  await withRapfiAssets(t, async (bin, assets) => {
    for (const name of recipe.match(/^BINARIES="([^"]+)"$/m)[1].split(/\s+/)) {
      writeFileSync(resolve(bin, name), 'fixture binary', { mode: 0o755 });
    }
    writeFileSync(resolve(bin, 'pikafish.nnue'), 'fixture net');
    writeFileSync(resolve(bin, 'it014.jqn'), 'fixture net');
    const out = resolve(bin, 'dist');
    run('package', bin, out);
    const tar = execFileSync('tar', ['-tzf', resolve(out, 'engines-x86-64-sse41-popcnt.tar.gz')], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
    const manifest = readFileSync(resolve(out, 'MANIFEST'), 'utf8');
    for (const entry of [...assets.FILES, ...assets.LICENSES]) {
      assert.ok(tar.includes(entry.name), `${entry.name} is packaged`);
      assert.ok(manifest.includes(`${entry.name}=sha256:${entry.sha256}`));
    }
    assert.ok(tar.includes('rapfi'));
    assert.ok(
      !tar.some((name) => name.endsWith('.data')),
      'the Emscripten container is not a native net',
    );
  });
});

test('Rapfi offline source path uses the pinned clean tree and the production CMake recipe', async (t) => {
  await withRapfiAssets(t, async (bin, assets, bundle) => {
    const source = resolve(bin, 'local source');
    const tools = resolve(bin, 'tools');
    mkdirSync(resolve(source, 'Rapfi'), { recursive: true });
    mkdirSync(tools);
    writeFileSync(resolve(source, 'Rapfi/CMakeLists.txt'), 'fixture pinned source');
    const log = resolve(bin, 'recipe.log');
    const executable = (name, code) =>
      writeFileSync(resolve(tools, name), `#!${process.execPath}\n${code}`, { mode: 0o755 });
    executable(
      'git',
      `
const {execFileSync}=require('node:child_process');
const args=process.argv.slice(2);
if(args[0]==='rev-parse') console.log(process.env.RAPFI_TEST_WRONG_PIN ? '0'.repeat(40) : '1387d11312190ec66665d361ff07a7c70221b78a');
else if(args[0]==='archive') execFileSync('tar',['-cf',args[1].slice('--output='.length),'Rapfi']);
else process.exit(1);
`,
    );
    executable(
      'cmake',
      `
const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(args[0]==='--build') {
  // Rapfi/CMakeLists.txt sets OUTPUT_NAME "pbrain-rapfi" on the rapfi target.
  fs.writeFileSync(path.join(args[1],'pbrain-rapfi'),'fixture native binary');
} else {
  if(fs.readFileSync(path.join(args[args.indexOf('-S')+1],'CMakeLists.txt'),'utf8')!=='fixture pinned source') process.exit(1);
  fs.mkdirSync(args[args.indexOf('-B')+1],{recursive:true});
}
`,
    );
    executable('strip', `require('node:fs').copyFileSync(process.argv[4],process.argv[3]);`);
    executable('curl', `throw new Error('offline source path must never download');`);
    const env = { ...process.env, PATH: `${tools}:${process.env.PATH}` };
    execFileSync('sh', [script, 'build-rapfi', bin, source, bundle], { env });
    const [configure, build] = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const expected = recipe.match(/^RAPFI_CMAKE_FLAGS="([^"]+)"$/m)[1].split(' ');
    assert.deepEqual(configure.slice(4), expected);
    assert.ok(configure[1].endsWith('/source/Rapfi'));
    assert.ok(!configure[3].startsWith(source), 'build output stays outside shared source');
    assert.deepEqual(build.slice(-2), ['--target', 'rapfi']);
    assert.equal(readFileSync(resolve(bin, 'rapfi'), 'utf8'), 'fixture native binary');
    await assets.check(bin);
    assert.throws(
      () =>
        execFileSync('sh', [script, 'build-rapfi', bin, source, bundle], {
          env: { ...env, RAPFI_TEST_WRONG_PIN: '1' },
          stdio: 'pipe',
        }),
      /not pinned/,
    );
  });
});

// jqe's net is MIT like its code (jqe.ref), so unlike AB-JChess's and KataGo's it
// ships in our engines release: pinned by sha, packaged beside the binary, and
// loaded by the verify gate, which also refuses a build that fell back to the
// classical eval because the net did not load.
test('the jqe net is pinned by hash, packaged with the binary, and loaded by verify', () => {
  assert.match(recipe, /^JQE_NET=it014\.jqn$/m);
  assert.match(
    recipe,
    /^JQE_NET_SHA256=f90bd44e8ee244405eb08eb4f784e3f156900f0691f651b5124d50032f8ba160$/m,
  );
  assert.match(recipe, /^JQE_CMAKE_FLAGS=".*-DJQE_NATIVE=OFF .*-march=haswell .*-static"$/m);
  assert.match(recipe, /echo "jqe-cmake=\$JQE_CMAKE_FLAGS"/, 'the cmake flags are in the hash');
  assert.match(recipe, /echo "jqe-net=\$JQE_NET_SHA256"/, 'the net sha is in the hash');
  assert.match(recipe, /-czf "\$out\/\$ASSET" \$BINARIES pikafish\.nnue "\$JQE_NET"/);
  assert.match(recipe, /jqe_search_ok "\$bin\/jqe" "\$bin\/\$JQE_NET"/);
  assert.match(
    recipe,
    /EvalFile loaded/,
    'verify wants the net loaded, not the classical fallback',
  );
  assert.match(
    readFileSync(resolve(repoRoot, 'jqe.ref'), 'utf8').split('\n')[0],
    /^331a6e612a038c4a04cf980f7b9482910fd50078$/,
  );
});

// The KataGo-AnimalChess net has no release of its own; it ships inside Kouza's
// Dandelion 4 GUI zip. We run it with hzyhhzy's agreement (hzyhhzy/KataGomo#12)
// and never re-host it: the engines tarball never contains it, and the image
// checks the zip and the net before the fetched binary plays a move on it.
test('the KataGo jungle net is fetched from Dandelion, checksummed, and never packaged', () => {
  assert.doesNotMatch(
    recipe,
    /b10c384|katago-jungle-net/,
    'engine-assets.sh never touches the net',
  );
  const fetchNet = readFileSync(resolve(repoRoot, 'scripts/fetch-katago-jungle-net.sh'), 'utf8');
  assert.match(
    fetchNet,
    /^url=https:\/\/github\.com\/lxsgx23\/Dandelion-Chess\/releases\/download\/v4\.0\//m,
  );
  assert.match(fetchNet, /^zip_sha=[0-9a-f]{64}$/m, 'the zip is checked');
  assert.match(fetchNet, /^net_sha=[0-9a-f]{64}$/m, 'the extracted net is checked');
  assert.match(fetchNet, /Loaded model/, 'the fetched binary loads the net');
  const step = railpack.indexOf(
    'sh /app/scripts/fetch-katago-jungle-net.sh /app/bin /app/apps/server/src/katago-jungle-gtp.cfg',
  );
  assert.ok(step > 0, 'railpack.json runs the net script with the seat config');
  assert.ok(
    step > railpack.indexOf('sh /app/scripts/engine-assets.sh verify'),
    'the net gate runs the fetched binary, so it comes after verify',
  );
  assert.ok(
    existsSync(resolve(repoRoot, 'apps/server/src/katago-jungle-gtp.cfg')),
    'the config the step loads is in the repo',
  );
});

// The author allowed site use on the terms that we fetch his net from his own
// release and never re-host it (lxsgx23/AB-JChess#1). So the net must never
// enter our engines tarball, and the image must check it before using it.
test('the AB-JChess net is fetched from the author, checksummed, and never packaged', () => {
  assert.doesNotMatch(recipe, /abjchess-\d+\.nnue/, 'engine-assets.sh never touches the net');
  const fetchNet = readFileSync(resolve(repoRoot, 'scripts/fetch-abjchess-net.sh'), 'utf8');
  assert.match(fetchNet, /^url=https:\/\/github\.com\/lxsgx23\/AB-JChess\/releases\/download\//m);
  assert.match(fetchNet, /^zip_sha=[0-9a-f]{64}$/m, 'the zip is checked');
  assert.match(fetchNet, /^net_sha=[0-9a-f]{64}$/m, 'the extracted net is checked');
  assert.match(fetchNet, /EvalFile loaded/, 'the fetched binary loads the net');
  assert.match(
    fetchNet,
    /^bench_nodes=43125$/m,
    'the fetched binary matches the author bench signature',
  );
  const step = railpack.indexOf('sh /app/scripts/fetch-abjchess-net.sh /app/bin');
  assert.ok(step > 0, 'railpack.json runs the net script');
  assert.ok(
    step > railpack.indexOf('sh /app/scripts/engine-assets.sh verify'),
    'the net gate runs the fetched binary, so it comes after verify',
  );
});

// Railpack cuts an inline build command at its first single quote and still
// passes the build (2026-09-30): the AB-JChess net step ran only its download,
// and the Fairy-Stockfish xiangqi net step only its download too, so neither
// checksum nor load check ever ran. Logic with quotes goes in a set -eu script
// under scripts/, which railpack runs as `sh /app/scripts/<name> ...`.
function railpackCommands() {
  const { steps } = JSON.parse(railpack);
  return Object.values(steps).flatMap((step) =>
    (step.commands ?? []).filter((command) => typeof command === 'string'),
  );
}

test('no railpack build command contains a single quote', () => {
  const quoted = railpackCommands().filter((command) => command.includes("'"));
  assert.deepEqual(
    quoted,
    [],
    'railpack cuts inline commands at the first single quote; move these into scripts/*.sh',
  );
});

test('every script railpack runs exists, fails fast, and redeploys every service when it changes', () => {
  const scripts = new Set();
  for (const command of railpackCommands()) {
    for (const match of command.matchAll(/\/app\/scripts\/([\w.-]+)/g)) scripts.add(match[1]);
  }
  assert.ok(scripts.size > 0, 'railpack runs scripts from /app/scripts');
  for (const name of scripts) {
    const path = resolve(repoRoot, 'scripts', name);
    assert.ok(existsSync(path), `railpack runs scripts/${name}, which does not exist`);
    if (name.endsWith('.sh')) {
      assert.match(readFileSync(path, 'utf8'), /^set -eu$/m, `scripts/${name} must set -eu`);
    }
  }
  for (const file of ['railway.web.json', 'railway.json', 'railway.engine-worker.json']) {
    const { build } = JSON.parse(readFileSync(resolve(repoRoot, file), 'utf8'));
    for (const name of scripts) {
      assert.ok(
        build.watchPatterns.includes(`/scripts/${name}`),
        `${file} must watch /scripts/${name}, or a change to it never deploys`,
      );
    }
  }
});

test('the Fairy-Stockfish xiangqi net is checksummed and loaded after the binaries are verified', () => {
  const fetchNet = readFileSync(resolve(repoRoot, 'scripts/fetch-fsf-xiangqi-net.sh'), 'utf8');
  assert.match(fetchNet, /^net_sha=[0-9a-f]{64}$/m, 'the net is checked');
  assert.match(fetchNet, /NNUE evaluation using/, 'the fetched binary loads the net');
  assert.match(fetchNet, /fairy-stockfish-xiangqi-nnue-ok/, 'the step prints its success line');
});

// Every binary or data file the image downloads is checked against a sha256
// pinned in this repo (2026-10-02): the inline curl steps for our own engines
// checked only that the file existed, so a replaced release asset would ship.
test('railpack downloads nothing inline except the rust toolchain installer', () => {
  const inline = railpackCommands().filter(
    (command) => /\bcurl\b/.test(command) && !command.includes('https://sh.rustup.rs'),
  );
  assert.deepEqual(inline, [], 'download through a checksummed scripts/fetch-*.sh instead');
});

test('every release asset railpack fetches has a pinned sha256', () => {
  const script = readFileSync(resolve(repoRoot, 'scripts/fetch-release-asset.sh'), 'utf8');
  const fetched = railpackCommands().flatMap((command) => [
    ...command.matchAll(/fetch-release-asset\.sh \/app\/bin ([\w.-]+)/g),
  ]);
  assert.ok(fetched.length > 0, 'railpack fetches release assets');
  for (const [, name] of fetched) {
    const entry = script.match(
      new RegExp(`^  ${name.replaceAll('.', '\\.')}\\)\\n(.*\\n.*);;`, 'm'),
    );
    assert.ok(entry, `scripts/fetch-release-asset.sh has no entry for ${name}`);
    assert.match(entry[1], /sha=[0-9a-f]{64}\b/, `${name} pins a sha256`);
  }
  const largeboard = readFileSync(
    resolve(repoRoot, 'scripts/fetch-fairy-stockfish-largeboard.sh'),
    'utf8',
  );
  assert.match(largeboard, /^sha=[0-9a-f]{64}$/m, 'the largeboard binary pins a sha256');
});
