import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialXiangqiState, standardXiangqiFen } from '@mistboard/game';
import { STUDY_PREVIEW_PLIES, studyPreviewBoard } from './study-preview-board.js';

const START_FEN = standardXiangqiFen(createInitialXiangqiState('t'));

test('a composition draws its own rootFen, untouched by the mainline', () => {
  const board = studyPreviewBoard({
    variant: 'xiangqi',
    rootFen: '3k5/4a4/3a5/9/9/9/9/3A1K3/9/3C5 r - - 0 1',
    mainline: ['d1d2'],
  });
  assert.deepEqual(board, {
    variant: 'xiangqi',
    fen: '3k5/4a4/3a5/9/9/9/9/3A1K3/9/3C5 r - - 0 1',
  });
});

test('a game from the standard start draws the position after the preview plies', () => {
  // Central cannon vs screen horse, eight plies in; every collection then shows
  // its own opening rather than the shared start array.
  const mainline = ['h3e3', 'h10g8', 'h1g3', 'b10c8', 'i1h1', 'i10h10', 'c4c5', 'g7g6', 'b3b5'];
  const board = studyPreviewBoard({ variant: 'xiangqi', rootFen: null, mainline });
  assert.ok(board?.fen);
  assert.notEqual(board.fen, START_FEN);
  assert.equal(
    board.fen.split(' ')[0],
    'r1bakabr1/9/1cn3nc1/p1p1p3p/6p2/2P6/P3P1P1P/1C2C1N2/9/RNBAKABR1',
  );
  assert.equal(mainline.length, STUDY_PREVIEW_PLIES + 1, 'fixture covers the cut-off');
});

test('replay stops at the first illegal ply and keeps the board reached', () => {
  const board = studyPreviewBoard({
    variant: 'xiangqi',
    rootFen: null,
    mainline: ['h3e3', 'a1a9', 'h10g8'],
  });
  assert.equal(
    board?.fen?.split(' ')[0],
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR',
  );
});

test('an empty mainline from the standard start is the standard start', () => {
  assert.equal(
    studyPreviewBoard({ variant: 'xiangqi', rootFen: null, mainline: [] })?.fen,
    START_FEN,
  );
});

test('an unparseable rootFen is a failure, not a fall-through to the start', () => {
  assert.deepEqual(studyPreviewBoard({ variant: 'xiangqi', rootFen: 'not a fen', mainline: [] }), {
    variant: 'xiangqi',
    fen: null,
  });
});

test('other variants keep their name and get no board', () => {
  assert.deepEqual(studyPreviewBoard({ variant: 'jungle', rootFen: null, mainline: ['a1a2'] }), {
    variant: 'jungle',
    fen: null,
  });
  assert.equal(studyPreviewBoard(null), null);
  assert.equal(studyPreviewBoard({ rootFen: null }), null);
});
