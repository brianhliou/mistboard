import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyJieqiMove,
  assertValidJieqiDeal,
  createInitialJieqiState,
  createJieqiDeal,
  getJieqiLegalMoves,
  getJieqiLegalMovesFrom,
  getJieqiPlayerView,
  getJieqiPublicView,
  isJieqiLegalMove,
  type JieqiBoard,
  type JieqiColor,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPiece,
  type JieqiPieceRole,
  jieqiHomeSquares,
  jieqiTruthView,
  STANDARD_JIEQI_DEAL,
} from './variants-jieqi.js';

function dark(color: JieqiColor, role: JieqiPieceRole): JieqiPiece {
  return { color, role, faceDown: true };
}

function up(color: JieqiColor, role: JieqiPieceRole): JieqiPiece {
  return { color, role, faceDown: false };
}

function playing(board: JieqiBoard, turn: JieqiColor = 'red'): JieqiGameState {
  return {
    id: 'test',
    board,
    status: { type: 'playing', turn },
    moveNumber: 1,
    noCaptureClock: 0,
    captures: [],
  };
}

function destinations(moves: JieqiMove[]): string[] {
  return moves.map((m) => m.to).sort();
}

test('player views carry own candidate moves off-turn', () => {
  const state = createInitialJieqiState('view-legal');

  assert.ok(getJieqiPlayerView(state, 'red').legalMoves.length > 0);
  assert.ok(getJieqiPlayerView(state, 'black').legalMoves.length > 0);
  assert.equal(
    getJieqiLegalMoves(state).some((move) => move.from === 'e10'),
    false,
  );
});

// ── Setup + deal ────────────────────────────────────────────────────────────

test('initial state deals 15 dark pieces per side and face-up generals', () => {
  const state = createInitialJieqiState('init');

  assert.equal(Object.keys(state.board).length, 32);
  assert.deepEqual(state.board.e1, { color: 'red', role: 'general', faceDown: false });
  assert.deepEqual(state.board.e10, { color: 'black', role: 'general', faceDown: false });
  assert.equal(state.status.type === 'playing' && state.status.turn, 'red');

  const redDark = Object.values(state.board).filter((p) => p?.color === 'red' && p.faceDown);
  const blackDark = Object.values(state.board).filter((p) => p?.color === 'black' && p.faceDown);
  assert.equal(redDark.length, 15);
  assert.equal(blackDark.length, 15);

  // a1 is the first red home square; default deal places the standard chariot.
  assert.deepEqual(state.board.a1, { color: 'red', role: 'chariot', faceDown: true });
});

test('deal maps onto home squares in canonical order', () => {
  const home = jieqiHomeSquares('red');
  assert.equal(home[0], 'a1');
  assert.equal(home.length, 15);

  // Swap the chariot (index 0 -> a1) and a soldier (index 10 -> a4).
  const red = [...STANDARD_JIEQI_DEAL.red];
  [red[0], red[10]] = [red[10], red[0]];
  const deal: JieqiDeal = { red, black: [...STANDARD_JIEQI_DEAL.black] };
  const state = createInitialJieqiState('deal', deal);

  assert.equal(state.board.a1?.role, 'soldier');
  assert.equal(state.board.a4?.role, 'chariot');
});

test('createJieqiDeal always produces a valid deal and is rng-deterministic', () => {
  let counter = 0;
  const seeded = () => {
    counter = (counter * 1103515245 + 12345) & 0x7fffffff;
    return counter / 0x7fffffff;
  };
  for (let i = 0; i < 50; i += 1) {
    assert.doesNotThrow(() => assertValidJieqiDeal(createJieqiDeal(seeded)));
  }

  const fixed = () => 0.42;
  assert.deepEqual(createJieqiDeal(fixed), createJieqiDeal(fixed));
});

test('invalid deals are rejected', () => {
  assert.throws(() => assertValidJieqiDeal({ red: ['chariot'], black: STANDARD_JIEQI_DEAL.black }));
  const wrong = [...STANDARD_JIEQI_DEAL.red];
  wrong[0] = 'general'; // not part of the dealable multiset
  assert.throws(() => assertValidJieqiDeal({ red: wrong, black: STANDARD_JIEQI_DEAL.black }));
  assert.doesNotThrow(() => assertValidJieqiDeal(STANDARD_JIEQI_DEAL));
});

// ── Dark movement by starting point ─────────────────────────────────────────

test('a dark piece moves by its starting point, not its hidden identity', () => {
  // True soldier sitting on the a1 corner (a chariot point) plays as a chariot.
  const state = playing({
    a1: dark('red', 'soldier'),
    d1: up('red', 'general'),
    f10: up('black', 'general'),
  });

  assert.deepEqual(destinations(getJieqiLegalMovesFrom(state, 'a1')), [
    'a10',
    'a2',
    'a3',
    'a4',
    'a5',
    'a6',
    'a7',
    'a8',
    'a9',
    'b1',
    'c1',
  ]);
});

test('a dark advisor point is palace-confined; a revealed advisor is freed', () => {
  const confined = playing({
    d1: dark('red', 'advisor'),
    e1: up('red', 'general'),
    a10: up('black', 'general'),
  });
  assert.deepEqual(destinations(getJieqiLegalMovesFrom(confined, 'd1')), ['e2']);

  const freed = playing({
    e5: up('red', 'advisor'),
    e1: up('red', 'general'),
    a10: up('black', 'general'),
  });
  assert.deepEqual(destinations(getJieqiLegalMovesFrom(freed, 'e5')), ['d4', 'd6', 'f4', 'f6']);
});

test('a dark elephant stays in its half; a revealed elephant may cross the river', () => {
  const confined = playing({
    c1: dark('red', 'elephant'),
    e1: up('red', 'general'),
    a10: up('black', 'general'),
  });
  assert.deepEqual(destinations(getJieqiLegalMovesFrom(confined, 'c1')), ['a3', 'e3']);

  const freed = playing({
    e5: up('red', 'elephant'),
    e1: up('red', 'general'),
    a10: up('black', 'general'),
  });
  const dests = destinations(getJieqiLegalMovesFrom(freed, 'e5'));
  assert.deepEqual(dests, ['c3', 'c7', 'g3', 'g7']);
  // c7 and g7 are across the river — only legal because the elephant is revealed.
  assert.ok(dests.includes('c7') && dests.includes('g7'));
});

// ── Reveal on move ──────────────────────────────────────────────────────────

test('a dark piece reveals on its first move, then plays by identity', () => {
  const state = playing({
    a1: dark('red', 'horse'),
    d1: up('red', 'general'),
    f10: up('black', 'general'),
  });
  // Moves as a chariot (its a1 starting point), not as a horse.
  const after = applyJieqiMove(state, { from: 'a1', to: 'a5' });
  assert.deepEqual(after.board.a5, { color: 'red', role: 'horse', faceDown: false });
  assert.equal(after.board.a1, undefined);

  // Now face-up, it generates horse moves.
  const revealed = playing({
    a5: up('red', 'horse'),
    d1: up('red', 'general'),
    f10: up('black', 'general'),
  });
  assert.deepEqual(destinations(getJieqiLegalMovesFrom(revealed, 'a5')), ['b3', 'b7', 'c4', 'c6']);
});

// ── Check, checkmate, stalemate, facing generals ────────────────────────────

test('exposing the generals to each other is illegal', () => {
  const state = playing({
    e1: up('red', 'general'),
    e10: up('black', 'general'),
    e5: up('red', 'chariot'),
  });
  // Moving the blocker off the file leaves the generals facing — illegal.
  assert.equal(isJieqiLegalMove(state, { from: 'e5', to: 'd5' }), false);
  // Sliding along the file keeps the file blocked — legal.
  assert.equal(isJieqiLegalMove(state, { from: 'e5', to: 'e6' }), true);
});

test('a move must resolve check', () => {
  const state = playing({
    e1: up('red', 'general'),
    e5: up('black', 'chariot'), // checks the red general up the e-file
    a1: up('red', 'soldier'),
    f10: up('black', 'general'),
  });
  // An unrelated move that ignores the check is illegal.
  assert.equal(isJieqiLegalMove(state, { from: 'a1', to: 'a2' }), false);
  // Stepping the general off the file escapes.
  assert.equal(isJieqiLegalMove(state, { from: 'e1', to: 'd1' }), true);
  assert.ok(getJieqiLegalMoves(state).length > 0);
});

test('checkmate ends the game for the moving side', () => {
  // Black general boxed in the back rank; red slides the last cover into place.
  const state = playing({
    e10: up('black', 'general'),
    e3: up('red', 'chariot'), // checks up the e-file, covers e9
    a10: up('red', 'chariot'), // covers d10
    g5: up('red', 'chariot'), // about to cover f10
    f2: up('red', 'general'),
  });
  const after = applyJieqiMove(state, { from: 'g5', to: 'g10' });
  assert.deepEqual(after.status, { type: 'finished', winner: 'red', reason: 'checkmate' });
});

test('a mated position has no legal moves and is in check', () => {
  const state = playing(
    {
      e10: up('black', 'general'),
      e2: up('red', 'chariot'),
      d1: up('red', 'chariot'),
      f1: up('red', 'chariot'),
      e1: up('red', 'general'),
    },
    'black',
  );
  assert.equal(getJieqiLegalMoves(state).length, 0);
  assert.equal(getJieqiPlayerView(state, 'black').inCheck, true);
});

test('stalemate is a loss for the side to move', () => {
  const state = playing({
    e10: up('black', 'general'),
    d1: up('red', 'chariot'), // covers d10
    f1: up('red', 'chariot'), // covers f10
    a5: up('red', 'chariot'), // about to cover e9 from rank 9
    e2: up('red', 'general'),
    e5: up('red', 'soldier'), // blocks the e-file so neither general is in check
  });
  const after = applyJieqiMove(state, { from: 'a5', to: 'a9' });
  assert.deepEqual(after.status, { type: 'finished', winner: 'red', reason: 'stalemate' });

  // And the resulting position is genuinely stalemate: no moves, not in check.
  const blackToMove = playing(
    {
      e10: up('black', 'general'),
      d1: up('red', 'chariot'),
      f1: up('red', 'chariot'),
      a9: up('red', 'chariot'),
      e2: up('red', 'general'),
      e5: up('red', 'soldier'),
    },
    'black',
  );
  assert.equal(getJieqiLegalMoves(blackToMove).length, 0);
  assert.equal(getJieqiPlayerView(blackToMove, 'black').inCheck, false);
});

// ── No-capture clock ────────────────────────────────────────────────────────

test('the no-capture clock draws after the limit and resets on capture', () => {
  const base = playing({
    d1: up('red', 'general'),
    f10: up('black', 'general'),
    a1: up('red', 'chariot'),
    i10: up('black', 'chariot'),
  });

  const nearLimit: JieqiGameState = { ...base, noCaptureClock: 3 };
  const drawn = applyJieqiMove(nearLimit, { from: 'a1', to: 'a2' }, { noCaptureClockLimit: 4 });
  assert.deepEqual(drawn.status, { type: 'finished', winner: null, reason: 'no-capture-clock' });

  const withTarget: JieqiGameState = {
    ...playing({
      d1: up('red', 'general'),
      f10: up('black', 'general'),
      a1: up('red', 'chariot'),
      a3: up('black', 'chariot'),
    }),
    noCaptureClock: 5,
  };
  const captured = applyJieqiMove(withTarget, { from: 'a1', to: 'a3' });
  assert.equal(captured.noCaptureClock, 0);
  assert.equal(captured.status.type, 'playing');
  assert.equal(captured.captures.length, 1);
});

// ── Hidden information (capturer-only reveal) ───────────────────────────────

test('dark pieces are masked for both players, including their owner', () => {
  const red = [...STANDARD_JIEQI_DEAL.red];
  [red[0], red[10]] = [red[10], red[0]];
  const state = createInitialJieqiState('mask', { red, black: [...STANDARD_JIEQI_DEAL.black] });

  const redView = getJieqiPlayerView(state, 'red');
  const blackView = getJieqiPlayerView(state, 'black');

  // Red's own a1 piece is hidden from red — you do not know your own identities.
  assert.deepEqual(redView.board.a1, { color: 'red', faceDown: true });
  assert.ok(!('role' in redView.board.a1!));
  // Both players see the same masked board for dark squares.
  assert.deepEqual(redView.board.a1, blackView.board.a1);
  // Generals are face-up to everyone.
  assert.deepEqual(redView.board.e1, { color: 'red', role: 'general', faceDown: false });
});

test('only the capturer learns a captured dark piece; the owner never does', () => {
  const state = playing({
    d1: up('red', 'general'),
    f10: up('black', 'general'),
    a1: up('red', 'chariot'),
    a3: dark('black', 'cannon'),
  });
  const after = applyJieqiMove(state, { from: 'a1', to: 'a3' });

  assert.deepEqual(after.captures, [{ owner: 'black', role: 'cannon', revealedAtCapture: false }]);
  // Red captured it — red knows the identity.
  assert.deepEqual(getJieqiPlayerView(after, 'red').captured, [{ owner: 'black', role: 'cannon' }]);
  // Black owned it but never knew it — still hidden.
  assert.deepEqual(getJieqiPlayerView(after, 'black').captured, [{ owner: 'black', role: null }]);
});

test('a piece captured while revealed is known to both players', () => {
  const state = playing({
    d1: up('red', 'general'),
    f10: up('black', 'general'),
    a1: up('red', 'chariot'),
    a3: up('black', 'cannon'), // already face-up
  });
  const after = applyJieqiMove(state, { from: 'a1', to: 'a3' });
  assert.deepEqual(getJieqiPlayerView(after, 'red').captured, [{ owner: 'black', role: 'cannon' }]);
  assert.deepEqual(getJieqiPlayerView(after, 'black').captured, [
    { owner: 'black', role: 'cannon' },
  ]);
});

// ── Truth view (postgame review) ────────────────────────────────────────────

test('jieqiTruthView reveals every identity and captures carry full roles', () => {
  // A dark-piece capture so a still-dark role lands in the capture pool.
  const state = playing({
    d1: up('red', 'general'),
    f10: up('black', 'general'),
    a1: up('red', 'chariot'),
    a3: dark('black', 'cannon'),
    e5: dark('red', 'horse'),
  });
  const after = applyJieqiMove(state, { from: 'a1', to: 'a3' });
  const truth = jieqiTruthView(after);

  // Every occupied square is revealed in the truth view — no faceDown:true.
  for (const [square, entry] of Object.entries(truth.board)) {
    assert.equal(entry?.faceDown, false, `truth square ${square} must be revealed`);
  }
  // The still-dark red horse is revealed by identity in the truth view, unlike
  // the per-player view where the owner's own dark pieces stay masked.
  assert.deepEqual(truth.board.e5, { color: 'red', role: 'horse', faceDown: false });
  // The captured dark piece carries its full role (no per-viewer redaction).
  assert.deepEqual(truth.captured, [{ owner: 'black', role: 'cannon' }]);
  // Truth view is rendered from red's perspective and is never in check / has no
  // legal moves attached (it is a static review projection).
  assert.equal(truth.perspective, 'red');
  assert.equal(truth.inCheck, false);
  assert.deepEqual(truth.legalMoves, []);
});

// ── Public view (live spectators) ───────────────────────────────────────────

test('the public view never holds a role that one of the seats lacks', () => {
  // One dark capture (red takes a dark black cannon: only red learns it) and one
  // revealed capture (black takes a face-up red chariot: public to everyone).
  const state = playing({
    d1: up('red', 'general'),
    f10: up('black', 'general'),
    a1: up('red', 'chariot'),
    a3: dark('black', 'cannon'),
    i10: up('black', 'chariot'),
    i8: up('red', 'chariot'),
    e5: dark('red', 'horse'),
  });
  const afterDarkCapture = applyJieqiMove(state, { from: 'a1', to: 'a3' });
  const after = applyJieqiMove(afterDarkCapture, { from: 'i10', to: 'i8' });

  const spectator = getJieqiPublicView(after);
  const red = getJieqiPlayerView(after, 'red');
  const black = getJieqiPlayerView(after, 'black');

  // The board is the shared mask: dark pieces keep their colour and lose their role.
  assert.deepEqual(spectator.board, red.board);
  assert.deepEqual(spectator.board.e5, { color: 'red', faceDown: true });
  // The dark capture is listed (the piece visibly left the board) with no role,
  // which is what the victim sees; the revealed capture carries its public role.
  assert.deepEqual(spectator.captured, [
    { owner: 'black', role: null },
    { owner: 'red', role: 'chariot' },
  ]);
  assert.deepEqual(red.captured, [
    { owner: 'black', role: 'cannon' },
    { owner: 'red', role: 'chariot' },
  ]);
  // Never more than either seat: each capture's public role is null or agrees
  // with BOTH seats' knowledge of it.
  spectator.captured.forEach((capture, index) => {
    if (capture.role === null) return;
    assert.equal(capture.role, red.captured[index]?.role);
    assert.equal(capture.role, black.captured[index]?.role);
  });
  // Nothing to play from the rail.
  assert.deepEqual(spectator.legalMoves, []);
  assert.equal(spectator.lastMove?.to, 'i8');
});

test('the public view reports check for the side to move from the public board', () => {
  // Black to move, in check from a face-up red chariot on the file.
  const state = playing(
    {
      d1: up('red', 'general'),
      f10: up('black', 'general'),
      a10: up('red', 'chariot'),
    },
    'black',
  );
  assert.equal(getJieqiPublicView(state).inCheck, true);
  assert.equal(getJieqiPlayerView(state, 'black').inCheck, true);
  assert.equal(getJieqiPublicView(playing(state.board, 'red')).inCheck, false);
});
