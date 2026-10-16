// Threefold repetition and the perpetual-check loss (jieqi follows xiangqi).
// The kernel ends a `repetition: true` game on the third occurrence of a
// position; jieqiPerpetualCheckLoser names a one-sided perpetual checker, which
// the server tenant turns into a 'chasing' loss.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiPlayerView,
  getJieqiPublicView,
  type JieqiBoard,
  type JieqiColor,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPieceRole,
  jieqiPerpetualCheckLoser,
  jieqiPositionKey,
} from './variants-jieqi.js';

// mistboard.com/jieqi/game/jq_e6ba8d8a-00f1-4c27-a024-66474a5f4290 (2026-10-05):
// AB-JChess (red) against a guest (black). After red's 27th ply, Ke1-d1, black
// had a perpetual: Rb1+ Kd2 Rb2+ Kd1, round and round. Before the rule the cycle
// ran on to the 120-ply no-capture draw.
export const EXAMPLE_DEAL: JieqiDeal = {
  red: [
    'soldier',
    'elephant',
    'chariot',
    'soldier',
    'horse',
    'soldier',
    'cannon',
    'soldier',
    'soldier',
    'chariot',
    'horse',
    'cannon',
    'advisor',
    'elephant',
    'advisor',
  ] as JieqiPieceRole[],
  black: [
    'horse',
    'soldier',
    'soldier',
    'soldier',
    'chariot',
    'advisor',
    'soldier',
    'cannon',
    'cannon',
    'elephant',
    'chariot',
    'soldier',
    'advisor',
    'horse',
    'elephant',
  ] as JieqiPieceRole[],
};

export const EXAMPLE_OPENING =
  'c4-c5 c10-e8 b3-b6 i7-i6 b1-c3 h8-h1 c5-a5 b10-a8 a5-a8 a10-a8 h3-h9 h1-g1 h9-a9 a8-a4 ' +
  'a1-a4 g1-f1 i1-f1 i6-i4 e4-e5 i4-g4 d1-e2 g4-c4 c1-e3 c4-a4 e3-d3 a4-b4 e1-d1';

// Black checks on every move; red only steps the general.
export const EXAMPLE_PERPETUAL = 'b4-b1 d1-d2 b1-b2 d2-d1 b2-b1 d1-d2 b1-b2 d2-d1 b2-b1';

export function parseMoves(line: string): JieqiMove[] {
  return line.split(' ').map((token) => {
    const [from, to] = token.split('-');
    return { from, to } as JieqiMove;
  });
}

function play(state: JieqiGameState, line: string): JieqiGameState {
  let current = state;
  for (const move of parseMoves(line)) {
    assert.equal(current.status.type, 'playing', `game ended before ${move.from}-${move.to}`);
    const next = applyJieqiMove(current, move);
    assert.notEqual(next, current, `illegal move ${move.from}-${move.to}`);
    current = next;
  }
  return current;
}

// A hand-built position with the rule switched on.
function enforcing(board: JieqiBoard, turn: JieqiColor = 'red'): JieqiGameState {
  const key = jieqiPositionKey(board, turn);
  return {
    id: 'rep',
    board,
    status: { type: 'playing', turn },
    moveNumber: 1,
    noCaptureClock: 0,
    captures: [],
    positionCounts: { [key]: 1 },
    repetitionLog: [{ key }],
  };
}

test('the example game: black perpetual-checks to a threefold and is named the loser', () => {
  const start = createInitialJieqiState('example', EXAMPLE_DEAL, { repetition: true });
  const afterOpening = play(start, EXAMPLE_OPENING);
  assert.deepEqual(afterOpening.status, { type: 'playing', turn: 'black' });

  const end = play(afterOpening, EXAMPLE_PERPETUAL);
  assert.deepEqual(end.status, { type: 'finished', winner: null, reason: 'repetition' });
  assert.equal(jieqiPerpetualCheckLoser(end), 'black');
});

test('the example cycle is not a third occurrence one ply earlier', () => {
  const start = createInitialJieqiState('example', EXAMPLE_DEAL, { repetition: true });
  const moves = EXAMPLE_PERPETUAL.split(' ');
  const state = play(start, `${EXAMPLE_OPENING} ${moves.slice(0, -1).join(' ')}`);
  assert.equal(state.status.type, 'playing');
});

test('without the flag the same cycle plays on (replays, analysis, old games)', () => {
  const start = createInitialJieqiState('example', EXAMPLE_DEAL);
  const end = play(start, `${EXAMPLE_OPENING} ${EXAMPLE_PERPETUAL} d1-d2 b1-b2 d2-d1`);
  assert.equal(end.status.type, 'playing');
  assert.equal(end.positionCounts, undefined);
  assert.equal(end.repetitionLog, undefined);
});

test('a cycle with no checks is a draw', () => {
  const state = enforcing({
    e1: { color: 'red', role: 'general', faceDown: false },
    a1: { color: 'red', role: 'chariot', faceDown: false },
    f10: { color: 'black', role: 'general', faceDown: false },
    i10: { color: 'black', role: 'chariot', faceDown: false },
  });
  const end = play(state, 'a1-a2 i10-i9 a2-a1 i9-i10 a1-a2 i10-i9 a2-a1 i9-i10');
  assert.deepEqual(end.status, { type: 'finished', winner: null, reason: 'repetition' });
  assert.equal(jieqiPerpetualCheckLoser(end), null);
});

test('a one-sided perpetual by red names red', () => {
  // Red's chariot checks along rank 10 and rank 9 while black's general steps.
  const state = enforcing({
    e1: { color: 'red', role: 'general', faceDown: false },
    a8: { color: 'red', role: 'chariot', faceDown: false },
    e10: { color: 'black', role: 'general', faceDown: false },
    i1: { color: 'black', role: 'soldier', faceDown: false },
    e5: { color: 'black', role: 'cannon', faceDown: false },
  });
  // e5 blocks the generals' file; the cannon has no screen toward e1.
  const end = play(state, 'a8-a10 e10-e9 a10-a9 e9-e10 a9-a10 e10-e9 a10-a9 e9-e10 a9-a10');
  assert.deepEqual(end.status, { type: 'finished', winner: null, reason: 'repetition' });
  assert.equal(jieqiPerpetualCheckLoser(end), 'red');
});

test('both sides checking in turn is a draw', () => {
  // The classifier on a cycle where every ply of both sides gave check.
  const a = 'black|A';
  const b = 'red|B';
  const state: JieqiGameState = {
    ...enforcing({}),
    status: { type: 'finished', winner: null, reason: 'repetition' },
    repetitionLog: [
      { key: a },
      { key: b, mover: 'black', gaveCheck: true },
      { key: a, mover: 'red', gaveCheck: true },
      { key: b, mover: 'black', gaveCheck: true },
      { key: a, mover: 'red', gaveCheck: true },
    ],
  };
  assert.equal(jieqiPerpetualCheckLoser(state), null);
  // Same cycle with red's checks dropped: black is the lone perpetual checker.
  const oneSided: JieqiGameState = {
    ...state,
    repetitionLog: state.repetitionLog!.map((entry) =>
      entry.mover === 'red' ? { ...entry, gaveCheck: false } : entry,
    ),
  };
  assert.equal(jieqiPerpetualCheckLoser(oneSided), 'black');
});

test('a capture or a reveal starts a new repetition window', () => {
  const start = createInitialJieqiState('window', EXAMPLE_DEAL, { repetition: true });
  // c4-c5 reveals a dark piece: the window restarts at that position.
  const revealed = applyJieqiMove(start, { from: 'c4', to: 'c5' });
  assert.equal(revealed.repetitionLog?.length, 1);
  assert.deepEqual(Object.values(revealed.positionCounts ?? {}), [1]);
  // A quiet move by a face-up piece extends it.
  const afterOpening = play(start, EXAMPLE_OPENING);
  const quiet = applyJieqiMove(afterOpening, { from: 'b4', to: 'b1' });
  assert.equal(quiet.repetitionLog?.length, (afterOpening.repetitionLog?.length ?? 0) + 1);
});

test('hidden info: repetition state never reaches a player or public view', () => {
  const start = createInitialJieqiState('leak', EXAMPLE_DEAL, { repetition: true });
  const state = play(start, 'c4-c5 c10-e8 c5-c4 e8-c10');
  assert.ok(state.positionCounts, 'the rule is on');
  // The keys spell every dark piece's true role.
  assert.ok(Object.keys(state.positionCounts).some((key) => key.includes('.d')));
  const views = [
    getJieqiPlayerView(state, 'red'),
    getJieqiPlayerView(state, 'black'),
    getJieqiPublicView(state),
  ];
  for (const view of views) {
    const wire = JSON.stringify(view);
    assert.ok(!wire.includes('positionCounts'), 'positionCounts leaked');
    assert.ok(!wire.includes('repetitionLog'), 'repetitionLog leaked');
    for (const key of Object.keys(state.positionCounts)) {
      assert.ok(!wire.includes(key), 'a position key leaked');
    }
    for (const entry of Object.values(view.board)) {
      if (entry?.faceDown) assert.ok(!('role' in entry), 'a face-down role leaked');
    }
  }
});
