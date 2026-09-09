import assert from 'node:assert/strict';
import test from 'node:test';

import { totalFaan } from './hk-faan.js';
import { HK_PATTERNS, type HkPatternId, type ScoredPattern } from './hk-patterns.js';

const only = (id: HkPatternId, count = 1): ScoredPattern[] => [{ id, count }];

test('the derived totals match the values the HK tables publish', () => {
  // These are the rolled-up numbers printed in the sources. They are NOT stored
  // anywhere in hk-patterns.ts; each has to fall out of an atomic value plus its
  // implications. If any drifts, the atomic value or the implication graph is
  // wrong, which is the failure this whole structure exists to prevent.
  const published: [HkPatternId, number][] = [
    ['big-three-dragons', 8], // 5 + three dragon pungs
    ['little-three-dragons', 5], // 3 + two dragon pungs
    ['all-terminals-and-honours', 4], // 1 + 對對糊 3
    ['kong-replacement', 2], // 1 + 自摸 1
    ['flower-win', 3], // 2 + 自摸 1
  ];

  for (const [id, expected] of published) {
    assert.equal(totalFaan(only(id)).faan, expected, `${HK_PATTERNS[id].chinese} should be ${expected}`);
  }
});

test('a component counted explicitly and implied is counted once', () => {
  // Detection will legitimately report both: the hand does contain three dragon
  // pungs, and it is also 大三元. Adding them gives 11.
  const both = totalFaan([
    { id: 'big-three-dragons', count: 1 },
    { id: 'dragon-pung', count: 3 },
  ]);
  assert.equal(both.faan, 8);

  const dragons = both.lines.find((line) => line.id === 'dragon-pung');
  assert.equal(dragons?.count, 3);
});

test('a rolled-up pattern absorbs the components it excludes', () => {
  // 坎坎糊 is defined as all-pungs-with-nothing-claimed and explicitly does not
  // additionally score 對對糊, 門前清 or 自摸.
  const result = totalFaan([
    { id: 'four-concealed-pungs', count: 1 },
    { id: 'all-pungs', count: 1 },
    { id: 'concealed', count: 1 },
    { id: 'self-draw', count: 1 },
  ]);
  assert.equal(result.faan, 8);
  assert.equal(result.lines.length, 1);
  assert.equal(result.dropped.filter((d) => d.reason === 'excluded-by-another-pattern').length, 3);
});

test('exclusion beats implication', () => {
  // 小四喜 necessarily IS a half flush and the source forbids adding it. If
  // implications were expanded before exclusions were applied, the half flush
  // would come back and the hand would read 9 instead of 6.
  const result = totalFaan([
    { id: 'little-four-winds', count: 1 },
    { id: 'half-flush', count: 1 },
  ]);
  assert.equal(result.faan, 6);
  assert.ok(result.lines.every((line) => line.id !== 'half-flush'));
});

test('限牌 pays the table limit, not its nominal faan', () => {
  assert.equal(totalFaan(only('thirteen-orphans'), { limit: 8 }).faan, 8);
  assert.equal(totalFaan(only('thirteen-orphans'), { limit: 10 }).faan, 10);
  assert.equal(totalFaan(only('thirteen-orphans'), { limit: 13 }).faan, 13);
  assert.equal(totalFaan(only('thirteen-orphans'), { limit: 10 }).limitHand, true);
});

test('under unlimited play a limit hand scores its nominal faan', () => {
  const capped = totalFaan(only('big-four-winds'), { limit: 8 });
  const uncapped = totalFaan(only('big-four-winds'), { limit: 8, unlimited: true });
  assert.equal(capped.faan, 8);
  assert.equal(uncapped.faan, 13);
  assert.equal(uncapped.limitHand, true);
});

test('a table may promote a pattern into the limit set', () => {
  const normal = totalFaan(only('big-three-dragons'), { limit: 10 });
  const promoted = totalFaan(only('big-three-dragons'), {
    limit: 10,
    elevatedToLimit: ['big-three-dragons'],
  });
  assert.equal(normal.faan, 8);
  assert.equal(promoted.faan, 10);
});

test('seven pairs scores nothing at an orthodox table', () => {
  const orthodox = totalFaan(only('seven-pairs'));
  assert.equal(orthodox.faan, 0);
  assert.deepEqual(orthodox.dropped, [{ id: 'seven-pairs', reason: 'not-orthodox' }]);

  const houseRules = totalFaan(only('seven-pairs'), { patternSet: 'with-custom' });
  assert.equal(houseRules.faan, 3);
});

test('a dropped house-rule pattern cannot exclude anything', () => {
  // Seven pairs excludes 平糊. At an orthodox table seven pairs does not exist,
  // so it must not be able to silently delete a pattern that does.
  const result = totalFaan([
    { id: 'seven-pairs', count: 1 },
    { id: 'all-chows', count: 1 },
  ]);
  assert.equal(result.faan, 1);
  assert.equal(result.lines[0]?.id, 'all-chows');
});

test('counts are clamped to what can actually occur', () => {
  const result = totalFaan(only('dragon-pung', 5));
  assert.equal(result.faan, 3);
  assert.ok(result.dropped.some((d) => d.reason === 'over-max-count'));
});

test('seat flowers score twice at most', () => {
  assert.equal(totalFaan(only('seat-flower', 1)).faan, 1);
  assert.equal(totalFaan(only('seat-flower', 2)).faan, 2);
  assert.equal(totalFaan(only('seat-flower', 3)).faan, 2);
});

test('the minimum winning hand from the source example', () => {
  // The worked example for 三番起糊: a dragon pung, a seat flower and a
  // self-draw. Flowers counting toward the minimum is HK, and the opposite of
  // MCR, so this example is the regression test for that rule.
  const result = totalFaan([
    { id: 'dragon-pung', count: 1 },
    { id: 'seat-flower', count: 1 },
    { id: 'self-draw', count: 1 },
  ]);
  assert.equal(result.faan, 3);
  assert.equal(result.limitHand, false);
});

test('every pattern implies and excludes only patterns that exist', () => {
  for (const spec of Object.values(HK_PATTERNS)) {
    for (const component of spec.implies) {
      assert.ok(HK_PATTERNS[component.id], `${spec.id} implies unknown ${component.id}`);
      assert.ok(component.count > 0, `${spec.id} implies ${component.id} zero times`);
    }
    for (const victim of spec.excludes) {
      assert.ok(HK_PATTERNS[victim], `${spec.id} excludes unknown ${victim}`);
    }
  }
});

test('no orthodox pattern implies a house-rule pattern', () => {
  // Otherwise an orthodox table would score a house rule through the back door.
  for (const spec of Object.values(HK_PATTERNS)) {
    if (!spec.orthodox) continue;
    for (const component of spec.implies) {
      assert.ok(
        HK_PATTERNS[component.id].orthodox,
        `orthodox ${spec.id} implies house-rule ${component.id}`,
      );
    }
  }
});
