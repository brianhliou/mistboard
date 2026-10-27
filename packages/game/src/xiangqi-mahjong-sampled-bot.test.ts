import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type XmjHandState,
  type XmjMeld,
  type XmjTile,
  xmjClaim,
  xmjOrderedTiles,
  xmjSortTiles,
} from './xiangqi-mahjong.js';
import { xmjBotAction as baseline } from './xiangqi-mahjong-bot-baseline.js';
import { xmjMatchWalls } from './xiangqi-mahjong-bot-match.js';
import {
  applyXmjMove,
  createXmjRoomState,
  type XmjRoomState,
  type XmjSeat,
  xmjPendingAction,
  xmjViewFor,
} from './xiangqi-mahjong-room.js';
import {
  XMJ_SEARCH_SAMPLES,
  xmjRolloutHand,
  xmjSampledAction,
  xmjSampledDecision,
  xmjSampleHand,
  xmjScoreRaceValue,
} from './xiangqi-mahjong-sampled-bot.js';

// A complete physical tile partition near the end of the final hand. No tiles
// are fabricated: the unassigned tiles are already public in east's pond.
function position(
  east: XmjTile[],
  west: XmjTile[],
  wall: XmjTile[],
  phase: XmjHandState['phase'] = { type: 'discard', mayWin: true, drawn: null },
  melds: XmjHandState['melds'] = [[], []],
  scores: readonly [number, number] = [1, 0],
): XmjRoomState {
  const base = createXmjRoomState({ walls: xmjMatchWalls(41), firstDealer: 'east' });
  const pond = xmjOrderedTiles();
  const open = phase.type === 'claim' ? [phase.discard] : [];
  for (const tile of [
    ...east,
    ...west,
    ...wall,
    ...melds.flatMap((ms) => ms.flatMap((m) => m.tiles)),
    ...open,
  ]) {
    const index = pond.indexOf(tile);
    assert.ok(index >= 0, `impossible fixture: ${tile}`);
    pond.splice(index, 1);
  }
  const hand: XmjHandState = {
    dealer: 1,
    turn: phase.type === 'claim' ? phase.discarder : 0,
    wall,
    hands: [xmjSortTiles(east), xmjSortTiles(west)],
    melds,
    discards: [pond, open],
    drawnDiscards: [pond.map(() => false), open.map(() => false)],
    phase,
    draws: [12, 11],
    claimed: melds.some((ms) => ms.length > 0),
  };
  return {
    ...base,
    status: { type: 'playing', turn: hand.turn === 0 ? 'east' : 'west' },
    match: { ...base.match, handIndex: 5, scores, hand },
  };
}

test('search protects a final-hand lead instead of dealing into a forced win', () => {
  const state = position(['rP', 'rA', 'rE', 'bR', 'bH'], ['rP', 'rP', 'bC', 'bC'], []);
  const view = xmjViewFor(state, 'east');
  assert.deepEqual(baseline(view, 'east'), { action: 'discard', tile: 'rA' });
  const decision = xmjSampledDecision(view, 'east');
  assert.equal(XMJ_SEARCH_SAMPLES, 64);
  assert.equal(decision.samples, 64);
  assert.equal(decision.values.length, view.legal.discard.length);
  assert.equal(decision.action?.action, 'discard');
  assert.notDeepEqual(decision.action, { action: 'discard', tile: 'rP' });
  const danger = decision.values.find(
    (v) => v.action.action === 'discard' && v.action.tile === 'rP',
  );
  const safe = decision.values.find((v) => v.action.action === 'discard' && v.action.tile === 'rA');
  assert.ok(danger && safe);
  assert.equal(danger.matchScore, 0);
  assert.equal(safe.matchScore, 1);
  assert.ok(safe.value > danger.value);
});

test('permuting actual unseen hands and wall cannot change the whole search result', () => {
  const state = createXmjRoomState({ walls: xmjMatchWalls(7), firstDealer: 'east' });
  const hidden = [...state.match.hand.hands[1], ...state.match.hand.wall].reverse();
  const other = {
    ...state,
    match: {
      ...state.match,
      hand: {
        ...state.match.hand,
        hands: [state.match.hand.hands[0], hidden.slice(0, 4)] as const,
        wall: hidden.slice(4),
      },
    },
  };
  const view = xmjViewFor(state, 'east');
  assert.deepEqual(JSON.stringify(xmjViewFor(other, 'east')), JSON.stringify(view));
  const options = { samples: 2, seed: 19 };
  assert.deepEqual(
    xmjSampledDecision(view, 'east', options),
    xmjSampledDecision(xmjViewFor(other, 'east'), 'east', options),
  );
  assert.deepEqual(
    xmjSampledDecision(
      { ...view, id: 'different-room', moveNumber: 999, nextHandAt: 999 },
      'east',
      options,
    ),
    xmjSampledDecision(view, 'east', options),
    'room identity, clocks and bookkeeping must not salt the samples',
  );
  const order = (decision: ReturnType<typeof xmjSampledDecision>) =>
    [...decision.values].sort((a, b) =>
      JSON.stringify(a.action).localeCompare(JSON.stringify(b.action)),
    );
  assert.deepEqual(
    order(
      xmjSampledDecision(
        { ...view, legal: { ...view.legal, discard: [...view.legal.discard].reverse() } },
        'east',
        options,
      ),
    ),
    order(xmjSampledDecision(view, 'east', options)),
    'each candidate must use the same samples, independent of candidate ordering',
  );
});

test('sampled partitions conserve every physical tile and all visible information', () => {
  let state = createXmjRoomState({ walls: xmjMatchWalls(49), firstDealer: 'east' });
  state = applyXmjMove(state, { action: 'discard', tile: 'rP', by: 'east', at: 1 });
  for (const seat of ['east', 'west'] as const) {
    const view = xmjViewFor(state, seat);
    for (const seed of [1, 2, 3]) {
      const hand = xmjSampleHand(view, seat, seed);
      const all = [
        ...hand.hands.flat(),
        ...hand.wall,
        ...hand.discards.flat(),
        ...hand.melds.flat().flatMap((m) => m.tiles),
      ];
      assert.deepEqual(xmjSortTiles(all), xmjOrderedTiles());
      assert.deepEqual(hand.hands[seat === 'east' ? 0 : 1], view.hands[seat]);
      assert.equal(hand.wall.length, view.wallCount);
      assert.equal(
        hand.hands[seat === 'east' ? 1 : 0].length,
        view.handCounts[seat === 'east' ? 'west' : 'east'],
      );
    }
  }
});

test('public tile bookkeeping reconstructs draw counts after claims remove pond tiles', () => {
  let claims = 0;
  for (const seed of [1, 7, 42]) {
    let state = createXmjRoomState({ walls: xmjMatchWalls(seed), firstDealer: 'east' });
    while (!state.match.over) {
      if (state.match.between) {
        const pending = xmjPendingAction(state);
        assert.ok(pending);
        state = applyXmjMove(state, pending.move);
        continue;
      }
      const hand = state.match.hand;
      const seat: XmjSeat =
        hand.phase.type === 'claim'
          ? hand.phase.discarder === 0
            ? 'west'
            : 'east'
          : hand.turn === 0
            ? 'east'
            : 'west';
      const view = xmjViewFor(state, seat);
      const sampled = xmjSampleHand(view, seat, 9);
      assert.deepEqual(sampled.draws, hand.draws);
      assert.equal(sampled.claimed, hand.claimed);
      assert.deepEqual(sampled.melds, hand.melds);
      const action = baseline(view, seat);
      const move = action
        ? { ...action, by: seat, at: state.moveNumber * 2000 }
        : xmjPendingAction(state)?.move;
      assert.ok(move);
      if (move.action === 'claim') claims += 1;
      const next = applyXmjMove(state, move);
      assert.notEqual(next, state);
      state = next;
    }
  }
  assert.ok(claims > 0);
});

test('every simulated seat gets only its own serialized view', () => {
  const state = createXmjRoomState({ walls: xmjMatchWalls(42), firstDealer: 'east' });
  const seats = new Set<string>();
  const result = xmjRolloutHand(state.match.hand, (view, seat) => {
    const wire = JSON.parse(JSON.stringify(view));
    seats.add(seat);
    assert.equal(wire.perspective, seat);
    assert.equal(wire.hands[seat === 'east' ? 'west' : 'east'], null);
    assert.equal('wall' in wire, false);
    assert.equal('walls' in wire, false);
    return baseline(view, seat);
  });
  assert.deepEqual([...seats].sort(), ['east', 'west']);
  assert.ok(result.phase.type === 'won' || result.phase.type === 'exhausted');
  assert.throws(
    () => xmjRolloutHand(state.match.hand, () => ({ action: 'self-draw' })),
    /illegal/i,
  );
});

test('claim search evaluates pass and every set, then discards without drawing or self-winning', () => {
  const state = position(['rR', 'rH', 'bA', 'bE'], ['rP', 'bP', 'bP', 'rA'], ['rP'], {
    type: 'claim',
    discarder: 1,
    discard: 'rC',
  });
  const view = xmjViewFor(state, 'east');
  const result = xmjSampledDecision(view, 'east', { samples: 4 });
  assert.deepEqual(result.values.map((v) => v.action.action).sort(), ['claim', 'pass']);
  const claim = view.legal.claims.find((c) => c.kind === 'chow');
  assert.ok(claim);
  const claimed = xmjClaim(state.match.hand, claim);
  assert.equal(claimed.wall.length, 1);
  assert.equal(claimed.hands[0].length, 2);
  assert.deepEqual(claimed.phase, { type: 'discard', mayWin: false, drawn: null });
  assert.equal(claimed.discards[1].length, 0);
  let first = true;
  xmjRolloutHand(claimed, (next, seat) => {
    if (first) {
      first = false;
      assert.equal(seat, 'east');
      assert.equal(next.wallCount, 1);
      assert.equal(next.legal.selfDraw, false);
      assert.equal(next.legal.pass, false);
      assert.equal(next.legal.discard.length, 2);
    }
    return baseline(next, seat);
  });
  assert.equal(first, false);
});

test('empty walls permit the last claim, while passing ends the hand', () => {
  const state = position(['rR', 'rH', 'bA', 'bE'], ['rP', 'bP', 'bP', 'rA'], [], {
    type: 'claim',
    discarder: 1,
    discard: 'rC',
  });
  const result = xmjSampledDecision(xmjViewFor(state, 'east'), 'east', { samples: 4 });
  assert.equal(result.values.length, 2);
  for (const value of result.values) assert.ok(Number.isFinite(value.value));
  const passed = xmjRolloutHand(state.match.hand, () => ({ action: 'pass' }));
  assert.equal(passed.phase.type, 'exhausted');
});

test('forced self-draws and discard wins bypass sampling, including on the last tile', () => {
  const won = position(['rR', 'rH', 'rC', 'bA', 'bA'], ['rP', 'bP', 'bP', 'rA'], []);
  assert.deepEqual(xmjSampledDecision(xmjViewFor(won, 'east'), 'east'), {
    action: { action: 'self-draw' },
    samples: 0,
    values: [],
  });
  const win = position(['rR', 'rH', 'rC', 'bA'], ['rP', 'bP', 'bP', 'rA'], [], {
    type: 'claim',
    discarder: 1,
    discard: 'bA',
  });
  assert.deepEqual(xmjSampledAction(xmjViewFor(win, 'east'), 'east'), {
    action: 'claim',
    kind: 'win',
    fromHand: [],
  });
  assert.equal(xmjSampledAction(xmjViewFor(win, 'west'), 'west'), null);
});

test('score-race value includes comeback loss and respects a banked lead', () => {
  assert.ok(xmjScoreRaceValue(1) > xmjScoreRaceValue(0));
  assert.ok(xmjScoreRaceValue(0) > xmjScoreRaceValue(-1));
  const safeLead = xmjScoreRaceValue(1);
  const riskyLead = (xmjScoreRaceValue(8) + xmjScoreRaceValue(-1)) / 2;
  assert.ok(safeLead > riskyLead, 'a bigger mean tai gain can still lose the score race');
  assert.equal(xmjScoreRaceValue(0), 0.5);
});

test('sampling rejects inconsistent tile models and invalid budgets', () => {
  const state = createXmjRoomState({ walls: xmjMatchWalls(7), firstDealer: 'east' });
  const view = xmjViewFor(state, 'east');
  for (const samples of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => xmjSampledDecision(view, 'east', { samples }), RangeError);
  }
  assert.throws(() => xmjSampleHand({ ...view, wallCount: 0 }, 'east', 1), /tile|pool/i);
  const meld: XmjMeld = { kind: 'sequence', tiles: ['rK', 'rA', 'rE'], claimed: 'rE' };
  assert.throws(
    () => xmjSampleHand({ ...view, melds: { ...view.melds, west: [meld] } }, 'east', 1),
    /tile|pool/i,
  );
});
