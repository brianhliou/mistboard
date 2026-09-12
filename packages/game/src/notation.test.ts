import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameEvent } from './events.js';
import { algebraicMoveLabels, moveToAlgebraic } from './notation.js';
import type { GameState, Move } from './types.js';
import { darkChessVariant } from './variants.js';

test('formats quiet pawn moves without coordinate notation', () => {
  const state = {
    ...darkChessVariant.createInitialState('notation-pawn'),
    status: { type: 'playing', turn: 'white' },
  } satisfies GameState;

  assert.equal(moveToAlgebraic(state, { from: 'e2', to: 'e4' }), 'e4');
});

test('formats piece moves and captures in algebraic notation', () => {
  const state = {
    ...darkChessVariant.createInitialState('notation-piece'),
    board: {
      e4: { color: 'white', role: 'knight' },
      f6: { color: 'black', role: 'bishop' },
    },
    status: { type: 'playing', turn: 'white' },
  } satisfies GameState;

  assert.equal(moveToAlgebraic(state, { from: 'e4', to: 'f6' }), 'Nxf6');
});

test('adds disambiguation when two same-color pieces can reach the destination', () => {
  const state = {
    ...darkChessVariant.createInitialState('notation-disambiguation'),
    board: {
      b1: { color: 'white', role: 'knight' },
      d1: { color: 'white', role: 'knight' },
    },
    status: { type: 'playing', turn: 'white' },
  } satisfies GameState;

  assert.equal(moveToAlgebraic(state, { from: 'b1', to: 'c3' }), 'Nbc3');
});

test('formats promotion and en passant captures', () => {
  const promotionState = {
    ...darkChessVariant.createInitialState('notation-promotion'),
    board: {
      e7: { color: 'white', role: 'pawn' },
    },
    status: { type: 'playing', turn: 'white' },
  } satisfies GameState;
  const enPassantState = {
    ...darkChessVariant.createInitialState('notation-en-passant'),
    board: {
      e5: { color: 'white', role: 'pawn' },
      d5: { color: 'black', role: 'pawn' },
    },
    enPassantSquare: 'd6',
    status: { type: 'playing', turn: 'white' },
  } satisfies GameState;

  assert.equal(
    moveToAlgebraic(promotionState, { from: 'e7', to: 'e8', promotion: 'queen' }),
    'e8=Q',
  );
  assert.equal(moveToAlgebraic(enPassantState, { from: 'e5', to: 'd6' }), 'exd6');
});

test('formats castling algebraically', () => {
  const state = {
    ...darkChessVariant.createInitialState('notation-castling'),
    board: {
      e1: { color: 'white', role: 'king' },
      h1: { color: 'white', role: 'rook' },
      a1: { color: 'white', role: 'rook' },
    },
    castlingRights: ['a1', 'h1'],
    status: { type: 'playing', turn: 'white' },
  } satisfies GameState;

  assert.equal(moveToAlgebraic(state, { from: 'e1', to: 'h1' }), 'O-O');
  assert.equal(moveToAlgebraic(state, { from: 'e1', to: 'c1' }), 'O-O-O');
});

test('does not format ordinary king moves to c-file or g-file as castling', () => {
  const state = {
    ...darkChessVariant.createInitialState('notation-king-move'),
    board: {
      b1: { color: 'white', role: 'king' },
    },
    castlingRights: [],
    status: { type: 'playing', turn: 'white' },
  } satisfies GameState;

  assert.equal(moveToAlgebraic(state, { from: 'b1', to: 'c1' }), 'Kc1');
});

test('labels consecutive visible moves after redacted opponent moves', () => {
  const roomId = 'redacted-pve-notation';
  const moves: Move[] = [
    { from: 'e2', to: 'e4' },
    { from: 'g1', to: 'f3' },
    { from: 'b1', to: 'c3' },
    { from: 'f1', to: 'c4' },
    { from: 'd2', to: 'd3' },
    { from: 'e4', to: 'd5' },
    { from: 'd5', to: 'e6' },
    { from: 'e1', to: 'h1' },
    { from: 'f1', to: 'e1' },
  ];
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId, variant: 'dark-chess' },
    ...moves.map((move, index) => ({
      type: 'move-played' as const,
      at: index + 2,
      roomId,
      color: 'white' as const,
      move,
    })),
  ];

  const labels = algebraicMoveLabels(events, roomId);

  assert.equal(labels.get(8), 'dxe6');
  assert.equal(labels.get(9), 'O-O');
  assert.equal(labels.get(10), 'Re1');
});
