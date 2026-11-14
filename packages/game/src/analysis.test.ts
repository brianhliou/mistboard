import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ABJCHESS_20261031_WIN_PCT_K,
  ABJCHESS_WIN_PCT_K,
  accuracyPercent,
  gameAccuracy,
  moveJudgment,
  RAPFI_WIN_PCT_K,
  WIN_PCT_K,
  winPercent,
  winPercentK,
} from './analysis.js';

test('winPercent is 50 at even and monotonic in cp', () => {
  assert.equal(winPercent(0, null), 50);
  assert.ok(winPercent(200, null) > 50);
  assert.ok(winPercent(-200, null) < 50);
  assert.ok(winPercent(800, null) > winPercent(200, null));
  // Null (unknown) reads as even.
  assert.equal(winPercent(null, null), 50);
});

test('winPercent maps mates through the lila mate->cp ladder', () => {
  // A mate is close to (but not exactly) certain, and closer mates are worth more.
  assert.ok(winPercent(null, 1) > 99);
  assert.ok(winPercent(null, -1) < 1);
  assert.ok(winPercent(null, 1) > winPercent(null, 9));
  // A mate always beats the cp clamp ceiling (mate-in-10+ = 1100cp > 1000cp).
  assert.ok(winPercent(null, 15) > winPercent(1000, null));
});

test('winPercent takes an engine curve constant; the default stays lila', () => {
  // The default is unchanged: 200cp on lila's curve is the ~67.6% the jieqi consistency
  // threshold was written against.
  assert.equal(winPercent(200, null), winPercent(200, null, WIN_PCT_K));
  assert.ok(Math.abs(winPercent(200, null) - 67.6) < 0.1);
  // AB-JChess's fitted curve: p = 1/(1+exp(-0.00985*cp)), so +112cp is 75%.
  assert.ok(Math.abs(winPercent(112, null, ABJCHESS_WIN_PCT_K) - 75) < 0.1);
  // The same cp means more on AB's steeper curve, and the curve stays symmetric.
  assert.ok(winPercent(150, null, ABJCHESS_WIN_PCT_K) > winPercent(150, null));
  assert.ok(
    Math.abs(
      winPercent(-150, null, ABJCHESS_WIN_PCT_K) -
        (100 - winPercent(150, null, ABJCHESS_WIN_PCT_K)),
    ) < 1e-9,
  );
  assert.equal(winPercent(null, null, ABJCHESS_WIN_PCT_K), 50);
});

test('winPercentK picks the curve from the stored analysis engine id', () => {
  assert.equal(winPercentK('ab-jchess-jieqi-analysis@0.1.0+1ae95ca6'), ABJCHESS_WIN_PCT_K);
  assert.equal(winPercentK('ab-jchess-jieqi-decisions@0.1.0+1ae95ca6'), ABJCHESS_WIN_PCT_K);
  // An id on the v0.2d net keeps v0.2b's curve; one on AB-JChess-20261031's net
  // (the jqe-lineage engine) gets its own refit, where +409cp is 75%.
  assert.equal(
    winPercentK(
      'ab-jchess-jieqi-analysis@1+fe35d87c+abjchess-20261010+nodes50000+consistent-win1+public1',
    ),
    ABJCHESS_WIN_PCT_K,
  );
  for (const id of [
    'ab-jchess-jieqi-analysis@1+efc83867+abjchess-20261030+nodes50000+consistent-win1+public1',
    'ab-jchess-jieqi-decisions@2+efc83867+abjchess-20261030+nodes20000+mpv100000+d6-public',
  ]) {
    assert.equal(winPercentK(id), ABJCHESS_20261031_WIN_PCT_K, id);
  }
  assert.ok(Math.abs(winPercent(409, null, ABJCHESS_20261031_WIN_PCT_K) - 75) < 0.1);
  assert.equal(winPercentK('pikafish-jieqi-analysis@0.4.0+e75cee3a'), WIN_PCT_K);
  assert.equal(winPercentK('pikafish'), WIN_PCT_K);
  assert.equal(winPercentK(undefined), WIN_PCT_K);
  assert.equal(winPercentK(null), WIN_PCT_K);
});

test('winPercent clamps extreme cp so it never exceeds the bounds', () => {
  assert.ok(winPercent(100000, null) <= 100);
  assert.ok(winPercent(-100000, null) >= 0);
});

test('Three Kingdoms Misty scores are expected score times 1000, not centipawns', () => {
  for (const engineId of [
    'misty-three-kingdoms-banqi',
    'misty-three-kingdoms-banqi-level-8',
    'misty-three-kingdoms-banqi-analysis@1',
    'misty-three-kingdoms-banqi-decisions@1',
  ]) {
    for (const [cp, expected] of [
      [0, 50],
      [100, 55],
      [300, 65],
      [500, 75],
      [-500, 25],
      [1000, 100],
      [-1000, 0],
      [1500, 100],
      [-1500, 0],
      [30000, 100],
      [-30000, 0],
    ] as const) {
      assert.equal(winPercent(cp, null, engineId), expected, `${engineId}: ${cp}`);
    }
    assert.equal(winPercent(null, null, engineId), 50);
    for (const mate of [1, 10, 30]) {
      assert.equal(winPercent(null, mate, engineId), 100);
      assert.equal(winPercent(null, -mate, engineId), 0);
    }
    assert.equal(winPercent(null, 0, engineId), 0);
    assert.equal(winPercent(-500, 1, engineId), 100, 'mate takes precedence over cp');
  }
});

test('a Misty 120-point swing is an inaccuracy rather than a chess-curve mistake', () => {
  const engineId = 'misty-three-kingdoms-banqi-analysis@1';
  assert.equal(moveJudgment(winPercent(0, null), winPercent(-120, null)), 'mistake');
  assert.equal(
    moveJudgment(winPercent(0, null, engineId), winPercent(-120, null, engineId)),
    'inaccuracy',
  );
});

test('engine-id win models preserve existing curves unless the score scale is confirmed', () => {
  for (const engineId of [
    'pikafish',
    'fairy-stockfish',
    'misty-banqi-analysis@0.2.5+history1',
    'misty-jungle-analysis@0.2.0',
    'misty-jungle-flip-analysis@0.2.0+history1',
    'misty-analysis@0.2.0+sf18+i200',
    'misty-unconfirmed-analysis@1',
    'misty-three-kingdoms-banqix-analysis@1',
    'ab-jchess-jieqi-analysis@0.1.0+1ae95ca6',
    'ab-jchess-jieqi-decisions@2+efc83867+abjchess-20261030+nodes20000',
    'rapfi-gomoku-analysis@1',
    undefined,
    null,
  ]) {
    const k = winPercentK(engineId);
    for (const cp of [-30000, -500, 0, 500, 30000, null]) {
      assert.equal(winPercent(cp, null, engineId), winPercent(cp, null, k));
    }
    assert.equal(winPercent(null, 3, engineId), winPercent(null, 3, k));
  }
  assert.equal(winPercentK('fairy-stockfish'), WIN_PCT_K);
});

test('accuracyPercent is 100 for a non-losing move and falls with the win drop', () => {
  assert.equal(accuracyPercent(60, 60), 100);
  assert.equal(accuracyPercent(60, 62), 100); // gained win% -> no penalty
  assert.ok(accuracyPercent(60, 40) < accuracyPercent(60, 55));
  const acc = accuracyPercent(80, 30);
  assert.ok(acc >= 0 && acc < 40);
});

test('moveJudgment thresholds blunder/mistake/inaccuracy by win drop', () => {
  assert.equal(moveJudgment(60, 58), null); // 2 pts, fine
  assert.equal(moveJudgment(60, 54), 'inaccuracy'); // 6 pts
  assert.equal(moveJudgment(60, 48), 'mistake'); // 12 pts
  assert.equal(moveJudgment(60, 44), 'blunder'); // 16 pts (lila blunder = 15+)
  assert.equal(moveJudgment(60, 30), 'blunder'); // 30 pts
  assert.equal(moveJudgment(40, 60), null); // improved, not a mistake
});

test('gameAccuracy is near-100 for a clean game and punishes a blunder harmonically', () => {
  // 12 flat moves: nobody loses win%.
  const flat = Array.from({ length: 13 }, () => 50);
  const clean = gameAccuracy(flat);
  assert.ok(clean.first > 95);
  assert.ok(clean.second > 95);

  // Same game, but the first mover throws move 7 (50 -> 10 for them).
  const blundered = [...flat];
  for (let i = 7; i < blundered.length; i += 1) blundered[i] = 10;
  const swung = gameAccuracy(blundered);
  assert.ok(swung.first < clean.first - 20); // harmonic mean makes one blunder hurt
  assert.ok(swung.second > 95); // the opponent's moves stay clean
});

test('gameAccuracy handles degenerate inputs', () => {
  assert.deepEqual(gameAccuracy([]), { first: 0, second: 0 });
  assert.deepEqual(gameAccuracy([50]), { first: 0, second: 0 });
  // One move: only the first mover has an accuracy sample. The second mover made no gradeable
  // move, so they have no errors to count → 100% (not a misleading 0%).
  const one = gameAccuracy([50, 40]);
  assert.ok(one.first > 0 && one.first < 100);
  assert.equal(one.second, 100);
});

test('gameAccuracy drops a reveal ply (null override) from the graded accuracy', () => {
  // A curve where the FIRST mover's ply-1 move looks like a big blunder (50 -> 15) but it is a
  // reveal (luck): dropping ply 1 should lift their accuracy well above the un-overridden version.
  const curve = [50, 15, 40, 45, 42];
  const graded = gameAccuracy(curve);
  const revealDropped = gameAccuracy(curve, new Map([[1, null]]));
  assert.ok(revealDropped.first > graded.first, 'dropping the unlucky reveal raises accuracy');
});

test('gameAccuracy substitutes a luck-free accuracy for a reveal ply', () => {
  // Same curve: ply 1 realized as a 50->15 crater, but the luck-free DECISION was near-perfect.
  // Overriding ply 1 with a high accuracy should grade the first mover well above the realized
  // (outcome-graded) version, and above simply dropping the ply (which adds no positive sample).
  const curve = [50, 15, 40, 45, 42];
  const realized = gameAccuracy(curve);
  const luckFree = gameAccuracy(curve, new Map([[1, 99]]));
  assert.ok(luckFree.first > realized.first, 'a luck-free decision beats the crater outcome');
});

test("Rapfi analyses are read on Rapfi's own win curve", () => {
  const id = 'rapfi-gomoku-analysis@1+1387d11312+net6bc0d1b0+n100000+t5000+h32+threads1+pv1';
  assert.equal(winPercentK(id), RAPFI_WIN_PCT_K);
  // Rapfi printed EVAL 414 beside WINRATE 0.887953 for one recorded position.
  assert.ok(Math.abs(winPercent(414, null, winPercentK(id)) - 88.8) < 0.1);
});

test('CC0 Xiangqi @6 uses its paired curve while historical and unrelated ids stay unchanged', () => {
  const id = 'pikafish-xiangqi-analysis@6';
  assert.equal(winPercentK(id), 0.00465696);
  for (const old of [1, 2, 3, 4, 5]) {
    assert.equal(winPercentK(`pikafish-xiangqi-analysis@${old}`), WIN_PCT_K);
  }
  for (const other of [
    'pikafish-xiangqi-analysis@60',
    'pikafish-xiangqi-level-6',
    'pikafish-jieqi-analysis@6',
  ]) {
    assert.equal(winPercentK(other), WIN_PCT_K);
  }
  assert.equal(moveJudgment(50, winPercent(-90, null, id)), 'mistake');
  assert.equal(
    moveJudgment(50, winPercent(-90, null, 'pikafish-xiangqi-analysis@5')),
    'inaccuracy',
  );
  assert.equal(winPercent(null, null, id), 50);
  assert.equal(winPercent(2000, null, id), winPercent(1000, null, id));
  assert.ok(winPercent(null, 1, id) > winPercent(1000, null, id));
  assert.ok(Math.abs(winPercent(-90, null, id) + winPercent(90, null, id) - 100) < 1e-9);
});

test('FFQ fitted review and decision ids select the 2026-11-13 self-play curve', () => {
  const k = 0.00518009;
  for (const kind of ['analysis', 'decisions']) {
    const id = `misty-ffq-banqi-${kind}@0.1.0+misty-ffq-banqi-level-7-n25000-classical-ms3000-masked2-winfit20261113${kind === 'decisions' ? '-d1-top-played' : ''}`;
    assert.equal(winPercentK(id), k);
    assert.ok(Math.abs(winPercent(360, null, id) - 86.5858) < 0.01);
    assert.ok(Math.abs(winPercent(-360, null, id) + winPercent(360, null, id) - 100) < 1e-10);
  }
  assert.equal(
    winPercentK(
      'misty-ffq-banqi-analysis@0.1.0+misty-ffq-banqi-level-7-n25000-classical-ms3000-masked1',
    ),
    WIN_PCT_K,
  );
  assert.equal(winPercentK('misty-banqi-analysis@0.1.0'), WIN_PCT_K);
});
