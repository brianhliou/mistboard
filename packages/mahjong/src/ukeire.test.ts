import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTiles, parseTiles, toCounts } from './tiles.js';
import { acceptance, rankDiscards, waits } from './ukeire.js';

const counts = (notation: string) => toCounts(parseTiles(notation));
const asNotation = (tiles: readonly { tile: number }[]) =>
  formatTiles(tiles.map((entry) => entry.tile));

test('an edge wait accepts exactly one tile', () => {
  const result = waits(counts('123m456m789m12p55s'));
  assert.equal(result.shanten, 0);
  assert.equal(asNotation(result.tiles), '3p');
  assert.equal(result.total, 4);
});

test('a shanpon wait accepts both pairs', () => {
  const result = waits(counts('123m456m789m11p22p'));
  assert.equal(asNotation(result.tiles), '12p');
  // Two copies of each remain: the hand holds the other two.
  assert.equal(result.total, 4);
});

test('a two-sided run accepts both ends', () => {
  const result = waits(counts('123m456m789m34p55s'));
  assert.equal(asNotation(result.tiles), '25p');
  assert.equal(result.total, 8);
});

test('visible copies are removed from the count', () => {
  const hand = counts('123m456m789m12p55s');
  const visible = toCounts(parseTiles('33p'));
  const result = waits(hand, {}, visible);
  assert.equal(asNotation(result.tiles), '3p');
  assert.equal(result.total, 2);
});

test('a dead wait reports zero live tiles but still reads as tenpai', () => {
  const hand = counts('123m456m789m12p55s');
  const visible = toCounts(parseTiles('3333p'));
  const result = waits(hand, {}, visible);
  assert.equal(result.shanten, 0);
  assert.equal(result.total, 0);
  assert.equal(result.tiles.length, 1);
});

test('waits are empty when the hand is not tenpai', () => {
  const result = waits(counts('123m456m789m12p45s'));
  assert.equal(result.shanten, 1);
  assert.deepEqual(result.tiles, []);
});

test('acceptance on a one-away hand names every improving tile', () => {
  // 123m 456m 789m 12p 45s: five blocks, no pair. Improving means completing a
  // block AND leaving a pair reachable, so the pairing tiles count too.
  const result = acceptance(counts('123m456m789m12p45s'));
  assert.equal(result.shanten, 1);
  assert.ok(result.tiles.length > 0);
  assert.ok(result.total > 0);
  for (const entry of result.tiles) {
    assert.ok(entry.remaining >= 0 && entry.remaining <= 4);
  }
});

test('discard ranking puts the tenpai-preserving discard first', () => {
  // The 9s is the odd tile out; dropping it restores the 3p edge wait.
  const options = rankDiscards(counts('123m456m789m12p559s'));
  const best = options[0];
  assert.ok(best);
  assert.equal(formatTiles([best.discard]), '9s');
  assert.equal(best.shanten, 0);
  assert.equal(asNotation(best.acceptance.tiles), '3p');
});

test('discard ranking prefers the wider wait when shanten ties', () => {
  // Holding 1p, 3p, 4p over a 5z pair. Dropping 1p keeps the two-sided 34p
  // (waits 2p/5p, eight tiles); dropping 4p keeps the 13p gap (waits 2p only,
  // four tiles). Both are tenpai, so width has to break the tie.
  const options = rankDiscards(counts('123m456m789m55z134p'));
  const best = options[0];
  assert.ok(best);
  assert.equal(best.shanten, 0);
  assert.equal(asNotation(best.acceptance.tiles), '25p');
  assert.equal(best.acceptance.total, 8);
});

test('every discard is offered exactly once per distinct tile', () => {
  const options = rankDiscards(counts('123m456m789m12p559s'));
  const discards = options.map((option) => option.discard);
  assert.equal(new Set(discards).size, discards.length);
  assert.equal(discards.length, new Set(parseTiles('123m456m789m12p559s')).size);
});
