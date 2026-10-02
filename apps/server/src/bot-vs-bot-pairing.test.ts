import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  botLadderFor,
  pickCalibrationPairing,
  pickContentPairing,
  pickPairing,
  xiangqiBotLadder,
} from './bot-vs-bot-pairing.js';
import { FIRST_PARTY_BOT_PROFILES, firstPartyBotForEngine } from './first-party-bots.js';

const LADDER = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']; // 9 rungs

// Deterministic rng from a fixed sequence (cycles).
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

test('the live ladder is the 9 public rungs, strength-ascending', () => {
  const ladder = xiangqiBotLadder();
  assert.equal(ladder.length, 9);
  assert.equal(ladder.filter((id) => id.startsWith('fairy-stockfish-xiangqi-level-')).length, 8);
  assert.ok(ladder[ladder.length - 1]!.includes('pikafish'));
});

test('content pairing only draws from the top rungs', () => {
  const top = new Set(['r6', 'r7', 'r8']); // top 3 of a 9-rung ladder
  for (let i = 0; i < 50; i++) {
    const rng = seqRng([i / 50, ((i * 7) % 50) / 50]);
    const p = pickContentPairing(rng, LADDER);
    assert.ok(top.has(p.redEngineId), `red ${p.redEngineId} not in top`);
    assert.ok(top.has(p.blackEngineId), `black ${p.blackEngineId} not in top`);
  }
});

test('content pairing allows mirrors', () => {
  // Both weightedPick draws land on the strongest rung.
  const p = pickContentPairing(seqRng([0.999, 0.999]), LADDER);
  assert.equal(p.redEngineId, 'r8');
  assert.equal(p.blackEngineId, 'r8');
});

test('calibration pairing is never a mirror', () => {
  for (let i = 0; i < 200; i++) {
    const rng = seqRng([(i % 9) / 9, (i % 10) / 10, (i % 3) / 3, (i % 2) / 2]);
    const p = pickCalibrationPairing(rng, LADDER);
    assert.notEqual(p.redEngineId, p.blackEngineId);
    assert.ok(LADDER.includes(p.redEngineId));
    assert.ok(LADDER.includes(p.blackEngineId));
  }
});

test('calibration pairing favours near neighbours', () => {
  // i picked mid-ladder, delta roll < 0.7 → ±1, direction down.
  const p = pickCalibrationPairing(seqRng([4 / 9, 0.1, 0.99]), LADDER);
  const gap = Math.abs(LADDER.indexOf(p.redEngineId) - LADDER.indexOf(p.blackEngineId));
  assert.equal(gap, 1);
});

test('calibration pairing needs at least two rungs', () => {
  assert.throws(() => pickCalibrationPairing(seqRng([0]), ['solo']));
});

test('pickPairing routes by calibration ratio', () => {
  // ratio 0 → always content; ratio 1 → always calibration.
  assert.equal(pickPairing(seqRng([0.5, 0.9, 0.9]), LADDER, 0).lane, 'content');
  assert.equal(pickPairing(seqRng([0.0, 0.5, 0.5, 0.5]), LADDER, 1).lane, 'calibration');
});

test('each variant ladder is the engines its first-party bots play, and only its own', () => {
  for (const variant of [
    'xiangqi',
    'jieqi',
    'duck-xiangqi',
    'atomic-xiangqi',
    'fortress-xiangqi',
    'banqi',
    'jungle',
  ]) {
    const ladder = botLadderFor(variant);
    assert.ok(ladder, variant);
    const fronted = FIRST_PARTY_BOT_PROFILES.map((bot) => bot.engines[variant]).filter(
      (id): id is string => typeof id === 'string',
    );
    // Every offered bot is on the ladder...
    for (const id of fronted) assert.ok(ladder.includes(id), `${variant}: ${id} missing`);
    // ...and every rung is one, or (jungle's retired levels) still attributes to one.
    for (const id of ladder) {
      const bot = firstPartyBotForEngine(id);
      assert.ok(bot && Object.hasOwn(bot.engines, variant), `${variant}: ${id} is no bot's`);
    }
    if (variant !== 'jungle') assert.deepEqual(new Set(ladder), new Set(fronted), variant);
  }
  // No ladder, no fallback: a variant without one answers null, not xiangqi's.
  assert.equal(botLadderFor('jungle-flip'), null);
  assert.equal(botLadderFor('crossroads-chess'), null);
  assert.equal(botLadderFor('constructor'), null);
});
