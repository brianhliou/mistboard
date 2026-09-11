import assert from 'node:assert/strict';
import test from 'node:test';

import { sevenPairsShanten, shanten, standardShanten, thirteenOrphansShanten } from './shanten.js';
import { formatTiles, parseTiles, toCounts } from './tiles.js';

const counts = (notation: string) => toCounts(parseTiles(notation));

test('notation round-trips through parse and format', () => {
  assert.equal(formatTiles(parseTiles('123m456p789s11z')), '123m456p789s11z');
  assert.equal(formatTiles(parseTiles('321m')), '123m');
  assert.equal(formatTiles(parseTiles('1m 2m 3m')), '123m');
});

test('notation rejects malformed input', () => {
  assert.throws(() => parseTiles('123'), /trailing ranks/);
  assert.throws(() => parseTiles('m123'), /no preceding ranks/);
  assert.throws(() => parseTiles('123x'), /unknown suit/);
  assert.throws(() => parseTiles('0z'), /honour rank out of range/);
  assert.throws(() => toCounts(parseTiles('11111m')), /more than four/);
});

test('a complete hand is -1 shanten', () => {
  assert.equal(standardShanten(counts('123m456m789m123p11s')), -1);
  assert.equal(standardShanten(counts('111m222m333m444m55m')), -1);
});

test('a waiting hand is 0 shanten', () => {
  // Waiting to pair the lone 1s.
  assert.equal(standardShanten(counts('123m456m789m123p1s')), 0);
  // Edge wait on 3p, pair already held.
  assert.equal(standardShanten(counts('123m456m789m12p55s')), 0);
  // Shanpon: two pairs, either completes the hand.
  assert.equal(standardShanten(counts('123m456m789m11p22p')), 0);
});

test('five blocks with no pair costs an extra exchange', () => {
  // Three sets plus 12p and 45s. The arithmetic alone reads 0; the hand is
  // actually 1 away, because one block has to be broken to make the pair.
  // Without the no-pair correction in standardShanten this returns 0.
  assert.equal(standardShanten(counts('123m456m789m12p45s')), 1);
});

test('a set cannot be added on top of five partials', () => {
  // Found by differential test against an independent implementation, not by
  // anything written here. The cap was applied to partials only, so the search
  // could build five partials and then add a SET, reporting six blocks and a
  // hand one tile closer to winning than it is.
  //
  // 346788m 2457p 456s 6z: the six-block reading is 34m 67m 88m 24p 57p plus
  // 456s, which scores 1. The real answer takes 678m and 456s as sets with
  // 34m 24p 57p, five blocks and no pair, so 8-4-3 = 1 and the no-pair
  // correction makes it 2.
  assert.equal(standardShanten(counts('346788m2457p456s6z')), 2);
  assert.equal(standardShanten(counts('3568m245679p222s7z')), 2);
  assert.equal(standardShanten(counts('389m23p125578s111z')), 2);
});

test('blocks beyond the fifth do not reduce shanten', () => {
  // One set and five partial runs: six blocks in thirteen tiles. Only five can
  // ever be used, and none of them is a pair. Counting all six reads 1; the
  // hand is really 3 away (three tiles to finish sets, one more to pair).
  assert.equal(standardShanten(counts('123m12p45p78p12s45s')), 3);
});

test('melded sets count toward the four', () => {
  // Four melds down, holding only the pair: complete.
  assert.equal(standardShanten(counts('11m'), 4), -1);
  // Three melds down, holding a pair and a partial run: tenpai on 1p/4p.
  assert.equal(standardShanten(counts('11m23p'), 3), 0);
  // Three melds down, a pair and two floaters: one draw from tenpai.
  assert.equal(standardShanten(counts('11m5p9s'), 3), 1);
});

test('a hand of thirteen isolated tiles is the standard maximum', () => {
  assert.equal(standardShanten(counts('147m147p147s1234z')), 8);
});

test('seven pairs', () => {
  assert.equal(sevenPairsShanten(counts('11m22m33m44m55m66m77m')), -1);
  assert.equal(sevenPairsShanten(counts('11m22m33m44m55m66m79m')), 0);
  // Four of a kind is one pair, not two: the hand still needs a seventh kind.
  assert.equal(sevenPairsShanten(counts('1111m22m33m44m55m66m')), 1);
});

test('thirteen orphans', () => {
  assert.equal(thirteenOrphansShanten(counts('19m19p19s1234567z')), 0);
  assert.equal(thirteenOrphansShanten(counts('19m19p19s12345677z')), -1);
  assert.equal(thirteenOrphansShanten(counts('19m19p19s123456z2m')), 1);
});

test('special shapes are opt-in and report which shape won', () => {
  // Six isolated pairs three ranks apart, so no run can ever form from them.
  // As seven pairs this is tenpai; as four-sets-and-a-pair it is 3 away.
  const sevenPairHand = counts('11m44m77m11p44p77p1s');

  // Hong Kong tables that do not recognise seven pairs must not see it.
  const closed = shanten(sevenPairHand);
  assert.equal(closed.shape, 'standard');
  assert.equal(closed.shanten, 3);

  const opened = shanten(sevenPairHand, { sevenPairs: true });
  assert.equal(opened.shape, 'seven-pairs');
  assert.equal(opened.shanten, 0);
});

test('a tie between shapes resolves to the standard hand', () => {
  // 112233445566m 79m is tenpai read either way. Standard is the shape a
  // player is actually holding, so it wins the tie and the label stays honest.
  const both = counts('11m22m33m44m55m66m79m');
  assert.equal(standardShanten(both), 0);
  assert.equal(sevenPairsShanten(both), 0);
  assert.equal(shanten(both, { sevenPairs: true }).shape, 'standard');
});

test('special shapes are unavailable once the hand has melded', () => {
  const hand = counts('11m22m33m44m55m');
  assert.equal(shanten(hand, { sevenPairs: true, meldCount: 1 }).shape, 'standard');
});

test('shanten stays in range across many random hands', () => {
  let seed = 20260909;
  const nextInt = (bound: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % bound;
  };

  for (let trial = 0; trial < 400; trial += 1) {
    const wall: number[] = [];
    for (let tile = 0; tile < 34; tile += 1) {
      for (let copy = 0; copy < 4; copy += 1) wall.push(tile);
    }
    const hand: number[] = [];
    for (let drawn = 0; drawn < 13; drawn += 1) {
      hand.push(...wall.splice(nextInt(wall.length), 1));
    }
    const value = standardShanten(toCounts(hand));
    assert.ok(
      value >= 0 && value <= 8,
      `thirteen tiles ${formatTiles(hand)} produced shanten ${value}`,
    );
  }
});
