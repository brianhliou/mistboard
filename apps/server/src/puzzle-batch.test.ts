import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type PuzzleBatchCandidate,
  type PuzzleBatchOptions,
  selectPuzzleBatch,
} from './puzzle-batch.js';

function puzzle(
  id: string,
  rating = 1500,
  theme = 'fork',
  variant = 'xiangqi',
): PuzzleBatchCandidate {
  return { id, variant, rating, themes: [theme] };
}

function options(overrides: Partial<PuzzleBatchOptions> = {}): PuzzleBatchOptions {
  return {
    variant: 'xiangqi',
    targetRating: 1500,
    limit: 10,
    attemptedIds: new Set(),
    excludedIds: new Set(),
    seed: 632,
    ...overrides,
  };
}

const ids = (puzzles: readonly PuzzleBatchCandidate[]) => puzzles.map(({ id }) => id);

test('batch excludes attempted, caller-excluded and other-variant puzzles before every pick', () => {
  const eligible = Array.from({ length: 12 }, (_, index) => puzzle(`fresh-${index}`));
  const candidates = [
    puzzle('solved'),
    puzzle('failed'),
    puzzle('queued'),
    puzzle('seen'),
    puzzle('other-variant', 1500, 'fork', 'jungle'),
    ...eligible,
  ];
  // Sweep deterministic seeds, including exploration slots 5 and 10. A short
  // eligible pool must never be topped up from either exclusion set.
  for (let seed = 0; seed < 32; seed += 1) {
    const result = selectPuzzleBatch(
      candidates,
      options({
        limit: 20,
        attemptedIds: new Set(['solved', 'failed', 'missing-attempt']),
        excludedIds: new Set(['queued', 'seen', 'solved', 'missing-exclusion']),
        seed,
      }),
    );
    assert.deepEqual([...ids(result)].sort(), [...ids(eligible)].sort());
  }
});

test('empty and exhausted pools return an empty batch without recycling attempts', () => {
  assert.deepEqual(selectPuzzleBatch([], options()), []);
  assert.deepEqual(
    selectPuzzleBatch([puzzle('attempted')], options({ attemptedIds: new Set(['attempted']) })),
    [],
  );
  assert.deepEqual(
    selectPuzzleBatch([puzzle('excluded')], options({ excludedIds: new Set(['excluded']) })),
    [],
  );
  assert.deepEqual(selectPuzzleBatch([puzzle('fresh')], options({ limit: 0 })), []);
});

test('batch size is bounded and duplicate candidate IDs are returned only once', () => {
  const candidates = [puzzle('a'), puzzle('a'), puzzle('b'), puzzle('c')];
  assert.equal(selectPuzzleBatch(candidates, options({ limit: 2 })).length, 2);
  assert.deepEqual(ids(selectPuzzleBatch(candidates, options())).sort(), ['a', 'b', 'c']);
});

test('caller can exclude the previous batch when requesting the next one', () => {
  const candidates = Array.from({ length: 15 }, (_, index) => puzzle(`fresh-${index}`));
  const first = selectPuzzleBatch(candidates, options());
  const second = selectPuzzleBatch(candidates, options({ excludedIds: new Set(ids(first)) }));
  assert.equal(first.length, 10);
  assert.equal(second.length, 5);
  assert.equal(new Set([...ids(first), ...ids(second)]).size, candidates.length);
});

test('variant selection is exact, with no fallback for unknown or exhausted variants', () => {
  const candidates = [puzzle('xiangqi'), puzzle('jungle', 1500, 'fork', 'jungle')];
  assert.deepEqual(ids(selectPuzzleBatch(candidates, options({ variant: 'jungle' }))), ['jungle']);
  assert.deepEqual(selectPuzzleBatch(candidates, options({ variant: 'unknown' })), []);
});

test('selection uses the supplied effective ratings, including difficulty priors', () => {
  const candidates = [puzzle('hard-prior', 2600), puzzle('near-prior', 1310), puzzle('mid', 1700)];
  assert.equal(
    selectPuzzleBatch(candidates, options({ targetRating: 1300, limit: 1 }))[0]?.id,
    'near-prior',
  );
  assert.equal(
    selectPuzzleBatch(candidates, options({ targetRating: 2600, limit: 1 }))[0]?.id,
    'hard-prior',
  );
});

test('adaptive picks diversify the primary themes of the last two selections', () => {
  const candidates = [
    puzzle('first', 1500, 'fork'),
    puzzle('repeat', 1540, 'fork'),
    puzzle('different', 1550, 'pin'),
  ];
  assert.deepEqual(ids(selectPuzzleBatch(candidates, options())), ['first', 'different', 'repeat']);
});

test('every fifth pick explores the nearest nonempty window instead of the whole corpus', () => {
  const near = Array.from({ length: 20 }, (_, index) => puzzle(`near-${index}`, 1300 + index));
  const far = Array.from({ length: 20 }, (_, index) => puzzle(`far-${index}`, 2400 + index));
  for (let seed = 0; seed < 32; seed += 1) {
    const result = selectPuzzleBatch([...near, ...far], options({ targetRating: 1300, seed }));
    assert.equal(result.length, 10);
    assert.ok(result.every(({ id }) => id.startsWith('near-')));
  }

  // Four adaptive picks consume the closest puzzles. The fifth can pass over
  // a closer match to explore either edge, but never leaves the 300-point band.
  const candidates = [
    ...Array.from({ length: 4 }, (_, index) => puzzle(`closest-${index}`)),
    puzzle('closer', 1600),
    puzzle('lower-edge', 1200),
    puzzle('upper-edge', 1800),
    puzzle('outside', 1801),
  ];
  const explored = new Set<string>();
  for (let seed = 0; seed < 32; seed += 1) {
    const result = selectPuzzleBatch(candidates, options({ limit: 5, seed }));
    assert.ok(result.slice(0, 4).every(({ id }) => id.startsWith('closest-')));
    explored.add(result[4]!.id);
  }
  assert.deepEqual([...explored].sort(), ['closer', 'lower-edge', 'upper-edge']);
});

test('exploration widens only after the closer band is empty', () => {
  for (const distance of [600, 1200]) {
    const candidates = [
      ...Array.from({ length: 4 }, (_, index) => puzzle(`closest-${index}`)),
      puzzle('remaining', 1500 + distance),
      puzzle('outside-band', 1501 + distance),
      puzzle('excluded-near'),
    ];
    for (let seed = 0; seed < 32; seed += 1) {
      assert.equal(
        selectPuzzleBatch(
          candidates,
          options({ limit: 5, excludedIds: new Set(['excluded-near']), seed }),
        )[4]?.id,
        'remaining',
      );
    }
  }
});

test('exploration still returns a fresh puzzle when all rating windows are empty', () => {
  const candidates = [
    ...Array.from({ length: 4 }, (_, index) => puzzle(`closest-${index}`)),
    puzzle('distant', 3000),
    puzzle('excluded-distant', 3000),
  ];
  assert.equal(
    selectPuzzleBatch(
      candidates,
      options({ limit: 5, excludedIds: new Set(['excluded-distant']) }),
    )[4]?.id,
    'distant',
  );
});

test('the same seed reproduces a batch without ambient randomness or input mutation', (t) => {
  t.mock.method(Math, 'random', () => {
    throw new Error('selection must use its explicit seed');
  });
  const candidates = Object.freeze(
    Array.from({ length: 20 }, (_, index) =>
      Object.freeze({ ...puzzle(`puzzle-${index}`), themes: Object.freeze(['fork']) }),
    ),
  );
  const input = options({
    attemptedIds: new Set(['puzzle-0']),
    excludedIds: new Set(['puzzle-1']),
  });
  const before = structuredClone({ candidates, input });
  const first = selectPuzzleBatch(candidates, input);
  assert.deepEqual(selectPuzzleBatch(candidates, input), first);
  assert.deepEqual({ candidates, input }, before);
  assert.ok(first.every((candidate) => candidates.includes(candidate)));

  const orders = new Set(
    Array.from({ length: 8 }, (_, seed) =>
      JSON.stringify(ids(selectPuzzleBatch(candidates, options({ seed })))),
    ),
  );
  assert.ok(orders.size > 1, 'different seeds should vary tied and exploration picks');
});

test('invalid batch limits, target ratings and seeds are rejected', () => {
  for (const limit of [
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(() => selectPuzzleBatch([], options({ limit })), RangeError);
  }
  for (const targetRating of [Number.NaN, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => selectPuzzleBatch([], options({ targetRating })), RangeError);
  }
  for (const seed of [-1, 0.5, 2 ** 32, Number.NaN]) {
    assert.throws(() => selectPuzzleBatch([], options({ seed })), RangeError);
  }
});
