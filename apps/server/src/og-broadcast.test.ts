import assert from 'node:assert/strict';
import test from 'node:test';
import type { XiangqiMove } from '@mistboard/game';
import { broadcastFinalFen, broadcastOutcome } from './og-broadcast.js';

const OPENING = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r';

test('the card position is the last one that replays, from the opening', () => {
  assert.ok(broadcastFinalFen([]).startsWith(OPENING));
  // 炮二平五: the cannon on the centre file, Black to move.
  const after = broadcastFinalFen([{ from: 'h3', to: 'e3' } as XiangqiMove]);
  assert.ok(after.startsWith('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b'));
  // A move the rules refuse stops the replay rather than inventing a board.
  const stuck = broadcastFinalFen([
    { from: 'h3', to: 'e3' } as XiangqiMove,
    { from: 'a1', to: 'a9' } as XiangqiMove,
  ]);
  assert.equal(stuck, after);
});

test('the description names the winner and the length in moves', () => {
  const board = (result: string, plies: number) => ({
    red: { name: '曹岩磊', nameEn: 'Cao Yanlei' },
    black: { name: '赖理兄', nameEn: 'Lai Lixiong' },
    result,
    moves: Array.from({ length: plies }),
  });
  assert.equal(broadcastOutcome(board('1-0', 65)), 'Cao Yanlei won with Red in 33 moves');
  assert.equal(broadcastOutcome(board('0-1', 2)), 'Lai Lixiong won with Black in 1 move');
  assert.equal(broadcastOutcome(board('1/2-1/2', 111)), 'Drawn in 56 moves');
  assert.equal(broadcastOutcome(board('*', 10)), 'In play, 5 moves so far');
});
