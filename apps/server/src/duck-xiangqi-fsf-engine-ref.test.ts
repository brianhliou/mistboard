// The Duck Xiangqi Fairy-Stockfish build is pinned in FOUR places that must
// agree: fairy-stockfish-duck-xiangqi.ref (the commit railpack checks out),
// fairy-stockfish-duck-xiangqi.patch (what makes that commit able to play this
// variant at all), and the two constants in the provider that name them. Unlike
// the xiangqi build, the ref alone does NOT identify this engine — the patch
// raises MAX_MOVES, lowers MAX_PLY, and restores the flying-general rule for a
// non-royal general — so editing the patch without moving the digest would let a
// bot identity silently change how it plays. There is no runtime signal for
// that, so the build has to be the signal. Same shape as
// xiangqi-fsf-engine-ref.test.ts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DUCK_XIANGQI_FSF_ENGINE_REF,
  DUCK_XIANGQI_FSF_PATCH_SHA256,
} from './duck-xiangqi-fsf-engine.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const refFile = resolve(repoRoot, 'fairy-stockfish-duck-xiangqi.ref');
const patchFile = resolve(repoRoot, 'fairy-stockfish-duck-xiangqi.patch');
const railpack = readFileSync(resolve(repoRoot, 'railpack.json'), 'utf8');

function pinnedRef(): string {
  return readFileSync(refFile, 'utf8').split('\n')[0]!.trim();
}

test('the .ref file holds a full 40-char commit sha on its first line', () => {
  // The build step does `head -1 | tr -d '[:space:]'` and then fetches that ref,
  // so a comment or a short sha on line 1 breaks the deploy rather than this test.
  assert.match(pinnedRef(), /^[0-9a-f]{40}$/);
});

test('DUCK_XIANGQI_FSF_ENGINE_REF is the short form of the pinned .ref commit', () => {
  assert.ok(
    pinnedRef().startsWith(DUCK_XIANGQI_FSF_ENGINE_REF),
    `fairy-stockfish-duck-xiangqi.ref pins ${pinnedRef()} but DUCK_XIANGQI_FSF_ENGINE_REF is ` +
      `${DUCK_XIANGQI_FSF_ENGINE_REF}. Moving the binary must move the engine identity.`,
  );
});

test('DUCK_XIANGQI_FSF_PATCH_SHA256 is the digest of the patch railpack applies', () => {
  const digest = createHash('sha256').update(readFileSync(patchFile)).digest('hex');
  assert.equal(
    digest,
    DUCK_XIANGQI_FSF_PATCH_SHA256,
    'fairy-stockfish-duck-xiangqi.patch changed. The patch is half this engine’s build ' +
      'identity: update DUCK_XIANGQI_FSF_PATCH_SHA256, bump the engine version, and re-measure ' +
      'the ladder rather than letting an existing rung quietly become a different player.',
  );
});

test('railpack builds from the .ref, applies the patch, and gates on perft', () => {
  assert.ok(
    railpack.includes('/app/fairy-stockfish-duck-xiangqi.ref'),
    'the build step reads the .ref',
  );
  assert.ok(
    railpack.includes('/app/fairy-stockfish-duck-xiangqi.patch'),
    'the build step applies the patch; stock Fairy-Stockfish cannot play this variant',
  );
  // The gate is agreement with the KERNEL's own legal-turn count for the opening
  // array, not merely that the binary starts: a build generating only the 44
  // piece moves would not crash, it would just play a different game.
  assert.ok(
    railpack.includes('Nodes searched: 2554'),
    'the build must be gated on perft(1) = 2554 against duck-xiangqi.ini',
  );
  assert.ok(
    railpack.includes('/app/apps/server/src/duck-xiangqi.ini'),
    'the perft gate must run against the same .ini the server hands the engine',
  );
});
