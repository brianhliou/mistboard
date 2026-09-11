import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type Claim,
  legalClaims,
  nextSeat,
  resolveClaims,
  type Seat,
  seatAfterClaim,
  seatAfterPass,
  seatDistance,
} from './claims.js';
import type { HandSet } from './decompose.js';
import { formatTiles, parseTiles, tileIndex, toCounts } from './tiles.js';

const counts = (notation: string) => toCounts(parseTiles(notation));
const kinds = (claims: readonly Claim[]) => claims.map((c) => c.kind).sort();

test('seat arithmetic goes around the table', () => {
  assert.equal(nextSeat(0), 1);
  assert.equal(nextSeat(3), 0);
  assert.equal(seatDistance(0, 1), 1);
  assert.equal(seatDistance(3, 0), 1);
  assert.equal(seatDistance(1, 0), 3);
});

test('the discarder cannot claim their own discard', () => {
  assert.deepEqual(legalClaims(counts('99m'), [], tileIndex('m', 9), 2, 2), []);
});

test('two matching tiles allow a pung, three allow a kong as well', () => {
  const two = legalClaims(counts('55m123p'), [], tileIndex('m', 5), 1, 0);
  assert.deepEqual(kinds(two), ['pung']);

  const three = legalClaims(counts('555m123p'), [], tileIndex('m', 5), 1, 0);
  assert.deepEqual(kinds(three), ['kong', 'pung']);
});

test('a chow is only available to the seat immediately after the discarder', () => {
  const hand = counts('34m');
  const discard = tileIndex('m', 5);

  const nextPlayer = legalClaims(hand, [], discard, 1, 0);
  assert.ok(kinds(nextPlayer).includes('chow'));

  // Same tiles, seat across the table: no chow.
  const across = legalClaims(hand, [], discard, 2, 0);
  assert.deepEqual(kinds(across), []);
  const before = legalClaims(hand, [], discard, 3, 0);
  assert.deepEqual(kinds(before), []);
});

test('every way of chowing a tile is offered separately', () => {
  // Holding 3,4,6,7 the discarded 5 completes 34-5, 4-5-6 or 5-67. The claimant
  // has to pick; the server must not choose for them.
  const claims = legalClaims(counts('3467m'), [], tileIndex('m', 5), 1, 0);
  const chows = claims.filter((c) => c.kind === 'chow');
  assert.equal(chows.length, 3);
  const shapes = chows.map((c) => formatTiles(c.fromHand)).sort();
  assert.deepEqual(shapes, ['34m', '46m', '67m']);
});

test('a chow cannot run across a suit boundary or off the end', () => {
  // 8m and 9m with a discarded 1p would be a run only if suits wrapped.
  assert.deepEqual(kinds(legalClaims(counts('89m'), [], tileIndex('p', 1), 1, 0)), []);
  // Honours have no runs at all.
  assert.deepEqual(kinds(legalClaims(counts('11z22z'), [], tileIndex('z', 3), 1, 0)), []);
});

test('a win claim needs the hand to actually be complete', () => {
  const melds: HandSet[] = [{ kind: 'pung', tile: 31, concealed: false }];
  // 123m 456m 789m 1p + a discarded 1p completes the pair.
  const claims = legalClaims(counts('123m456m789m1p'), melds, tileIndex('p', 1), 2, 0, {
    seatFlowers: 2,
  });
  assert.ok(kinds(claims).includes('win'));
});

test('a hand below the minimum cannot be declared, which makes the claim illegal', () => {
  // All chows and nothing else is 1 faan. Under 三番起糊 it is not a win, so the
  // claim must not be offered at all - this is a legality rule in HK, not just
  // a scoring one.
  const short = legalClaims(counts('123m456m789m123p5s'), [], tileIndex('s', 5), 2, 0);
  assert.ok(!kinds(short).includes('win'));

  // The same hand at a table with no minimum is a legal win.
  const anyTable = legalClaims(
    counts('123m456m789m123p5s'),
    [],
    tileIndex('s', 5),
    2,
    0,
    {},
    {
      minFaan: 0,
    },
  );
  assert.ok(kinds(anyTable).includes('win'));
});

test('a win outranks a pung, and a pung outranks a chow', () => {
  const chow: Claim = { seat: 1, kind: 'chow', fromHand: [] };
  const pung: Claim = { seat: 2, kind: 'pung', fromHand: [] };
  const win: Claim = { seat: 3, kind: 'win', fromHand: [] };

  assert.equal(resolveClaims([chow, pung], 0).winners[0], pung);
  assert.equal(resolveClaims([chow, pung, win], 0).winners[0], win);
  assert.equal(resolveClaims([chow], 0).winners[0], chow);
});

test('the chow seat does not simply take every discard that passes it', () => {
  // The seat immediately after the discarder is closest, but a pung from across
  // the table still beats their chow. Ordering by seat before rank gets this
  // backwards, and it is the mistake that makes chows swallow the game.
  const chow: Claim = { seat: 1, kind: 'chow', fromHand: [] };
  const pung: Claim = { seat: 3, kind: 'pung', fromHand: [] };
  const resolved = resolveClaims([chow, pung], 0);
  assert.equal(resolved.winners[0], pung);
  assert.equal(resolved.rejected[0]?.claim, chow);
  assert.equal(resolved.rejected[0]?.beatenBy, pung);
});

test('between equal claims the nearer seat after the discarder wins', () => {
  const north: Claim = { seat: 3, kind: 'win', fromHand: [] };
  const south: Claim = { seat: 1, kind: 'win', fromHand: [] };
  // East discards: South is one seat away, North is three.
  assert.equal(resolveClaims([north, south], 0).winners[0], south);
  // Distance is measured from the DISCARDER, not from East. With West
  // discarding, North is one away and South is three, so the answer flips.
  assert.equal(resolveClaims([north, south], 2).winners[0], north);
});

test('a claim from the discarder is discarded, not honoured', () => {
  // It sorts at distance zero, so if it were trusted it would beat every honest
  // claim at the table. legalClaims refuses to produce one; the resolver takes
  // its input off the network and cannot assume that.
  const cheat: Claim = { seat: 0, kind: 'win', fromHand: [] };
  const honest: Claim = { seat: 2, kind: 'pung', fromHand: [] };

  const resolved = resolveClaims([cheat, honest], 0);
  assert.deepEqual(resolved.winners, [honest]);
  assert.ok(resolved.rejected.every((r) => r.claim !== cheat));

  assert.deepEqual(resolveClaims([cheat], 0).winners, []);
});

test('多響 gives every winner the discard, 截糊 gives it to one', () => {
  const a: Claim = { seat: 1, kind: 'win', fromHand: [] };
  const b: Claim = { seat: 2, kind: 'win', fromHand: [] };

  const single = resolveClaims([a, b], 0);
  assert.deepEqual(single.winners, [a]);
  assert.equal(single.rejected.length, 1);

  const many = resolveClaims([a, b], 0, { multipleWinners: true });
  assert.deepEqual(many.winners, [a, b]);
  assert.equal(many.rejected.length, 0);
});

test('multiple winners applies only to wins', () => {
  const win: Claim = { seat: 1, kind: 'win', fromHand: [] };
  const pung: Claim = { seat: 2, kind: 'pung', fromHand: [] };
  const resolved = resolveClaims([win, pung], 0, { multipleWinners: true });
  assert.deepEqual(resolved.winners, [win]);
});

test('nothing claimed passes the turn along; a claim takes it out of order', () => {
  assert.equal(seatAfterPass(0), 1);
  assert.equal(seatAfterPass(3), 0);
  // East discards, West pungs: South is skipped entirely. A turn counter cannot
  // express this, which is why turn order has to be a seat and not an index.
  const pung: Claim = { seat: 2, kind: 'pung', fromHand: [] };
  assert.equal(seatAfterClaim(pung), 2 as Seat);
});

test('an empty window resolves to nothing rather than throwing', () => {
  const resolved = resolveClaims([], 0);
  assert.deepEqual(resolved.winners, []);
  assert.deepEqual(resolved.rejected, []);
});
