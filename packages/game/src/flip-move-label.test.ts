import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  banqiMoveLabel,
  banqiMoveLabelOnBoard,
  jungleFlipMoveLabel,
  jungleFlipMoveLabelOnBoard,
} from './flip-move-label.js';

test('banqi: a board move or capture reads from-to', () => {
  assert.equal(banqiMoveLabel({ from: 'b1', to: 'b2' }, null), 'b1-b2');
});

test('banqi: a flip reads its square and the piece it turned up, never from-to', () => {
  assert.equal(banqiMoveLabel({ from: 'f2', to: 'f2' }, { color: 'red', role: 'cannon' }), 'f2(C)');
  assert.equal(
    banqiMoveLabel({ from: 'f2', to: 'f2' }, { color: 'black', role: 'soldier' }),
    'f2(s)',
  );
  assert.equal(
    banqiMoveLabel({ from: 'a1', to: 'a1' }, { color: 'red', role: 'general' }),
    'a1(G)',
  );
});

test('banqi: a flip whose piece is not known is marked', () => {
  assert.equal(banqiMoveLabel({ from: 'f2', to: 'f2' }, null), 'f2(?)');
});

test('banqi: the flipped piece is read off the board after the move', () => {
  const move = { from: 'f2', to: 'f2' } as const;
  assert.equal(
    banqiMoveLabelOnBoard(move, { f2: { faceDown: false, color: 'black', role: 'horse' } }),
    'f2(h)',
  );
  // A board that still shows the tile face down (or lacks it) names nothing.
  assert.equal(banqiMoveLabelOnBoard(move, { f2: { faceDown: true } }), 'f2(?)');
  assert.equal(banqiMoveLabelOnBoard(move, undefined), 'f2(?)');
});

test('Flip Jungle: moves read from-to and flips name the animal turned up', () => {
  assert.equal(jungleFlipMoveLabel({ from: 'c3', to: 'c4' }, null), 'c3-c4');
  assert.equal(
    jungleFlipMoveLabel({ from: 'c3', to: 'c3' }, { color: 'red', role: 'elephant' }),
    'c3(E)',
  );
  assert.equal(
    jungleFlipMoveLabelOnBoard(
      { from: 'c3', to: 'c3' },
      { c3: { faceDown: false, color: 'black', role: 'leopard' } },
    ),
    'c3(p)',
  );
  assert.equal(jungleFlipMoveLabel({ from: 'c3', to: 'c3' }, null), 'c3(?)');
});
