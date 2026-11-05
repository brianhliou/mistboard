import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FFQ_BANQI_SPEC_ID,
  GAME_SPECS,
  GOMOKU_SPEC_ID,
  publicSpecPredicate,
  RETIRED_GAME_SPEC_IDS,
} from '@mistboard/game';
import {
  countedHumanGame,
  countedPublicGame,
  notRetiredVariant,
  OFF_PUBLIC_GAME_SPEC_IDS,
  offPublicGameSpecIds,
  publicVariant,
} from './persistence-counted-games.js';

test('notRetiredVariant excludes every retired spec id, derived from the registry', () => {
  assert.ok(RETIRED_GAME_SPEC_IDS.includes('fortress-xiangqi'));
  assert.ok(RETIRED_GAME_SPEC_IDS.includes('atomic-xiangqi'));
  const clause = notRetiredVariant('g');
  assert.match(clause, /^g\.variant NOT IN \(/);
  for (const id of RETIRED_GAME_SPEC_IDS) assert.ok(clause.includes(`'${id}'`), id);
  assert.ok(!clause.includes("'xiangqi'"));
});

test('every hidden spec is excluded from public figures independently of access grants', () => {
  assert.ok(countedPublicGame('g').includes(`'${GOMOKU_SPEC_ID}'`));
  for (const spec of GAME_SPECS) {
    assert.equal(
      OFF_PUBLIC_GAME_SPEC_IDS.includes(spec.id),
      spec.publicSurface === 'hidden' || spec.runtimeStatus === 'retired',
      spec.id,
    );
  }
  assert.ok(!countedHumanGame('g').includes(`'${GOMOKU_SPEC_ID}'`));
});

test('Gomoku games enter public figures only when its publicSurface becomes public', () => {
  const isPublic = publicSpecPredicate(
    GAME_SPECS.map((spec) =>
      spec.id === GOMOKU_SPEC_ID ? { ...spec, publicSurface: 'casual' as const } : spec,
    ),
  );
  const launched = offPublicGameSpecIds(isPublic);
  assert.ok(!publicVariant('g', launched).includes(`'${GOMOKU_SPEC_ID}'`));
  assert.deepEqual(
    launched,
    OFF_PUBLIC_GAME_SPEC_IDS.filter((id) => id !== GOMOKU_SPEC_ID),
  );
  assert.deepEqual(
    offPublicGameSpecIds(() => true),
    GAME_SPECS.map((spec) => spec.id).filter(
      (id) => id === FFQ_BANQI_SPEC_ID || RETIRED_GAME_SPEC_IDS.includes(id),
    ),
  );
});

test('notRetiredVariant is a no-op with nothing retired and refuses a non-id', () => {
  assert.equal(notRetiredVariant('g', []), 'TRUE');
  assert.equal(notRetiredVariant('x', ['a-b']), "x.variant NOT IN ('a-b')");
  assert.throws(() => notRetiredVariant('g', ["x'); DROP TABLE games; --"]));
});

test('countedPublicGame is the counted-game filter plus the retired-variant exclusion', () => {
  const clause = countedPublicGame('g');
  assert.ok(clause.startsWith(countedHumanGame('g')));
  assert.ok(clause.includes(publicVariant('g')));
  for (const id of RETIRED_GAME_SPEC_IDS) assert.ok(publicVariant('g').includes(`'${id}'`));
  // The admin and readout filter stays untouched.
  assert.ok(!countedHumanGame('g').includes('NOT IN'));
});
