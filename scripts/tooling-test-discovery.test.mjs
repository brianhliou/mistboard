// Every test file under scripts/ must be reached by a `test:tooling` glob.
// A test outside every glob passes nowhere and fails nowhere: the Fanfanqi
// rules-page builder test (scripts/variant-lab/rules-page-games/) and
// scripts/lib/article-line-assessment.test.mjs both sat outside it.
import assert from 'node:assert/strict';
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

function toolingGlobs(script) {
  // Shell globs, not globstar: `*` never crosses a directory, so a nested
  // directory needs its own pattern. Refuse anything this check cannot model.
  const patterns = script.split(/\s+/).filter((token) => token.startsWith('scripts/'));
  for (const pattern of patterns)
    assert.match(pattern, /^scripts\/(?:[\w.-]+\/)*\*\.test\.(?:mjs|ts)$/, pattern);
  return patterns;
}

function orphanedTests(root, script) {
  const selected = new Set(toolingGlobs(script).flatMap((p) => globSync(p, { cwd: root })));
  return [...globSync('scripts/**/*.test.{mjs,ts}', { cwd: root })]
    .filter((file) => !file.includes('node_modules') && !selected.has(file))
    .sort();
}

test('a nested test directory outside the tooling globs is reported (planted)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tooling-test-discovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of [
    'scripts/a.test.mjs',
    'scripts/variant-lab/b.test.ts',
    'scripts/variant-lab/rules-page-games/ffq-banqi.test.ts',
  ]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), 'THIS FIXTURE MUST NEVER EXECUTE');
  }
  // test:tooling before the fix.
  const before =
    'node --test scripts/*.test.mjs && tsx --test scripts/*.test.ts scripts/variant-lab/*.test.ts';
  assert.deepEqual(orphanedTests(dir, before), [
    'scripts/variant-lab/rules-page-games/ffq-banqi.test.ts',
  ]);
  assert.deepEqual(
    orphanedTests(dir, `${before} scripts/variant-lab/rules-page-games/*.test.ts`),
    [],
  );
});

test('every scripts/ test file is reached by test:tooling', () => {
  const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts[
    'test:tooling'
  ];
  assert.deepEqual(orphanedTests(ROOT, script), []);
});
