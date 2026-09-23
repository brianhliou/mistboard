// The xiangqi Fairy-Stockfish build is pinned in three places that MUST agree:
// fairy-stockfish-xiangqi.ref (the engine recipe checks that commit out and builds it),
// XIANGQI_FSF_ENGINE_REF (part of every xiangqi FSF rung's engine configHash), and
// the railpack net line (which net, from which commit, with which digest). If they
// drift, prod plays one engine and rates it under another engine's identity, which
// is the silent-divergence bug pinning exists to close. There is no runtime signal
// for it, so the build has to be the signal. Same shape as jieqi-engine-ref.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { XIANGQI_FSF_ENGINE_REF, XIANGQI_FSF_NNUE_NET } from './xiangqi-fsf-engine.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const refFile = resolve(repoRoot, 'fairy-stockfish-xiangqi.ref');
const recipe = readFileSync(resolve(repoRoot, 'scripts/engine-assets.sh'), 'utf8');
const railpack = readFileSync(resolve(repoRoot, 'railpack.json'), 'utf8');

function pinnedRef(): string {
  return readFileSync(refFile, 'utf8').split('\n')[0]!.trim();
}

test('the .ref file holds a full 40-char commit sha on its first line', () => {
  // The build step does `head -1 | tr -d '[:space:]'` and then fetches that ref, so
  // a comment or a short sha on line 1 breaks the deploy rather than this test.
  assert.match(pinnedRef(), /^[0-9a-f]{40}$/);
});

test('XIANGQI_FSF_ENGINE_REF is the short form of the pinned .ref commit', () => {
  assert.ok(
    pinnedRef().startsWith(XIANGQI_FSF_ENGINE_REF),
    `fairy-stockfish-xiangqi.ref pins ${pinnedRef()} but XIANGQI_FSF_ENGINE_REF is ` +
      `${XIANGQI_FSF_ENGINE_REF}. Moving the binary must move the engine identity: update ` +
      'the constant so the EvE ladder rates the new build as a new engine.',
  );
});

test('the recipe builds from the .ref file and railpack fetches the net the provider names', () => {
  assert.ok(recipe.includes('pin fairy-stockfish-xiangqi.ref'), 'the build reads the .ref');
  assert.ok(
    railpack.includes('engine-assets.sh fetch /app/bin'),
    'the image installs the published build beside the net',
  );
  assert.ok(
    railpack.includes(`/app/bin/${XIANGQI_FSF_NNUE_NET}`),
    `railpack must place ${XIANGQI_FSF_NNUE_NET} beside the xiangqi binary`,
  );
  // The net is named by its sha256 prefix; the build verifies the FULL digest, and
  // the digest it checks must be the one the name promises.
  const prefix = XIANGQI_FSF_NNUE_NET.replace(/^xiangqi-/, '').replace(/\.nnue$/, '');
  assert.match(
    railpack,
    new RegExp(`'${prefix}[0-9a-f]{52}  /app/bin/${XIANGQI_FSF_NNUE_NET.replace('.', '\\.')}'`),
    'railpack sha256 check must pin the digest whose prefix names the net',
  );
  assert.ok(
    railpack.includes("grep -q 'NNUE evaluation using'"),
    'the build must prove the binary loads the net, not just that both files exist',
  );
});
