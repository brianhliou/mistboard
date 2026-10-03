import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANQI_SPEC_ID,
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  correspondenceTimeControl,
  DARK_CHESS_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DAY_MS,
  GAME_SPECS,
  gameSpecForId,
  isCorrespondenceRatedSpec,
  JIEQI_SPEC_ID,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import {
  bucketForGame,
  CORRESPONDENCE_RATING_TIME_CLASS,
  DEFAULT_RATING_BUCKET,
  PUBLIC_RATING_TIME_CLASS,
  PUBLIC_RATING_TIME_CLASSES,
  parseRatingTimeClass,
  parseRatingVariant,
  type RatingVariant,
} from './rating-buckets.js';

test('default rating bucket uses the Dark chess game spec rating pool', () => {
  assert.deepEqual(DEFAULT_RATING_BUCKET, {
    variant: gameSpecForId(DARK_CHESS_SPEC_ID).ratingPoolBase as RatingVariant,
    timeClass: PUBLIC_RATING_TIME_CLASS,
  });
});

test('bucketForGame maps the dark-chess spec to the fog pool', () => {
  assert.deepEqual(
    bucketForGame({ variant: DARK_CHESS_SPEC_ID, initialMs: 180_000, incrementMs: 2_000 }),
    { variant: gameSpecForId(DARK_CHESS_SPEC_ID).ratingPoolBase, timeClass: 'blitz' },
  );
});

test('bucketForGame fails closed for a retired or unknown variant, never the fog pool', () => {
  // games.variant outlives the registry: rated rows for variants deleted in
  // #396 are still in prod. They must drop out of every pool rather than be
  // re-credited to fog (the old dark-chess fallback drew a Dark Mini Xiangqi
  // result on a fog-chess rating graph).
  assert.equal(
    bucketForGame({ variant: 'dark-mini-xiangqi', initialMs: 180_000, incrementMs: 2_000 }),
    null,
  );
  assert.equal(bucketForGame({ initialMs: 180_000, incrementMs: 2_000 }), null);
  assert.equal(bucketForGame({ variant: null, initialMs: 60_000, incrementMs: 1_000 }), null);
});

test('bucketForGame maps Jieqi and Banqi through their own rating pools', () => {
  assert.deepEqual(
    bucketForGame({ variant: JIEQI_SPEC_ID, initialMs: 180_000, incrementMs: 2_000 }),
    { variant: gameSpecForId(JIEQI_SPEC_ID).ratingPoolBase, timeClass: PUBLIC_RATING_TIME_CLASS },
  );
  // Banqi must bucket into its OWN pool, never fall through to fog. The old
  // ratingSpecForGame had a jieqi arm but no banqi arm, so a rated banqi game
  // would have mis-credited the fog pool — this is the regression guard.
  assert.deepEqual(
    bucketForGame({ variant: BANQI_SPEC_ID, initialMs: 180_000, incrementMs: 2_000 }),
    { variant: gameSpecForId(BANQI_SPEC_ID).ratingPoolBase, timeClass: PUBLIC_RATING_TIME_CLASS },
  );
  // Full Dark Xiangqi buckets into its OWN pool, never the fog fallback.
  assert.deepEqual(
    bucketForGame({ variant: DARK_XIANGQI_SPEC_ID, initialMs: 180_000, incrementMs: 2_000 }),
    {
      variant: gameSpecForId(DARK_XIANGQI_SPEC_ID).ratingPoolBase,
      timeClass: PUBLIC_RATING_TIME_CLASS,
    },
  );
});

test('bucketForGame fails closed for specs with no active pool, never the fog pool', () => {
  // A spec with no active rating pool must yield no bucket (simply not rated)
  // rather than fall through to the dark-chess fallback and pollute the fog
  // pool. Mahjong's pool base is not a rated pool, so it is exactly that.
  assert.equal(bucketForGame({ variant: 'mahjong', initialMs: 180_000, incrementMs: 2_000 }), null);
});

test('bucketForGame buckets each rated live pace into its own time class', () => {
  assert.deepEqual(
    bucketForGame({ variant: DARK_CHESS_SPEC_ID, initialMs: 60_000, incrementMs: 1_000 }),
    { variant: 'fog', timeClass: 'bullet' },
  );
  assert.deepEqual(
    bucketForGame({
      variant: JIEQI_SPEC_ID,
      initialMs: 300_000,
      incrementMs: 5_000,
    }),
    { variant: gameSpecForId(JIEQI_SPEC_ID).ratingPoolBase, timeClass: 'rapid' },
  );
});

test('bucketForGame yields no bucket for an unofficial or correspondence pace', () => {
  // Off-menu pace: no spec, so no bucket.
  assert.equal(bucketForGame({ initialMs: 240_000, incrementMs: 0 }), null);
  // Correspondence cadences are days-per-move; their ms values match no live
  // spec, which is what keeps correspondence casual by construction (the
  // perfect-information correspondence allowance rests on it).
  assert.equal(bucketForGame({ initialMs: 24 * 60 * 60 * 1000, incrementMs: 0 }), null);
});

test('parseRatingVariant keeps legacy leaderboard API params stable', () => {
  assert.equal(parseRatingVariant('fog'), 'fog');
  assert.equal(parseRatingVariant('dark-chess'), 'fog');
  // The deleted Draft960 pool is no longer a rating variant in any spelling.
  assert.equal(parseRatingVariant('fog_draft960'), null);
  assert.equal(parseRatingVariant('fog-draft960'), null);
  assert.equal(parseRatingVariant('dark-draft960'), null);
  assert.equal(parseRatingVariant('jieqi'), 'jieqi');
  assert.equal(parseRatingVariant('banqi'), 'banqi');
  assert.equal(parseRatingVariant('dark-xiangqi'), 'dark_xiangqi');
  assert.equal(parseRatingVariant('dark_xiangqi'), 'dark_xiangqi');
});

test('a rated correspondence game buckets into its variant pool under its OWN time class', () => {
  for (const days of [1, 3, 7] as const) {
    const tc = correspondenceTimeControl(days);
    assert.deepEqual(
      bucketForGame({ variant: XIANGQI_SPEC_ID, initialMs: tc.initialMs, incrementMs: 0 }),
      { variant: gameSpecForId(XIANGQI_SPEC_ID).ratingPoolBase, timeClass: 'correspondence' },
    );
    assert.deepEqual(
      bucketForGame({ variant: DARK_CHESS_SPEC_ID, initialMs: tc.initialMs, incrementMs: 0 }),
      { variant: gameSpecForId(DARK_CHESS_SPEC_ID).ratingPoolBase, timeClass: 'correspondence' },
    );
  }
  // Never a live class: the same variant at a live pace keeps its live bucket.
  assert.equal(
    bucketForGame({ variant: XIANGQI_SPEC_ID, initialMs: 180_000, incrementMs: 2_000 })?.timeClass,
    'blitz',
  );
});

test('correspondence buckets fail closed: dev paces, non-eligible specs, unknown variants', () => {
  // A compressed dev allowance is not an official pace: no pool at all.
  assert.equal(bucketForGame({ variant: XIANGQI_SPEC_ID, initialMs: 900, incrementMs: 0 }), null);
  // Every spec at a correspondence pace buckets exactly when the shared predicate says so.
  for (const spec of GAME_SPECS) {
    const bucket = bucketForGame({ variant: spec.id, initialMs: 3 * DAY_MS, incrementMs: 0 });
    assert.equal(bucket !== null, isCorrespondenceRatedSpec(spec.id), spec.id);
    if (bucket) assert.equal(bucket.timeClass, CORRESPONDENCE_RATING_TIME_CLASS);
  }
  if (!CORRESPONDENCE_ELIGIBLE_SPEC_IDS.includes(JIEQI_SPEC_ID)) {
    assert.equal(
      bucketForGame({ variant: JIEQI_SPEC_ID, initialMs: DAY_MS, incrementMs: 0 }),
      null,
    );
  }
  assert.equal(
    bucketForGame({ variant: 'dark-mini-xiangqi', initialMs: DAY_MS, incrementMs: 0 }),
    null,
  );
});

test('the correspondence time class parses and is listed after the live paces', () => {
  assert.equal(parseRatingTimeClass('correspondence'), 'correspondence');
  assert.equal(parseRatingTimeClass('classical'), null);
  assert.deepEqual(PUBLIC_RATING_TIME_CLASSES, ['bullet', 'blitz', 'rapid', 'correspondence']);
});
