import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KATAGO_JUNGLE_ENGINE_ID,
  KATAGO_JUNGLE_TIER_LIST,
  katagoJungleTierFor,
  katagoMoveFromReplies,
} from './jungle-katago-engine.js';

test('the move is the last two vertex replies, mirrored back into our coordinates', () => {
  // A real transcript: two parameter acknowledgements and a setfen, all empty,
  // then the piece and the square. G5 -> D5 there is a5 -> d5 here, the sideways
  // tiger jump from match game 67.
  assert.equal(katagoMoveFromReplies(['= ', '= ', '= ', '= G5', '= D5']), 'a5d5');
  assert.equal(katagoMoveFromReplies(['= ', '= A1', '= B1']), 'g1f1');
});

test('a pass, a resignation or an error is no move rather than a guess', () => {
  // The engine answers "pass" or "resign" at a terminal, and "?" on a refusal.
  // Half a move is the dangerous case: one vertex and one word would become a
  // plausible-looking move if the parser took whatever it could find.
  for (const replies of [
    ['= ', '= pass'],
    ['= ', '= resign', '= resign'],
    ['? illegal move'],
    ['= ', '= G5'],
    [],
  ]) {
    assert.equal(katagoMoveFromReplies(replies), null, JSON.stringify(replies));
  }
});

test('an out-of-board vertex is refused, not wrapped around', () => {
  // The board is 7 wide; H and rank 0 do not exist. A lenient parse would map
  // them onto a real square and hand the guard a legal-looking wrong move.
  assert.equal(katagoMoveFromReplies(['= H1', '= A1']), null);
  assert.equal(katagoMoveFromReplies(['= A0', '= A1']), null);
});

test('the shipped tier is the measured one, and it is the only one a room can take', () => {
  // 150 visits scored 0.690 against MistyJungle over 50 games; 6 s is the ceiling
  // the prod box needs for it (see the file header). If either moves, the bot is
  // not the engine the challenge was settled against.
  const tier = katagoJungleTierFor(KATAGO_JUNGLE_ENGINE_ID);
  assert.ok(tier);
  assert.equal(tier.visits, 150);
  assert.equal(tier.movetimeCapMs, 6_000);
  assert.equal(KATAGO_JUNGLE_TIER_LIST.length, 1);
  assert.equal(katagoJungleTierFor('katago-jungle-level-2'), null);
  assert.equal(katagoJungleTierFor(undefined), null);
});
