import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  gameSpecForId,
  JIEQI_SPEC_ID,
} from '@mistboard/game';
import {
  bucketForGame,
  DEFAULT_RATING_BUCKET,
  PUBLIC_RATING_TIME_CLASS,
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
