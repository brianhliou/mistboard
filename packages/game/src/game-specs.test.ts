import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANQI_SPEC_ID,
  CANONICAL_VARIANT_ORDER,
  DARK_CHESS_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  GAME_SPECS,
  gameSpecForId,
  gameSpecForLegacyLiveRoom,
  isGameSpecId,
  isRatedPoolBase,
  isRetiredGameSpec,
  isStudyEligibleSpecId,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  legacyLiveRoomForGameSpec,
  maybeGameSpecForId,
  RATED_POOL_BASES,
  type RatingVariant,
  RETIRED_GAME_SPEC_IDS,
  ratingPoolForSpec,
  STUDY_ELIGIBLE_SPEC_IDS,
  XIANGQI_SPEC_ID,
} from './game-specs.js';
import { hasStartFen } from './start-fen.js';

test('canonical display order contains exactly the current public variant shelf', () => {
  assert.deepEqual(CANONICAL_VARIANT_ORDER, [
    XIANGQI_SPEC_ID,
    BANQI_SPEC_ID,
    JIEQI_SPEC_ID,
    FORTRESS_XIANGQI_SPEC_ID,
    DUCK_XIANGQI_SPEC_ID,
    DARK_XIANGQI_SPEC_ID,
    DARK_CHESS_SPEC_ID,
    JUNGLE_SPEC_ID,
    JUNGLE_FLIP_SPEC_ID,
  ]);
});

test('current dark chess maps to the flagship chess spec', () => {
  const spec = gameSpecForId(DARK_CHESS_SPEC_ID);

  assert.equal(spec.publicName, 'Fog Chess');
  assert.equal(spec.family, 'chess');
  assert.equal(spec.board, 'chess-8x8');
  assert.equal(spec.movement, 'orthodox-chess');
  assert.equal(spec.objective, 'king-capture');
  assert.equal(spec.visibility, 'dark');
  assert.equal(spec.setup, 'standard');
  assert.equal(spec.reserves, 'none');
  assert.equal(spec.dropPolicy, 'none');
  assert.equal(spec.ratingPoolBase, 'fog');
  assert.equal(spec.publicSurface, 'casual');
  assert.equal(spec.runtimeStatus, 'live');
  assert.deepEqual(spec.legacyLiveRoom, { variant: 'dark-chess' });
});

test('Dark Xiangqi is a live separate family without live-room mapping', () => {
  const spec = gameSpecForId(DARK_XIANGQI_SPEC_ID);

  assert.equal(spec.publicName, 'Fog Xiangqi');
  assert.equal(spec.family, 'xiangqi');
  assert.equal(spec.board, 'xiangqi-9x10');
  assert.equal(spec.movement, 'xiangqi');
  assert.equal(spec.objective, 'general-capture');
  assert.equal(spec.visibility, 'dark');
  assert.equal(spec.setup, 'standard');
  assert.equal(spec.reserves, 'none');
  assert.equal(spec.dropPolicy, 'none');
  assert.equal(spec.ratingPoolBase, 'dark_xiangqi');
  assert.equal(spec.rated, true);
  assert.equal(spec.publicSurface, 'casual');
  assert.equal(spec.runtimeStatus, 'live');
  assert.equal(spec.legacyLiveRoom, undefined);
});

test('Jieqi is an xiangqi-family spec on its own hidden-identity axis', () => {
  const spec = gameSpecForId(JIEQI_SPEC_ID);

  assert.equal(spec.publicName, 'Jieqi');
  assert.equal(spec.family, 'xiangqi');
  assert.equal(spec.board, 'xiangqi-9x10');
  assert.equal(spec.movement, 'xiangqi');
  // Jieqi is the first checkmate + hidden-identity spec: identities hidden,
  // positions public (distinct from the fog 'dark' specs).
  assert.equal(spec.objective, 'checkmate');
  assert.equal(spec.visibility, 'hidden-identity');
  assert.equal(spec.setup, 'jieqi-deal');
  assert.equal(spec.reserves, 'none');
  assert.equal(spec.dropPolicy, 'none');
  assert.equal(spec.ratingPoolBase, 'jieqi');
  assert.equal(spec.publicSurface, 'casual');
  assert.equal(spec.runtimeStatus, 'live');
  assert.equal(spec.legacyLiveRoom, undefined);
});

test('Banqi is an xiangqi-family hidden-identity spec on the 8x4 board', () => {
  const spec = gameSpecForId(BANQI_SPEC_ID);

  assert.equal(spec.publicName, 'Banqi');
  assert.equal(spec.family, 'xiangqi');
  assert.equal(spec.board, 'banqi-8x4');
  assert.equal(spec.movement, 'banqi');
  // Banqi wins by leaving the opponent with no legal move (the general is not
  // royal), and like jieqi hides identities on a public board.
  assert.equal(spec.objective, 'last-mover');
  assert.equal(spec.visibility, 'hidden-identity');
  assert.equal(spec.setup, 'banqi-deal');
  assert.equal(spec.reserves, 'none');
  assert.equal(spec.dropPolicy, 'none');
  assert.equal(spec.ratingPoolBase, 'banqi');
  assert.equal(spec.publicSurface, 'casual');
  assert.equal(spec.runtimeStatus, 'live');
  assert.equal(spec.legacyLiveRoom, undefined);
});

test('composite specs are composed from rule modules', () => {
  const fortress = gameSpecForId(FORTRESS_XIANGQI_SPEC_ID);
  assert.equal(fortress.reserves, 'crazyhouse');
  assert.notEqual(fortress.dropPolicy, 'none');
});

test('game spec ids are unique and discoverable', () => {
  const ids = GAME_SPECS.map((spec) => spec.id);
  assert.equal(new Set(ids).size, ids.length);

  assert.equal(isGameSpecId('dark-chess'), true);
  assert.equal(isGameSpecId('dark-xiangqi'), true);
  assert.equal(isGameSpecId('banqi'), true);
  assert.equal(isGameSpecId('not-a-spec'), false);
  assert.equal(maybeGameSpecForId('not-a-spec'), null);
});

test('legacy live-room inputs map to Fog Chess, the only chess-shell spec left', () => {
  assert.equal(gameSpecForLegacyLiveRoom({ variant: 'dark-chess' }).id, DARK_CHESS_SPEC_ID);
  assert.equal(gameSpecForLegacyLiveRoom({ variant: 'chess' }).id, DARK_CHESS_SPEC_ID);
  assert.equal(gameSpecForLegacyLiveRoom({ variant: 'unknown' }).id, DARK_CHESS_SPEC_ID);
});

test('current live specs can be converted back to the existing room wire shape', () => {
  assert.deepEqual(legacyLiveRoomForGameSpec(DARK_CHESS_SPEC_ID), { variant: 'dark-chess' });
  assert.equal(legacyLiveRoomForGameSpec(DARK_XIANGQI_SPEC_ID), null);
});

test('RATED_POOL_BASES derives from the rated flag and matches the RatingVariant union', () => {
  // The runtime set is exactly the ratingPoolBase of every `rated: true` spec.
  const fromFlag = GAME_SPECS.filter((spec) => spec.rated).map((spec) => spec.ratingPoolBase);
  assert.deepEqual([...RATED_POOL_BASES].sort(), [...fromFlag].sort());

  // The compile-time RatingVariant union must match the runtime set. This Record
  // literal forces every union member to appear exactly once (a missing or extra
  // member is a compile error); comparing its keys to RATED_POOL_BASES guards the
  // type, the `rated` flags, and the user_ratings CHECK migration against drift.
  const unionMembers: Record<RatingVariant, true> = {
    fog: true,
    dark_xiangqi: true,
    jieqi: true,
    banqi: true,
    jungle: true,
    jungle_flip: true,
    fortress_xiangqi: true,
    xiangqi: true,
    duck_xiangqi: true,
  };
  assert.deepEqual(Object.keys(unionMembers).sort(), [...RATED_POOL_BASES].sort());
});

test('ratingPoolForSpec is rated for launched pools and null for casual-only specs', () => {
  assert.equal(ratingPoolForSpec(DARK_CHESS_SPEC_ID), 'fog');
  assert.equal(ratingPoolForSpec(JIEQI_SPEC_ID), 'jieqi');
  assert.equal(ratingPoolForSpec(BANQI_SPEC_ID), 'banqi');
  assert.equal(ratingPoolForSpec(DARK_XIANGQI_SPEC_ID), 'dark_xiangqi');
  assert.equal(ratingPoolForSpec(JUNGLE_SPEC_ID), 'jungle');
  assert.equal(ratingPoolForSpec(JUNGLE_FLIP_SPEC_ID), 'jungle_flip');
  assert.equal(isRatedPoolBase('jieqi'), true);
  assert.equal(isRatedPoolBase('jungle'), true);
  assert.equal(isRatedPoolBase('jungle_flip'), true);
  assert.equal(isRatedPoolBase('dark_xiangqi'), true);
  assert.equal(isRatedPoolBase('not-a-pool'), false);
});

test('every study-eligible spec is a real spec that can be rooted at a position', () => {
  for (const id of STUDY_ELIGIBLE_SPEC_IDS) {
    assert.ok(maybeGameSpecForId(id), `${id} is not a real game spec`);
    assert.equal(isStudyEligibleSpecId(id), true);
    // The invariant that replaced the old hidden-deal exclusion. A chapter
    // stores moves and is replayed from its root, so a variant whose position
    // cannot be spelled as a FEN has nothing to replay from. That is what makes
    // the dealt three safe to include: their canonical FEN pins the deal, and a
    // chapter persists it as SerializedTree.rootFen.
    assert.equal(hasStartFen(id), true, `${id} is study-eligible but has no start FEN`);
  }
  // The hidden-deal variants are IN now, and they are the reason the assertion
  // above exists rather than a hardcoded list.
  for (const id of [BANQI_SPEC_ID, JIEQI_SPEC_ID, JUNGLE_FLIP_SPEC_ID]) {
    assert.equal(isStudyEligibleSpecId(id), true, `${id} should be study-eligible`);
  }
  assert.equal(isStudyEligibleSpecId('chess'), false);
  assert.equal(isStudyEligibleSpecId('not-a-variant'), false);
  assert.equal(isStudyEligibleSpecId(''), false);
});

// The retired set is derived from the entries' own runtimeStatus, so this is
// the one list of what is going (docs-private/variant-retirement-plan.md, #396).
test('no spec is retired: every variant the plan named has been deleted', () => {
  // The retired set is empty as of 2026-09-12; a future retirement lands here
  // first (runtimeStatus 'retired', publicSurface 'hidden') and is deleted from
  // its own commit later.
  assert.deepEqual([...RETIRED_GAME_SPEC_IDS], []);
  for (const id of RETIRED_GAME_SPEC_IDS) {
    assert.equal(gameSpecForId(id).publicSurface, 'hidden', id);
    assert.equal(isRetiredGameSpec(id), true, id);
  }
  for (const id of [XIANGQI_SPEC_ID, DARK_CHESS_SPEC_ID, JIEQI_SPEC_ID, BANQI_SPEC_ID]) {
    assert.equal(isRetiredGameSpec(id), false, id);
  }
  assert.equal(isRetiredGameSpec('no-such-spec'), false);
});
