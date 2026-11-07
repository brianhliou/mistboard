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
  const runBlock = lines.indexOf('try {');
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

// The candidate push cannot deploy; a red run must stop before main advances.
test('release-prod promotes main only after the candidate CI wait', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-prod.mjs');
  const source = readFileSync(file, 'utf8');
  const candidate = source.indexOf("'git push release candidate'");
  const ciWait = source.indexOf("timedStage('hosted CI wait'");
  const promote = source.indexOf("runTimed('git push release head'");
  const revisionWait = source.indexOf("runTimed('production revision wait'");
  const smoke = source.indexOf('await runSmoke({');
  assert.ok(candidate > 0 && ciWait > candidate && promote > ciWait);
  assert.ok(revisionWait > promote && smoke > revisionWait);
  assert.doesNotMatch(source.slice(ciWait, promote), /catch \(error\)/);
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
          runParallelSmokes: async () => {},
          tsImport: async (file) => {
            assert.equal(file, '/active-release/packages/game/src/game-specs.ts');
            return { isPublicGameSpec: publicSpecPredicate(specs) };
          },
        },
      );
      await runSmoke({ deployRequired: true, headRevision: 'revision' });
      const gomoku = calls.filter(({ command }) => command[0] === 'prod:smoke:gomoku');
      const expected = publicSurface !== 'hidden' && ['web', 'full'].includes(tier);
      assert.equal(gomoku.length, expected ? 1 : 0, `${publicSurface} / ${tier}`);
      if (expected) assert.equal(gomoku[0].command[2], 'https://example.test');
    }
  }
});

test('release-prod runs the local smoke gate before any push or drain', () => {
  const source = readFileSync(new URL('./release-prod.mjs', import.meta.url), 'utf8');
  const localGate = source.indexOf('await runLocalGate(gate, ciPlan.changedFiles)');
  const smoke = source.indexOf("runTimed('local production smokes'");
  const push = source.indexOf("'git push release candidate'");
  const drain = source.indexOf("runTimed('production drain start'");
  assert.ok(localGate > 0 && smoke > localGate, 'local smokes must follow the build/test gate');
  assert.ok(smoke < drain && smoke < push, 'a smoke failure must prevent draining and pushing');
  assert.match(source.slice(localGate, smoke), /if \(release\.deployRequired\)/);
});

test('release-prod rebuilds and smokes the merged revision when main moves during the gate', () => {
  const source = readFileSync(new URL('./release-prod.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function catchUpWithMain()');
  const end = source.indexOf('function mergeRemoteTip(', start);
  const catchUp = source.slice(start, end);
  const smoke = catchUp.indexOf("runTimed('local production smokes (after merge)'");
  assert.ok(smoke > catchUp.indexOf('release.headRevision = git('));
  assert.match(
    catchUp.slice(smoke),
    /'release:local-smoke',[\s\S]*'--revision',\s*release.headRevision/,
  );
  assert.ok(!catchUp.slice(smoke).includes('--skip-build'), 'the merge needs a fresh full build');
});
