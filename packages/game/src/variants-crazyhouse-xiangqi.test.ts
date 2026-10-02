import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  abortCrazyhouseXiangqiGame,
  applyCrazyhouseXiangqiMove,
  CRAZYHOUSE_XIANGQI_START_FEN,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  crazyhouseXiangqiDropRegion,
  crazyhouseXiangqiFen,
  crazyhouseXiangqiMoveFromUci,
  crazyhouseXiangqiMoveToUci,
  crazyhouseXiangqiPerft,
  crazyhouseXiangqiPositionKey,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiLegalDrops,
  getCrazyhouseXiangqiLegalMoves,
  getCrazyhouseXiangqiPlayerView,
  isCrazyhouseXiangqiLegalMove,
  parseCrazyhouseXiangqiFen,
} from './variants-crazyhouse-xiangqi.js';

function fromFen(fen: string): CrazyhouseXiangqiGameState {
  const parsed = parseCrazyhouseXiangqiFen(fen, 't');
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.state;
}

function play(state: CrazyhouseXiangqiGameState, ...ucis: string[]): CrazyhouseXiangqiGameState {
  let next = state;
  for (const uci of ucis) {
    const move = crazyhouseXiangqiMoveFromUci(uci);
    assert.ok(move, uci);
    next = applyCrazyhouseXiangqiMove(next, move);
  }
  return next;
}

function dropSquares(state: CrazyhouseXiangqiGameState, uciLetter: string): string[] {
  return getCrazyhouseXiangqiLegalMoves(state)
    .map(crazyhouseXiangqiMoveToUci)
    .filter((uci) => uci.startsWith(`${uciLetter}@`))
    .map((uci) => uci.slice(2))
    .sort();
}

test('the start is standard xiangqi with empty hands, and round-trips its FEN', () => {
  const state = createInitialCrazyhouseXiangqiState('t');
  assert.equal(crazyhouseXiangqiFen(state), CRAZYHOUSE_XIANGQI_START_FEN);
  assert.deepEqual(state.hands, { red: {}, black: {} });
  assert.equal(getCrazyhouseXiangqiLegalMoves(state).length, 44);
  assert.equal(
    crazyhouseXiangqiFen(fromFen(CRAZYHOUSE_XIANGQI_START_FEN)),
    CRAZYHOUSE_XIANGQI_START_FEN,
  );
  // Standard xiangqi's perft from the start: no capture is possible before ply 3.
  assert.equal(
    crazyhouseXiangqiPerft({ board: state.board, hands: state.hands, turn: 'red' }, 2),
    1920,
  );
});

test('a capture goes to the capturer’s hand as its own colour', () => {
  const state = play(createInitialCrazyhouseXiangqiState('t'), 'h3h10');
  assert.deepEqual(state.hands, { red: { horse: 1 }, black: {} });
  assert.equal(state.progressClock, 0);
  const recaptured = play(state, 'i10h10');
  assert.deepEqual(recaptured.hands, { red: { horse: 1 }, black: { cannon: 1 } });
  assert.match(crazyhouseXiangqiFen(recaptured), /\[Nc\] w /);
  // Red may now drop its horse; black's cannon waits for black's turn.
  assert.ok(isCrazyhouseXiangqiLegalMove(recaptured, { drop: 'horse', to: 'e5' }));
  assert.ok(!isCrazyhouseXiangqiLegalMove(recaptured, { drop: 'cannon', to: 'e5' }));
  const dropped = play(recaptured, 'N@e5');
  assert.deepEqual(dropped.hands.red, {});
  assert.deepEqual(dropped.board.e5, { color: 'red', role: 'horse' });
});

test('drops go where the piece could stand: advisors, elephants and soldiers', () => {
  // Bare generals off each other's file, red to move with one of each.
  const red = fromFen('4k4/9/9/9/9/9/9/9/9/3K5[ABP] w - - 0 1');
  assert.deepEqual(dropSquares(red, 'A'), ['d3', 'e2', 'f1', 'f3']);
  assert.deepEqual(dropSquares(red, 'B'), ['a3', 'c1', 'c5', 'e3', 'g1', 'g5', 'i3']);
  const soldiers = dropSquares(red, 'P');
  // Home half: only the soldier files' two ranks.
  assert.deepEqual(
    soldiers.filter((s) => Number(s.slice(1)) <= 5),
    ['a4', 'a5', 'c4', 'c5', 'e4', 'e5', 'g4', 'g5', 'i4', 'i5'],
  );
  // Across the river: anywhere empty, except the three points that check e10.
  for (const square of ['e9', 'd10', 'f10']) assert.ok(!soldiers.includes(square), square);
  assert.equal(soldiers.length, 10 + 45 - 1 - 3);
  assert.ok(soldiers.includes('b6') && soldiers.includes('a10'));

  const black = fromFen('4k4/9/9/9/9/9/9/9/9/3K5[abp] b - - 0 1');
  assert.deepEqual(dropSquares(black, 'A'), ['d10', 'd8', 'e9', 'f10', 'f8']);
  assert.deepEqual(dropSquares(black, 'B'), ['a8', 'c10', 'c6', 'e8', 'g10', 'g6', 'i8']);
  const blackSoldiers = dropSquares(black, 'P');
  assert.deepEqual(
    blackSoldiers.filter((s) => Number(s.slice(1)) >= 6),
    ['a6', 'a7', 'c6', 'c7', 'e6', 'e7', 'g6', 'g7', 'i6', 'i7'],
  );
  for (const square of ['d2', 'c1', 'e1']) assert.ok(!blackSoldiers.includes(square), square);
  assert.equal(blackSoldiers.length, 10 + 45 - 1 - 3);
  assert.deepEqual(crazyhouseXiangqiDropRegion('advisor', 'red'), ['d1', 'f1', 'e2', 'd3', 'f3']);
});

test('no nifu: soldiers may share a file', () => {
  const state = fromFen('4k4/9/9/9/9/9/P8/9/9/3K5[P] w - - 0 1');
  assert.ok(isCrazyhouseXiangqiLegalMove(state, { drop: 'soldier', to: 'a5' }));
});

test('a drop may not give check, a cannon screen included', () => {
  // Red cannon on e5 bears on the black general along the e-file once it has a screen.
  const state = fromFen('4k4/9/9/9/9/4C4/9/9/9/3K5[NR] w - - 0 1');
  const horse = dropSquares(state, 'N');
  // Any point between general and cannon becomes the screen.
  for (const square of ['e9', 'e8', 'e7', 'e6']) assert.ok(!horse.includes(square), square);
  // A horse a jump from the general with a free leg checks directly.
  for (const square of ['g9', 'c9']) assert.ok(!horse.includes(square), square);
  // A hobbled jump or a point off every line is fine.
  assert.ok(horse.includes('f9') && horse.includes('d7') && horse.includes('a1'));
  const chariot = dropSquares(state, 'R');
  // On rank 10 or the e-file the chariot checks; elsewhere it is free.
  for (const square of ['a10', 'd10', 'f10', 'i10', 'e8'])
    assert.ok(!chariot.includes(square), square);
  assert.ok(chariot.includes('a9') && chariot.includes('e4'));
  // A board move may still check: drops are the only thing forbidden.
  assert.ok(isCrazyhouseXiangqiLegalMove(state, { from: 'd1', to: 'd2' }));
});

test('a drop must parry a check, and may not open one on its own general', () => {
  // Black chariot on e5 checks the red general on e1; red holds a horse.
  const inCheck = fromFen('3k5/9/9/9/9/4r4/9/9/9/4K4[N] w - - 0 1');
  const parries = getCrazyhouseXiangqiLegalDrops(inCheck, 'horse')
    .map((m) => m.to)
    .sort();
  assert.deepEqual(parries, ['e2', 'e3', 'e4']);
  // Black cannon on e5 with nothing between it and the red general: a piece
  // dropped between them becomes its screen.
  const screen = fromFen('3k5/9/9/9/9/4c4/9/9/9/4K4[N] w - - 0 1');
  const drops: string[] = getCrazyhouseXiangqiLegalDrops(screen, 'horse').map((m) => m.to);
  for (const square of ['e2', 'e3', 'e4']) assert.ok(!drops.includes(square), square);
  assert.ok(drops.includes('a1'));
});

test('stalemate loses, and a piece in hand is a move', () => {
  const before = '4k4/9/9/4P4/9/9/9/9/3R1R3/4K4[] w - - 0 1';
  const stalemated = play(fromFen(before), 'e7e8');
  assert.deepEqual(stalemated.status, { type: 'finished', winner: 'red', reason: 'stalemate' });
  const withHand = play(fromFen(before.replace('[]', '[n]')), 'e7e8');
  assert.equal(withHand.status.type, 'playing');
});

test('three-fold repetition draws, counting hands', () => {
  const start = createInitialCrazyhouseXiangqiState('t');
  const shuffle = ['b1c3', 'b10c8', 'c3b1', 'c8b10'];
  const twice = play(start, ...shuffle, ...shuffle.slice(0, 3));
  assert.equal(twice.status.type, 'playing');
  const thrice = play(twice, shuffle[3]!);
  assert.deepEqual(thrice.status, { type: 'finished', winner: null, reason: 'repetition' });
  // The same board with different hands is a different position.
  const a = { board: start.board, hands: { red: {}, black: {} }, turn: 'red' as const };
  const b = { board: start.board, hands: { red: { soldier: 1 }, black: {} }, turn: 'red' as const };
  assert.notEqual(crazyhouseXiangqiPositionKey(a), crazyhouseXiangqiPositionKey(b));
});

test('perpetual check loses (chasing)', () => {
  const state = fromFen('4k4/9/9/9/9/9/9/9/9/R2K5[] w - - 0 1');
  const loop = ['a10a9', 'e9e10', 'a9a10', 'e10e9'];
  const ended = play(state, 'a1a10', 'e10e9', ...loop, ...loop.slice(0, 3));
  assert.deepEqual(ended.status, { type: 'finished', winner: 'black', reason: 'chasing' });
});

test('checkmate wins, unless a piece in hand can be dropped to block', () => {
  // A chariot checks along rank 10; the other one covers e9.
  const before = '4k4/8R/9/9/9/9/9/9/9/R2K5[] w - - 0 1';
  const mated = play(fromFen(before), 'a1a10');
  assert.deepEqual(mated.status, { type: 'finished', winner: 'red', reason: 'checkmate' });
  // With an elephant in hand black blocks on c10, its own elephant point.
  const blocked = play(fromFen(before.replace('[]', '[b]')), 'a1a10');
  assert.equal(blocked.status.type, 'playing');
  assert.deepEqual(getCrazyhouseXiangqiLegalMoves(blocked).map(crazyhouseXiangqiMoveToUci), [
    'B@c10',
  ]);
});

test('the FEN parser rejects what play cannot produce', () => {
  const bad = [
    '4k4/9/9/9/9/9/9/9/9/3K5[K] w - - 0 1', // general in hand
    '4k4/9/9/9/9/9/9/9/9/3K5[RRRRR] w - - 0 1', // five chariots
    '4k4/9/9/9/9/9/9/9/A8/3K5[] w - - 0 1', // advisor off its points
    '4k4/9/9/9/9/9/1P7/9/9/3K5[] w - - 0 1', // red soldier on b4
    '4k4/9/9/9/9/9/9/9/9/4K4[] w - - 0 1', // facing generals
    '3rk4/9/9/9/9/9/9/9/9/3K5[] b - - 0 1', // red general attacked, black to move
    '4k4/9/9/9/9/9/9/9/9/3K5[X] w - - 0 1', // unknown pocket piece
  ];
  for (const fen of bad) assert.equal(parseCrazyhouseXiangqiFen(fen).ok, false, fen);
});

test('UCI: board moves are from+to, drops are Fairy-Stockfish letters for either side', () => {
  const cases: [CrazyhouseXiangqiMove, string][] = [
    [{ from: 'b10', to: 'c8' }, 'b10c8'],
    [{ drop: 'elephant', to: 'c5' }, 'B@c5'],
    [{ drop: 'advisor', to: 'e9' }, 'A@e9'],
    [{ drop: 'horse', to: 'e5' }, 'N@e5'],
    [{ drop: 'chariot', to: 'a10' }, 'R@a10'],
    [{ drop: 'cannon', to: 'b3' }, 'C@b3'],
    [{ drop: 'soldier', to: 'i4' }, 'P@i4'],
  ];
  for (const [move, uci] of cases) {
    assert.equal(crazyhouseXiangqiMoveToUci(move), uci);
    assert.deepEqual(crazyhouseXiangqiMoveFromUci(uci), move);
  }
  assert.equal(crazyhouseXiangqiMoveFromUci('K@e5'), null);
  assert.equal(crazyhouseXiangqiMoveFromUci('e11e10'), null);
});

test('illegal moves and finished games throw; abort keeps the board', () => {
  const start = createInitialCrazyhouseXiangqiState('t');
  assert.throws(() => applyCrazyhouseXiangqiMove(start, { drop: 'horse', to: 'e5' }));
  assert.throws(() => applyCrazyhouseXiangqiMove(start, { from: 'a1', to: 'a5' }));
  const aborted = abortCrazyhouseXiangqiGame(start, 'user-abort');
  assert.deepEqual(aborted.status, { type: 'aborted', reason: 'user-abort' });
  assert.deepEqual(getCrazyhouseXiangqiLegalMoves(aborted), []);
  assert.throws(() => applyCrazyhouseXiangqiMove(aborted, { from: 'b1', to: 'c3' }));
});

test('the player view carries both hands and the check flag', () => {
  const state = play(createInitialCrazyhouseXiangqiState('t'), 'h3h10', 'i10h10');
  const view = getCrazyhouseXiangqiPlayerView(state, 'black');
  assert.deepEqual(view.hands, { red: { horse: 1 }, black: { cannon: 1 } });
  assert.equal(view.inCheck, false);
  assert.ok(view.legalMoves.some((m) => 'drop' in m && m.drop === 'horse'));
  view.hands.red.horse = 9;
  assert.equal(state.hands.red.horse, 1);
  const checked = fromFen('3k5/9/9/9/9/4r4/9/9/9/4K4[N] w - - 0 1');
  assert.equal(getCrazyhouseXiangqiPlayerView(checked, 'red').inCheck, true);
});
