// The banqi perpetual-chase (長捉) rule: a chase move may not make a position
// appear for the third time (unless it is the only legal move), and a repetition
// caused by a chase, or by fleeing one, never draws. Chases that keep finding new
// squares are never restricted; ordinary shuffles still draw by threefold.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBanqiMove,
  BANQI_CHASE_RULE,
  type BanqiBoard,
  type BanqiChaseRule,
  type BanqiColor,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPiece,
  type BanqiPieceRole,
  type BanqiSquare,
  getBanqiForbiddenChaseMoves,
  getBanqiLegalMoves,
  getBanqiPlayerView,
  isBanqiLegalMove,
} from './variants-banqi.js';

function up(color: BanqiColor, role: BanqiPieceRole): BanqiPiece {
  return { color, role, faceDown: false };
}

function down(color: BanqiColor, role: BanqiPieceRole): BanqiPiece {
  return { color, role, faceDown: true };
}

function mv(from: BanqiSquare, to: BanqiSquare): BanqiMove {
  return { from, to };
}

// Red seat owns red ink and is to move; black's `lastMove` just arrived.
function redToMove(
  board: BanqiBoard,
  lastMove: BanqiMove,
  chaseRule: BanqiChaseRule | null = BANQI_CHASE_RULE,
): BanqiGameState {
  return {
    id: 'chase',
    board,
    status: { type: 'playing', turn: 'red' },
    ply: 10,
    firstColor: 'red',
    moveNumber: 6,
    noProgressClock: 0,
    repCounts: {},
    captures: [],
    lastMove,
    chaseRule,
  };
}

function play(state: BanqiGameState, move: BanqiMove): BanqiGameState {
  assert.ok(isBanqiLegalMove(state, move), `expected ${move.from}${move.to} to be legal`);
  const next = applyBanqiMove(state, move);
  assert.notEqual(next, state);
  return next;
}

/** Play `moves` in order, asserting the game is still on after each one. */
function playAll(state: BanqiGameState, moves: BanqiMove[]): BanqiGameState {
  let s = state;
  for (const [i, m] of moves.entries()) {
    s = play(s, m);
    assert.equal(s.status.type, 'playing', `ply ${i + 1} (${m.from}${m.to}) ended the game`);
  }
  return s;
}

function hasMove(moves: BanqiMove[], move: BanqiMove): boolean {
  return moves.some((m) => m.from === move.from && m.to === move.to);
}

function repeat<T>(items: T[], times: number): T[] {
  return Array.from({ length: times }, () => items).flat();
}

/** The repetition key `move` lands on (the key the apply step increments). */
function keyAfter(state: BanqiGameState, move: BanqiMove): string {
  const next = applyBanqiMove(state, move);
  const key = Object.keys(next.repCounts).find(
    (k) => (next.repCounts[k] ?? 0) !== (state.repCounts[k] ?? 0),
  );
  assert.ok(key, 'move changed no repetition count');
  return key;
}

// Back-and-forth chase on an open board: a red advisor shuttles c3/c2 after a
// black chariot that shuttles d2/d3. Each red step lands next to the chariot
// (advisor > chariot); each black step lands diagonal to the advisor. A 4-ply
// cycle; the third chase that would repeat is on ply 9.
const SHUTTLE = [mv('c3', 'c2'), mv('d2', 'd3'), mv('c2', 'c3'), mv('d3', 'd2')];

function openBoard(extra: BanqiBoard = {}): BanqiBoard {
  return {
    c3: up('red', 'advisor'),
    d2: up('black', 'chariot'),
    h1: up('red', 'soldier'), // gives red other moves
    a4: up('black', 'soldier'), // gives black other moves
    ...extra,
  };
}

test('back-and-forth chase: the chaser may not repeat a position a third time', () => {
  const s = playAll(redToMove(openBoard(), mv('e2', 'd2')), repeat(SHUTTLE, 2));
  const third = SHUTTLE[0]!;
  assert.equal(s.status.type, 'playing', 'the chase never drew');
  assert.deepEqual(getBanqiForbiddenChaseMoves(s), [third]);
  assert.ok(!hasMove(getBanqiLegalMoves(s), third), 'omitted from legal moves');
  assert.equal(isBanqiLegalMove(s, third), false);
  assert.equal(applyBanqiMove(s, third), s, 'validation refuses it');
  // The client sees the same list.
  assert.ok(!hasMove(getBanqiPlayerView(s, 'red').legalMoves, third));
  // A chase to a NEW square, another move by the chaser, or another piece is fine.
  const legal = getBanqiLegalMoves(s);
  assert.ok(hasMove(legal, mv('c3', 'd3')), 'chasing from a new square');
  assert.ok(hasMove(legal, mv('c3', 'b3')));
  assert.ok(hasMove(legal, mv('h1', 'g1')));
});

test('legacy rule (off): the same shuttle is a threefold draw on ply 9', () => {
  let s = redToMove(openBoard(), mv('e2', 'd2'), null);
  let plies = 0;
  while (s.status.type === 'playing' && plies < 40) {
    assert.deepEqual(getBanqiForbiddenChaseMoves(s), []);
    s = applyBanqiMove(s, SHUTTLE[plies % 4]!);
    plies += 1;
  }
  assert.equal(s.status.type === 'finished' && s.status.reason, 'repetition');
  assert.equal(plies, 9);
  assert.ok(!('chaseRule' in getBanqiPlayerView(s, 'red')), 'no rule on a legacy view');
});

test('cyclic chase round a 2x2 block is stopped at the third occurrence', () => {
  // The chariot runs round b2-c2-c3-b3, always to the corner diagonal to the
  // advisor; the advisor follows one corner behind. An 8-ply cycle.
  const board: BanqiBoard = {
    b2: up('red', 'advisor'),
    c3: up('black', 'chariot'),
    h1: up('red', 'soldier'),
    h4: up('black', 'soldier'),
  };
  const cycle = [
    mv('b2', 'c2'),
    mv('c3', 'b3'),
    mv('c2', 'c3'),
    mv('b3', 'b2'),
    mv('c3', 'b3'),
    mv('b2', 'c2'),
    mv('b3', 'b2'),
    mv('c2', 'c3'),
  ];
  const s = playAll(redToMove(board, mv('d3', 'c3')), repeat(cycle, 2));
  assert.equal(s.ply, 10 + 16);
  assert.equal(isBanqiLegalMove(s, cycle[0]!), false);
  assert.deepEqual(getBanqiForbiddenChaseMoves(s), [cycle[0]!]);
  // The other way round the block is a new position, so it is open.
  assert.ok(isBanqiLegalMove(s, mv('b2', 'b3')));

  // Under the legacy rule the same cycle draws on its 17th ply.
  const legacy = playAll(redToMove(board, mv('d3', 'c3'), null), repeat(cycle, 2));
  const drawn = applyBanqiMove(legacy, cycle[0]!);
  assert.equal(drawn.status.type === 'finished' && drawn.status.reason, 'repetition');
});

test('a herding chase onto new squares is never restricted', () => {
  // The chariot runs along rank 1 and back down rank 2; the advisor follows one
  // square behind. 13 chases, every position new.
  const path: BanqiSquare[] = [
    'a1',
    'b1',
    'c1',
    'd1',
    'e1',
    'f1',
    'g1',
    'h1',
    'h2',
    'g2',
    'f2',
    'e2',
    'd2',
    'c2',
    'b2',
  ];
  let s = redToMove(
    { a2: up('red', 'advisor'), b1: up('black', 'chariot'), h4: up('red', 'soldier') },
    mv('b2', 'b1'),
  );
  s = play(s, mv('a2', 'a1'));
  let chases = 1;
  for (let i = 1; i + 1 < path.length; i += 1) {
    s = play(s, mv(path[i]!, path[i + 1]!)); // the chariot flees ahead
    assert.equal(s.status.type, 'playing');
    assert.deepEqual(getBanqiForbiddenChaseMoves(s), []);
    s = play(s, mv(path[i - 1]!, path[i]!)); // the advisor follows: a chase
    assert.equal(s.chasedSquare, path[i + 1]);
    assert.equal(s.status.type, 'playing');
    chases += 1;
  }
  assert.ok(chases >= 12, `only ${chases} chases`);
});

test('a chase that is the only legal move stays legal and does not draw', () => {
  // Red's lone advisor in the corner chases a chariot. Two loops (via a2, then
  // via b1) leave both of the advisor's moves from a1 a third occurrence, and it
  // has no other move, so both stay legal.
  const loopA = [mv('a1', 'a2'), mv('b2', 'b1'), mv('a2', 'a1'), mv('b1', 'b2')];
  const loopB = [mv('a1', 'b1'), mv('b2', 'a2'), mv('b1', 'a1'), mv('a2', 'b2')];
  const start = redToMove({ a1: up('red', 'advisor'), b2: up('black', 'chariot') }, mv('c2', 'b2'));
  const s = playAll(start, [...loopA, ...loopB, ...loopA, ...loopB]);
  assert.equal(s.board.a1?.role, 'advisor');
  assert.equal(s.board.b2?.role, 'chariot');
  assert.deepEqual(getBanqiForbiddenChaseMoves(s), []);
  const legal = getBanqiLegalMoves(s);
  assert.equal(legal.length, 2);
  assert.ok(hasMove(legal, mv('a1', 'a2')));
  assert.ok(hasMove(legal, mv('a1', 'b1')));
  // Played, it reaches the third occurrence and the game goes on.
  const next = play(s, mv('a1', 'a2'));
  assert.equal(next.status.type, 'playing');
});

test('a flee that reaches a third occurrence does not draw', () => {
  // A prelude reaches the chase's start position by ordinary moves, so the
  // chariot's flee back to d2 is its third occurrence in the second loop.
  const board: BanqiBoard = {
    c3: up('red', 'advisor'),
    d1: up('black', 'chariot'),
    h2: up('red', 'soldier'),
    a4: up('black', 'soldier'),
  };
  // Ordinary moves into openBoard()'s position, which is counted once.
  const s = playAll(redToMove(board, mv('a3', 'a4')), [mv('h2', 'h1'), mv('d1', 'd2')]);
  assert.equal(s.chasedSquare, undefined);
  const afterLoops = playAll(s, repeat(SHUTTLE, 2)); // the last flee is occurrence 3
  assert.equal(afterLoops.status.type, 'playing');
  assert.equal(Math.max(...Object.values(afterLoops.repCounts)), 3);
  // The chaser's repeat is still refused.
  assert.equal(isBanqiLegalMove(afterLoops, SHUTTLE[0]!), false);

  // The legacy rule draws on exactly that flee.
  let legacy: BanqiGameState = { ...s, chaseRule: null };
  for (const m of repeat(SHUTTLE, 2)) legacy = applyBanqiMove(legacy, m);
  assert.equal(legacy.status.type === 'finished' && legacy.status.reason, 'repetition');
  assert.equal(legacy.ply, afterLoops.ply);
});

test('an ordinary shuffle with no chase still draws by threefold repetition', () => {
  const board: BanqiBoard = {
    c3: up('red', 'advisor'),
    f3: up('black', 'chariot'),
    h1: up('red', 'soldier'),
    a4: up('black', 'soldier'),
  };
  let s = redToMove(board, mv('a3', 'a4'));
  const cycle = [mv('h1', 'g1'), mv('a4', 'a3'), mv('g1', 'h1'), mv('a3', 'a4')];
  let plies = 0;
  while (s.status.type === 'playing' && plies < 40) {
    s = applyBanqiMove(s, cycle[plies % 4]!);
    plies += 1;
  }
  assert.equal(s.status.type === 'finished' && s.status.reason, 'repetition');
  assert.equal(plies, 9);
});

test('a cannon chasing over a screen is held to the same rule', () => {
  // Face-down tiles on b2 and b3 are screens. The red cannon shuttles c2/c3 and
  // threatens the black horse on a2/a3 by jumping the tile between them.
  const board: BanqiBoard = {
    c2: up('red', 'cannon'),
    a3: up('black', 'horse'),
    b2: down('black', 'soldier'),
    b3: down('red', 'soldier'),
    h4: up('black', 'soldier'),
  };
  const cycle = [mv('c2', 'c3'), mv('a3', 'a2'), mv('c3', 'c2'), mv('a2', 'a3')];
  const s = playAll(redToMove(board, mv('a4', 'a3')), repeat(cycle, 2));
  assert.equal(s.chasedSquare, undefined); // the horse's flee is not a chase
  assert.equal(isBanqiLegalMove(s, cycle[0]!), false);
  assert.ok(!hasMove(getBanqiLegalMoves(s), cycle[0]!));
  assert.ok(hasMove(getBanqiLegalMoves(s), mv('b2', 'b2')), 'flips stay available');
});

test('a mutual chase (two cannons on a line) is an ordinary move', () => {
  // Red's cannon steps to a1 and attacks black's cannon on d1 over the b1 tile.
  // Black's cannon steps back to e1: a flee that still attacks red's cannon, so
  // it is a chase too. That mutual move is not restricted, and a third
  // occurrence it reaches is a threefold draw.
  const board: BanqiBoard = {
    a2: up('red', 'cannon'),
    b1: down('red', 'soldier'),
    d1: up('black', 'cannon'),
    h4: up('red', 'soldier'),
    h3: up('black', 'soldier'),
  };
  const s = play(redToMove(board, mv('d2', 'd1')), mv('a2', 'a1'));
  assert.equal(s.chasedSquare, 'd1', "red's step is a chase");
  const mutual = mv('d1', 'e1');
  const seeded: BanqiGameState = { ...s, repCounts: { ...s.repCounts, [keyAfter(s, mutual)]: 2 } };
  assert.deepEqual(getBanqiForbiddenChaseMoves(seeded), []);
  const drawn = play(seeded, mutual);
  assert.equal(drawn.chasedSquare, 'a1', 'it threatens the red cannon');
  assert.equal(drawn.status.type === 'finished' && drawn.status.reason, 'repetition');

  // Contrast: a plain flee seeded the same way does not draw.
  const flee = mv('d1', 'd2');
  const fleeSeeded: BanqiGameState = {
    ...s,
    repCounts: { ...s.repCounts, [keyAfter(s, flee)]: 2 },
  };
  assert.equal(play(fleeSeeded, flee).status.type, 'playing');
});

test('a protected target still counts as chased', () => {
  // Black's general guards d2 and an advisor guards d3.
  const board = openBoard({ e2: up('black', 'general'), e3: up('black', 'advisor') });
  const s = playAll(redToMove(board, mv('d1', 'd2')), repeat(SHUTTLE, 2));
  assert.equal(isBanqiLegalMove(s, SHUTTLE[0]!), false);
});

test('a soldier chasing the general counts (soldier takes general)', () => {
  const board = openBoard({ c3: up('red', 'soldier'), d2: up('black', 'general') });
  const s = playAll(redToMove(board, mv('e2', 'd2')), repeat(SHUTTLE, 2));
  assert.equal(isBanqiLegalMove(s, SHUTTLE[0]!), false);
});

test('a move next to a piece it cannot take is not a chase', () => {
  // A chariot cannot take an advisor, so shuttling next to it repeats as an
  // ordinary shuffle and draws.
  const board = openBoard({ c3: up('red', 'chariot'), d2: up('black', 'advisor') });
  let s = play(redToMove(board, mv('e2', 'd2')), mv('c3', 'c2'));
  assert.equal(s.chasedSquare, undefined);
  s = redToMove(board, mv('e2', 'd2'));
  let plies = 0;
  while (s.status.type === 'playing' && plies < 40) {
    s = applyBanqiMove(s, SHUTTLE[plies % 4]!);
    plies += 1;
  }
  assert.equal(s.status.type === 'finished' && s.status.reason, 'repetition');
});

test('a state without a chaseRule plays under BANQI_CHASE_RULE', () => {
  const start = redToMove(openBoard(), mv('e2', 'd2'));
  delete start.chaseRule;
  const s = playAll(start, repeat(SHUTTLE, 2));
  assert.equal(isBanqiLegalMove(s, SHUTTLE[0]!), false);
  assert.equal(getBanqiPlayerView(s, 'red').chaseRule, BANQI_CHASE_RULE);
});
