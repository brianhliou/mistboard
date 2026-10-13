import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isXmjPair,
  meldKindOf,
  type XmjHandState,
  type XmjTile,
  xmjAdvance,
  xmjCanSelfDraw,
  xmjClaim,
  xmjClaimsOpen,
  xmjDeal,
  xmjDiscard,
  xmjLegalClaims,
  xmjMatchWinner,
  xmjNewMatch,
  xmjNextDealer,
  xmjNextHand,
  xmjOrderedTiles,
  xmjPass,
  xmjScore,
  xmjSelfDraw,
  xmjShuffle,
  xmjWinShape,
} from './xiangqi-mahjong.js';

/**
 * A 32-tile wall whose front is the dealer's five, then the other's four, then
 * `draws` in order, then everything left over.
 */
function wallWith(dealer: XmjTile[], other: XmjTile[], draws: XmjTile[] = []): XmjTile[] {
  const rest = xmjOrderedTiles();
  for (const tile of [...dealer, ...other, ...draws]) {
    const at = rest.indexOf(tile);
    assert.ok(at >= 0, `no ${tile} left in the set`);
    rest.splice(at, 1);
  }
  return [...dealer, ...other, ...draws, ...rest];
}

function count(tiles: readonly XmjTile[], tile: XmjTile) {
  return tiles.filter((t) => t === tile).length;
}

test('the set is 32 tiles, 16 per colour, with the right copies', () => {
  const tiles = xmjOrderedTiles();
  assert.equal(tiles.length, 32);
  assert.equal(tiles.filter((t) => t[0] === 'r').length, 16);
  assert.equal(count(tiles, 'rK'), 1);
  assert.equal(count(tiles, 'bK'), 1);
  assert.equal(count(tiles, 'rP'), 5);
  assert.equal(count(tiles, 'bP'), 5);
  assert.equal(count(tiles, 'bA'), 2);
  const shuffled = xmjShuffle(() => 0.42);
  assert.deepEqual([...shuffled].sort(), [...tiles].sort());
});

test('melds: only same-colour 將士象 / 車馬包 sequences and soldier triplets', () => {
  assert.equal(meldKindOf(['bK', 'bA', 'bE']), 'sequence');
  assert.equal(meldKindOf(['bE', 'bK', 'bA']), 'sequence', 'any order');
  assert.equal(meldKindOf(['rR', 'rH', 'rC']), 'sequence');
  assert.equal(meldKindOf(['bP', 'bP', 'bP']), 'triplet');
  assert.equal(meldKindOf(['bK', 'bA', 'rE']), null, 'colours never mix');
  assert.equal(meldKindOf(['bK', 'bA', 'bR']), null, 'pieces from two sequences');
  assert.equal(meldKindOf(['bA', 'bA', 'bA']), null, 'only soldiers make triplets');
  assert.equal(meldKindOf(['rP', 'rP', 'bP']), null);
});

test('pairs: identical tiles, or 帥 with 將', () => {
  assert.ok(isXmjPair('bA', 'bA'));
  assert.ok(isXmjPair('rK', 'bK'));
  assert.ok(!isXmjPair('rA', 'bA'), 'advisors of two colours are not a pair');
});

test('(a) 將士象 wins with a pair; mixed sequences and mixed colours do not', () => {
  assert.ok(xmjWinShape(['bK', 'bA', 'bE', 'rR', 'rR'], []));
  assert.equal(xmjWinShape(['bK', 'bA', 'rE', 'rR', 'rR'], []), null);
  assert.equal(xmjWinShape(['bK', 'bA', 'bR', 'rR', 'rR'], []), null);
});

test('(b) 帥+將 pair with 兵兵兵 wins and scores 將帥聽令', () => {
  const hand: XmjTile[] = ['rK', 'bK', 'rP', 'rP', 'rP'];
  assert.ok(xmjWinShape(hand, []));
  const score = xmjScore({
    concealed: hand,
    melds: [],
    selfDrawn: false,
    winnerIsDealer: false,
    heavenly: false,
    earthly: false,
    lastTile: false,
  });
  assert.deepEqual(
    score.lines.map((l) => [l.key, l.tai]),
    [
      ['win', 1],
      ['generals-pair', 2],
    ],
  );
  assert.equal(score.total, 3);
});

test('(c) five soldiers win; four soldiers and a 卒 do not', () => {
  assert.ok(xmjWinShape(['rP', 'rP', 'rP', 'rP', 'rP'], []));
  assert.equal(xmjWinShape(['rP', 'rP', 'rP', 'rP', 'bP'], []), null);
  const score = xmjScore({
    concealed: ['rP', 'rP', 'rP', 'rP', 'rP'],
    melds: [],
    selfDrawn: true,
    winnerIsDealer: false,
    heavenly: false,
    earthly: false,
    lastTile: false,
  });
  // 1 win + 2 self-draw + 1 one-colour + 5 five-soldiers (stacks with 清一色).
  assert.equal(score.total, 9);
  assert.ok(score.lines.some((l) => l.key === 'five-soldiers' && l.tai === 5));
  assert.ok(score.lines.some((l) => l.key === 'one-colour'));
});

test('five soldiers through an exposed 兵兵兵 meld still scores', () => {
  const score = xmjScore({
    concealed: ['bP', 'bP'],
    melds: [{ kind: 'triplet', tiles: ['bP', 'bP', 'bP'], claimed: 'bP' }],
    selfDrawn: false,
    winnerIsDealer: false,
    heavenly: false,
    earthly: false,
    lastTile: false,
  });
  assert.ok(score.lines.some((l) => l.key === 'five-soldiers'));
});

test('(d) 碰 is only on soldiers: 士 has two copies, so no pung', () => {
  assert.deepEqual(
    xmjLegalClaims(['bA', 'bA', 'rR', 'rH'], [], 'bA').map((c) => c.kind),
    [],
  );
  assert.deepEqual(
    xmjLegalClaims(['bP', 'bP', 'rR', 'rH'], [], 'bP').map((c) => c.kind),
    ['pung'],
  );
});

test('(e) 吃 of 象 by a 將士 holder', () => {
  const claims = xmjLegalClaims(['bK', 'bA', 'rR', 'rH'], [], 'bE');
  assert.deepEqual(claims, [{ kind: 'chow', fromHand: ['bK', 'bA'] }]);
  // Wrong colour discard completes nothing.
  assert.deepEqual(xmjLegalClaims(['bK', 'bA', 'rR', 'rH'], [], 'rE'), []);
});

test('a discard that completes the hand offers 胡 ahead of the meld claims', () => {
  const claims = xmjLegalClaims(['bP', 'bP', 'bA', 'bA'], [], 'bP');
  assert.deepEqual(
    claims.map((c) => c.kind),
    ['win', 'pung'],
  );
});

test('碰 and 吃 never compete for one tile: soldiers are in no sequence', () => {
  // Spec 12 asks the UI to offer both when both are legal. In the 32-tile set
  // that cannot happen (碰 needs a soldier, 吃 never uses one), so this pins it.
  const claims = xmjLegalClaims(['rP', 'rP', 'rR', 'rH'], [], 'rP');
  assert.deepEqual(
    claims.map((c) => c.kind),
    ['pung'],
  );
});

test('deal: dealer 5, other 4, wall 23, dealer to discard first', () => {
  const hand = xmjDeal(xmjOrderedTiles(), 1);
  assert.equal(hand.hands[1].length, 5);
  assert.equal(hand.hands[0].length, 4);
  assert.equal(hand.wall.length, 23);
  assert.equal(hand.turn, 1);
  assert.equal(hand.phase.type, 'discard');
});

test('(g) 天胡: the dealer wins on the opening five, flat 6', () => {
  const hand = xmjDeal(wallWith(['bK', 'bA', 'bE', 'rP', 'rP'], ['rR', 'rH', 'bR', 'bH']), 0);
  assert.ok(xmjCanSelfDraw(hand));
  const won = xmjSelfDraw(hand);
  assert.equal(won.phase.type, 'won');
  if (won.phase.type !== 'won') return;
  assert.equal(won.phase.winner, 0);
  assert.deepEqual(
    won.phase.score.lines.map((l) => l.key),
    ['heavenly'],
  );
  assert.equal(won.phase.score.total, 6);
});

test('draw/discard cycle: no claim available means the opponent draws at once', () => {
  const hand = xmjDeal(
    wallWith(['bK', 'rA', 'rR', 'bH', 'rC'], ['bP', 'bA', 'rE', 'bC'], ['rH']),
    0,
  );
  const after = xmjDiscard(hand, 'rR');
  assert.equal(after.turn, 1);
  assert.equal(after.phase.type, 'discard');
  assert.equal(after.hands[1].length, 5);
  assert.equal(after.hands[0].length, 4);
  assert.deepEqual(after.discards[0], ['rR']);
  if (after.phase.type === 'discard') assert.equal(after.phase.drawn, 'rH');
});

test('claim window opens when the opponent can 吃, and 吃 skips the draw', () => {
  const hand = xmjDeal(
    wallWith(['bE', 'rA', 'rR', 'bH', 'rC'], ['bK', 'bA', 'rP', 'rH'], ['rH']),
    0,
  );
  const window = xmjDiscard(hand, 'bE');
  assert.equal(window.phase.type, 'claim');
  assert.deepEqual(
    xmjClaimsOpen(window).map((c) => c.kind),
    ['chow'],
  );
  const claimed = xmjClaim(window, { kind: 'chow', fromHand: ['bA', 'bK'] });
  assert.equal(claimed.turn, 1);
  assert.equal(claimed.phase.type, 'discard');
  if (claimed.phase.type === 'discard') assert.equal(claimed.phase.mayWin, false);
  assert.equal(claimed.wall.length, window.wall.length, 'no draw after a claim');
  assert.deepEqual(claimed.hands[1], ['rH', 'rP']);
  assert.equal(claimed.melds[1].length, 1);
  assert.deepEqual(claimed.discards[0], [], 'the claimed tile leaves the pile');
  // Discard one soldier; now one concealed + meld, waiting on rP.
  const next = xmjDiscard(claimed, 'rP');
  assert.equal(next.hands[1].length, 1);
});

test('claiming an illegal set is refused', () => {
  const hand = xmjDeal(
    wallWith(['bE', 'rA', 'rR', 'bH', 'rC'], ['bK', 'bA', 'rP', 'rP'], ['rH']),
    0,
  );
  const window = xmjDiscard(hand, 'bE');
  assert.equal(xmjClaim(window, { kind: 'pung', fromHand: ['bE', 'bE'] }), window);
  assert.equal(xmjClaim(window, { kind: 'chow', fromHand: ['bK', 'rP'] }), window);
});

test('passing a window: the claimant draws', () => {
  const hand = xmjDeal(
    wallWith(['bE', 'rA', 'rR', 'bH', 'rC'], ['bK', 'bA', 'rP', 'rP'], ['rH']),
    0,
  );
  const passed = xmjPass(xmjDiscard(hand, 'bE'));
  assert.equal(passed.turn, 1);
  assert.equal(passed.hands[1].length, 5);
  if (passed.phase.type === 'discard') assert.equal(passed.phase.drawn, 'rH');
});

test('win on the opponent discard (胡) scores and books the hand', () => {
  const hand = xmjDeal(
    wallWith(['bE', 'rA', 'rR', 'bH', 'rC'], ['bK', 'bA', 'rP', 'rP'], ['rH']),
    0,
  );
  const window = xmjDiscard(hand, 'bE');
  // 將士 + 兵兵 + the discarded 象 is 將士象 + 兵兵.
  assert.deepEqual(
    xmjClaimsOpen(window).map((c) => c.kind),
    ['win', 'chow'],
  );
  const won = xmjClaim(window, { kind: 'win', fromHand: [] });
  assert.equal(won.phase.type, 'won');
  if (won.phase.type !== 'won') return;
  assert.equal(won.phase.winner, 1);
  assert.equal(won.phase.selfDrawn, false);
  // win 1 only: mixed colours, non-dealer.
  assert.equal(won.phase.score.total, 1);
});

test('地胡: the non-dealer wins on the first draw, flat 6', () => {
  const hand = xmjDeal(
    wallWith(['rA', 'rA', 'rR', 'bH', 'rC'], ['bK', 'bA', 'rP', 'rP'], ['bE']),
    0,
  );
  const drawn = xmjDiscard(hand, 'rR');
  assert.equal(drawn.turn, 1);
  assert.ok(xmjCanSelfDraw(drawn));
  const won = xmjSelfDraw(drawn);
  assert.equal(won.phase.type, 'won');
  if (won.phase.type === 'won') {
    assert.deepEqual(
      won.phase.score.lines.map((l) => l.key),
      ['earthly'],
    );
  }
});

test('dealer self-draw: 自摸 + 莊家, doubled for 連莊', () => {
  const score = xmjScore({
    concealed: ['bR', 'bH', 'bC', 'rA', 'rA'],
    melds: [],
    selfDrawn: true,
    winnerIsDealer: true,
    heavenly: false,
    earthly: false,
    lastTile: true,
  });
  // 1 + 2 + 1 (dealer) + 1 (last tile) = 5, x2 = 10.
  assert.equal(score.total, 10);
  assert.ok(score.lines.some((l) => l.key === 'last-tile'));
  assert.ok(score.lines.some((l) => l.key === 'dealer-repeat' && l.tai === 5));
});

/** Play a hand out with both seats discarding their first tile and never claiming. */
function playOut(start: XmjHandState): XmjHandState {
  let hand = start;
  for (let guard = 0; guard < 200; guard += 1) {
    if (hand.phase.type === 'exhausted' || hand.phase.type === 'won') return hand;
    if (hand.phase.type === 'claim') {
      hand = xmjPass(hand);
      continue;
    }
    const tile = hand.hands[hand.turn][0] as XmjTile;
    hand = xmjDiscard(hand, tile);
  }
  throw new Error('hand did not end');
}

test('(f) 流局 when the wall runs out with no winner', () => {
  // Hands that can never win by discarding the first tile: use a wall where
  // draws are fed in an order nothing completes. Brute force a seed instead of
  // hand-building: find a shuffle where play-out ends exhausted.
  let found: XmjHandState | null = null;
  for (let seed = 1; seed < 200 && !found; seed += 1) {
    let s = seed;
    const random = () => {
      s = (s * 1103515245 + 12345) % 2 ** 31;
      return s / 2 ** 31;
    };
    const end = playOut(xmjDeal(xmjShuffle(random), 0));
    if (end.phase.type === 'exhausted') found = end;
  }
  assert.ok(found, 'some deal ends in 流局');
  if (!found) return;
  assert.equal(found.wall.length, 0);
  // Every tile is still accounted for: 23 drawn, nothing lost.
  const total =
    found.hands[0].length +
    found.hands[1].length +
    found.discards[0].length +
    found.discards[1].length;
  assert.equal(total, 32);
});

test('match: eight hands, scores zero-sum, dealer rotation', () => {
  assert.equal(xmjNextDealer({ dealer: 0, winner: 0, selfDrawn: true, score: null }), 0);
  assert.equal(xmjNextDealer({ dealer: 0, winner: 1, selfDrawn: true, score: null }), 1);
  assert.equal(xmjNextDealer({ dealer: 1, winner: null, selfDrawn: false, score: null }), 1);

  let s = 7;
  const random = () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
  const walls = Array.from({ length: 8 }, () => xmjShuffle(random));
  let match = xmjNewMatch(walls, 0);
  for (let hand = 0; hand < 8; hand += 1) {
    // Take any win the moment it is offered, else play out.
    let state = match.hand;
    for (let guard = 0; guard < 200 && !match.between && !match.over; guard += 1) {
      if (state.phase.type === 'claim') {
        const win = xmjClaimsOpen(state).find((c) => c.kind === 'win');
        state = win ? xmjClaim(state, win) : xmjPass(state);
      } else if (state.phase.type === 'discard') {
        state = xmjCanSelfDraw(state)
          ? xmjSelfDraw(state)
          : xmjDiscard(state, state.hands[state.turn][0] as XmjTile);
      }
      match = xmjAdvance(match, state);
    }
    assert.equal(match.results.length, hand + 1);
    assert.equal(match.scores[0] + match.scores[1], 0);
    if (!match.over) match = xmjNextHand(match);
  }
  assert.ok(match.over);
  assert.equal(match.between, false);
  assert.equal(xmjNextHand(match), match, 'no ninth hand');
  const winner = xmjMatchWinner(match);
  if (match.scores[0] === match.scores[1]) assert.equal(winner, null);
  else assert.equal(winner, match.scores[0] > match.scores[1] ? 0 : 1);
});
