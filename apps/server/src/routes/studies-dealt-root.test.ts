import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BANQI_SPEC_ID,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { ensureDealtRoot, isSerializedTree } from './studies.js';

// The bug this exists for: studies gained the dealt variants, the create-study
// flow minted a deal, and the ADD-CHAPTER flow did not. So a jieqi study opened
// fine and its second chapter reported "this study uses a variant that is not
// supported yet" — a chapter with no deal has nothing to replay from. Found in
// production by adding a chapter, not by any test.
const EMPTY = { version: 1, root: { children: [] } };

test('a public Three Kingdoms replay never acquires a sampled dealt root', () => {
  const recorded = { ...EMPTY, replay: 'three-kingdoms-banqi-public-v1' };
  assert.equal(isSerializedTree(recorded), true);
  const stored = {
    id: 'chapter',
    variant: 'three-kingdoms-banqi',
    root: ensureDealtRoot('three-kingdoms-banqi', recorded),
  };
  assert.deepEqual(JSON.parse(JSON.stringify(stored)), {
    id: 'chapter',
    variant: 'three-kingdoms-banqi',
    root: recorded,
  });
});

test('public replay roots reject unknown formats and any accompanying deal', () => {
  assert.equal(isSerializedTree({ ...EMPTY, replay: 'unknown-v1' }), false);
  assert.equal(
    isSerializedTree({
      ...EMPTY,
      replay: 'three-kingdoms-banqi-public-v1',
      rootFen: 'secret-deal',
    }),
    false,
  );
});

test('a dealt variant always comes back with a root position', () => {
  for (const spec of [BANQI_SPEC_ID, JIEQI_SPEC_ID, JUNGLE_FLIP_SPEC_ID]) {
    const out = ensureDealtRoot(spec, EMPTY) as { rootFen?: string };
    assert.equal(typeof out.rootFen, 'string', `${spec} chapter was left without a deal`);
    assert.ok(out.rootFen && out.rootFen.trim().length > 0);
  }
});

test('an author-supplied deal is never replaced', () => {
  const supplied = { ...EMPTY, rootFen: 'author-chosen-position' };
  const out = ensureDealtRoot(JIEQI_SPEC_ID, supplied) as { rootFen?: string };
  assert.equal(out.rootFen, 'author-chosen-position');
});

test('two dealt chapters get two different deals', () => {
  // Each chapter is its own game. Minting once and reusing it would make every
  // chapter of a study the same position.
  const a = ensureDealtRoot(JIEQI_SPEC_ID, EMPTY) as { rootFen?: string };
  const b = ensureDealtRoot(JIEQI_SPEC_ID, EMPTY) as { rootFen?: string };
  assert.notEqual(a.rootFen, b.rootFen);
});

test('a deterministic variant is left exactly as it was', () => {
  // Xiangqi replays from its standard opening, so injecting a root here would
  // pin every chapter to one position for no reason.
  const out = ensureDealtRoot(XIANGQI_SPEC_ID, EMPTY);
  assert.deepEqual(out, EMPTY);
});
