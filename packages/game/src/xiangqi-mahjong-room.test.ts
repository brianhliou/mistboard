import assert from 'node:assert/strict';
import test from 'node:test';
import { type XmjTile, xmjOrderedTiles, xmjShuffle } from './xiangqi-mahjong.js';
import { xmjBotAction, xmjBotDiscard, xmjDistance, xmjUnseen } from './xiangqi-mahjong-bot.js';
import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  isXmjMove,
  isXmjRoomSetup,
  XMJ_BETWEEN_HANDS_MS,
  XMJ_CLAIM_WINDOW_MS,
  XMJ_SEATS,
  type XmjAction,
  type XmjMove,
  type XmjRoomSetup,
  type XmjRoomState,
  type XmjSeat,
  xmjClaimant,
  xmjClockOwner,
  xmjIsLegalMove,
  xmjMoveFromMessage,
  xmjPendingAction,
  xmjSeatMayAct,
  xmjViewFor,
} from './xiangqi-mahjong-room.js';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wallWith(dealer: XmjTile[], other: XmjTile[], draws: XmjTile[] = []): XmjTile[] {
  const rest = xmjOrderedTiles();
  for (const tile of [...dealer, ...other, ...draws]) {
    const at = rest.indexOf(tile);
    assert.ok(at >= 0, `no ${tile} left in the set`);
    rest.splice(at, 1);
  }
  return [...dealer, ...other, ...draws, ...rest];
}

function play(state: XmjRoomState, by: XmjSeat, action: XmjAction, at = 1_000): XmjRoomState {
  const move = { ...action, by, at } as XmjMove;
  assert.ok(xmjSeatMayAct(state, by), `${by} may not act`);
  assert.ok(xmjIsLegalMove(state, move), `illegal: ${JSON.stringify(move)}`);
  const next = applyXmjMove(state, move);
  assert.notEqual(next, state);
  return next;
}

/** Whichever seat has something to do, by bot. Null when nobody does. */
function botStep(state: XmjRoomState, at: number): XmjRoomState | null {
  for (const seat of XMJ_SEATS) {
    const action = xmjBotAction(xmjViewFor(state, seat), seat);
    if (action) return play(state, seat, action, at);
  }
  return null;
}

test('a fresh setup is eight full walls and passes its own validator', () => {
  const setup = createXmjSetup(seeded(1));
  assert.equal(setup.walls.length, 8);
  assert.ok(isXmjRoomSetup(setup));
  assert.ok(!isXmjRoomSetup({ ...setup, walls: [setup.walls[0]?.slice(1)] }));
  assert.ok(!isXmjRoomSetup({ ...setup, firstDealer: 'north' }));
});

test('a seat sees its own tiles, never the other hand or the other seat’s draw', () => {
  const setup: XmjRoomSetup = { walls: [xmjShuffle(seeded(2))], firstDealer: 'east' };
  const state = createXmjRoomState(setup, 'xmj_test');
  const east = xmjViewFor(state, 'east');
  const west = xmjViewFor(state, 'west');
  assert.equal(east.hands.east?.length, 5);
  assert.equal(east.hands.west, null);
  assert.equal(west.hands.east, null);
  assert.equal(west.handCounts.east, 5);
  assert.equal(east.wallCount, 23);
  assert.ok(east.legal.discard.length > 0);
  assert.deepEqual(west.legal.discard, []);
  assert.equal(xmjViewFor(state, 'spectator').hands.east, null);
  assert.equal(JSON.stringify(east).includes('walls'), false);

  // After east discards, west draws; east must not learn the drawn tile.
  const tile = east.legal.discard[0] as XmjTile;
  let next = play(state, 'east', { action: 'discard', tile });
  if (next.match.hand.phase.type === 'claim') {
    next = play(next, 'west', { action: 'pass' });
  }
  const after = xmjViewFor(next, 'east');
  assert.equal(after.phase.type, 'discard');
  if (after.phase.type === 'discard') assert.equal(after.phase.drawn, null);
  const own = xmjViewFor(next, 'west');
  if (own.phase.type === 'discard') assert.notEqual(own.phase.drawn, null);
});

test('a claim window belongs to the claimant; the discarder only times it out', () => {
  const wall = wallWith(['bE', 'rA', 'rR', 'bH', 'rC'], ['bK', 'bA', 'rP', 'rH'], ['rH']);
  let state = createXmjRoomState({ walls: [wall], firstDealer: 'east' });
  state = play(state, 'east', { action: 'discard', tile: 'bE' }, 5_000);
  assert.equal(xmjClaimant(state), 'west');
  assert.equal(state.windowClosesAt, 5_000 + XMJ_CLAIM_WINDOW_MS);
  assert.equal(xmjClockOwner(state), null);
  // The discarder cannot pass or claim for the claimant.
  assert.ok(!xmjIsLegalMove(state, { by: 'east', at: 1, action: 'pass' }));
  assert.ok(
    !xmjIsLegalMove(state, {
      by: 'east',
      at: 1,
      action: 'claim',
      kind: 'chow',
      fromHand: ['bK', 'bA'],
    }),
  );
  // The runtime's timeout is the discarder's, and acts as a pass.
  const pending = xmjPendingAction(state);
  assert.equal(pending?.color, 'east');
  assert.equal(pending?.at, 5_000 + XMJ_CLAIM_WINDOW_MS);
  const timedOut = applyXmjMove(state, pending?.move as XmjMove);
  assert.equal(timedOut.match.hand.turn, 1);
  assert.equal(timedOut.match.hand.hands[1].length, 5);
  assert.equal(timedOut.windowClosesAt, null);
  // A client cannot send a timeout.
  assert.equal(xmjMoveFromMessage({ action: 'timeout' }), null);
});

test('claiming a chow through the room exposes the set and skips the draw', () => {
  const wall = wallWith(['bE', 'rA', 'rR', 'bH', 'rC'], ['bK', 'bA', 'rP', 'rH'], ['rH']);
  let state = createXmjRoomState({ walls: [wall], firstDealer: 'east' });
  state = play(state, 'east', { action: 'discard', tile: 'bE' });
  const view = xmjViewFor(state, 'west');
  assert.deepEqual(
    view.legal.claims.map((c) => c.kind),
    ['chow'],
  );
  const message = xmjMoveFromMessage({ action: 'chow', tiles: ['bK', 'bA'] });
  assert.ok(message);
  state = play(state, 'west', message as XmjAction);
  const after = xmjViewFor(state, 'west');
  assert.equal(after.melds.west.length, 1);
  assert.deepEqual(after.hands.west, ['rH', 'rP']);
  assert.deepEqual(after.discards.east, []);
  assert.equal(after.turn, 'west');
  assert.equal(xmjClockOwner(state), 'west');
});

test('a won hand pauses the match until both seats are ready or the deadline passes', () => {
  // East (dealer) holds 帥仕相 + 兵兵 at the deal: 天胡.
  const walls = [
    wallWith(['rK', 'rA', 'rE', 'rP', 'rP'], ['bR', 'bH', 'bC', 'bA']),
    xmjShuffle(seeded(4)),
  ];
  let state = createXmjRoomState({ walls, firstDealer: 'east' });
  assert.ok(xmjViewFor(state, 'east').legal.selfDraw);
  state = play(state, 'east', { action: 'self-draw' }, 2_000);
  const view = xmjViewFor(state, 'west');
  assert.equal(view.between, true);
  assert.deepEqual(view.scores, { east: 6, west: -6 });
  assert.deepEqual(view.hands.east, ['rK', 'rA', 'rE', 'rP', 'rP']);
  assert.equal(state.nextHandAt, 2_000 + XMJ_BETWEEN_HANDS_MS);
  assert.equal(xmjClockOwner(state), null);

  const one = play(state, 'west', { action: 'next-hand' });
  assert.equal(one.match.between, true);
  assert.ok(!xmjIsLegalMove(one, { by: 'west', at: 1, action: 'next-hand' }));
  const both = play(one, 'east', { action: 'next-hand' });
  assert.equal(both.match.between, false);
  assert.equal(both.match.handIndex, 1);
  // The dealer won, so the dealer keeps the deal.
  assert.equal(both.match.hand.dealer, 0);
  assert.equal(both.nextHandAt, null);

  const pending = xmjPendingAction(one);
  assert.equal(pending?.at, 2_000 + XMJ_BETWEEN_HANDS_MS);
  const dealt = applyXmjMove(one, pending?.move as XmjMove);
  assert.equal(dealt.match.handIndex, 1);
});

test('the match finishes on points after its last hand', () => {
  const wall = wallWith(['rK', 'rA', 'rE', 'rP', 'rP'], ['bR', 'bH', 'bC', 'bA']);
  let state = createXmjRoomState({ walls: [wall], firstDealer: 'east' });
  state = play(state, 'east', { action: 'self-draw' });
  assert.deepEqual(state.status, { type: 'finished', winner: 'east', reason: 'points' });
  assert.equal(xmjSeatMayAct(state, 'east'), false);
  assert.equal(xmjPendingAction(state), null);
  // Finished: both hands face up for everybody.
  assert.deepEqual(xmjViewFor(state, 'spectator').hands.west, ['bA', 'bR', 'bH', 'bC']);
});

test('wire parsing refuses junk and moves round-trip the structural check', () => {
  assert.equal(xmjMoveFromMessage({ action: 'discard', tiles: ['zz'] }), null);
  assert.equal(xmjMoveFromMessage({ action: 'discard', tiles: ['rP', 'rP'] }), null);
  assert.equal(xmjMoveFromMessage({ action: 'kong', tiles: ['rP', 'rP', 'rP'] }), null);
  assert.ok(isXmjMove({ by: 'west', at: 3, action: 'discard', tile: 'bC' }));
  assert.ok(
    isXmjMove({ by: 'east', at: 3, action: 'claim', kind: 'pung', fromHand: ['rP', 'rP'] }),
  );
  assert.ok(!isXmjMove({ by: 'south', at: 3, action: 'pass' }));
  assert.ok(!isXmjMove({ by: 'east', at: 3, action: 'claim', kind: 'kong', fromHand: [] }));
});

test('the bot wins when it can and keeps the tiles that are closest to a win', () => {
  // Unseen from the holder's side: every copy not in this hand.
  const hand: XmjTile[] = ['rK', 'rA', 'rE', 'rP', 'bR'];
  const unseen = new Map<XmjTile, number>();
  for (const tile of xmjOrderedTiles()) unseen.set(tile, (unseen.get(tile) ?? 0) + 1);
  for (const tile of hand) unseen.set(tile, (unseen.get(tile) ?? 0) - 1);
  // 帥仕相 + 兵: one tile short (another 兵).
  assert.equal(xmjDistance(['rK', 'rA', 'rE', 'rP'], [], unseen).short, 1);
  // 帥仕相兵 or 帥仕相車 are both one short; four 兵 are unseen and one 車.
  assert.equal(xmjBotDiscard(hand, [], hand, unseen), 'bR');

  const wall = wallWith(['rK', 'rA', 'rE', 'rP', 'rP'], ['bR', 'bH', 'bC', 'bA']);
  const state = createXmjRoomState({ walls: [wall], firstDealer: 'east' });
  assert.deepEqual(xmjBotAction(xmjViewFor(state, 'east'), 'east'), { action: 'self-draw' });
  assert.equal(xmjBotAction(xmjViewFor(state, 'west'), 'west'), null);
});

test('the bot claims a set only when it gets strictly closer', () => {
  // West holds 將士 + 兵 + 傌: two short. 象 on the table makes 將士象, then one short.
  const wall = wallWith(['bE', 'rA', 'rR', 'bH', 'rC'], ['bK', 'bA', 'rP', 'rH'], ['rH']);
  let state = createXmjRoomState({ walls: [wall], firstDealer: 'east' });
  state = play(state, 'east', { action: 'discard', tile: 'bE' });
  const view = xmjViewFor(state, 'west');
  assert.equal(xmjDistance(view.hands.west ?? [], [], xmjUnseen(view, 'west')).short, 2);
  assert.deepEqual(xmjBotAction(view, 'west'), {
    action: 'claim',
    kind: 'chow',
    fromHand: ['bK', 'bA'],
  });
});

test('two bots play 200 seeded matches to the end with zero-sum scores', () => {
  let wins = 0;
  let exhausted = 0;
  let claims = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const random = seeded(seed);
    let state = createXmjRoomState(createXmjSetup(random), `m${seed}`);
    let at = 0;
    for (let step = 0; step < 2_000 && state.status.type === 'playing'; step += 1) {
      at += 500;
      if (state.lastMove?.action === 'claim') claims += 1;
      const next = botStep(state, at);
      assert.ok(next, `seed ${seed}: nobody can act at step ${step}`);
      state = next;
    }
    assert.equal(state.status.type, 'finished', `seed ${seed} did not finish`);
    const { match } = state;
    assert.equal(match.results.length, 8);
    assert.equal(match.scores[0] + match.scores[1], 0);
    for (const result of match.results) {
      if (result.winner === null) exhausted += 1;
      else wins += 1;
    }
  }
  // Sanity on the bot, not a rule: most hands should be won, and some claimed.
  assert.ok(wins > exhausted, `wins ${wins}, exhausted ${exhausted}`);
  assert.ok(claims > 0);
});
