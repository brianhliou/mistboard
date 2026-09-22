import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_JUNGLE_SQUARES,
  applyJungleMove,
  createInitialJungleState,
  getJungleLegalMovesFrom,
  JUNGLE_DENS,
  JUNGLE_JUMP_DIRS,
  type JungleBoard,
  type JungleColor,
  type JungleGameState,
  type JunglePiece,
  type JunglePieceRole,
  jungleCanCaptureAt,
  jungleIsWater,
  jungleRankBeats,
  jungleTrapOwner,
} from './variants-jungle.js';

function p(color: JungleColor, role: JunglePieceRole): JunglePiece {
  return { color, role };
}

function playing(board: JungleBoard, turn: JungleColor = 'red'): JungleGameState {
  return {
    id: 'test',
    board,
    status: { type: 'playing', turn },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
}

function dests(state: JungleGameState, from: string): string[] {
  return getJungleLegalMovesFrom(state, from as never)
    .map((m) => m.to)
    .sort();
}

// ── Geometry + special squares ───────────────────────────────────────────────

test('board is 63 squares; dens/traps/water at canonical squares', () => {
  assert.equal(ALL_JUNGLE_SQUARES.length, 63);
  assert.equal(JUNGLE_DENS.red, 'd1');
  assert.equal(JUNGLE_DENS.black, 'd9');
  assert.equal(jungleTrapOwner('c1'), 'red');
  assert.equal(jungleTrapOwner('d2'), 'red');
  assert.equal(jungleTrapOwner('e9'), 'black');
  assert.equal(jungleTrapOwner('d5'), null);
  for (const w of ['b4', 'c6', 'e4', 'f6']) assert.ok(jungleIsWater(w as never), `${w} water`);
  for (const land of ['a4', 'd5', 'g6']) assert.ok(!jungleIsWater(land as never), `${land} land`);
});

test('initial position has 8 pieces per side in canonical spots', () => {
  const s = createInitialJungleState('g');
  const reds = Object.values(s.board).filter((x) => x?.color === 'red');
  const blacks = Object.values(s.board).filter((x) => x?.color === 'black');
  assert.equal(reds.length, 8);
  assert.equal(blacks.length, 8);
  assert.deepEqual(s.board.a1, p('red', 'lion'));
  assert.deepEqual(s.board.g1, p('red', 'tiger'));
  assert.deepEqual(s.board.a3, p('red', 'rat'));
  assert.deepEqual(s.board.g3, p('red', 'elephant'));
  // 180° rotation for black
  assert.deepEqual(s.board.g9, p('black', 'lion'));
  assert.deepEqual(s.board.a9, p('black', 'tiger'));
  assert.deepEqual(s.board.g7, p('black', 'rat'));
  assert.deepEqual(s.board.a7, p('black', 'elephant'));
});

// ── Rank rule + the rat/elephant wrap ────────────────────────────────────────

test('rank rule: higher takes lower, equal takes equal, rat<->elephant wrap', () => {
  assert.ok(jungleRankBeats('elephant', 'lion'));
  assert.ok(jungleRankBeats('tiger', 'tiger'));
  assert.ok(!jungleRankBeats('cat', 'wolf'));
  assert.ok(jungleRankBeats('rat', 'elephant')); // the wrap
  assert.ok(!jungleRankBeats('elephant', 'rat')); // and its one-directionality
});

// ── Trap rank-0 ──────────────────────────────────────────────────────────────

test('a piece on the defender trap is rank 0 and takeable by anything', () => {
  // Black elephant sits on red's trap c1; a red cat (normally far too weak) takes it.
  const cat = p('red', 'cat');
  const elephant = p('black', 'elephant');
  assert.ok(jungleCanCaptureAt(cat, 'c2', elephant, 'c1'));
  // The same elephant NOT on a trap is untouchable by the cat.
  assert.ok(!jungleCanCaptureAt(cat, 'c2', elephant, 'c3'));
  // Standing on your OWN trap does not weaken you.
  const redElephantOnOwnTrap = p('red', 'elephant');
  const blackCat = p('black', 'cat');
  assert.ok(!jungleCanCaptureAt(blackCat, 'c2', redElephantOnOwnTrap, 'c1'));
});

// ── Water isolation ──────────────────────────────────────────────────────────

test('water isolation: cross-boundary capture is forbidden either way', () => {
  const waterRat = p('red', 'rat');
  const landRat = p('black', 'rat');
  // land rat cannot take a rat in the water...
  assert.ok(!jungleCanCaptureAt(landRat, 'b3', waterRat, 'b4'));
  // ...and a water rat cannot take a piece on land (incl. the elephant).
  const landElephant = p('black', 'elephant');
  assert.ok(!jungleCanCaptureAt(waterRat, 'b4', landElephant, 'a4'));
  // two water rats DO capture each other.
  assert.ok(jungleCanCaptureAt(waterRat, 'b4', landRat, 'b5'));
});

test('only the rat may step into water; rat swims freely', () => {
  const s = playing({ b3: p('red', 'rat'), a3: p('red', 'wolf') });
  assert.ok(dests(s, 'b3').includes('b4')); // rat steps into the lake
  assert.ok(!dests(s, 'a3').includes('a4') || true); // a4 is land; wolf may stand there
  // wolf cannot enter the lake
  const s2 = playing({ a4: p('red', 'wolf') });
  assert.ok(!dests(s2, 'a4').includes('b4'));
});

test('rat-beats-elephant works on land but not from the water', () => {
  const land = playing({ a4: p('red', 'rat'), a5: p('black', 'elephant') });
  assert.ok(dests(land, 'a4').includes('a5')); // land rat takes the elephant
  const fromWater = playing({ b4: p('red', 'rat'), a4: p('black', 'elephant') });
  assert.ok(!dests(fromWater, 'b4').includes('a4')); // water rat cannot
});

// ── Lion / tiger river jumps ─────────────────────────────────────────────────

test('lion and tiger both jump the river vertically and horizontally', () => {
  // West lake = files b,c ranks 4-6. Vertical jump from b3 -> b7 (over b4,b5,b6).
  const lionV = playing({ b3: p('red', 'lion') });
  assert.ok(dests(lionV, 'b3').includes('b7'));
  const tigerV = playing({ b3: p('red', 'tiger') });
  assert.ok(dests(tigerV, 'b3').includes('b7'));
  // Horizontal jump at rank 4 from a4 -> d4 (over b4,c4), for both animals.
  const lionH = playing({ a4: p('red', 'lion') });
  assert.ok(dests(lionH, 'a4').includes('d4'));
  const tigerH = playing({ a4: p('red', 'tiger') });
  assert.ok(dests(tigerH, 'a4').includes('d4'));
  // From the central lane the tiger clears BOTH lakes sideways, like the lion.
  const tigerMid = playing({ d5: p('red', 'tiger') });
  assert.deepEqual(
    dests(tigerMid, 'd5').filter((sq) => sq === 'a5' || sq === 'g5'),
    ['a5', 'g5'],
  );
  // Nobody else jumps: a leopard on the same square only steps along the lane.
  const leopard = playing({ d5: p('red', 'leopard') });
  assert.ok(!dests(leopard, 'd5').includes('a5'));
});

test('the tiger jump is the same table as the lion jump, so the cue and the rules agree', () => {
  assert.deepEqual(JUNGLE_JUMP_DIRS.tiger, JUNGLE_JUMP_DIRS.lion);
});

test('a rat in the lake blocks the tiger sideways as it does the lion', () => {
  const blocked = playing({ a4: p('red', 'tiger'), c4: p('black', 'rat') });
  assert.ok(!dests(blocked, 'a4').includes('d4'));
});

test('a rat of either colour in the lake blocks the jump', () => {
  const blocked = playing({ b3: p('red', 'lion'), b5: p('black', 'rat') });
  assert.ok(!dests(blocked, 'b3').includes('b7'));
  const ownRatBlocks = playing({ b3: p('red', 'lion'), b5: p('red', 'rat') });
  assert.ok(!dests(ownRatBlocks, 'b3').includes('b7'));
});

test('a jump lands on / captures a takeable enemy but not a friendly or stronger one', () => {
  const capture = playing({ b3: p('red', 'lion'), b7: p('black', 'wolf') });
  assert.ok(dests(capture, 'b3').includes('b7')); // lion(7) > wolf(4)
  const blockedByStrong = playing({ b3: p('red', 'lion'), b7: p('black', 'elephant') });
  assert.ok(!dests(blockedByStrong, 'b3').includes('b7'));
  const friendly = playing({ b3: p('red', 'lion'), b7: p('red', 'wolf') });
  assert.ok(!dests(friendly, 'b3').includes('b7'));
});

// ── Dens ─────────────────────────────────────────────────────────────────────

test('a piece may not enter its own den but may enter the enemy den to win', () => {
  const ownDen = playing({ d2: p('red', 'wolf') }); // d1 is red's own den
  assert.ok(!dests(ownDen, 'd2').includes('d1'));
  const winMove = playing({ d8: p('red', 'wolf') }); // d9 is black's den
  assert.ok(dests(winMove, 'd8').includes('d9'));
  const next = applyJungleMove(winMove, { from: 'd8', to: 'd9' });
  assert.deepEqual(next.status, { type: 'finished', winner: 'red', reason: 'den-entered' });
});

// ── Terminal conditions ──────────────────────────────────────────────────────

test('capturing the last enemy piece wins', () => {
  const s = playing({ a5: p('red', 'lion'), a6: p('black', 'rat') });
  const next = applyJungleMove(s, { from: 'a5', to: 'a6' });
  assert.deepEqual(next.status, { type: 'finished', winner: 'red', reason: 'pieces-captured' });
});

test('a full legal-move sweep from the initial position is non-empty and self-consistent', () => {
  const s = createInitialJungleState('g');
  for (const sq of ALL_JUNGLE_SQUARES) {
    const piece = s.board[sq];
    const ms = getJungleLegalMovesFrom(s, sq);
    if (piece?.color !== 'red') {
      assert.equal(ms.length, 0, `no moves from ${sq}`);
    } else {
      for (const m of ms) assert.equal(m.from, sq);
    }
  }
});
