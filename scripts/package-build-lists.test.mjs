// Every workspace package that exports only dist/* has to be built before
// anything that imports it, and the build order is a hand-kept list in six
// places: the root build (what Railway and ci:quick run), the pre-typecheck
// stale-dist guard, the pre-push gate's dist cleanup and cold-gate paths,
// verify's per-package plan, worktree:prepare, and every CI job that builds
// dependencies before typecheck or tests. None of them typechecks against
// packages/.
//
// @mistboard/mahjong (9df9bda2) joined packages/ and none of them knew it:
// every cold checkout failed typecheck, CI went red, and Railway stayed on the
// previous build (fixed in 9bc07685). A warm checkout that had built the
// package by hand could not fail, so this reads packages/ and fails closed.
//
// The lists stay hand-kept on purpose: order matters (game before the packages
// that import it), and a directory listing sorts board-render first.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(resolve(repoRoot, file), 'utf8');

/** Workspace packages whose entry point is compiled output: the canonical list. */
function distPackages() {
  return readdirSync(resolve(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const pkg = JSON.parse(read(`packages/${entry.name}/package.json`));
      return { dir: `packages/${entry.name}`, name: pkg.name, main: String(pkg.main ?? '') };
    })
    .filter((pkg) => pkg.main.startsWith('dist/'))
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

function missingFrom(file, needle) {
  const source = read(file);
  return distPackages()
    .filter((pkg) => !source.includes(needle(pkg)))
    .map((pkg) => `${pkg.name}: add ${needle(pkg)} to ${file}`);
}

test('the dist-package roster is readable and non-trivial', () => {
  // An empty roster would make every check below pass by measuring nothing.
  const names = distPackages().map((pkg) => pkg.name);
  assert.ok(names.includes('@mistboard/game'), `expected @mistboard/game, got ${names}`);
  assert.ok(names.length >= 3, `expected at least three dist packages, got ${names}`);
});

test('scripts/build.mjs builds every dist package in both service lists', () => {
  // Two literal arrays, the engine-worker one and the web one; both end in
  // @mistboard/server, which is how they are found.
  const source = read('scripts/build.mjs');
  const lists = source.match(/\[[^\]]*'@mistboard\/server'[^\]]*\]/g) ?? [];
  assert.equal(lists.length, 2, 'expected the worker and web workspace lists in build.mjs');
  const missing = [];
  lists.forEach((list, index) => {
    for (const pkg of distPackages()) {
      if (!list.includes(`'${pkg.name}'`)) {
        missing.push(
          `${pkg.name}: add '${pkg.name}' before '@mistboard/server' in the ${index === 0 ? 'worker' : 'web'} list of scripts/build.mjs`,
        );
      }
    }
  });
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('ensure-packages-built.mjs guards every dist package', () => {
  const missing = missingFrom('scripts/ensure-packages-built.mjs', (pkg) => `'${pkg.dir}'`);
  assert.deepEqual(missing, [], `${missing.join('\n')} (the PACKAGES list)`);
});

test('pre-push-check.mjs cleans and cold-gates every dist package', () => {
  const missing = [
    ...missingFrom('scripts/pre-push-check.mjs', (pkg) => `'${pkg.dir}/dist'`),
    ...missingFrom('scripts/pre-push-check.mjs', (pkg) => `'${pkg.dir}/'`),
  ];
  assert.deepEqual(
    missing,
    [],
    `${missing.join('\n')} (DIST_DIRS takes '<dir>/dist'; needsBroadColdGate takes '<dir>/')`,
  );
});

test('verify.mjs plans a rebuild for every dist package', () => {
  const missing = missingFrom('scripts/verify.mjs', (pkg) => `starts('${pkg.dir}/')`);
  assert.deepEqual(
    missing,
    [],
    `${missing.join('\n')} (and a build step for it in buildPlan, like build-mahjong)`,
  );
});

test('worktree-prepare.mjs builds every dist package for a fresh worktree', () => {
  // The sixth copy, missed by 9bc07685: a worktree prepared without mahjong's
  // dist cannot load any server module that imports it.
  const missing = missingFrom(
    'scripts/worktree-prepare.mjs',
    (pkg) => `'build', '--workspace', '${pkg.name}'`,
  );
  assert.deepEqual(
    missing,
    [],
    missing
      .map((line) => `${line} (as run(['npm', 'run', 'build', '--workspace', '<name>']))`)
      .join('\n'),
  );
});

test('every CI step that builds @mistboard/game builds every dist package', () => {
  const file = '.github/workflows/ci.yml';
  const lines = read(file).split('\n');
  const isBuild = (line) => /npm run build --workspace @mistboard\//.test(line);
  const missing = [];
  let steps = 0;
  lines.forEach((line, index) => {
    if (!/npm run build --workspace @mistboard\/game\s*$/.test(line)) return;
    steps += 1;
    // The contiguous run of workspace build lines this one belongs to.
    let start = index;
    while (start > 0 && isBuild(lines[start - 1])) start -= 1;
    let end = index;
    while (end + 1 < lines.length && isBuild(lines[end + 1])) end += 1;
    const block = lines.slice(start, end + 1).join('\n');
    for (const pkg of distPackages()) {
      if (!new RegExp(`--workspace ${pkg.name}\\s*$`, 'm').test(block)) {
        missing.push(
          `${pkg.name}: add \`npm run build --workspace ${pkg.name}\` after line ${index + 1} of ${file}`,
        );
      }
    }
  });
  assert.ok(steps >= 5, `expected the CI dependency-build steps, found ${steps}`);
  assert.deepEqual(missing, [], missing.join('\n'));
});
