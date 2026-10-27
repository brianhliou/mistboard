import assert from 'node:assert/strict';
import test from 'node:test';
import {
  XMJ_MATCH_HANDS,
  XMJ_TAI_TABLE,
  type XmjTile,
  xmjOrderedTiles,
  xmjShuffle,
} from './xiangqi-mahjong.js';
import { xmjBotAction, xmjBotDiscard, xmjDistance, xmjUnseen } from './xiangqi-mahjong-bot.js';
import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  isXmjMove,
  isXmjRoomSetup,
  XMJ_BETWEEN_HANDS_MS,
  XMJ_CLAIM_PAUSE_MS,
  XMJ_SEATS,
  type XmjAction,
  type XmjMove,
  type XmjRoomSetup,
  type XmjRoomState,
  type XmjSeat,
  xmjAnswerAt,
  xmjClaimAnswerEarliestAt,
  xmjClaimant,
  xmjClockOwner,
  xmjIsLegalMove,
  xmjMoveFromMessage,
  xmjPendingAction,
  xmjReviewViewFor,
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

/**
 * Whichever seat has something to do, by bot; else the runtime's deadline move
 * (a window with nothing to claim settles that way). Null when nobody does.
 */
function botStep(state: XmjRoomState, at: number): XmjRoomState | null {
  for (const seat of XMJ_SEATS) {
    const action = xmjBotAction(xmjViewFor(state, seat), seat);
    if (action) return play(state, seat, action, at);
  }
  const pending = xmjPendingAction(state);
  return pending ? applyXmjMove(state, pending.move) : null;
}

test('a fresh setup is one full wall per match hand and passes its own validator', () => {
  const setup = createXmjSetup(seeded(1));
  assert.equal(setup.walls.length, XMJ_MATCH_HANDS);
  assert.ok(isXmjRoomSetup(setup));
  assert.ok(!isXmjRoomSetup({ ...setup, walls: [setup.walls[0]?.slice(1)] }));
  assert.ok(!isXmjRoomSetup({ ...setup, firstDealer: 'north' }));
});

test('table 3 accepts an atomic declaration only by explicit setup; new rooms stay on table 2', () => {
  assert.equal(XMJ_TAI_TABLE, 2);
  for (const correspondence of [false, true]) {
    assert.equal(createXmjSetup(seeded(1), { correspondence }).taiTable, 2);
  }
  const wall = wallWith(['rK', 'rA', 'rE', 'rP', 'bH'], ['bK', 'bA', 'bE', 'bR']);
  const setup = { walls: [wall], firstDealer: 'east', taiTable: 3 } as const;
  assert.ok(isXmjRoomSetup(setup), 'an explicitly stamped table-3 setup is accepted');
  const move = xmjMoveFromMessage({ action: 'declare-ready', tiles: ['bH'] });
  assert.ok(move, 'declaration carries its discard in one move');
  assert.ok(isXmjMove(move));
  const start = createXmjRoomState(setup);
  const declared = play(start, 'east', move);
  assert.equal(declared.match.hand.phase.type, 'claim');
  assert.deepEqual(declared.match.hand.hands[0], ['rK', 'rA', 'rE', 'rP']);
  assert.deepEqual(xmjViewFor(declared, 'east').declared, { east: true, west: false });
  assert.deepEqual(declared.ready, [], 'declaration is separate from next-hand readiness');
});

test('table-3 eligibility is owner-only; older tables retain their serialized payload shape', () => {
  const wall = wallWith(['rK', 'rA', 'rE', 'rP', 'bH'], ['bK', 'bA', 'bE', 'bR']);
  const setup = { walls: [wall], firstDealer: 'east' } as const;
  const state = createXmjRoomState({ ...setup, taiTable: 3 });
  assert.ok(xmjViewFor(state, 'east').legal.declareReady?.includes('bH'));
  for (const seat of ['west', 'spectator'] as const) {
    const view = JSON.parse(JSON.stringify(xmjViewFor(state, seat)));
    assert.deepEqual(view.legal.declareReady, []);
    assert.deepEqual(view.declared, { east: false, west: false });
    for (const tile of ['rK', 'rA', 'rE', 'rP', 'bH']) {
      assert.ok(!JSON.stringify(view).includes(`"${tile}"`), `${seat} sees ${tile}`);
    }
  }
  for (const stamp of [{}, { taiTable: 1 }, { taiTable: 2 }] as const) {
    const legacy = createXmjRoomState({ ...setup, ...stamp });
    for (const seat of ['east', 'west', 'spectator'] as const) {
      const view = JSON.parse(JSON.stringify(xmjViewFor(legacy, seat)));
      assert.equal('declared' in view, false);
      assert.deepEqual(Object.keys(view.legal), [
        'discard',
        'selfDraw',
        'claims',
        'pass',
        'nextHand',
      ]);
    }
    const declare = { by: 'east', at: 1, action: 'declare-ready', tile: 'bH' } as const;
    assert.equal(xmjIsLegalMove(legacy, declare), false);
    assert.equal(applyXmjMove(legacy, declare), legacy);
  }
});

test('table-3 locked nonwinning draws have persisted pending discards and deterministic replay', () => {
  const wall = wallWith(['rK', 'rA', 'rE', 'rP', 'bH'], ['bK', 'bA', 'bE', 'bR'], ['bP', 'rA']);
  const setup = { walls: [wall], firstDealer: 'east', taiTable: 3 } as const;
  const moves: XmjMove[] = [
    { by: 'east', at: 1_000, action: 'declare-ready', tile: 'bH' },
    { by: 'west', at: 3_000, action: 'pass' },
    { by: 'west', at: 4_000, action: 'discard', tile: 'bR' },
    { by: 'east', at: 6_000, action: 'pass' },
  ];
  let state = createXmjRoomState(setup);
  for (const move of moves) state = play(state, move.by, move, move.at);
  assert.deepEqual(xmjViewFor(state, 'east').legal.discard, ['rA']);
  assert.deepEqual(xmjViewFor(state, 'east').legal.declareReady, []);
  for (const action of [
    { action: 'discard', tile: 'rK' },
    { action: 'discard', tile: 'rA', handCopy: true },
    { action: 'declare-ready', tile: 'rA' },
  ] as const) {
    const illegal = { ...action, by: 'east', at: 7_000 } as const;
    assert.equal(xmjIsLegalMove(state, illegal), false);
    assert.equal(applyXmjMove(state, illegal), state);
  }
  const pending = xmjPendingAction(state);
  assert.deepEqual(pending, {
    at: 6_000 + XMJ_CLAIM_PAUSE_MS,
    color: 'east',
    move: { by: 'east', at: 6_000 + XMJ_CLAIM_PAUSE_MS, action: 'discard', tile: 'rA' },
  });
  assert.ok(pending);
  const replay = JSON.parse(JSON.stringify(moves)).reduce(applyXmjMove, createXmjRoomState(setup));
  assert.deepEqual(replay, state);
  assert.deepEqual(xmjPendingAction(replay), pending);
  assert.deepEqual(applyXmjMove(replay, pending.move), applyXmjMove(state, pending.move));
  assert.deepEqual(applyXmjMove(state, pending.move).match.hand.hands[0], ['rK', 'rA', 'rE', 'rP']);
});

test('a declared winning draw waits for its owner; next-hand readiness resets declarations', () => {
  const wall = wallWith(['rK', 'rA', 'rE', 'rP', 'bH'], ['bK', 'bA', 'bE', 'bR'], ['bP', 'rP']);
  let state = createXmjRoomState({ walls: [wall, wall], firstDealer: 'east', taiTable: 3 });
  state = play(state, 'east', { action: 'declare-ready', tile: 'bH' });
  state = play(state, 'west', { action: 'pass' });
  state = play(state, 'west', { action: 'discard', tile: 'bR' });
  state = play(state, 'east', { action: 'pass' });
  assert.equal(xmjPendingAction(state), null, 'never throw away a winning draw automatically');
  state = play(state, 'east', { action: 'self-draw' });
  assert.deepEqual(state.ready, []);
  state = play(state, 'east', { action: 'next-hand' });
  assert.deepEqual(state.ready, ['east']);
  assert.deepEqual(xmjViewFor(state, 'west').declared, { east: true, west: false });
  state = play(state, 'west', { action: 'next-hand' });
  assert.deepEqual(state.ready, []);
  assert.deepEqual(xmjViewFor(state, 'east').declared, { east: false, west: false });
});

test('declaration wire actions require exactly one tile and validate hand-copy hints', () => {
  assert.deepEqual(xmjMoveFromMessage({ action: 'declare-ready-hand', tiles: ['rP'] }), {
    by: 'east',
    at: 0,
    action: 'declare-ready',
    tile: 'rP',
    handCopy: true,
  });
  for (const tiles of [[], ['rP', 'rP'], ['bad']]) {
    assert.equal(xmjMoveFromMessage({ action: 'declare-ready', tiles }), null);
  }
  assert.equal(
    isXmjMove({ by: 'east', at: 0, action: 'declare-ready', tile: 'rP', handCopy: false }),
    false,
  );
});

test('a match scores on the 台 table its setup was stamped with; no stamp is table 1', () => {
  assert.equal(createXmjSetup(seeded(1)).taiTable, XMJ_TAI_TABLE);
  assert.equal(createXmjSetup(seeded(1), { correspondence: true }).taiTable, XMJ_TAI_TABLE);
  const setup = createXmjSetup(seeded(1));
  assert.ok(isXmjRoomSetup({ ...setup, taiTable: 1 }));
  assert.ok(!isXmjRoomSetup({ ...setup, taiTable: 4 }));
  assert.ok(!isXmjRoomSetup({ ...setup, taiTable: '2' }));

  // East deals and throws 象; west's 將士 + 兵兵 wins on it. Table 2 adds 將之才.
  const front: XmjTile[] = ['bE', 'rA', 'rR', 'bH', 'rC', 'bK', 'bA', 'rP', 'rP'];
  const rest = xmjOrderedTiles();
  for (const tile of front) rest.splice(rest.indexOf(tile), 1);
  const wall = [...front, ...rest];
  const totalOn = (stamp: Partial<XmjRoomSetup>) => {
    const state = createXmjRoomState({ walls: [wall, wall], firstDealer: 'east', ...stamp });
    const won = play(play(state, 'east', { action: 'discard', tile: 'bE' }), 'west', {
      action: 'claim',
      kind: 'win',
      fromHand: [],
    });
    const result = won.match.results[0];
    // The next hand deals on the same table.
    assert.equal(xmjAdvanceDeal(won).match.hand.taiTable, stamp.taiTable ?? 1);
    return result?.score?.total;
  };
  assert.equal(totalOn({}), 1, 'an unstamped (pre-10-26) game keeps its old score');
  assert.equal(totalOn({ taiTable: 1 }), 1);
  assert.equal(totalOn({ taiTable: 2 }), 2);
});

/** Deal the next hand of a match that is between hands. */
function xmjAdvanceDeal(state: XmjRoomState): XmjRoomState {
  return play(play(state, 'east', { action: 'next-hand' }), 'west', { action: 'next-hand' });
}

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

test('the review view shows both hands and the draw mid-hand, with no actions or deadlines', () => {
  const setup: XmjRoomSetup = { walls: [xmjShuffle(seeded(2))], firstDealer: 'east' };
  const state = createXmjRoomState(setup, 'xmj_test');
  const east = xmjViewFor(state, 'east');
  let next = play(state, 'east', { action: 'discard', tile: east.legal.discard[0] as XmjTile });
  if (next.match.hand.phase.type === 'claim') next = play(next, 'west', { action: 'pass' });
  const review = xmjReviewViewFor(next);
  assert.equal(review.perspective, 'spectator');
  assert.deepEqual(review.hands.east, [...next.match.hand.hands[0]]);
  assert.deepEqual(review.hands.west, [...next.match.hand.hands[1]]);
  assert.equal(review.phase.type, 'discard');
  const phase = next.match.hand.phase;
  if (review.phase.type === 'discard' && phase.type === 'discard') {
    assert.equal(review.phase.drawn, phase.drawn);
    assert.notEqual(review.phase.drawn, null);
  }
  assert.equal(review.legal.discard.length, 0);
  assert.equal(review.legal.nextHand, false);
  assert.equal(review.claimPauseEndsAt, null);
  assert.equal(review.nextHandAt, null);
  assert.deepEqual(review.ready, []);
  // The wall is a count, never its order.
  assert.equal(JSON.stringify(review).includes('walls'), false);
  assert.equal(review.wallCount, next.match.hand.wall.length);
});

test('each discard says whether it was the tile just drawn; the opponent learns only that', () => {
  // East deals and throws from the hand; west draws rP and throws it straight
  // back; east draws bP and throws rK from the hand.
  const wall = wallWith(['rK', 'rA', 'rE', 'rR', 'rH'], ['bK', 'bA', 'bE', 'bR'], ['rP', 'bP']);
  let state = createXmjRoomState({ walls: [wall], firstDealer: 'east' }, 'xmj_flag');
  state = play(state, 'east', { action: 'discard', tile: 'rH' });
  state = play(state, 'west', { action: 'pass' });

  // West holds its draw. East sees a count and no tiles: not the draw, not the hand.
  const east = xmjViewFor(state, 'east');
  assert.equal(east.hands.west, null);
  assert.equal(east.handCounts.west, 5);
  assert.ok(east.phase.type === 'discard' && east.phase.drawn === null);
  const westView = xmjViewFor(state, 'west');
  assert.ok(westView.phase.type === 'discard' && westView.phase.drawn === 'rP');
  for (const viewer of [east, xmjViewFor(state, 'spectator')]) {
    const wire = JSON.stringify(viewer);
    for (const tile of ['rP', 'bK', 'bA', 'bE', 'bR']) {
      assert.equal(
        wire.includes(`"${tile}"`),
        false,
        `${tile} reached a client that may not see it`,
      );
    }
  }

  state = play(state, 'west', { action: 'discard', tile: 'rP' });
  state = play(state, 'east', { action: 'pass' });
  state = play(state, 'east', { action: 'discard', tile: 'rK' });
  for (const seat of [...XMJ_SEATS, 'spectator'] as const) {
    const view = xmjViewFor(state, seat);
    assert.deepEqual(view.discards, { east: ['rH', 'rK'], west: ['rP'] });
    assert.deepEqual(view.drawnDiscards, { east: [false, false], west: [true] });
  }
  // West still may not see east's draw (bP) or hand, only the flags.
  const west = JSON.stringify(xmjViewFor(state, 'west'));
  for (const tile of ['bP', 'rA', 'rE', 'rR']) assert.equal(west.includes(`"${tile}"`), false);
});

test('a twin of the drawn tile thrown from the hand is flagged as a hand discard', () => {
  const wall = wallWith(['rK', 'rA', 'rE', 'rR', 'rH'], ['bK', 'bA', 'bE', 'rP'], ['rP']);
  const start = play(
    play(createXmjRoomState({ walls: [wall], firstDealer: 'east' }, 'xmj_twin'), 'east', {
      action: 'discard',
      tile: 'rH',
    }),
    'west',
    { action: 'pass' },
  );
  const drawn = play(start, 'west', { action: 'discard', tile: 'rP' });
  assert.deepEqual(drawn.match.hand.drawnDiscards[1], [true]);
  const twin = play(start, 'west', { action: 'discard', tile: 'rP', handCopy: true });
  assert.deepEqual(twin.match.hand.drawnDiscards[1], [false]);
  // A claim takes the tile and its flag off the pile together.
  const view = xmjViewFor(twin, 'east');
  assert.equal(view.discards.west.length, view.drawnDiscards.west.length);
  // The wire names the hand copy; a bare discard leaves it to the kernel.
  assert.deepEqual(xmjMoveFromMessage({ action: 'discard-hand', tiles: ['rP'] }), {
    by: 'east',
    at: 0,
    action: 'discard',
    tile: 'rP',
    handCopy: true,
  });
  assert.ok(isXmjMove({ by: 'west', at: 3, action: 'discard', tile: 'rP', handCopy: true }));
  assert.ok(!isXmjMove({ by: 'west', at: 3, action: 'discard', tile: 'rP', handCopy: 'yes' }));
});

test('a hand-copy claim with no twin in the hand is ignored', () => {
  const wall = wallWith(['rK', 'rA', 'rE', 'rR', 'rH'], ['bK', 'bA', 'bE', 'bR'], ['rP']);
  let state = createXmjRoomState({ walls: [wall], firstDealer: 'east' }, 'xmj_lie');
  state = play(state, 'east', { action: 'discard', tile: 'rH' });
  state = play(state, 'west', { action: 'pass' });
  state = play(state, 'west', { action: 'discard', tile: 'rP', handCopy: true });
  assert.deepEqual(state.match.hand.drawnDiscards[1], [true]);
});

test('a claim decision belongs to the claimant, on its own clock, with no other deadline', () => {
  const wall = wallWith(['bE', 'rA', 'rR', 'bH', 'rC'], ['bK', 'bA', 'rP', 'rH'], ['rH']);
  let state = createXmjRoomState({ walls: [wall], firstDealer: 'east' });
  state = play(state, 'east', { action: 'discard', tile: 'bE' }, 5_000);
  assert.equal(xmjClaimant(state), 'west');
  // The discard hands the clock over: the claimant's runs while it decides.
  assert.equal(xmjClockOwner(state), 'west');
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
  // With a claim to weigh there is no claim timer: the runtime never passes
  // for it, and only its clock running out ends the wait.
  assert.equal(xmjPendingAction(state), null);
  const passed = play(state, 'west', { action: 'pass' }, 60_000);
  assert.equal(passed.match.hand.turn, 1);
  assert.equal(passed.match.hand.hands[1].length, 5);
  assert.equal(xmjClockOwner(passed), 'west', 'pass, draw and discard are one turn');
  // A client cannot send a timeout.
  assert.equal(xmjMoveFromMessage({ action: 'timeout' }), null);
});

// Same dealer hand, same discard (車); only the claimant's hidden hand differs.
const DEALER: XmjTile[] = ['bK', 'rA', 'rR', 'bH', 'bC'];
const CAN_CHOW: XmjTile[] = ['rH', 'rC', 'bA', 'rE']; // 傌炮 take the 俥
const NOTHING: XmjTile[] = ['bP', 'bP', 'bA', 'rE'];

function afterDiscard(claimant: XmjTile[]): XmjRoomState {
  const wall = wallWith(DEALER, claimant, ['rP']);
  const state = createXmjRoomState({ walls: [wall], firstDealer: 'east' });
  return play(state, 'east', { action: 'discard', tile: 'rR' }, 5_000);
}

test('the discarder sees the same window whether or not the claimant can claim', () => {
  const withClaim = afterDiscard(CAN_CHOW);
  const without = afterDiscard(NOTHING);
  assert.deepEqual(
    xmjViewFor(withClaim, 'west').legal.claims.map((c) => c.kind),
    ['chow'],
  );
  assert.deepEqual(xmjViewFor(without, 'west').legal.claims, []);
  // A window that opened only for a claim told the discarder the opponent's
  // hand fit the tile. Every field the discarder (and a spectator) can read is
  // identical: phase, deadlines, counts, what it may do.
  assert.deepEqual(xmjViewFor(withClaim, 'east'), xmjViewFor(without, 'east'));
  assert.deepEqual(xmjViewFor(withClaim, 'spectator'), xmjViewFor(without, 'spectator'));
  const view = xmjViewFor(without, 'east');
  assert.equal(view.phase.type, 'claim');
  assert.equal(view.claimPauseEndsAt, 5_000 + XMJ_CLAIM_PAUSE_MS);
});

test('a window with nothing to claim passes for the claimant when the pause ends', () => {
  const without = afterDiscard(NOTHING);
  // No buttons for a seat with nothing to press.
  assert.equal(xmjViewFor(without, 'west').legal.pass, false);
  const pending = xmjPendingAction(without);
  assert.deepEqual(pending, {
    at: 5_000 + XMJ_CLAIM_PAUSE_MS,
    color: 'west',
    move: { by: 'west', at: 5_000 + XMJ_CLAIM_PAUSE_MS, action: 'pass' },
  });
  const drawn = applyXmjMove(without, pending?.move as XmjMove);
  assert.equal(drawn.match.hand.turn, 1);
  assert.equal(drawn.match.hand.hands[1].length, 5);
  assert.equal(drawn.claimPauseEndsAt, null);

  // A claimant WITH a claim answers no sooner than that same moment, so the
  // window settles at the pause end either way unless a human sits on it.
  const withClaim = afterDiscard(CAN_CHOW);
  assert.equal(xmjClaimAnswerEarliestAt(withClaim), pending?.at);
  assert.equal(xmjClaimAnswerEarliestAt(drawn), null);
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
  assert.deepEqual(view.scores, { east: 6, west: 0 });
  assert.deepEqual(view.hands.east, ['rK', 'rA', 'rE', 'rP', 'rP']);
  assert.equal(state.nextHandAt, 2_000 + XMJ_BETWEEN_HANDS_MS);
  assert.equal(xmjClockOwner(state), null);

  const one = play(state, 'west', { action: 'next-hand' });
  assert.equal(one.match.between, true);
  assert.ok(!xmjIsLegalMove(one, { by: 'west', at: 1, action: 'next-hand' }));
  const both = play(one, 'east', { action: 'next-hand' });
  assert.equal(both.match.between, false);
  assert.equal(both.match.handIndex, 1);
  // The dealer won, and the deal passes anyway: it alternates every hand.
  assert.equal(both.match.hand.dealer, 1);
  assert.equal(xmjViewFor(both, 'east').handNumber, 2);
  assert.equal(xmjViewFor(both, 'east').handsInMatch, 2);
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

test('two bots play 200 seeded matches to the end, each score the hands its seat won', () => {
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
    assert.equal(match.results.length, XMJ_MATCH_HANDS);
    // Each seat deals the same number of times.
    assert.deepEqual(
      match.results.map((r) => r.dealer === match.results[0]?.dealer),
      match.results.map((_, i) => i % 2 === 0),
    );
    for (const seat of [0, 1] as const) {
      const banked = match.results
        .filter((r) => r.winner === seat)
        .reduce((sum, r) => sum + (r.score?.total ?? 0), 0);
      assert.equal(match.scores[seat], banked);
    }
    for (const result of match.results) {
      if (result.winner === null) exhausted += 1;
      else wins += 1;
    }
  }
  // Sanity on the bot, not a rule: most hands should be won, and some claimed.
  assert.ok(wins > exhausted, `wins ${wins}, exhausted ${exhausted}`);
  assert.ok(claims > 0);
});

test('an answer made at once is dated to the pause end, a late one to its own time', () => {
  const state = afterDiscard(CAN_CHOW);
  const pauseEnd = 5_000 + XMJ_CLAIM_PAUSE_MS;
  assert.equal(xmjAnswerAt(state, pauseEnd + 80), pauseEnd);
  assert.equal(xmjAnswerAt(state, pauseEnd + 4_000), pauseEnd + 4_000);
  // Outside a window the clock is the clock.
  const fresh = createXmjRoomState({
    walls: [wallWith(DEALER, CAN_CHOW, ['rP'])],
    firstDealer: 'east',
  });
  assert.equal(xmjAnswerAt(fresh, 123), 123);
});

// ---- Correspondence (days per move) ------------------------------------------------

function afterCorrespondenceDiscard(claimant: XmjTile[]): XmjRoomState {
  const wall = wallWith(DEALER, claimant, ['rP']);
  const state = createXmjRoomState({ walls: [wall], firstDealer: 'east', correspondence: true });
  return play(state, 'east', { action: 'discard', tile: 'rR' }, 5_000);
}

test('a correspondence setup always deals east first and says so in the state', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const setup = createXmjSetup(seeded(seed), { correspondence: true });
    assert.equal(setup.firstDealer, 'east');
    assert.equal(setup.correspondence, true);
    assert.ok(isXmjRoomSetup(setup));
    assert.equal(createXmjRoomState(setup).correspondence, true);
  }
  assert.equal(createXmjSetup(seeded(1)).correspondence, undefined, 'a live setup is unchanged');
  assert.ok(!isXmjRoomSetup({ ...createXmjSetup(seeded(1)), correspondence: 'yes' }));
});

test('correspondence: a discard opens the claimant’s turn with no window, and it owns the clock', () => {
  for (const claimant of [NOTHING, CAN_CHOW]) {
    const state = afterCorrespondenceDiscard(claimant);
    assert.equal(xmjClaimant(state), 'west');
    assert.equal(state.claimPauseEndsAt, null);
    // No deadline but the move deadline: nothing for the runtime to settle.
    assert.equal(xmjPendingAction(state), null);
    assert.equal(xmjClockOwner(state), 'west');
    // Pass is always the claimant's to press, claim or no claim.
    const west = xmjViewFor(state, 'west');
    assert.equal(west.legal.pass, true);
    assert.equal(west.correspondence, true);
    // An answer keeps its own time: there is no pause to snap to.
    assert.equal(xmjAnswerAt(state, 9_999_999), 9_999_999);
  }
  // The discarder sees the same thing whether or not there was a claim.
  const strip = (view: ReturnType<typeof xmjViewFor>) => ({
    phase: view.phase,
    legal: view.legal,
    claimPauseEndsAt: view.claimPauseEndsAt,
    turn: view.turn,
  });
  assert.deepEqual(
    strip(xmjViewFor(afterCorrespondenceDiscard(NOTHING), 'east')),
    strip(xmjViewFor(afterCorrespondenceDiscard(CAN_CHOW), 'east')),
  );
});

test('correspondence: pass, draw and discard are one turn, then the clock goes back', () => {
  let state = afterCorrespondenceDiscard(NOTHING);
  state = play(state, 'west', { action: 'pass' }, 6_000);
  // The pass draws: west now holds five and must discard, still on its clock.
  assert.equal(state.match.hand.phase.type, 'discard');
  assert.equal(state.match.hand.hands[1].length, 5);
  assert.equal(xmjClockOwner(state), 'west');
  state = play(state, 'west', { action: 'discard', tile: 'bP' }, 7_000);
  assert.equal(xmjClaimant(state), 'east');
  assert.equal(xmjClockOwner(state), 'east');
  assert.equal(xmjViewFor(state, 'east').legal.pass, true);
});

test('correspondence: the next hand deals at once, by the runtime, with no Next hand button', () => {
  const walls = [
    wallWith(['rK', 'rA', 'rE', 'rP', 'rP'], ['bR', 'bH', 'bC', 'bA']),
    xmjShuffle(seeded(4)),
  ];
  let state = createXmjRoomState({ walls, firstDealer: 'east', correspondence: true });
  state = play(state, 'east', { action: 'self-draw' }, 2_000);
  assert.equal(state.match.between, true);
  assert.equal(state.nextHandAt, 2_000, 'no 30s wait');
  assert.equal(xmjClockOwner(state), null);
  for (const seat of XMJ_SEATS) {
    assert.equal(xmjViewFor(state, seat).legal.nextHand, false, `${seat} has nothing to press`);
    assert.ok(!xmjIsLegalMove(state, { by: seat, at: 2_000, action: 'next-hand' }));
  }
  const pending = xmjPendingAction(state);
  assert.equal(pending?.at, 2_000);
  assert.equal(pending?.color, 'west', 'the next dealer plays the deal');
  const dealt = applyXmjMove(state, pending?.move as XmjMove);
  assert.equal(dealt.match.handIndex, 1);
  assert.equal(dealt.match.between, false);
  assert.equal(xmjClockOwner(dealt), 'west');
});
