import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_HK_PAYMENT, type HkPaymentRules, settle, unit } from './hk-payment.js';

test('the half-spicy table matches the published values', () => {
  const expected = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384];
  for (let faan = 0; faan < expected.length; faan += 1) {
    assert.equal(unit(faan, 'half-spicy'), expected[faan], `half-spicy at ${faan} faan`);
  }
});

test('the full-spicy table doubles every faan', () => {
  const expected = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192];
  for (let faan = 0; faan < expected.length; faan += 1) {
    assert.equal(unit(faan, 'full-spicy'), expected[faan], `full-spicy at ${faan} faan`);
  }
});

test('the two curves diverge by eight times at the common limit', () => {
  assert.equal(unit(10, 'full-spicy') / unit(10, 'half-spicy'), 8);
  // They agree up to four faan, which is why the choice looks harmless.
  for (let faan = 0; faan <= 4; faan += 1) {
    assert.equal(unit(faan, 'half-spicy'), unit(faan, 'full-spicy'));
  }
});

test('the limit caps the faan before the lookup, not the payout after', () => {
  const rules: HkPaymentRules = { ...DEFAULT_HK_PAYMENT, limit: 8 };
  const limitHand = settle(13, false, rules);
  const exactlyAtLimit = settle(8, false, rules);
  assert.equal(limitHand.effectiveFaan, 8);
  assert.deepEqual(limitHand, exactlyAtLimit);
});

test('a self-drawn win is worth exactly 1.5x a discard win at every level', () => {
  for (const curve of ['half-spicy', 'full-spicy'] as const) {
    for (const system of ['half-shoot', 'full-shoot'] as const) {
      const rules: HkPaymentRules = { ...DEFAULT_HK_PAYMENT, curve, system, limit: 13 };
      for (let faan = 0; faan <= 13; faan += 1) {
        const drawn = settle(faan, true, rules);
        const discarded = settle(faan, false, rules);
        assert.equal(
          drawn.winnerReceives / discarded.winnerReceives,
          1.5,
          `${curve}/${system} at ${faan} faan`,
        );
      }
    }
  }
});

test('half shoot spreads a discard loss, full shoot concentrates it', () => {
  const half = settle(3, false, { ...DEFAULT_HK_PAYMENT, system: 'half-shoot' });
  const full = settle(3, false, { ...DEFAULT_HK_PAYMENT, system: 'full-shoot' });

  // The winner cannot tell the systems apart.
  assert.equal(half.winnerReceives, full.winnerReceives);

  // The table can. Under full shoot the discarder carries all of it.
  assert.equal(half.discarderPays, 16);
  assert.equal(half.eachOtherPays, 8);
  assert.equal(full.discarderPays, 32);
  assert.equal(full.eachOtherPays, 0);
});

test('every settlement balances: what is paid equals what is received', () => {
  for (const system of ['half-shoot', 'full-shoot'] as const) {
    for (const selfDrawn of [true, false]) {
      for (let faan = 0; faan <= 13; faan += 1) {
        const result = settle(faan, selfDrawn, { ...DEFAULT_HK_PAYMENT, system, limit: 13 });
        const paid = selfDrawn
          ? result.eachOtherPays * 3
          : result.discarderPays + result.eachOtherPays * 2;
        assert.equal(
          paid,
          result.winnerReceives,
          `${system} ${selfDrawn ? 'self-draw' : 'discard'} at ${faan} faan leaks`,
        );
      }
    }
  }
});

test('the stake scales everything linearly', () => {
  const single = settle(4, true, { ...DEFAULT_HK_PAYMENT, stake: 1 });
  const quadruple = settle(4, true, { ...DEFAULT_HK_PAYMENT, stake: 4 });
  assert.equal(quadruple.winnerReceives, single.winnerReceives * 4);
  assert.equal(quadruple.eachOtherPays, single.eachOtherPays * 4);
});

test('a three-faan win at the default table', () => {
  // The minimum winning hand under 三番起糊, on the most common table.
  const result = settle(3, false);
  assert.equal(result.unit, 8);
  assert.equal(result.winnerReceives, 32);
  assert.equal(result.discarderPays, 16);
  assert.equal(result.eachOtherPays, 8);
});

test('negative faan is rejected rather than silently floored', () => {
  assert.throws(() => unit(-1), /cannot be negative/);
});
