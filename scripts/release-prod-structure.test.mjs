import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
