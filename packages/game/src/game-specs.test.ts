import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANQI_SPEC_ID,
  CANONICAL_VARIANT_ORDER,
  CROSSROADS_CHESS_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  DARK_CRAZYHOUSE_SPEC_ID,
  DARK_CROSSROADS_CHESS_SPEC_ID,
  DARK_DRAFT960_SPEC_ID,
  DARK_MINI_XIANGQI_SPEC_ID,
  DARK_SHOGI_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DROP_MINI_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  FOG_DRAFT960_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  GAME_SPECS,
  gameSpecForId,
  gameSpecForLegacyLiveRoom,
  isGameSpecId,
  isRatedPoolBase,
  isStudyEligibleSpecId,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  KRIEGSPIEL_SPEC_ID,
  LUZHANQI_SPEC_ID,
  legacyLiveRoomForGameSpec,
  MINI_XIANGQI_SPEC_ID,
  maybeGameSpecForId,
  RATED_POOL_BASES,
  type RatingVariant,
  REVEAL_CHESS_SPEC_ID,
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
  assert.deepEqual(spec.legacyLiveRoom, { variant: 'dark-chess', hiddenDraft960: false });
});

test('Draft960 is modeled as a dark chess setup module, not a family', () => {
  const spec = gameSpecForId(DARK_DRAFT960_SPEC_ID);

  assert.equal(spec.id, 'dark-draft960');
  assert.equal(spec.publicName, 'Dark Draft960');
  assert.equal(spec.family, 'chess');
  assert.equal(spec.board, 'chess-8x8');
  assert.equal(spec.movement, 'orthodox-chess');
  assert.equal(spec.objective, 'king-capture');
  assert.equal(spec.visibility, 'dark');
  assert.equal(spec.setup, 'draft960');
  assert.equal(spec.reserves, 'none');
  assert.equal(spec.dropPolicy, 'none');
  assert.equal(spec.ratingPoolBase, 'fog_draft960');
  assert.equal(spec.runtimeStatus, 'live');
  assert.deepEqual(spec.legacyLiveRoom, { variant: 'dark-chess', hiddenDraft960: true });
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

test('Dark Mini Xiangqi is a live xiangqi-family spec', () => {
  const spec = gameSpecForId(DARK_MINI_XIANGQI_SPEC_ID);

  assert.equal(spec.publicName, 'Dark Mini Xiangqi');
  assert.equal(spec.family, 'xiangqi');
  assert.equal(spec.board, 'xiangqi-7x7');
  assert.equal(spec.movement, 'mini-xiangqi');
  assert.equal(spec.objective, 'general-capture');
  assert.equal(spec.visibility, 'dark');
  assert.equal(spec.setup, 'mini-standard');
  assert.equal(spec.reserves, 'none');
  assert.equal(spec.dropPolicy, 'none');
  assert.equal(spec.ratingPoolBase, 'dark_mini_xiangqi');
  assert.equal(spec.publicSurface, 'hidden');
  assert.equal(spec.runtimeStatus, 'live');
  assert.equal(spec.legacyLiveRoom, undefined);
});

test('Mini Xiangqi is a parked (hidden) open-info xiangqi-family spec', () => {
  const spec = gameSpecForId(MINI_XIANGQI_SPEC_ID);

  assert.equal(spec.publicName, 'Mini Xiangqi');
  assert.equal(spec.family, 'xiangqi');
  assert.equal(spec.board, 'xiangqi-7x7');
  assert.equal(spec.movement, 'mini-xiangqi');
  assert.equal(spec.objective, 'checkmate');
  assert.equal(spec.visibility, 'open');
  assert.equal(spec.setup, 'mini-standard');
  assert.equal(spec.reserves, 'none');
  assert.equal(spec.dropPolicy, 'none');
  assert.equal(spec.ratingPoolBase, 'mini_xiangqi');
  assert.equal(spec.rated, undefined);
  assert.equal(spec.publicSurface, 'hidden');
  assert.equal(spec.runtimeStatus, 'live');
  assert.equal(spec.legacyLiveRoom, undefined);
});

test('Drop Mini Xiangqi is a live open-info xiangqi reserve spec', () => {
  const spec = gameSpecForId(DROP_MINI_XIANGQI_SPEC_ID);

  assert.equal(spec.publicName, 'Drop Mini Xiangqi');
  assert.equal(spec.family, 'xiangqi');
  assert.equal(spec.board, 'xiangqi-7x7');
  assert.equal(spec.movement, 'mini-xiangqi');
  assert.equal(spec.objective, 'checkmate');
  assert.equal(spec.visibility, 'open');
  assert.equal(spec.setup, 'mini-standard');
  assert.equal(spec.reserves, 'crazyhouse');
  assert.equal(spec.dropPolicy, 'not-enemy-palace');
  assert.equal(spec.ratingPoolBase, 'drop_mini_xiangqi');
  assert.equal(spec.rated, true);
  assert.equal(spec.publicSurface, 'hidden');
  assert.equal(spec.runtimeStatus, 'live');
  assert.equal(spec.legacyLiveRoom, undefined);
});

test('Dark Shogi is a live shogi family spec', () => {
  const spec = gameSpecForId(DARK_SHOGI_SPEC_ID);

  assert.equal(spec.publicName, 'Fog Shogi');
  assert.equal(spec.family, 'shogi');
  assert.equal(spec.board, 'shogi-9x9');
  assert.equal(spec.movement, 'shogi');
  assert.equal(spec.objective, 'king-capture');
  assert.equal(spec.visibility, 'dark');
  assert.equal(spec.setup, 'standard');
  assert.equal(spec.reserves, 'shogi-hands');
  assert.equal(spec.dropPolicy, 'any-legal-square');
  assert.equal(spec.ratingPoolBase, 'dark_shogi');
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

test('Luzhanqi is a hidden computer-refereed hidden-identity military-chess spec', () => {
  const spec = gameSpecForId(LUZHANQI_SPEC_ID);

  assert.equal(spec.publicName, 'Luzhanqi');
  assert.equal(spec.family, 'military-chess');
  assert.equal(spec.board, 'luzhanqi-65-graph');
  assert.equal(spec.movement, 'luzhanqi');
  assert.equal(spec.objective, 'flag-capture');
  assert.equal(spec.visibility, 'hidden-identity');
  assert.equal(spec.setup, 'luzhanqi-formation');
  assert.equal(spec.reserves, 'none');
  assert.equal(spec.dropPolicy, 'none');
  assert.equal(spec.ratingPoolBase, 'luzhanqi');
  assert.equal(spec.rated, undefined);
  assert.equal(spec.publicSurface, 'hidden');
  assert.equal(spec.runtimeStatus, 'live');
  assert.equal(spec.legacyLiveRoom, undefined);
});

test('composite specs are composed from rule modules', () => {
  const sunTzu = gameSpecForId('sun-tzu');
  const laoTzu = gameSpecForId('lao-tzu');
  const darkCrazyhouse = gameSpecForId(DARK_CRAZYHOUSE_SPEC_ID);
  const darkAntichess = gameSpecForId('dark-antichess');
  const darkSeirawan = gameSpecForId('dark-seirawan');
  const darkOmega = gameSpecForId('dark-omega');

  assert.equal(darkCrazyhouse.reserves, 'crazyhouse');
  assert.equal(darkCrazyhouse.dropPolicy, 'any-legal-square');
  assert.equal(darkAntichess.objective, 'antichess');
  assert.equal(sunTzu.setup, 'double-fischer-random');
  assert.equal(sunTzu.reserves, 'crazyhouse');
  assert.equal(sunTzu.dropPolicy, 'any-legal-square');
  assert.equal(laoTzu.setup, 'double-fischer-random');
  assert.equal(laoTzu.reserves, 'crazyhouse');
  assert.equal(laoTzu.dropPolicy, 'seen-squares-only');
  assert.equal(darkSeirawan.movement, 'seirawan');
  assert.equal(darkSeirawan.reserves, 'seirawan-gating');
  assert.equal(darkOmega.family, 'omega-chess');
  assert.equal(darkOmega.board, 'omega-10x10-plus-corners');
});

test('Crossroads Chess is two specs sharing one family/board, split on visibility', () => {
  const open = gameSpecForId(CROSSROADS_CHESS_SPEC_ID);
  const dark = gameSpecForId(DARK_CROSSROADS_CHESS_SPEC_ID);

  for (const spec of [open, dark]) {
    assert.equal(spec.family, 'crossroads-chess');
    assert.equal(spec.board, 'crossroads-6x8');
    assert.equal(spec.movement, 'crossroads-chess');
    assert.equal(spec.objective, 'royal-capture-or-race');
    assert.equal(spec.setup, 'crossroads-standard');
    assert.equal(spec.publicSurface, 'casual');
  }
  assert.equal(open.runtimeStatus, 'live');
  assert.equal(dark.runtimeStatus, 'live');
  // The split: perfect-info onboarding vs the real fog mode, on separate pools.
  assert.equal(open.publicName, 'Crossroads Chess');
  assert.equal(dark.publicName, 'Dark Crossroads Chess');
  assert.equal(open.visibility, 'open');
  assert.equal(dark.visibility, 'dark');
  assert.equal(open.ratingPoolBase, 'crossroads_chess_open');
  assert.equal(dark.ratingPoolBase, 'crossroads_chess');
  assert.equal(open.rated, true);
  assert.equal(dark.rated, true);
});

test('game spec ids are unique and discoverable', () => {
  const ids = GAME_SPECS.map((spec) => spec.id);
  assert.equal(new Set(ids).size, ids.length);

  assert.equal(isGameSpecId('dark-chess'), true);
  assert.equal(isGameSpecId('dark-draft960'), true);
  assert.equal(isGameSpecId('fog-draft960'), false);
  assert.equal(isGameSpecId('mini-xiangqi'), true);
  assert.equal(isGameSpecId('dark-mini-xiangqi'), true);
  assert.equal(isGameSpecId('drop-mini-xiangqi'), true);
  assert.equal(isGameSpecId('dark-xiangqi'), true);
  assert.equal(isGameSpecId('dark-shogi'), true);
  assert.equal(isGameSpecId('banqi'), true);
  assert.equal(isGameSpecId('not-a-spec'), false);
  assert.equal(maybeGameSpecForId('dark-draft960')?.id, DARK_DRAFT960_SPEC_ID);
  assert.equal(maybeGameSpecForId('fog-draft960')?.id, DARK_DRAFT960_SPEC_ID);
  assert.equal(maybeGameSpecForId('not-a-spec'), null);
});

test('legacy Fog Draft960 spec constant aliases the canonical Dark Draft960 id', () => {
  assert.equal(FOG_DRAFT960_SPEC_ID, DARK_DRAFT960_SPEC_ID);
  assert.equal(gameSpecForId(FOG_DRAFT960_SPEC_ID).id, DARK_DRAFT960_SPEC_ID);
});

test('legacy live-room inputs map to current game specs', () => {
  assert.equal(gameSpecForLegacyLiveRoom({ variant: 'dark-chess' }).id, DARK_CHESS_SPEC_ID);
  assert.equal(
    gameSpecForLegacyLiveRoom({ variant: 'dark-chess', hiddenDraft960: true }).id,
    DARK_DRAFT960_SPEC_ID,
  );
  assert.equal(
    gameSpecForLegacyLiveRoom({ variant: 'dark-chess', hiddenDraft960: 'yes' }).id,
    DARK_DRAFT960_SPEC_ID,
  );
  assert.equal(gameSpecForLegacyLiveRoom({ variant: 'draft960' }).id, DARK_DRAFT960_SPEC_ID);
  assert.equal(gameSpecForLegacyLiveRoom({ variant: 'dark-draft960' }).id, DARK_DRAFT960_SPEC_ID);
  assert.equal(gameSpecForLegacyLiveRoom({ variant: 'fog-draft960' }).id, DARK_DRAFT960_SPEC_ID);
  assert.equal(gameSpecForLegacyLiveRoom({ variant: 'unknown' }).id, DARK_CHESS_SPEC_ID);
});

test('current live specs can be converted back to the existing room wire shape', () => {
  assert.deepEqual(legacyLiveRoomForGameSpec(DARK_CHESS_SPEC_ID), {
    variant: 'dark-chess',
    hiddenDraft960: false,
  });
  assert.deepEqual(legacyLiveRoomForGameSpec(DARK_DRAFT960_SPEC_ID), {
    variant: 'dark-chess',
    hiddenDraft960: true,
  });
  assert.equal(legacyLiveRoomForGameSpec(MINI_XIANGQI_SPEC_ID), null);
  assert.equal(legacyLiveRoomForGameSpec(DARK_MINI_XIANGQI_SPEC_ID), null);
  assert.equal(legacyLiveRoomForGameSpec(DROP_MINI_XIANGQI_SPEC_ID), null);
  assert.equal(legacyLiveRoomForGameSpec(DARK_XIANGQI_SPEC_ID), null);
  assert.equal(legacyLiveRoomForGameSpec(DARK_SHOGI_SPEC_ID), null);
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
    fog_draft960: true,
    dark_mini_xiangqi: true,
    drop_mini_xiangqi: true,
    dark_xiangqi: true,
    dark_crazyhouse: true,
    dark_shogi: true,
    crossroads_chess: true,
    crossroads_chess_open: true,
    jieqi: true,
    banqi: true,
    kriegspiel: true,
    reveal_chess: true,
    jungle: true,
    jungle_flip: true,
    fortress_xiangqi: true,
    xiangqi: true,
  };
  assert.deepEqual(Object.keys(unionMembers).sort(), [...RATED_POOL_BASES].sort());
});

test('ratingPoolForSpec is rated for launched pools and null for casual-only specs', () => {
  assert.equal(ratingPoolForSpec(DARK_CHESS_SPEC_ID), 'fog');
  assert.equal(ratingPoolForSpec(DARK_DRAFT960_SPEC_ID), 'fog_draft960');
  assert.equal(ratingPoolForSpec(MINI_XIANGQI_SPEC_ID), null);
  assert.equal(ratingPoolForSpec(DROP_MINI_XIANGQI_SPEC_ID), 'drop_mini_xiangqi');
  assert.equal(ratingPoolForSpec(CROSSROADS_CHESS_SPEC_ID), 'crossroads_chess_open');
  assert.equal(ratingPoolForSpec(JIEQI_SPEC_ID), 'jieqi');
  assert.equal(ratingPoolForSpec(BANQI_SPEC_ID), 'banqi');
  assert.equal(ratingPoolForSpec(LUZHANQI_SPEC_ID), null);
  assert.equal(ratingPoolForSpec(REVEAL_CHESS_SPEC_ID), 'reveal_chess');
  assert.equal(ratingPoolForSpec(DARK_XIANGQI_SPEC_ID), 'dark_xiangqi');
  assert.equal(ratingPoolForSpec(DARK_CROSSROADS_CHESS_SPEC_ID), 'crossroads_chess');
  assert.equal(ratingPoolForSpec(DARK_SHOGI_SPEC_ID), 'dark_shogi');
  assert.equal(ratingPoolForSpec(DARK_CRAZYHOUSE_SPEC_ID), 'dark_crazyhouse');
  assert.equal(ratingPoolForSpec(KRIEGSPIEL_SPEC_ID), 'kriegspiel');
  assert.equal(ratingPoolForSpec(JUNGLE_SPEC_ID), 'jungle');
  assert.equal(ratingPoolForSpec(JUNGLE_FLIP_SPEC_ID), 'jungle_flip');
  assert.equal(isRatedPoolBase('jieqi'), true);
  assert.equal(isRatedPoolBase('jungle'), true);
  assert.equal(isRatedPoolBase('jungle_flip'), true);
  assert.equal(isRatedPoolBase('mini_xiangqi'), false);
  assert.equal(isRatedPoolBase('drop_mini_xiangqi'), true);
  assert.equal(isRatedPoolBase('dark_xiangqi'), true);
  assert.equal(isRatedPoolBase('dark_shogi'), true);
  assert.equal(isRatedPoolBase('kriegspiel'), true);
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
