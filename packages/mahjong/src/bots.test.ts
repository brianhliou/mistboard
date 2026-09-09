import assert from 'node:assert/strict';
import test from 'node:test';

import { outcomeOf, playHand } from './autoplay.js';
import { type Bot, efficiencyBot, randomBot, seatBots, seenByOthers, viewFor } from './bots.js';
import type { Seat } from './claims.js';
import { WALL_SIZE, dealGame, shuffleWall } from './game.js';
import { runLadder, seededRng } from './ladder.js';
import { TILE_COUNT, parseTiles, tileIndex, toCounts } from './tiles.js';

const rng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
};

test('a view carries no tile a seat is not entitled to', () => {
  const game = dealGame(shuffleWall(rng(5)));
  const view = viewFor(game, 1);

  // The wall is a count, never contents.
  assert.equal(typeof view.wallRemaining, 'number');
  assert.equal(view.wallRemaining, game.wall.length);
  assert.ok(!('wall' in view), 'the view must not carry the wall');
  assert.ok(!('deadWall' in view), 'the view must not carry the dead wall');
  assert.ok(!('hands' in view), 'the view must not carry every seat’s hand');

  // Own hand only, and only own drawn tile.
  assert.deepEqual(view.hand, game.hands[1]);
  assert.equal(view.drawn, null, 'the dealer drew, not this seat');
  assert.equal(viewFor(game, 0).drawn, game.drawn);
});

test('what others have seen excludes your own hand', () => {
  // acceptance() computes live copies as 4 - held - visible. Folding the hand
  // into `visible` as well subtracts every held tile twice and silently halves
  // the count of everything the hand is waiting on.
  const game = dealGame(shuffleWall(rng(9)));
  const view = viewFor(game, 2);
  const seen = seenByOthers(view);

  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    assert.ok((seen[tile] ?? 0) + (view.hand[tile] ?? 0) <= 4, `tile ${tile} over-counted`);
  }
  // Nothing has been discarded or melded yet, so nothing is visible at all.
  assert.equal(seen.reduce((a, b) => a + b, 0), 0);
});

test('the efficiency bot discards the widest tile, not the first one', () => {
  const bot = efficiencyBot();
  const game = dealGame(shuffleWall(rng(13)));
  // 123m 456m 789m 12p 55s plus a loose 9s: the 9s is the throw.
  const hands = game.hands.map((h) => [...h]);
  hands[0] = toCounts(parseTiles('123m456m789m12p559s'));
  const staged = { ...game, hands };

  assert.equal(bot.chooseDiscard(viewFor(staged, 0)), tileIndex('s', 9));
});

test('the efficiency bot declines a claim that does not advance the hand', () => {
  const bot = efficiencyBot();
  const game = dealGame(shuffleWall(rng(17)));
  const hands = game.hands.map((h) => [...h]);
  // Already tenpai. Chowing here would break the hand open for nothing.
  hands[1] = toCounts(parseTiles('123m456m789m12p55s'));
  const staged = { ...game, hands, turn: 0 as Seat };

  const chow = {
    seat: 1 as Seat,
    kind: 'chow' as const,
    fromHand: [tileIndex('m', 5), tileIndex('m', 6)],
  };
  assert.equal(bot.chooseClaim(viewFor(staged, 1), [chow]), null);
});

test('the efficiency bot always takes a win', () => {
  const bot = efficiencyBot();
  const game = dealGame(shuffleWall(rng(19)));
  const win = { seat: 1 as Seat, kind: 'win' as const, fromHand: [] };
  const chow = { seat: 1 as Seat, kind: 'chow' as const, fromHand: [0, 1] };
  assert.equal(bot.chooseClaim(viewFor(game, 1), [chow, win]), win);
});

test('four bots play a hand to a legal end without losing a tile', () => {
  for (const seed of [2, 4, 8, 16, 32]) {
    const game = dealGame(shuffleWall(rng(seed)));
    const played = playHand(game, seatBots(() => efficiencyBot()));

    assert.ok(['won', 'exhausted'].includes(played.phase.type), `seed ${seed}`);

    let total = played.wall.length + played.deadWall.length;
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      total += (played.hands[seat] as readonly number[]).reduce((a, b) => a + b, 0);
      total += (played.discards[seat] as readonly number[]).length;
      total += (played.flowers[seat] as readonly number[]).length;
      for (const meld of played.melds[seat] as readonly { kind: string }[]) {
        total += meld.kind === 'kong' ? 4 : 3;
      }
    }
    assert.equal(total, WALL_SIZE, `seed ${seed} lost or invented a tile`);
  }
});

test('a declared win always meets the table minimum', () => {
  // The loop must never declare a hand that could not legally be declared.
  for (const seed of [3, 6, 12, 24, 48, 96]) {
    const played = playHand(dealGame(shuffleWall(rng(seed))), seatBots(() => efficiencyBot()));
    const outcome = outcomeOf(played);
    if (outcome.exhausted) continue;
    assert.ok(outcome.faan !== null, `seed ${seed} won with an unscoreable hand`);
    assert.ok((outcome.faan as number) >= 3, `seed ${seed} declared ${outcome.faan} faan`);
  }
});

test('efficiency beats random over a short run', () => {
  // Fast smoke of the calibration; the meaningful run is bots.slowtest.ts.
  const result = runLadder(
    (hand) => ({
      0: efficiencyBot(),
      1: randomBot(seededRng(50_000 + hand)),
      2: efficiencyBot(),
      3: randomBot(seededRng(90_000 + hand)),
    }) as Record<Seat, Bot>,
    60,
    400,
  );
  assert.ok(
    (result.winsByBot.efficiency ?? 0) > (result.winsByBot.random ?? 0),
    JSON.stringify(result.winsByBot),
  );
});
