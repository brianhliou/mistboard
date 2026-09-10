import assert from 'node:assert/strict';
import test from 'node:test';

import { type Bot, efficiencyBot, randomBot } from './bots.js';
import type { Seat } from './claims.js';
import { runLadder, seededRng } from './ladder.js';

/**
 * The calibration the ladder rests on. Slow by design: this is the EvE run, not
 * a unit test, so it sits outside the CI unit suite the way the puzzle corpus
 * checks do. Run with `npm run test:ladder`.
 */
test('efficiency beats random over a long run', () => {
  const result = runLadder(
    (hand) =>
      ({
        0: efficiencyBot(),
        1: randomBot(seededRng(50_000 + hand)),
        2: efficiencyBot(),
        3: randomBot(seededRng(90_000 + hand)),
      }) as Record<Seat, Bot>,
    600,
    7_000,
  );

  const efficiency = result.winsByBot.efficiency ?? 0;
  const random = result.winsByBot.random ?? 0;
  const share = efficiency / Math.max(1, result.decided);

  console.log(
    `  efficiency ${efficiency} / random ${random} of ${result.decided} decided ` +
      `(${(share * 100).toFixed(1)}%), ${result.exhausted}/${result.hands} exhausted`,
  );

  assert.ok(result.decided > 0, 'every hand exhausted, so nothing was measured');
  assert.ok(share > 0.6, `efficiency took only ${(share * 100).toFixed(1)}% of wins`);
});
