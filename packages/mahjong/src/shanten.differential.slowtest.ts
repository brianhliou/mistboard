/**
 * Differential test against an independent implementation.
 *
 * Every other test in this package checks that the code matches what the author
 * believed the rules to be. That is worth something, and it is not worth what it
 * looks like: nobody on this project plays Hong Kong mahjong, so a shared
 * misunderstanding would pass every one of them.
 *
 * `@kobalab/majiang-core` is an MIT, independently written mahjong library by
 * someone who does play. Its rules are Japanese, but hand STRUCTURE - four sets
 * and a pair, seven pairs, thirteen orphans - is identical across rulesets, so
 * its shanten must agree with ours on every hand. Where it does not, one of us
 * is wrong, and it is worth finding out which.
 *
 * This settles the structural half of the mechanics table in
 * docs-private/mahjong/hk-old-style.md §7. It says nothing about the HK scoring,
 * for which no independent implementation exists.
 *
 * Run with `npm run test:differential`.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { sevenPairsShanten, standardShanten, thirteenOrphansShanten } from './shanten.js';
import { formatTiles, rankOf, suitOf, TILE_COUNT } from './tiles.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Majiang = require('@kobalab/majiang-core') as any;

/** Their notation puts the suit letter first and groups ranks after it. */
function toMajiang(counts: readonly number[]): string {
  const groups: Record<string, string> = { m: '', p: '', s: '', z: '' };
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    const n = counts[tile] ?? 0;
    if (n > 0) groups[suitOf(tile)] += String(rankOf(tile)).repeat(n);
  }
  return ['m', 'p', 's', 'z'].map((s) => (groups[s] ? s + groups[s] : '')).join('');
}

const theirs = (counts: readonly number[]) => {
  const shoupai = Majiang.Shoupai.fromString(toMajiang(counts));
  return {
    standard: Majiang.Util.xiangting_yiban(shoupai) as number,
    sevenPairs: Majiang.Util.xiangting_qidui(shoupai) as number,
    thirteenOrphans: Majiang.Util.xiangting_guoshi(shoupai) as number,
  };
};

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function deal(rng: () => number, size: number, pool: number[]): number[] {
  const wall = [...pool];
  const counts = new Array<number>(TILE_COUNT).fill(0);
  for (let i = 0; i < size; i += 1) {
    const [tile] = wall.splice(Math.floor(rng() * wall.length), 1);
    counts[tile as number] = (counts[tile as number] ?? 0) + 1;
  }
  return counts;
}

const FULL: number[] = [];
for (let tile = 0; tile < TILE_COUNT; tile += 1) {
  for (let copy = 0; copy < 4; copy += 1) FULL.push(tile);
}
/** Two suits plus honours: narrower walls produce structured hands far more often. */
const NARROW = FULL.filter((tile) => tile < 18 || tile >= 27);
/** Terminals and honours only, to exercise the thirteen-orphans path. */
const ORPHANS = FULL.filter(
  (tile) => tile >= 27 || tile % 9 === 0 || tile % 9 === 8 || tile % 9 === 1,
);

function compare(label: string, pool: number[], size: number, trials: number, seed: number) {
  const rng = makeRng(seed);
  let checked = 0;
  const disagreements: string[] = [];

  for (let i = 0; i < trials; i += 1) {
    const counts = deal(rng, size, pool);
    const mine = {
      standard: standardShanten(counts),
      sevenPairs: sevenPairsShanten(counts),
      thirteenOrphans: thirteenOrphansShanten(counts),
    };
    const other = theirs(counts);
    checked += 1;

    for (const key of ['standard', 'sevenPairs', 'thirteenOrphans'] as const) {
      if (mine[key] !== other[key]) {
        const tiles = counts.flatMap((n, tile) => Array.from({ length: n }, () => tile));
        disagreements.push(
          `${key} on ${formatTiles(tiles)}: ours ${mine[key]}, theirs ${other[key]}`,
        );
      }
    }
  }

  console.log(`  ${label.padEnd(26)} ${checked} hands, ${disagreements.length} disagreements`);
  assert.deepEqual(
    disagreements.slice(0, 10),
    [],
    `${label}: ${disagreements.length} disagreements`,
  );
  return checked;
}

test('shanten agrees with an independent implementation', () => {
  let total = 0;
  total += compare('uniform, 13 tiles', FULL, 13, 3000, 11);
  total += compare('uniform, 14 tiles', FULL, 14, 3000, 22);
  total += compare('two suits, 13 tiles', NARROW, 13, 4000, 33);
  total += compare('two suits, 14 tiles', NARROW, 14, 4000, 44);
  total += compare('terminals/honours, 13', ORPHANS, 13, 2000, 55);
  total += compare('terminals/honours, 14', ORPHANS, 14, 2000, 66);
  console.log(`  ${String(total)} hands checked in total`);
  assert.ok(total >= 18_000);
});

test('the two implementations agree on the cases this kernel got wrong first', () => {
  // Regressions from earlier in this build, re-checked against an outside
  // opinion rather than against my own expectation.
  const cases: [string, number[]][] = [];
  const push = (notation: string) => {
    const counts = new Array<number>(TILE_COUNT).fill(0);
    let pending: number[] = [];
    for (const ch of notation) {
      if (ch >= '0' && ch <= '9') pending.push(Number(ch));
      else {
        const base = { m: 0, p: 9, s: 18, z: 27 }[ch] as number;
        for (const r of pending) counts[base + r - 1] = (counts[base + r - 1] ?? 0) + 1;
        pending = [];
      }
    }
    cases.push([notation, counts]);
  };
  push('123m456m789m12p45s'); // five blocks, no pair
  push('123m12p45p78p12s45s'); // six blocks, only five usable
  push('11m44m77m11p44p77p1s'); // seven pairs beats standard
  push('19m19p19s1234567z'); // thirteen orphans
  push('1111m22m33m44m55m66m'); // four of a kind is one pair

  for (const [notation, counts] of cases) {
    const other = theirs(counts);
    assert.equal(standardShanten(counts), other.standard, `standard on ${notation}`);
    assert.equal(sevenPairsShanten(counts), other.sevenPairs, `sevenPairs on ${notation}`);
    assert.equal(
      thirteenOrphansShanten(counts),
      other.thirteenOrphans,
      `thirteenOrphans on ${notation}`,
    );
  }
});
