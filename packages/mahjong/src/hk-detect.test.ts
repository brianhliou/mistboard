import assert from 'node:assert/strict';
import test from 'node:test';

import type { HandSet } from './decompose.js';
import { scoreHand } from './hk-detect.js';
import { parseTiles, toCounts } from './tiles.js';

const counts = (notation: string) => toCounts(parseTiles(notation));
const ids = (score: { lines: readonly { id: string }[] } | null) =>
  (score?.lines ?? []).map((line) => line.id).sort();

test('a hand that is not a win scores nothing', () => {
  assert.equal(scoreHand(counts('123m456m789m12p55s')), null);
});

test('all chows', () => {
  const score = scoreHand(counts('123m456m789m123p55s'));
  assert.ok(score);
  assert.ok(ids(score).includes('all-chows'));
});

test('all pungs', () => {
  // Melded, so this is 對對糊 and not 坎坎糊. Fully concealed it would be the
  // stronger pattern and 對對糊 would correctly disappear.
  const melded: HandSet[] = [{ kind: 'pung', tile: 0, concealed: false }];
  const score = scoreHand(counts('333m555p777s99s'), melded);
  assert.ok(score);
  assert.ok(ids(score).includes('all-pungs'));
  assert.equal(score.faan, 3);
});

test('full flush outranks half flush and both outrank nothing', () => {
  const full = scoreHand(counts('123m456m789m111m22m'));
  assert.ok(ids(full).includes('full-flush'));
  assert.ok(!ids(full).includes('half-flush'));

  const half = scoreHand(counts('123m456m789m111z22m'));
  assert.ok(ids(half).includes('half-flush'));
});

test('the best-paying split is the one that is reported', () => {
  // 111222333444m splits as four pungs or as three runs plus a pung. The pung
  // reading is 坎坎糊 8 plus a full flush 7; the chow reading is only the
  // flush. A scorer that keeps the first split it finds loses eight faan.
  const score = scoreHand(counts('111m222m333m444m55m'));
  assert.ok(score);
  assert.ok(ids(score).includes('four-concealed-pungs'), 'should take the all-pungs reading');
  assert.ok(ids(score).includes('full-flush'));
  assert.equal(score.faan, 15);
});

test('three dragon pungs roll up rather than counting separately', () => {
  const score = scoreHand(counts('555z666z777z123m11m'));
  assert.ok(score);
  assert.ok(ids(score).includes('big-three-dragons'));
  const dragons = score.lines.find((line) => line.id === 'dragon-pung');
  assert.equal(dragons?.count, 3);
  // 大三元 5 + three implied dragon pungs 3 = 8, plus 混一色 3 and 門前清 1.
  // The dragon pungs are implied once, not added on top of the roll-up.
  assert.equal(score.faan, 12);
});

test('two dragon pungs plus the dragon pair is little three dragons', () => {
  const score = scoreHand(counts('555z666z77z123m111m'));
  assert.ok(score);
  assert.ok(ids(score).includes('little-three-dragons'));
  assert.ok(!ids(score).includes('big-three-dragons'));
});

test('a lone dragon pung scores one faan per dragon', () => {
  const score = scoreHand(counts('555z123m456m789m11p'));
  assert.ok(score);
  const dragons = score.lines.find((line) => line.id === 'dragon-pung');
  assert.equal(dragons?.count, 1);
});

test('seat and round wind score separately and stack when they coincide', () => {
  const east = 27;
  const apart = scoreHand(counts('111z123m456m789m11p'), [], { seatWind: east, roundWind: 28 });
  const together = scoreHand(counts('111z123m456m789m11p'), [], {
    seatWind: east,
    roundWind: east,
  });
  assert.ok(apart && together);
  assert.equal(together.faan - apart.faan, 1, 'double east should be worth one more faan');
});

test('all honours is a limit hand and does not also score all pungs', () => {
  const score = scoreHand(counts('111z222z333z444z55z'), [], {}, { limit: 10 });
  assert.ok(score);
  assert.equal(score.limitHand, true);
  assert.equal(score.faan, 10);
  assert.ok(!ids(score).includes('all-pungs'));
});

test('a limit hand pays the table limit, so the table changes the answer', () => {
  const small = scoreHand(counts('111z222z333z444z55z'), [], {}, { limit: 8 });
  const large = scoreHand(counts('111z222z333z444z55z'), [], {}, { limit: 13 });
  assert.equal(small?.faan, 8);
  assert.equal(large?.faan, 13);
});

test('concealment is read from the melds, not asserted', () => {
  const melded: HandSet[] = [{ kind: 'pung', tile: 0, concealed: false }];
  const open = scoreHand(counts('456m789m123p11p'), melded);
  const closed = scoreHand(counts('111m456m789m123p11p'));
  assert.ok(open && closed);
  assert.ok(!ids(open).includes('concealed'));
  assert.ok(ids(closed).includes('concealed'));
});

test('four concealed pungs absorbs its own components', () => {
  const score = scoreHand(counts('111m333m555p777s99s'), [], { selfDrawn: true });
  assert.ok(score);
  assert.ok(ids(score).includes('four-concealed-pungs'));
  assert.ok(!ids(score).includes('all-pungs'));
  assert.ok(!ids(score).includes('concealed'));
  assert.ok(!ids(score).includes('self-draw'));
});

test('flowers count toward the three-faan minimum', () => {
  // The worked example from the source: dragon pung, seat flower, self-draw.
  const melded: HandSet[] = [{ kind: 'pung', tile: 31, concealed: false }];
  const score = scoreHand(counts('123m456m789m11p'), melded, {
    selfDrawn: true,
    seatFlowers: 1,
  });
  assert.ok(score);
  assert.equal(score.faan, 3);
  assert.equal(score.meetsMinimum, true);
});

test('a cheap hand wins nothing under the standard minimum', () => {
  const score = scoreHand(counts('123m456m789m123p55s'));
  assert.ok(score);
  assert.equal(score.meetsMinimum, false, 'all chows alone is 1 faan and cannot be declared');
});

test('house-rule shapes are silent at an orthodox table', () => {
  const orthodox = scoreHand(counts('123m456m789m111m22m'));
  assert.ok(!ids(orthodox).includes('pure-straight'));
  assert.ok(!ids(orthodox).includes('one-voided-suit'));

  const custom = scoreHand(counts('123m456m789m111m22m'), [], {}, { patternSet: 'with-custom' });
  assert.ok(ids(custom).includes('pure-straight'));
});

test('the settlement rides along with the score', () => {
  const melded: HandSet[] = [{ kind: 'pung', tile: 31, concealed: false }];
  const score = scoreHand(counts('123m456m789m11p'), melded, {
    selfDrawn: true,
    seatFlowers: 1,
  });
  assert.ok(score);
  // Three faan self-drawn on the default table: unit 8, six units to the winner.
  assert.equal(score.settlement.unit, 8);
  assert.equal(score.settlement.winnerReceives, 48);
  assert.equal(score.settlement.eachOtherPays, 16);
});
