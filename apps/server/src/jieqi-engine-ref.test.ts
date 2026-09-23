// The pinned engine commit exists in two places that MUST agree: pikafish-jieqi.ref
// (which the engine recipe reads to check out the binary) and
// PIKAFISH_JIEQI_ENGINE_REF (which is part of the analysis cache key). If they drift,
// prod builds one engine and files its evals under another engine's key, which is the
// exact silent-divergence bug pinning was introduced to close. There is no runtime
// signal for it, so the build has to be the signal.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JIEQI_ANALYSIS_ENGINE_ID, JIEQI_DECISIONS_ENGINE_ID } from './jieqi-analysis.js';
import { PIKAFISH_JIEQI_ENGINE_REF } from './jieqi-engine.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const refFile = resolve(repoRoot, 'pikafish-jieqi.ref');

function pinnedRef(): string {
  return readFileSync(refFile, 'utf8').split('\n')[0]!.trim();
}

test('the .ref file holds a full 40-char commit sha on its first line', () => {
  // The build step does `head -1 | tr -d '[:space:]'` and then `git checkout $REF`, so a
  // comment or a short sha on line 1 breaks the deploy rather than this test.
  assert.match(pinnedRef(), /^[0-9a-f]{40}$/);
});

test('PIKAFISH_JIEQI_ENGINE_REF is the short form of the pinned .ref commit', () => {
  assert.ok(
    pinnedRef().startsWith(PIKAFISH_JIEQI_ENGINE_REF),
    `pikafish-jieqi.ref pins ${pinnedRef()} but PIKAFISH_JIEQI_ENGINE_REF is ` +
      `${PIKAFISH_JIEQI_ENGINE_REF}. Moving the engine must move the analysis cache key: ` +
      'update the constant so cached jieqi analysis recomputes instead of serving evals ' +
      'from the previous binary.',
  );
});

test('both analysis cache keys carry the engine ref', () => {
  // Decisions and the sweep are cached separately; a ref that reached only one of them
  // would leave the other silently reusing the previous engine's numbers.
  assert.ok(JIEQI_ANALYSIS_ENGINE_ID.includes(PIKAFISH_JIEQI_ENGINE_REF));
  assert.ok(JIEQI_DECISIONS_ENGINE_ID.includes(PIKAFISH_JIEQI_ENGINE_REF));
});
