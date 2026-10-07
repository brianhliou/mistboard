import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  endgameEntryEngineFen,
  endgameEntryState,
  endgameGradeVerdict,
  endgameHubEntry,
  endgameHubPositionIds,
  endgamePracticeSetup,
  getStandardXiangqiLegalMoves,
  isStandardXiangqiGeneralInCheck,
  isStandardXiangqiLegalMove,
  XIANGQI_ENDGAME_HUB,
  XIANGQI_ENDGAME_HUB_CHECKS,
  type XiangqiSquare,
} from './index.js';

// Every verdict the 象棋残局 page prints is a claim a reader can play out, so
// each one is held to the committed checks file: the grade's result for the
// row's own position must be what the tablebase said, and a win's line must
// replay through our kernel to a Red mate. A position with no check fails here.

const SQUARES = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;

function checkFor(id: string) {
  const rows = XIANGQI_ENDGAME_HUB_CHECKS.filter((row) => row.id === id);
  assert.equal(rows.length, 1, `${id} should have exactly one check row`);
  return rows[0]!;
}

/** The check's result from Red's side (it is written from the side to move). */
function redResult(id: string): 'win' | 'draw' | 'loss' {
  const entry = endgameHubEntry(id);
  const { result } = checkFor(id);
  if (entry.turn === 'red' || result === 'draw') return result;
  return result === 'win' ? 'loss' : 'win';
}

test('every hub row is a Red-to-move corpus position whose grade matches its verdict', () => {
  for (const row of XIANGQI_ENDGAME_HUB) {
    const entry = endgameHubEntry(row.id);
    assert.equal(entry.turn, 'red', `${row.id} should be Red to move`);
    assert.equal(entry.verdict, endgameGradeVerdict(row.grade), `${row.id} grade vs verdict`);
  }
});

test('a contrast position has the opposite result to its row', () => {
  for (const row of XIANGQI_ENDGAME_HUB) {
    for (const id of row.contrasts ?? []) {
      assert.notEqual(endgameHubEntry(id).verdict, endgameHubEntry(row.id).verdict, id);
    }
  }
});

test('hub positions are unique and every one has a check on the exact FEN', () => {
  const ids = endgameHubPositionIds();
  assert.equal(new Set(ids).size, ids.length, 'a position appears twice on the page');
  for (const id of ids) {
    assert.equal(checkFor(id).fen, endgameEntryEngineFen(endgameHubEntry(id)), `${id} fen drifted`);
  }
  const orphans = XIANGQI_ENDGAME_HUB_CHECKS.filter((row) => !ids.includes(row.id));
  assert.deepEqual(
    orphans.map((row) => row.id),
    [],
  );
});

test('every check agrees with the verdict the page prints', () => {
  for (const id of endgameHubPositionIds()) {
    const expected = endgameHubEntry(id).verdict;
    assert.equal(
      redResult(id),
      expected,
      `${id}: page says ${expected}, check says ${redResult(id)}`,
    );
  }
});

test("a win's line replays through the kernel to a Red mate", () => {
  for (const id of endgameHubPositionIds()) {
    const entry = endgameHubEntry(id);
    if (entry.verdict !== 'win') continue;
    let state = endgameEntryState(entry);
    for (const token of checkFor(id).pv) {
      const match = SQUARES.exec(token);
      assert.ok(match, `${id}: unreadable move ${token}`);
      const move = { from: match[1] as XiangqiSquare, to: match[2] as XiangqiSquare };
      assert.ok(isStandardXiangqiLegalMove(state, move), `${id}: ${token} is illegal here`);
      state = applyStandardXiangqiMove(state, move);
    }
    assert.equal(state.status.type, 'finished', `${id}: the line stops before the end`);
    assert.equal(
      state.status.type === 'finished' && state.status.winner,
      'red',
      `${id}: the line does not end in a Red win`,
    );
  }
});

test('every position is playable: moves exist and the side not to move is not in check', () => {
  for (const id of endgameHubPositionIds()) {
    const state = endgameEntryState(endgameHubEntry(id));
    assert.ok(getStandardXiangqiLegalMoves(state).length > 0, `${id} has no legal move`);
    assert.equal(isStandardXiangqiGeneralInCheck(state, 'black'), false, `${id}: Black in check`);
  }
});

test('practice setup: a win is played as Red to mate, a draw as Black to hold', () => {
  for (const id of endgameHubPositionIds()) {
    const entry = endgameHubEntry(id);
    const setup = endgamePracticeSetup(entry);
    assert.deepEqual(
      setup,
      entry.verdict === 'win' ? { side: 'red', goal: 'mate' } : { side: 'black', goal: 'draw' },
    );
  }
});
