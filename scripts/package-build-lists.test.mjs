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
import { runInNewContext } from 'node:vm';

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

function workflowSteps(file, job) {
  const block = read(file)
    .split(/(?=^ {2}[\w-]+:\n)/m)
    .find((block) => block.startsWith(`  ${job}:\n`));
  assert.ok(block, `${file}: missing job ${job}`);
  return block.split(/^ {6}- /m).slice(1);
}

for (const [job, consumer] of [
  ['build', /run: npm run build\s*$/m],
  // rapfi.test.ts invokes fetch-rapfi-net.mjs in beforeAll on either shard.
  ['unit-web', /run: npm run test:unit --workspace @mistboard\/web/],
]) {
  test(`${job} restores both pinned engine nets before fetching them`, () => {
    const steps = workflowSteps('.github/workflows/ci.yml', job);
    const consumerIndex = steps.findIndex((step) => consumer.test(step));
    assert.ok(consumerIndex >= 0, `${job}: missing net consumer`);
    const cacheIndex = steps.findIndex((step) => step.includes('key: engine-nets-'));
    assert.ok(cacheIndex >= 0, `${job}: missing engine net cache`);
    assert.ok(cacheIndex < consumerIndex, `${job}: restore nets before their consumer`);
    const cache = steps[cacheIndex];
    assert.ok(
      cache.includes(`key: engine-nets-\${{ hashFiles('apps/web/public/engine/*/net.json') }}`),
    );
    const pikafishNet = JSON.parse(read('apps/web/public/engine/pikafish/net.json')).file;
    assert.ok(cache.includes(`apps/web/public/engine/pikafish/${pikafishNet}`));
    assert.ok(cache.includes('apps/web/public/engine/rapfi/*.data'));
    // Only Build fetches both files. A shard saving first would leave an
    // immutable, Rapfi-only cache under the shared key on every later run.
    assert.match(
      cache,
      job === 'build' ? /uses: actions\/cache@/ : /uses: actions\/cache\/restore@/,
    );
    assert.doesNotMatch(cache, /\bif:/, 'restore and SHA verification must run on every build');
    assert.doesNotMatch(cache, /restore-keys:/, 'a pin change must miss the cache');
  });
}

for (const [file, job, install] of [
  ['.github/workflows/ci.yml', 'browser-smoke', 'npx playwright install chromium'],
  [
    '.github/workflows/seo-render-audit.yml',
    'audit',
    'npx playwright install --with-deps chromium',
  ],
]) {
  test(`${file} caches Chromium by the locked Playwright version and keeps installation`, () => {
    const steps = workflowSteps(file, job);
    const versionIndex = steps.findIndex((step) => step.includes('id: playwright-version'));
    assert.ok(versionIndex >= 0, `${job}: missing Playwright version step`);
    const versionCommand = steps[versionIndex].match(/run: node -e "([^"]+)" >> "\$GITHUB_OUTPUT"/);
    assert.ok(versionCommand, `${job}: write the locked version to the step output`);
    for (const version of ['1.62.1', '1.63.0']) {
      const output = [];
      runInNewContext(versionCommand[1], {
        require(path) {
          assert.equal(path, './package-lock.json');
          return { packages: { 'node_modules/@playwright/test': { version } } };
        },
        console: { log: (line) => output.push(line) },
      });
      assert.deepEqual(output, [`version=${version}`]);
    }
    const cacheIndex = steps.findIndex((step) => step.includes('path: ~/.cache/ms-playwright'));
    assert.ok(cacheIndex > versionIndex, `${job}: restore browsers after reading their version`);
    const cache = steps[cacheIndex];
    assert.match(cache, /uses: actions\/cache@/);
    assert.ok(
      cache.includes(
        `key: playwright-\${{ runner.os }}-\${{ steps.playwright-version.outputs.version }}`,
      ),
    );
    assert.doesNotMatch(cache, /restore-keys:/, 'do not restore browsers from other versions');
    const installIndex = steps.findIndex((step) => step.includes(`run: ${install}\n`));
    assert.ok(installIndex > cacheIndex, `${job}: keep playwright install after the cache restore`);
    assert.doesNotMatch(steps[installIndex], /\bif:/, 'install must also run on cache hits');
  });
}
