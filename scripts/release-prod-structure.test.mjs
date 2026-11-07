import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { tsImport } from 'tsx/esm/api';

// release-prod.mjs runs its release from a top-level try block, and the
// functions it calls are hoisted, so they are reachable from that block
// wherever they sit in the file. Top-level `const` and `let` are not: one
// declared below the block is uninitialized while the release runs, and the
// first function to read it throws. That shipped once (2026-09-23) as
// ancestryCache, on the path taken only when main moves during the CI wait,
// and failed a release whose push and CI had both succeeded.
test('release-prod declares all its module state above the run block', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-prod.mjs');
  const lines = readFileSync(file, 'utf8').split('\n');
  const runBlock = lines.findIndex((line) => line === 'try {');
  assert.ok(runBlock > 0, 'expected a top-level `try {` that runs the release');
  const late = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .slice(runBlock)
    .filter(({ line }) => /^(const|let|var) /.test(line));
  assert.deepEqual(
    late.map(({ number, line }) => `${number}: ${line}`),
    [],
    'top-level declarations below the run block are uninitialized while it runs; move them above it',
  );
});

// The local gate asks pre-push-check for its plan with the release's file list.
// Without the base revision the plan's verify step falls back to the working
// tree, which is clean in a release, and runs nothing (2026-10-02, b40cb193).
test('release-prod passes the target revision to the local gate plan', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-prod.mjs');
  const source = readFileSync(file, 'utf8');
  assert.match(source, /localGateFor\(\s*ciPlan\.changedFiles,\s*release\.targetRevision,/);
  assert.match(source, /localGateFor\(\s*changed,\s*remote,/);
  assert.match(source, /'--plan',\s*'--json',\s*'--base',\s*baseRevision,\s*'--files'/);
});

test('IndexNow releases submit only changed URLs and skip releases without a deploy', () => {
  const source = readFileSync(new URL('./release-prod.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function submitIndexNow(');
  const end = source.indexOf('\n}\n', start) + 2;
  assert.ok(start > 0 && end > start);
  const calls = [];
  const submitIndexNow = vm.runInNewContext(`(${source.slice(start, end)})`, {
    console: { log() {}, error() {} },
    workdir: '/active-release',
    quoteCommand: (command) => command.join(' '),
    spawnSync: (command, args) => {
      calls.push([command, ...args]);
      return { status: 0 };
    },
  });
  submitIndexNow({ deployRequired: false });
  assert.deepEqual(calls, []);
  submitIndexNow({ deployRequired: true });
  assert.deepEqual(calls, [['node', 'scripts/indexnow-submit.mjs', '--changed']]);
});

// The drain decision read production's active-game count once, before the
// local gate, and acted on it minutes later. A game that started in between was
// killed by the container swap with no drain (2026-10-01, 10:38 PDT). The push
// step has to re-read the count after catching up with main and before pushing.
test('release-prod re-reads the active game count right before the push', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-prod.mjs');
  const source = readFileSync(file, 'utf8');
  const catchUp = source.indexOf('    catchUpWithMain();\n');
  const push = source.indexOf('pushCommand(release.headRevision)');
  assert.ok(catchUp > 0 && push > catchUp, 'expected catchUpWithMain() before the release push');
  const between = source.slice(catchUp, push);
  assert.match(between, /await fetchActiveGameCount\(\)/);
  assert.match(between, /requireUsableDrainToken\(/);
});

// Web deploys on push whatever hosted CI says. A red run used to end the
// release before the revision wait and smoke, so nothing checked the site that
// was already serving the new code (2026-10-17: a Postgres image pull limit
// failed three jobs before any test ran; the live checks were run by hand).
test('release-prod still waits for the revision and smokes after a red CI run', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-prod.mjs');
  const source = readFileSync(file, 'utf8');
  assert.match(source, /throw Object\.assign\(new Error\(decision\.message\), \{ ciRed:/);
  const ciWait = source.indexOf("timedStage('hosted CI wait'");
  const revisionWait = source.indexOf("runTimed('production revision wait'");
  const smoke = source.indexOf('await runSmoke({');
  const rethrow = source.indexOf('throw ciRed;');
  assert.ok(ciWait > 0 && revisionWait > ciWait && smoke > revisionWait && rethrow > smoke);
  const handler = source.slice(ciWait, revisionWait);
  assert.match(handler, /if \(!release\.pushCompleted \|\| !error\?\.ciRed\) throw error;/);
  assert.match(handler, /ciRed = error;/);
  assert.ok(source.indexOf('announceNews(') > rethrow, 'News and IndexNow stay behind a green CI');
});

// Exercise the actual release smoke dispatcher without pushing, fetching or
// launching browsers. Flip only a copy of the real launch registry.
test('Gomoku browser smoke runs only for a public spec in web/full releases', async () => {
  const { GAME_SPECS, publicSpecPredicate } = await tsImport(
    '../packages/game/src/game-specs.ts',
    import.meta.url,
  );
  const source = readFileSync(new URL('./release-prod.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function runSmoke(');
  const end = source.indexOf('async function runParallelSmokes(', start);
  assert.ok(start > 0 && end > start);
  for (const publicSurface of ['hidden', 'beta', 'casual', 'rated']) {
    const specs = GAME_SPECS.map((spec) =>
      spec.id === 'gomoku' ? { ...spec, publicSurface } : spec,
    );
    for (const tier of ['none', 'lite', 'web', 'full']) {
      const calls = [];
      const runSmoke = vm.runInNewContext(
        `(${source.slice(start, end).replaceAll('import.meta.url', JSON.stringify(import.meta.url))}\n)`,
        {
          console: { log() {} },
          release: {},
          workdir: '/active-release',
          releaseRoot: '/release',
          path,
          resolveSmokeTier: () => tier,
          baseArgs: () => ['--base', 'https://example.test'],
          npmCommand: (script, args) => [script, ...args],
          runTimed: (label, command) => calls.push({ label, command }),
          runParallelSmokes: async (smokes) => {
            const gomoku = smokes.filter(({ command }) => command[0] === 'prod:smoke:gomoku');
            assert.equal(gomoku.length, 1, 'full releases must smoke the Rapfi server family');
          },
          tsImport: async (file) => {
            assert.equal(file, '/active-release/packages/game/src/game-specs.ts');
            return { isPublicGameSpec: publicSpecPredicate(specs) };
          },
        },
      );
      await runSmoke({ deployRequired: true, headRevision: 'revision' });
      const gomoku = calls.filter(({ command }) => command[0] === 'prod:smoke:gomoku-browser');
      const expected = publicSurface !== 'hidden' && ['web', 'full'].includes(tier);
      assert.equal(gomoku.length, expected ? 1 : 0, `${publicSurface} / ${tier}`);
      if (expected) assert.equal(gomoku[0].command[2], 'https://example.test');
    }
  }
});
