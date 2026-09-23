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
  const net = railpack.indexOf('xiangqi-c07e94a5c7cb.nnue');
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

test('the recipe builds and verifies the same six binaries the image expects', () => {
  const binaries = recipe.match(/^BINARIES="([^"]+)"$/m)[1].split(/\s+/);
  assert.deepEqual(binaries, [
    'fairy-stockfish-xiangqi',
    'fairy-stockfish-duck-xiangqi',
    'fairy-stockfish-atomic-xiangqi',
    'stockfish',
    'pikafish-jieqi',
    'pikafish',
  ]);
  // Every binary is built with the ISA the container was measured for.
  assert.match(recipe, /^ARCH=x86-64-sse41-popcnt$/m);
});
