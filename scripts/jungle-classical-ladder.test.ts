import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyJungleMove,
  createInitialJungleState,
  engineUciToJungleMove,
  getJungleLegalMoves,
} from '@mistboard/game';
import {
  buildJungleClassicalGoCommand,
  JUNGLE_CLASSICAL_POLICIES,
  jungleClassicalSeed,
} from '../packages/game/src/jungle-classical-levels.js';
import { type CalibrationGame, pairedOpening, summarize } from './jungle-classical-ladder.js';

test('paired openings are reproducible, diverse, legal, and unfinished', () => {
  const distinct = new Set<string>();
  for (let pair = 0; pair < 60; pair++) {
    const opening = pairedOpening(pair, 917);
    assert.deepEqual(opening, pairedOpening(pair, 917));
    let state = createInitialJungleState('test');
    for (const uci of opening) {
      const move = engineUciToJungleMove(uci)!;
      assert.ok(getJungleLegalMoves(state).some((m) => m.from === move.from && m.to === move.to));
      state = applyJungleMove(state, move);
      assert.equal(state.status.type, 'playing');
    }
    distinct.add(opening.join(' '));
  }
  assert.equal(distinct.size, 60);
});

test('top search command retains the shipped budget and noisy commands retain their seed', () => {
  assert.equal(
    buildJungleClassicalGoCommand(JUNGLE_CLASSICAL_POLICIES[6]!, 1),
    'go nodes 5000000 movetime 6000',
  );
  assert.match(
    buildJungleClassicalGoCommand(JUNGLE_CLASSICAL_POLICIES[0]!, 42, 0),
    /movetime 0 depth 1 noise 1000 seed 42$/,
  );
  assert.throws(() => buildJungleClassicalGoCommand(JUNGLE_CLASSICAL_POLICIES[0]!, -1));
  assert.throws(() => buildJungleClassicalGoCommand(JUNGLE_CLASSICAL_POLICIES[0]!, 1, -1));
  assert.equal(jungleClassicalSeed('game', 4, 2), jungleClassicalSeed('game', 4, 2));
  assert.notEqual(jungleClassicalSeed('game', 4, 2), jungleClassicalSeed('game', 5, 2));
});

test('paired summary retains draws and excludes incomplete and censored pairs', () => {
  const record = (
    pair: number,
    highSeat: 'red' | 'black',
    winner: 'red' | 'black' | null,
  ): CalibrationGame => ({
    key: `${pair}:${highSeat}`,
    low: 1,
    high: 2,
    pair,
    highSeat,
    opening: [String(pair)],
    moves: [],
    decisions: [],
    winner,
    reason: 'test',
    censored: false,
  });
  const summary = summarize([
    record(0, 'red', 'red'),
    record(0, 'black', null), // 0.75
    record(1, 'red', 'black'),
    record(1, 'black', 'red'), // 0
    record(2, 'red', 'red'), // incomplete: excluded
    record(3, 'red', 'red'),
    { ...record(3, 'black', null), censored: true },
  ])[0]!;
  assert.equal(summary.completePairs, 2);
  assert.equal(summary.highScore, 0.375);
  assert.equal(summary.draws, 1);
  assert.equal(summary.censored, 1);
  assert.equal(summary.separated, false);
});
