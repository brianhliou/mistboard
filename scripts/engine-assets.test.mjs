// The engine recipe lives in scripts/engine-assets.sh; three other files have
// to agree with it by hand (the workflow's push paths, the Railway watch
// patterns, the railpack build step), and none of them typechecks. This test
// is the mirror check: a pin added to the recipe but not to the workflow would
// build once and never rebuild; one missing from the watch patterns would move
// the pin without a deploy; a railpack step that compiles again would put the
// 2.5 minutes back.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

test('the recipe builds and verifies the same eight binaries the image expects', () => {
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
  ]);
  // Every binary is built with the ISA the container was measured for; AB-JChess
  // alone targets avx2 (its NNUE is its strength; ab-jchess.ref).
  assert.match(recipe, /^ARCH=x86-64-sse41-popcnt$/m);
  assert.match(recipe, /^ABJ_ARCH=x86-64-avx2$/m);
  // KataGo-AnimalChess: the Eigen CPU backend with AVX2, linked static (katago-jungle.ref).
  assert.match(recipe, /^KATA_CMAKE_FLAGS=".*-DUSE_BACKEND=EIGEN .*-DUSE_AVX2=1 .*-static"$/m);
  assert.match(recipe, /echo "kata-cmake=\$KATA_CMAKE_FLAGS"/, 'the cmake flags are in the hash');
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
  assert.match(fetchNet, /ABJNNUE model loaded/, 'the fetched binary loads the net');
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
