import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { XMJ_TILE_KINDS, type XmjMeld, type XmjTile, xmjWinShape } from './xiangqi-mahjong.js';
import { xmjBotAction as current, xmjDistance, xmjUnseen } from './xiangqi-mahjong-bot.js';
import { xmjBotAction as baseline } from './xiangqi-mahjong-bot-baseline.js';
import {
  xmjMatchWalls,
  xmjPlayBotMatch,
  xmjRunBotPairs,
  xmjSummarizeBotPairs,
} from './xiangqi-mahjong-bot-match.js';
import { xmjDealInProbability } from './xiangqi-mahjong-danger.js';
import { xmjDefensiveAction } from './xiangqi-mahjong-defensive-bot.js';
import { createXmjRoomState, type XmjSeat, xmjViewFor } from './xiangqi-mahjong-room.js';

// Independently enumerate physical subsets, so repeated faces get their actual weight.
function exhaustive(
  pool: readonly XmjTile[],
  size: number,
  discard: XmjTile,
  melds: readonly XmjMeld[],
): number {
  let wins = 0;
  let total = 0;
  const visit = (at: number, hand: XmjTile[]) => {
    if (hand.length === size) {
      total += 1;
      if (xmjWinShape([...hand, discard], melds)) wins += 1;
      return;
    }
    for (let i = at; i < pool.length; i += 1) visit(i + 1, [...hand, pool[i] as XmjTile]);
  };
  visit(0, []);
  return wins / total;
}

const exposed: XmjMeld[] = [{ kind: 'sequence', tiles: ['rR', 'rH', 'rC'] }];

test('danger matches exhaustive physical enumeration, including multiplicities and overlapping shapes', () => {
  const fixtures: [XmjTile[], number, XmjMeld[]][] = [
    [['rK', 'rA', 'rE', 'rP', 'rP', 'rP', 'bP', 'bP'], 4, []],
    [['rP', 'rP', 'rP', 'rP', 'bP', 'bP', 'bP'], 4, []],
    [['rK', 'bK', 'bA', 'bA', 'rE', 'rE'], 4, []],
    [['rP', 'rP', 'rP', 'bP', 'rK', 'bK'], 1, exposed],
  ];
  for (const [pool, size, melds] of fixtures) {
    const unseen = new Map<XmjTile, number>();
    for (const tile of pool) unseen.set(tile, (unseen.get(tile) ?? 0) + 1);
    for (const tile of XMJ_TILE_KINDS) {
      assert.ok(
        Math.abs(
          xmjDealInProbability(tile, unseen, size, melds) - exhaustive(pool, size, tile, melds),
        ) < 1e-12,
        `${tile}: ${pool}`,
      );
    }
  }
  // Three of six physical tiles pair with rP. Do not condition on being ready.
  assert.equal(
    xmjDealInProbability(
      'rP',
      new Map([
        ['rP', 3],
        ['bP', 1],
        ['rK', 1],
        ['bK', 1],
      ]),
      1,
      exposed,
    ),
    0.5,
  );
});

test('danger rejects impossible models rather than silently manufacturing probabilities', () => {
  assert.throws(() => xmjDealInProbability('rP', new Map([['rP', 1]]), 4, []), RangeError);
  assert.throws(() => xmjDealInProbability('rP', new Map([['rP', -1]]), 1, exposed), RangeError);
  assert.throws(() => xmjDealInProbability('rP', new Map([['rP', 4]]), 2, []), RangeError);
});

test('baseline is the byte-for-byte bot snapshot from issue #675', () => {
  const source = readFileSync(new URL('../src/xiangqi-mahjong-bot-baseline.ts', import.meta.url));
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    '03890196e6bafd484c0c027eb2a21e91b1de16e97a1145d3eaf242d166e2beb8',
  );
  for (const seed of [1, 7, 42]) {
    const state = createXmjRoomState({ walls: xmjMatchWalls(seed), firstDealer: 'east' });
    const view = xmjViewFor(state, 'east');
    assert.deepEqual(baseline(view, 'east'), current(view, 'east'));
    assert.deepEqual(xmjDefensiveAction(view, 'east', 0), baseline(view, 'east'));
  }
});

test('challenger breaks an offensive tie toward the safer discard using only its view', () => {
  const state = createXmjRoomState({ walls: xmjMatchWalls(49), firstDealer: 'east' });
  const view = xmjViewFor(state, 'east');
  assert.deepEqual(view.hands.east, ['rA', 'rA', 'rP', 'bC', 'bP']);
  assert.equal(view.hands.west, null);
  assert.deepEqual(baseline(view, 'east'), { action: 'discard', tile: 'rP' });
  assert.deepEqual(xmjDefensiveAction(view, 'east'), { action: 'discard', tile: 'bC' });
  const unseen = xmjUnseen(view, 'east');
  for (const discard of ['rP', 'bC'] as const) {
    const rest: XmjTile[] = [...(view.hands.east ?? [])];
    rest.splice(rest.indexOf(discard), 1);
    assert.deepEqual(xmjDistance(rest, [], unseen), { short: 2, outs: 8 });
  }
  assert.ok(xmjDealInProbability('bC', unseen, 4, []) < xmjDealInProbability('rP', unseen, 4, []));
  assert.deepEqual(
    xmjDefensiveAction({ ...view, legal: { ...view.legal, selfDraw: true } }, 'east'),
    { action: 'self-draw' },
  );
  assert.throws(() => xmjDefensiveAction(view, 'east', -1), RangeError);
});

test('six-hand harness is deterministic, alternates dealers, and books kernel results', () => {
  const one = xmjPlayBotMatch(42, [baseline, xmjDefensiveAction]);
  assert.deepEqual(xmjPlayBotMatch(42, [baseline, xmjDefensiveAction]), one);
  assert.equal(one.results.length, 6);
  assert.deepEqual(
    one.results.map((r) => r.dealer),
    [0, 1, 0, 1, 0, 1],
  );
  for (const seat of [0, 1] as const) {
    assert.equal(
      one.tai[seat],
      one.results
        .filter((r) => r.winner === seat)
        .reduce((sum, r) => sum + (r.score?.total ?? 0), 0),
    );
    assert.equal(
      one.dealIns[seat],
      one.results.filter((r) => r.winner === 1 - seat && !r.selfDrawn).length,
    );
  }
  assert.equal(one.exhaustedWalls, one.results.filter((r) => r.winner === null).length);
  assert.notDeepEqual(xmjMatchWalls(42), xmjMatchWalls(43));
});

test('paired seeds swap distinct policies on identical walls', () => {
  const challengerSeats = new Set<XmjSeat>();
  const opponentSeats = new Set<XmjSeat>();
  const pair = xmjRunBotPairs(
    49,
    1,
    (view, seat) => {
      challengerSeats.add(seat);
      return xmjDefensiveAction(view, seat);
    },
    (view, seat) => {
      opponentSeats.add(seat);
      return baseline(view, seat);
    },
  )[0];
  assert.ok(pair);
  assert.deepEqual([...challengerSeats], ['east', 'west']);
  assert.deepEqual([...opponentSeats], ['west', 'east']);
  assert.deepEqual(pair.challengerEast, xmjPlayBotMatch(49, [xmjDefensiveAction, baseline]));
  assert.deepEqual(pair.challengerWest, xmjPlayBotMatch(49, [baseline, xmjDefensiveAction]));
});

test('identical policies cancel seat advantage and retain pair-level uncertainty', () => {
  const pairs = xmjRunBotPairs(9, 1, baseline, baseline);
  assert.equal(pairs.length, 1);
  const pair = pairs[0];
  assert.ok(pair);
  assert.deepEqual(pair.challengerEast.results, pair.challengerWest.results);
  assert.equal(pair.matchScore, 0.5);
  assert.equal(pair.taiDifference, 0);
  const summary = xmjSummarizeBotPairs(pairs);
  assert.equal(summary.matches, 2);
  assert.equal(summary.matchScore, 0.5);
  assert.equal(summary.paired95, null, 'one seed pair cannot establish uncertainty');
  assert.equal(summary.promote, false);
  assert.throws(() => xmjRunBotPairs(1, 0), RangeError);
  // All wins in a tiny sample still need a nondegenerate lower bound.
  const perfect = Array.from({ length: 4 }, (_, i) => ({ ...pair, seed: i, matchScore: 1 }));
  assert.ok((xmjSummarizeBotPairs(perfect).paired95?.[0] ?? 1) < 1);
  assert.equal(xmjSummarizeBotPairs(perfect).promote, false);
});

test('harness policies receive redacted views, and invalid actions fail the measurement', () => {
  let calls = 0;
  const inspect: typeof baseline = (view, seat) => {
    const wire = JSON.parse(JSON.stringify(view));
    assert.equal(wire.hands[seat === 'east' ? 'west' : 'east'], null);
    assert.equal('walls' in wire, false);
    assert.equal('wall' in wire, false);
    assert.equal(wire.status.turn, wire.turn, 'room turn must be current after each new deal');
    calls += 1;
    assert.deepEqual(xmjDefensiveAction(view, seat, 0), baseline(view, seat));
    return baseline(view, seat);
  };
  xmjPlayBotMatch(2, [inspect, inspect]);
  assert.ok(calls > 6);
  assert.throws(() => xmjPlayBotMatch(2, [() => ({ action: 'self-draw' }), baseline]), /illegal/);
  assert.throws(() => xmjMatchWalls(-1), RangeError);
});

test('paired promotion requires both the score threshold and a lower bound above half', () => {
  const pair = xmjRunBotPairs(3, 1, baseline, baseline)[0];
  assert.ok(pair);
  const win = {
    ...pair,
    challengerEast: { ...pair.challengerEast, winner: 0 as const },
    challengerWest: { ...pair.challengerWest, winner: 1 as const },
    matchScore: 1,
  };
  const loss = {
    ...pair,
    challengerEast: { ...pair.challengerEast, winner: 1 as const },
    challengerWest: { ...pair.challengerWest, winner: 0 as const },
    matchScore: 0,
  };
  const strong = Array.from({ length: 2000 }, (_, i) => ({ ...(i < 1100 ? win : loss), seed: i }));
  const summary = xmjSummarizeBotPairs(strong);
  assert.equal(summary.matchScore, 0.55);
  assert.equal(summary.wins, 2200);
  assert.equal(summary.promote, true);
  assert.ok((summary.paired95?.[0] ?? 0) > 0.5);
  assert.equal(xmjSummarizeBotPairs(strong.map((p, i) => (i === 1099 ? loss : p))).promote, false);
  const stage2 = { minimumScore: 0.6, minimumMatches: 4000 };
  assert.equal(xmjSummarizeBotPairs(strong, stage2).promote, false);
  const sixty = strong.map((pair, i) => (i < 1200 ? { ...win, seed: i } : pair));
  assert.equal(xmjSummarizeBotPairs(sixty, stage2).promote, true);
  assert.equal(xmjSummarizeBotPairs(sixty.slice(0, 1999), stage2).promote, false);
  assert.throws(() => xmjSummarizeBotPairs(strong, { minimumScore: Number.NaN }), RangeError);
});

test('exhausted hands count separately from drawn matches and matches award half for draws', () => {
  const decline: typeof baseline = (view) => {
    const tile = view.legal.discard[0];
    if (tile) return { action: 'discard', tile };
    return view.legal.pass ? { action: 'pass' } : null;
  };
  const pair = xmjRunBotPairs(5, 1, decline, decline)[0];
  assert.ok(pair);
  const summary = xmjSummarizeBotPairs([pair]);
  assert.equal(summary.matchScore, 0.5);
  assert.equal(summary.draws, 2);
  assert.equal(summary.exhaustedWalls, 12);
  assert.deepEqual(summary.dealIns, { challenger: 0, baseline: 0 });
});
