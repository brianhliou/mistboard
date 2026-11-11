import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_BANQI_SQUARES,
  applyBanqiMove,
  assertValidBanqiDeal,
  type BanqiBoard,
  type BanqiColor,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPiece,
  type BanqiPieceRole,
  banqiInkForSeat,
  banqiLastMoverInk,
  banqiMoverInk,
  banqiNoProgressLimitOf,
  banqiRulesFromView,
  banqiSeatToMove,
  banqiSquareFromIndex,
  banqiTruthView,
  createBanqiDeal,
  createBanqiSetup,
  createInitialBanqiState,
  DEFAULT_NO_PROGRESS_PLY_LIMIT,
  getBanqiLegalMoves,
  getBanqiLegalMovesFrom,
  getBanqiPlayerView,
  isBanqiLegalMove,
  LEGACY_BANQI_NO_PROGRESS_PLY_LIMIT,
  LEGACY_BANQI_RULES,
  oppositeBanqiColor,
  readBanqiSetup,
  STANDARD_BANQI_DEAL,
} from './variants-banqi.js';

function up(color: BanqiColor, role: BanqiPieceRole): BanqiPiece {
  return { color, role, faceDown: false };
}

function down(color: BanqiColor, role: BanqiPieceRole): BanqiPiece {
  return { color, role, faceDown: true };
}

// A mid-game state where the `first` seat (to move at ply 0) owns `moverInk`.
function playingFor(board: BanqiBoard, moverInk: BanqiColor = 'red'): BanqiGameState {
  return {
    id: 'test',
    board,
    status: { type: 'playing', turn: 'red' },
    ply: 0,
    firstColor: moverInk,
    moveNumber: 1,
    noProgressClock: 0,
    repCounts: {},
    captures: [],
  };
}

function dests(state: BanqiGameState, from: BanqiMove['from']): string[] {
  return getBanqiLegalMovesFrom(state, from)
    .map((m) => m.to)
    .sort();
}

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ── Setup + deal ──────────────────────────────────────────────────────────────

test('initial state is 32 face-down pieces, no ink bound, first seat flips only', () => {
  const deal = createBanqiDeal(seededRng(7));
  const state = createInitialBanqiState('init', deal);

  assert.equal(Object.keys(state.board).length, 32);
  assert.ok(Object.values(state.board).every((p) => p?.faceDown === true));
  assert.equal(state.status.type === 'playing' && state.status.turn, 'red');
  assert.equal(state.ply, 0);
  assert.equal(state.firstColor, null);
  assert.equal(banqiSeatToMove(state), 'red');
  assert.equal(banqiMoverInk(state), null); // ink unbound until the first flip

  // Pre-binding: every legal action is a flip (one per square).
  const moves = getBanqiLegalMoves(state);
  assert.equal(moves.length, 32);
  assert.ok(moves.every((m) => m.from === m.to));
});

test('createBanqiDeal is a valid permutation of the 32-piece set', () => {
  const deal = createBanqiDeal(seededRng(99));
  assert.doesNotThrow(() => assertValidBanqiDeal(deal));
  assert.equal(deal.filter((p) => p.color === 'red').length, 16);
  assert.equal(deal.filter((p) => p.color === 'black').length, 16);
  assert.equal(deal.filter((p) => p.role === 'soldier').length, 10); // 5 per side
  assert.equal(deal.filter((p) => p.role === 'general').length, 2);
});

test('assertValidBanqiDeal rejects wrong length and wrong multiset', () => {
  const deal = createBanqiDeal(seededRng(1));
  assert.throws(() => assertValidBanqiDeal(deal.slice(0, 31)));
  const bad: BanqiDeal = deal.map((p, i) => (i === 0 ? { color: 'red', role: 'general' } : p));
  // two red generals now (a1 forced to red general), one black general missing
  assert.throws(() => assertValidBanqiDeal(bad));
});

// ── Flip + first-flip ink binding ──────────────────────────────────────────────

test('first flip binds the first seat to the revealed ink', () => {
  const deal = createBanqiDeal(seededRng(42));
  const state = createInitialBanqiState('bind', deal);
  const revealedInk = deal[0].color; // a1 = square index 0

  const next = applyBanqiMove(state, { from: 'a1', to: 'a1' });

  assert.equal(next.firstColor, revealedInk);
  assert.equal(banqiInkForSeat(next, 'red'), revealedInk); // opener reveals their own ink
  assert.equal(next.board.a1?.faceDown, false);
  assert.equal(next.ply, 1);
  // The second seat is now to move, owning the opposite ink.
  assert.equal(next.status.type === 'playing' && next.status.turn, 'black');
  assert.equal(banqiMoverInk(next), oppositeBanqiColor(revealedInk));
});

// ── Per-piece move generation (one orthogonal step) ────────────────────────────

test('soldier steps one square and captures along the ladder (general yes, advisor no)', () => {
  const board: BanqiBoard = {
    d2: up('red', 'soldier'),
    d3: up('black', 'general'), // soldier captures general (cycle)
    d1: up('black', 'advisor'), // soldier cannot capture advisor
    c2: up('black', 'soldier'), // equal rank → capturable
    // e2 left empty → a quiet step
  };
  const state = playingFor(board, 'red');
  assert.deepEqual(dests(state, 'd2'), ['c2', 'd3', 'e2']);
});

test('general captures down the ladder but not the soldier', () => {
  const board: BanqiBoard = {
    d2: up('red', 'general'),
    d3: up('black', 'soldier'), // general cannot capture soldier (cycle)
    d1: up('black', 'advisor'), // general > advisor → capture
    c2: up('black', 'general'), // equal rank → capture
  };
  const state = playingFor(board, 'red');
  assert.deepEqual(dests(state, 'd2'), ['c2', 'd1', 'e2']);
});

test('chariot moves exactly one orthogonal step (banqi does NOT slide)', () => {
  const board: BanqiBoard = { a1: up('red', 'chariot') };
  const state = playingFor(board, 'red');
  // A xiangqi chariot would reach the whole rank/file; banqi steps once.
  assert.deepEqual(dests(state, 'a1'), ['a2', 'b1']);
});

test('a piece is blocked by friendly, face-down, and uncapturable enemy neighbours', () => {
  const board: BanqiBoard = {
    d2: up('red', 'horse'),
    d3: up('red', 'soldier'), // friendly → blocked
    d1: down('black', 'soldier'), // face-down → blocked (identity unknown)
    c2: up('black', 'general'), // horse < general → uncapturable
    e2: up('black', 'horse'), // equal rank → capturable
  };
  const state = playingFor(board, 'red');
  assert.deepEqual(dests(state, 'd2'), ['e2']);
});

// ── Cannon ─────────────────────────────────────────────────────────────────────

test('cannon makes a single non-capturing step and does not slide', () => {
  const board: BanqiBoard = { a1: up('red', 'cannon') }; // empty board otherwise
  const state = playingFor(board, 'red');
  assert.deepEqual(dests(state, 'a1'), ['a2', 'b1']);
});

test('cannon captures a revealed enemy across exactly one screen (screen may be face-down)', () => {
  const board: BanqiBoard = {
    a1: up('red', 'cannon'),
    c1: down('red', 'advisor'), // the screen — face-down is fine
    e1: up('black', 'soldier'), // the target — revealed enemy
  };
  const state = playingFor(board, 'red');
  // Non-capturing step b1 / a2, plus the screen capture on e1. Not c1 (the screen).
  assert.deepEqual(dests(state, 'a1'), ['a2', 'b1', 'e1']);
});

test('cannon cannot capture a face-down target (target must be revealed)', () => {
  const board: BanqiBoard = {
    a1: up('red', 'cannon'),
    c1: up('red', 'advisor'), // screen
    e1: down('black', 'soldier'), // face-down target → no capture
  };
  const state = playingFor(board, 'red');
  assert.deepEqual(dests(state, 'a1'), ['a2', 'b1']);
});

// ── Illegal moves ──────────────────────────────────────────────────────────────

test('applyBanqiMove rejects an illegal move by returning the same state', () => {
  const board: BanqiBoard = { a1: up('red', 'chariot'), c1: up('red', 'horse') };
  const state = playingFor(board, 'red');
  const next = applyBanqiMove(state, { from: 'a1', to: 'c1' }); // onto a friendly
  assert.equal(next, state);
});

// ── Draw: no-progress clock (60 plies, 40 before 2026-10-17; resets on capture OR flip)

test('a new game is not drawn at 40 quiet plies and is drawn at 60', () => {
  const board: BanqiBoard = { a1: up('red', 'chariot'), h4: up('black', 'chariot') };
  assert.equal(DEFAULT_NO_PROGRESS_PLY_LIMIT, 60);
  const fresh = createInitialBanqiState('fresh', STANDARD_BANQI_DEAL);
  assert.equal(banqiNoProgressLimitOf(fresh), 60);
  assert.equal(createBanqiSetup(() => 0.5).noProgressLimit, 60);
  const at40 = applyBanqiMove(
    { ...playingFor(board, 'red'), noProgressClock: 39 },
    {
      from: 'a1',
      to: 'b1',
    },
  );
  assert.equal(at40.noProgressClock, 40);
  assert.equal(at40.status.type, 'playing');
  const at60 = applyBanqiMove(
    { ...playingFor(board, 'red'), noProgressClock: 59 },
    {
      from: 'a1',
      to: 'b1',
    },
  );
  assert.equal(at60.noProgressClock, 60);
  assert.equal(at60.status.type === 'finished' && at60.status.reason, 'no-progress');
});

test('a game created under the old rules still draws at 40', () => {
  const board: BanqiBoard = { a1: up('red', 'chariot'), h4: up('black', 'chariot') };
  const legacy = createInitialBanqiState('old', STANDARD_BANQI_DEAL, LEGACY_BANQI_RULES);
  assert.equal(banqiNoProgressLimitOf(legacy), LEGACY_BANQI_NO_PROGRESS_PLY_LIMIT);
  const next = applyBanqiMove(
    { ...playingFor(board, 'red'), noProgressLimit: legacy.noProgressLimit, noProgressClock: 39 },
    { from: 'a1', to: 'b1' },
  );
  assert.equal(next.noProgressClock, 40);
  assert.equal(next.status.type === 'finished' && next.status.reason, 'no-progress');
  // The view carries the limit, so a client replays the game under it.
  assert.equal(getBanqiPlayerView(legacy, 'red').noProgressLimit, 40);
  assert.equal(getBanqiPlayerView(fresh60(), 'red').noProgressLimit, 60);
});

test('stored setups read their limit fail-closed: only the current limit reads as 60', () => {
  const deal = STANDARD_BANQI_DEAL;
  // A bare deal (before the 長捉 rule) and a 10-09 setup without the field: 40.
  assert.equal(readBanqiSetup([...deal]).rules.noProgressLimit, 40);
  assert.equal(
    readBanqiSetup({ deal: [...deal], chaseRule: 'repetition' }).rules.noProgressLimit,
    40,
  );
  // An unknown value never reads as the current limit.
  assert.equal(
    readBanqiSetup({ deal: [...deal], chaseRule: 'repetition', noProgressLimit: 80 }).rules
      .noProgressLimit,
    40,
  );
  assert.equal(
    readBanqiSetup({ deal: [...deal], chaseRule: 'repetition', noProgressLimit: 60 }).rules
      .noProgressLimit,
    60,
  );
  // No stored setup (tests, the seed projection): the current defaults.
  assert.deepEqual(readBanqiSetup(undefined).rules, {});
  // A view without the field (a client of an older server) replays at 40.
  assert.equal(banqiRulesFromView({}).noProgressLimit, 40);
  assert.equal(banqiRulesFromView({ noProgressLimit: 60 }).noProgressLimit, 60);
});

function fresh60(): BanqiGameState {
  return createInitialBanqiState('fresh', STANDARD_BANQI_DEAL);
}

test('no-progress clock draws at the limit', () => {
  const board: BanqiBoard = { a1: up('red', 'chariot'), h4: up('black', 'chariot') };
  const state: BanqiGameState = {
    ...playingFor(board, 'red'),
    noProgressClock: DEFAULT_NO_PROGRESS_PLY_LIMIT - 1,
  };
  const next = applyBanqiMove(state, { from: 'a1', to: 'b1' }); // a quiet move
  assert.equal(next.noProgressClock, DEFAULT_NO_PROGRESS_PLY_LIMIT);
  assert.equal(next.status.type, 'finished');
  assert.equal(next.status.type === 'finished' && next.status.reason, 'no-progress');
  assert.equal(next.status.type === 'finished' && next.status.winner, null);
});

test('a flip resets the no-progress clock', () => {
  const board: BanqiBoard = { a1: up('red', 'chariot'), h4: down('black', 'soldier') };
  const state: BanqiGameState = {
    ...playingFor(board, 'red'),
    noProgressClock: DEFAULT_NO_PROGRESS_PLY_LIMIT - 1,
  };
  const next = applyBanqiMove(state, { from: 'h4', to: 'h4' }); // flip resets
  assert.equal(next.noProgressClock, 0);
  assert.equal(next.status.type, 'playing');
});

test('a capture resets the no-progress clock', () => {
  // h4 keeps black alive so the game continues past the capture.
  const board: BanqiBoard = {
    a1: up('red', 'chariot'),
    b1: up('black', 'horse'),
    h4: up('black', 'chariot'),
  };
  const state: BanqiGameState = {
    ...playingFor(board, 'red'),
    noProgressClock: DEFAULT_NO_PROGRESS_PLY_LIMIT - 1,
  };
  const next = applyBanqiMove(state, { from: 'a1', to: 'b1' }); // chariot > horse
  assert.equal(next.noProgressClock, 0);
  assert.equal(next.captures.length, 1);
  assert.equal(next.status.type, 'playing');
});

// ── Draw: threefold repetition ─────────────────────────────────────────────────

test('threefold position repetition is a draw (before the no-progress clock)', () => {
  const board: BanqiBoard = { a1: up('red', 'chariot'), h4: up('black', 'chariot') };
  let state = playingFor(board, 'red');
  const cycle: BanqiMove[] = [
    { from: 'a1', to: 'b1' },
    { from: 'h4', to: 'g4' },
    { from: 'b1', to: 'a1' },
    { from: 'g4', to: 'h4' },
  ];
  let i = 0;
  while (state.status.type === 'playing' && i < 60) {
    state = applyBanqiMove(state, cycle[i % 4]);
    i += 1;
  }
  assert.equal(state.status.type, 'finished');
  assert.equal(state.status.type === 'finished' && state.status.reason, 'repetition');
  assert.equal(state.status.type === 'finished' && state.status.winner, null);
  // It fired on repetition, not on the no-progress clock.
  assert.ok(state.noProgressClock < DEFAULT_NO_PROGRESS_PLY_LIMIT);
});

// ── Win: no legal move (subsumes all-pieces-captured) ──────────────────────────

test('capturing the opponents last movable piece with no flips left wins', () => {
  // The `first` seat owns black ink and is to move; it takes red's lone soldier,
  // leaving the `second` seat (red ink) with no piece and no flip → it loses.
  const board: BanqiBoard = { a4: up('red', 'soldier'), b4: up('black', 'soldier') };
  const state = playingFor(board, 'black'); // first seat = black ink
  const next = applyBanqiMove(state, { from: 'b4', to: 'a4' });

  assert.equal(banqiSeatToMove(next), 'black');
  assert.equal(banqiMoverInk(next), 'red'); // the side with nothing left
  assert.equal(getBanqiLegalMoves(next).length, 0);
  assert.equal(next.status.type, 'finished');
  assert.equal(next.status.type === 'finished' && next.status.reason, 'stalemate');
  assert.equal(next.status.type === 'finished' && next.status.winner, 'red');
});

test('flipping the last face-down tile that leaves the flipper with nothing ends the game at once', () => {
  // The `red` seat (red ink) has no piece left and only the last face-down tile
  // to flip; it reveals a black piece, so after the flip red owns nothing and no
  // flips remain. Black is to move but red can never act again — the game must
  // end now (black wins) instead of forcing black to play a pointless move first.
  const board: BanqiBoard = {
    a1: up('black', 'general'),
    h4: down('black', 'soldier'), // the last face-down tile, dealt to black
  };
  const state = playingFor(board, 'red'); // red seat = red ink, red to move
  assert.deepEqual(getBanqiLegalMoves(state), [{ from: 'h4', to: 'h4' }]); // flip is red's only move

  const next = applyBanqiMove(state, { from: 'h4', to: 'h4' });

  assert.equal(banqiSeatToMove(next), 'black'); // it is black's turn...
  assert.equal(next.status.type, 'finished'); // ...but the game is already over
  assert.equal(next.status.type === 'finished' && next.status.reason, 'stalemate');
  assert.equal(next.status.type === 'finished' && next.status.winner, 'black');
});

test('a side wiped out while only OPPONENT tiles remain to flip loses at once', () => {
  // Black ink (the `red` seat) captures red ink's last piece while a black tile is
  // still face-down. Red ink is now to move and DOES have a legal move — it could
  // flip that tile — but the tile is black's, so red can never hold a piece again.
  // The game ends now (the `red` seat / black ink wins) instead of forcing red ink
  // to flip black's tiles out first. This is the case the no-face-down-tiles rule
  // missed: a legal flip exists, yet the side is provably eliminated because no
  // tile of its OWN colour remains.
  const board: BanqiBoard = {
    a4: up('red', 'soldier'), // red ink's last piece
    b4: up('black', 'chariot'), // black ink captures it (chariot outranks soldier)
    h1: down('black', 'advisor'), // a black tile still face-down: a legal flip, but not red's colour
  };
  const state = playingFor(board, 'black'); // `red` seat owns black ink and moves first
  const next = applyBanqiMove(state, { from: 'b4', to: 'a4' });

  assert.equal(banqiSeatToMove(next), 'black'); // the `black` seat (red ink) is to move...
  assert.equal(banqiMoverInk(next), 'red'); // ...the side that was just wiped out
  assert.ok(ALL_BANQI_SQUARES.some((sq) => next.board[sq]?.faceDown)); // a legal flip WAS available
  assert.equal(next.status.type, 'finished'); // ...yet the game is already over
  assert.equal(next.status.type === 'finished' && next.status.reason, 'stalemate');
  assert.equal(next.status.type === 'finished' && next.status.winner, 'red');
});

// ── Symmetric information (§8) ─────────────────────────────────────────────────

test('both seats see the identical masked board; face-down tiles carry no ink', () => {
  const board: BanqiBoard = {
    a1: up('red', 'chariot'),
    b1: down('black', 'general'), // a hidden black general
    c1: down('red', 'soldier'),
    h4: up('black', 'horse'),
  };
  const state = playingFor(board, 'red'); // first seat to move

  const firstView = getBanqiPlayerView(state, 'red');
  const secondView = getBanqiPlayerView(state, 'black');

  assert.deepEqual(firstView.board, secondView.board); // identical mask for both
  assert.deepEqual(firstView.board.b1, { faceDown: true }); // no ink leaked
  assert.deepEqual(firstView.board.a1, { color: 'red', role: 'chariot', faceDown: false });

  // Player views carry each seat's own candidate moves even while waiting.
  assert.ok(firstView.legalMoves.length > 0);
  assert.ok(secondView.legalMoves.length > 0);
  assert.equal(firstView.firstColor, 'red'); // binding exposed for client rendering
});

test('truth view reveals every face-down identity (postgame only)', () => {
  const board: BanqiBoard = { a1: up('red', 'chariot'), b1: down('black', 'general') };
  const state = playingFor(board, 'red');
  const truth = banqiTruthView(state);
  assert.deepEqual(truth.board.b1, { color: 'black', role: 'general', faceDown: false });
});

// ── Geometry sanity ────────────────────────────────────────────────────────────

test('square indexing matches the engine convention (a1=0 … h4=31)', () => {
  assert.equal(ALL_BANQI_SQUARES.length, 32);
  assert.equal(banqiSquareFromIndex(0), 'a1');
  assert.equal(banqiSquareFromIndex(7), 'h1');
  assert.equal(banqiSquareFromIndex(8), 'a2');
  assert.equal(banqiSquareFromIndex(31), 'h4');
});

test('banqiLastMoverInk is null before anything has been played', () => {
  assert.equal(banqiLastMoverInk({ ply: 0, firstColor: null }), null);
  assert.equal(banqiLastMoverInk({ ply: 0, firstColor: 'red' }), null);
});

test('banqiLastMoverInk alternates with ply, one behind the side to move', () => {
  // The red SEAT acts on even ply, so the action at ply - 1 was red's when ply is odd.
  assert.equal(banqiLastMoverInk({ ply: 1, firstColor: 'red' }), 'red');
  assert.equal(banqiLastMoverInk({ ply: 2, firstColor: 'red' }), 'black');
  assert.equal(banqiLastMoverInk({ ply: 3, firstColor: 'red' }), 'red');
});

test('banqiLastMoverInk follows the bound ink, not the seat name', () => {
  // firstColor 'black' means the red SEAT plays BLACK ink. A caller that compared
  // the seat to a piece colour would get every answer backwards.
  assert.equal(banqiLastMoverInk({ ply: 1, firstColor: 'black' }), 'black');
  assert.equal(banqiLastMoverInk({ ply: 2, firstColor: 'black' }), 'red');
});

test('banqiLastMoverInk reports the flipper, not the ink the flip revealed', () => {
  let state = createInitialBanqiState('ink', STANDARD_BANQI_DEAL);
  state = applyBanqiMove(state, { from: 'a1', to: 'a1' });
  // The opening flip BINDS the seat to what it turned up, so the two agree here.
  assert.equal(banqiLastMoverInk(state), state.board.a1?.color);

  // Later flips are where they part company: a flip reveals a random tile, so the
  // revealed colour says nothing about who acted. Walk until one disagrees.
  let disagreed = false;
  for (const square of ALL_BANQI_SQUARES) {
    if (state.board[square]?.faceDown !== true) continue;
    const next = applyBanqiMove(state, { from: square, to: square });
    if (next === state) continue;
    const mover = banqiLastMoverInk(next);
    assert.equal(mover, banqiInkForSeat(next, next.ply % 2 === 1 ? 'red' : 'black'));
    if (mover !== next.board[square]?.color) disagreed = true;
    state = next;
    if (disagreed) break;
  }
  assert.ok(disagreed, 'expected a flip whose revealed ink differs from the flipper');
});

void isBanqiLegalMove; // exercised via applyBanqiMove; exported for the server
