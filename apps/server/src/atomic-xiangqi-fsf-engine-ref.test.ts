// The Atomic Xiangqi Fairy-Stockfish build is pinned in FOUR places that must
// agree: fairy-stockfish-atomic-xiangqi.ref (the commit the engine recipe checks out),
// fairy-stockfish-atomic-xiangqi.patch (what makes that commit able to play
// this variant at all), and the two constants in the provider that name them.
// The ref alone does NOT identify this engine: the patch is the blast shape,
// the soldier immunity, the cannon shot and the lethal check, so editing it
// without moving the digest would let a bot identity silently change how it
// plays. Same shape as duck-xiangqi-fsf-engine-ref.test.ts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ATOMIC_XIANGQI_FSF_ENGINE_REF,
  ATOMIC_XIANGQI_FSF_PATCH_SHA256,
} from './atomic-xiangqi-fsf-engine.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const refFile = resolve(repoRoot, 'fairy-stockfish-atomic-xiangqi.ref');
const patchFile = resolve(repoRoot, 'fairy-stockfish-atomic-xiangqi.patch');
const labPatchFile = resolve(
  repoRoot,
  'scripts/variant-lab/patches/fairy-stockfish-atomic-xiangqi.patch',
);
const recipe = readFileSync(resolve(repoRoot, 'scripts/engine-assets.sh'), 'utf8');
const railpack = readFileSync(resolve(repoRoot, 'railpack.json'), 'utf8');

function pinnedRef(): string {
  return readFileSync(refFile, 'utf8').split('\n')[0]!.trim();
}

test('the .ref file holds a full 40-char commit sha on its first line', () => {
  assert.match(pinnedRef(), /^[0-9a-f]{40}$/);
});

test('ATOMIC_XIANGQI_FSF_ENGINE_REF is the short form of the pinned .ref commit', () => {
  assert.ok(
    pinnedRef().startsWith(ATOMIC_XIANGQI_FSF_ENGINE_REF),
    `fairy-stockfish-atomic-xiangqi.ref pins ${pinnedRef()} but ATOMIC_XIANGQI_FSF_ENGINE_REF is ` +
      `${ATOMIC_XIANGQI_FSF_ENGINE_REF}. Moving the binary must move the engine identity.`,
  );
});

test('ATOMIC_XIANGQI_FSF_PATCH_SHA256 is the digest of the patch the recipe applies', () => {
  const digest = createHash('sha256').update(readFileSync(patchFile)).digest('hex');
  assert.equal(
    digest,
    ATOMIC_XIANGQI_FSF_PATCH_SHA256,
    'fairy-stockfish-atomic-xiangqi.patch changed. The patch is half this engine’s build ' +
      'identity: update ATOMIC_XIANGQI_FSF_PATCH_SHA256, bump the engine version, and re-measure ' +
      'the ladder rather than letting an existing rung quietly become a different player.',
  );
});

test('the shipped patch is the variant lab’s patch, byte for byte', () => {
  // The lab's perft gate tied this patch to the kernel at every rule point;
  // a production copy that drifts from it is an engine nothing has measured.
  assert.ok(
    readFileSync(patchFile).equals(readFileSync(labPatchFile)),
    'fairy-stockfish-atomic-xiangqi.patch differs from scripts/variant-lab/patches/: copy the lab patch, do not edit the root one',
  );
});

test('the recipe builds from the .ref, applies the patch, and gates on perft', () => {
  // The recipe (scripts/engine-assets.sh) compiles on a GitHub runner and
  // publishes a release; railpack fetches it and re-runs the same verify step.
  assert.ok(recipe.includes('pin fairy-stockfish-atomic-xiangqi.ref'), 'the build reads the .ref');
  assert.ok(
    recipe.includes('fairy-stockfish-atomic-xiangqi.patch"'),
    'the build applies the patch; stock Fairy-Stockfish plays a different game',
  );
  const iniGate = recipe.split('atomic-xiangqi.ini" atomicxiangqi').length - 1;
  assert.equal(
    iniGate,
    3,
    'three perft gates run against the same .ini the server hands the engine',
  );
  for (const gate of ['startpos 44', "3C5/9/4K4 w - - 0 1' 3", "3R5/9/4K4 w - - 0 1' 4"]) {
    assert.ok(recipe.includes(gate), `the build must be gated on perft ${gate}`);
  }
  assert.ok(
    railpack.includes('engine-assets.sh verify /app/bin /app/apps/server/src'),
    'the image re-runs the verify gates against the .ini directory the server uses',
  );
});
