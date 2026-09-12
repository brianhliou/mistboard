import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameState, Move } from './types.js';
import { darkChessVariant, standardChessVariant, variantForId } from './variants.js';

test('variantForId resolves known slugs and throws on anything else', () => {
  assert.equal(variantForId('dark-chess'), darkChessVariant);
  assert.equal(variantForId('chess'), standardChessVariant);
  assert.throws(() => variantForId('fog-of-war' as never), /unknown variant id/);
});

test('Standard chess exposes legal moves once playing', () => {
  const state: GameState = {
    ...standardChessVariant.createInitialState('legal-moves'),
    status: { type: 'playing', turn: 'white' } as const,
  };

  const moves = standardChessVariant.getLegalMoves(state, 'white');
  assert.equal(moves.length, 20);
  assert.ok(moves.some((move) => move.from === 'e2' && move.to === 'e4'));
  assert.equal(standardChessVariant.getLegalMoves(state, 'black').length, 0);
});

test('Standard chess player views carry own candidate moves off-turn', () => {
  const state: GameState = {
    ...standardChessVariant.createInitialState('view-legal-moves'),
    status: { type: 'playing', turn: 'white' } as const,
  };

  const blackView = standardChessVariant.getPlayerView(state, 'black');

  assert.ok(blackView.legalMoves.some((move) => move.from === 'e7' && move.to === 'e5'));
  assert.equal(standardChessVariant.getLegalMoves(state, 'black').length, 0);
});

test('Standard chess applies legal moves through the rules adapter', () => {
  const state = {
    ...standardChessVariant.createInitialState('apply-move'),
    status: { type: 'playing', turn: 'white' } as const,
  };

  const next = standardChessVariant.applyMove(state, { from: 'e2', to: 'e4' });

  assert.equal(next.board.e2, undefined);
  assert.deepEqual(next.board.e4, { color: 'white', role: 'pawn' });
  assert.deepEqual(next.status, { type: 'playing', turn: 'black' });
  assert.deepEqual(next.lastMove, { from: 'e2', to: 'e4' });
});

test('Standard chess rejects illegal moves without changing state', () => {
  const state = {
    ...standardChessVariant.createInitialState('illegal-move'),
    status: { type: 'playing', turn: 'white' } as const,
  };

  assert.equal(standardChessVariant.applyMove(state, { from: 'e2', to: 'e5' }), state);
});

test('Standard chess exposes and applies explicit promotion choices', () => {
  const state: GameState = {
    ...standardChessVariant.createInitialState('promotion'),
    board: {
      a7: { color: 'white', role: 'pawn' },
      e1: { color: 'white', role: 'king' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
  };

  const promotions = standardChessVariant
    .getLegalMoves(state, 'white')
    .filter((move) => move.from === 'a7' && move.to === 'a8')
    .map((move) => move.promotion)
    .sort();

  assert.deepEqual(promotions, ['bishop', 'knight', 'queen', 'rook']);

  const next = standardChessVariant.applyMove(state, { from: 'a7', to: 'a8', promotion: 'knight' });
  assert.equal(next.board.a7, undefined);
  assert.deepEqual(next.board.a8, { color: 'white', role: 'knight' });
});

test('Standard chess applies castling moves represented as king to rook square', () => {
  const state: GameState = {
    ...standardChessVariant.createInitialState('castle'),
    board: {
      e1: { color: 'white', role: 'king' },
      h1: { color: 'white', role: 'rook' },
      e8: { color: 'black', role: 'king' },
      h8: { color: 'black', role: 'rook' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: ['h1', 'h8'],
  };

  const moves = standardChessVariant.getLegalMoves(state, 'white');
  assert.ok(moves.some((move) => move.from === 'e1' && move.to === 'h1'));

  const next = standardChessVariant.applyMove(state, { from: 'e1', to: 'h1' });
  assert.equal(next.board.e1, undefined);
  assert.equal(next.board.h1, undefined);
  assert.deepEqual(next.board.g1, { color: 'white', role: 'king' });
  assert.deepEqual(next.board.f1, { color: 'white', role: 'rook' });
});

test('Standard chess applies castling moves represented as king two squares', () => {
  const state: GameState = {
    ...standardChessVariant.createInitialState('castle-two-squares'),
    board: {
      e1: { color: 'white', role: 'king' },
      h1: { color: 'white', role: 'rook' },
      e8: { color: 'black', role: 'king' },
      h8: { color: 'black', role: 'rook' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: ['h1', 'h8'],
  };

  const moves = standardChessVariant.getLegalMoves(state, 'white');
  assert.ok(moves.some((move) => move.from === 'e1' && move.to === 'g1'));

  const next = standardChessVariant.applyMove(state, { from: 'e1', to: 'g1' });
  assert.equal(next.board.e1, undefined);
  assert.equal(next.board.h1, undefined);
  assert.deepEqual(next.board.g1, { color: 'white', role: 'king' });
  assert.deepEqual(next.board.f1, { color: 'white', role: 'rook' });
});

test('Fog of War view includes own pieces and legal destination squares', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-visibility'),
    board: {
      a1: { color: 'white', role: 'rook' },
      e1: { color: 'white', role: 'king' },
      e2: { color: 'white', role: 'pawn' },
      a4: { color: 'black', role: 'rook' },
      e8: { color: 'black', role: 'king' },
      h8: { color: 'black', role: 'bishop' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
    lastMove: { from: 'h8', to: 'h7' },
  };

  const view = darkChessVariant.getPlayerView(state, 'white');

  assert.deepEqual(view.board.a1, { color: 'white', role: 'rook' });
  assert.deepEqual(view.board.e1, { color: 'white', role: 'king' });
  assert.deepEqual(view.board.e2, { color: 'white', role: 'pawn' });
  assert.deepEqual(view.board.a4, { color: 'black', role: 'rook' });
  assert.equal(view.board.h8, undefined);
  assert.ok(view.visibleSquares.includes('a3'));
  assert.ok(view.visibleSquares.includes('a4'));
  assert.ok(view.visibleSquares.includes('e4'));
  assert.equal(view.lastMove, undefined);
});

test('Fog of War visibility is computed for a player even off-turn', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-off-turn'),
    board: {
      a1: { color: 'white', role: 'rook' },
      e1: { color: 'white', role: 'king' },
      a4: { color: 'black', role: 'rook' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
  };

  const view = darkChessVariant.getPlayerView(state, 'black');

  assert.ok(
    view.legalMoves.some((move) => move.from === 'a4' && move.to === 'a1'),
    'off-turn fog view should still expose the viewer legal test moves',
  );
  assert.deepEqual(view.board.a4, { color: 'black', role: 'rook' });
  assert.deepEqual(view.board.e8, { color: 'black', role: 'king' });
  assert.deepEqual(view.board.a1, { color: 'white', role: 'rook' });
  assert.ok(view.visibleSquares.includes('a1'));
});

test('Fog of War pawn visibility includes forward moves but not empty diagonals', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-pawn-empty-diagonals'),
    board: {
      e1: { color: 'white', role: 'king' },
      e4: { color: 'white', role: 'pawn' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'black' } as const,
    castlingRights: [],
  };

  const view = darkChessVariant.getPlayerView(state, 'white');

  assert.ok(view.visibleSquares.includes('e5'));
  assert.equal(view.visibleSquares.includes('d5'), false);
  assert.equal(view.visibleSquares.includes('f5'), false);
});

test('Fog of War pawn visibility reveals diagonal captures but not direct blockers', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-pawn-captures-blockers'),
    board: {
      e1: { color: 'white', role: 'king' },
      e4: { color: 'white', role: 'pawn' },
      d5: { color: 'black', role: 'knight' },
      e5: { color: 'black', role: 'rook' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'black' } as const,
    castlingRights: [],
  };

  const view = darkChessVariant.getPlayerView(state, 'white');

  assert.ok(view.visibleSquares.includes('d5'));
  assert.deepEqual(view.board.d5, { color: 'black', role: 'knight' });
  assert.equal(view.visibleSquares.includes('e5'), false);
  assert.equal(view.board.e5, undefined);
  assert.equal(view.visibleSquares.includes('f5'), false);
});

test('Fog of War player view exposes own last move after the piece leaves its origin', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-own-last-move'),
    board: {
      e1: { color: 'white', role: 'king' },
      e4: { color: 'white', role: 'pawn' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'black' } as const,
    castlingRights: [],
    lastMove: { from: 'e2', to: 'e4' },
  };

  const view = darkChessVariant.getPlayerView(state, 'white');

  assert.deepEqual(view.lastMove, { from: 'e2', to: 'e4' });
});

test('Fog of War player view exposes own castling last move', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-own-castle-last-move'),
    board: {
      f1: { color: 'white', role: 'rook' },
      g1: { color: 'white', role: 'king' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'black' } as const,
    castlingRights: [],
    lastMove: { from: 'e1', to: 'h1' },
  };

  const view = darkChessVariant.getPlayerView(state, 'white');

  assert.deepEqual(view.lastMove, { from: 'e1', to: 'h1' });
});

test('Fog of War player view does not expose opponent last-move coordinates', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-hidden-opponent-last-move'),
    board: {
      e1: { color: 'white', role: 'king' },
      e4: { color: 'white', role: 'pawn' },
      e8: { color: 'black', role: 'rook' },
      h8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'black' } as const,
    castlingRights: [],
    lastMove: { from: 'e2', to: 'e4' },
  };

  const view = darkChessVariant.getPlayerView(state, 'black');

  assert.deepEqual(view.board.e4, { color: 'white', role: 'pawn' });
  assert.equal(view.lastMove, undefined);
});

test('Fog of War en passant does not leak visibility to the pushing side', () => {
  // Right after white plays b2-b4, enPassantSquare=b3. The pushing side
  // (white) cannot legally capture EP (b3 is on rank 3, white's EP target
  // rank is 6). White pawns at c2/a2 must NOT treat b3 as a capture target.
  // Regression for the bug surfaced by cross-language visibility parity.
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-ep-no-pushing-side-leak'),
    board: {
      a2: { color: 'white', role: 'pawn' },
      b4: { color: 'white', role: 'pawn' },
      c2: { color: 'white', role: 'pawn' },
      e1: { color: 'white', role: 'king' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'black' } as const,
    castlingRights: [],
    enPassantSquare: 'b3',
  };

  const view = darkChessVariant.getPlayerView(state, 'white');

  assert.ok(!view.visibleSquares.includes('b3'));
});

test('Fog of War en passant visibility includes the captured pawn square', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-en-passant-visibility'),
    board: {
      e1: { color: 'white', role: 'king' },
      e5: { color: 'white', role: 'pawn' },
      d5: { color: 'black', role: 'pawn' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
    enPassantSquare: 'd6',
  };

  const view = darkChessVariant.getPlayerView(state, 'white');

  assert.ok(view.visibleSquares.includes('d6'));
  assert.ok(view.visibleSquares.includes('d5'));
  assert.deepEqual(view.board.d5, { color: 'black', role: 'pawn' });
});

test('Fog of War player view serialization does not contain hidden opponent pieces', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-serialization'),
    board: {
      a1: { color: 'white', role: 'rook' },
      e1: { color: 'white', role: 'king' },
      a4: { color: 'black', role: 'rook' },
      e8: { color: 'black', role: 'king' },
      h8: { color: 'black', role: 'queen' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
  };

  const payload = JSON.stringify(darkChessVariant.getPlayerView(state, 'white'));

  assert.match(payload, /"a4"/);
  assert.doesNotMatch(payload, /"h8"/);
  assert.doesNotMatch(payload, /queen/);
});

test('Fog of War legal moves ignore check constraints', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-no-check'),
    board: {
      e1: { color: 'white', role: 'king' },
      e8: { color: 'black', role: 'rook' },
      h8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
  };

  const moves = darkChessVariant.getLegalMoves(state, 'white');
  assert.ok(moves.some((move) => move.from === 'e1' && move.to === 'e2'));
  assert.ok(
    darkChessVariant
      .getPlayerView(state, 'white')
      .legalMoves.some((move) => move.from === 'e1' && move.to === 'e2'),
  );

  const next = darkChessVariant.applyMove(state, { from: 'e1', to: 'e2' });
  assert.deepEqual(next.board.e2, { color: 'white', role: 'king' });
  assert.deepEqual(next.status, { type: 'playing', turn: 'black' });
});

test('Fog of War ends when a king is captured', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-king-capture'),
    board: {
      e1: { color: 'white', role: 'king' },
      e2: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
  };

  const moves = darkChessVariant.getLegalMoves(state, 'white');
  assert.ok(moves.some((move) => move.from === 'e1' && move.to === 'e2'));

  const next = darkChessVariant.applyMove(state, { from: 'e1', to: 'e2' });
  assert.deepEqual(next.board.e2, { color: 'white', role: 'king' });
  assert.deepEqual(next.status, { type: 'finished', winner: 'white', reason: 'king-captured' });
});

test('Fog of War vision survives king capture (finished status)', () => {
  // After a king is captured, fogVisibleSquares must still iterate piece
  // moves so each side keeps the vision it had while playing. Otherwise the
  // captured side's view collapses to its own piece squares (a single square
  // here) and any postgame render — replays, articles — would "lose" sight.
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-vision-after-capture'),
    board: {
      e1: { color: 'white', role: 'king' },
      e2: { color: 'black', role: 'king' },
      a1: { color: 'white', role: 'rook' }, // rook sees the a-file + rank 1
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
  };

  const next = darkChessVariant.applyMove(state, { from: 'e1', to: 'e2' });
  assert.equal(next.status.type, 'finished');

  // The losing side (black) lost its only piece — visibility is empty,
  // which is correct (nothing left to see from).
  const blackView = darkChessVariant.getPlayerView(next, 'black');
  assert.deepEqual(blackView.visibleSquares, []);

  // The winning side (white) still has pieces. Vision must include rook
  // sight lines, not just own-piece squares.
  const whiteView = darkChessVariant.getPlayerView(next, 'white');
  assert.ok(whiteView.visibleSquares.includes('a8'), 'rook should still see up the a-file');
  assert.ok(whiteView.visibleSquares.includes('h1'), 'rook should still see along rank 1');
  assert.ok(whiteView.visibleSquares.includes('e2'), 'king should still see e2');
});

test('Fog of War draws on the 50-move rule', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-fifty-move'),
    board: {
      e1: { color: 'white', role: 'king' },
      b1: { color: 'white', role: 'knight' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
    halfmoveClock: 99,
  };

  const next = darkChessVariant.applyMove(state, { from: 'b1', to: 'c3' });
  assert.deepEqual(next.status, { type: 'finished', winner: null, reason: 'draw' });
  assert.equal(next.halfmoveClock, 100);
});

test('Fog of War draws on threefold repetition', () => {
  let state: GameState = {
    ...darkChessVariant.createInitialState('fog-threefold'),
    board: {
      e1: { color: 'white', role: 'king' },
      g1: { color: 'white', role: 'knight' },
      e8: { color: 'black', role: 'king' },
      g8: { color: 'black', role: 'knight' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
  };

  for (const move of [
    { from: 'g1', to: 'f3' },
    { from: 'g8', to: 'f6' },
    { from: 'f3', to: 'g1' },
    { from: 'f6', to: 'g8' },
    { from: 'g1', to: 'f3' },
    { from: 'g8', to: 'f6' },
    { from: 'f3', to: 'g1' },
  ] satisfies Move[]) {
    state = darkChessVariant.applyMove(state, move);
    assert.equal(state.status.type, 'playing');
  }

  const repeated = darkChessVariant.applyMove(state, { from: 'f6', to: 'g8' });
  assert.deepEqual(repeated.status, { type: 'finished', winner: null, reason: 'draw' });
});

test('Fog of War castling ignores attacked transit and destination squares', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-castle-through-check'),
    board: {
      e1: { color: 'white', role: 'king' },
      h1: { color: 'white', role: 'rook' },
      f8: { color: 'black', role: 'rook' },
      g8: { color: 'black', role: 'bishop' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: ['h1'],
  };

  const moves = darkChessVariant.getLegalMoves(state, 'white');
  assert.ok(moves.some((move) => move.from === 'e1' && move.to === 'h1'));
  assert.equal(
    moves.some((move) => move.from === 'e1' && move.to === 'g1'),
    false,
  );

  const next = darkChessVariant.applyMove(state, { from: 'e1', to: 'g1' });
  assert.equal(next.board.e1, undefined);
  assert.equal(next.board.h1, undefined);
  assert.deepEqual(next.board.g1, { color: 'white', role: 'king' });
  assert.deepEqual(next.board.f1, { color: 'white', role: 'rook' });
  assert.deepEqual(next.lastMove, { from: 'e1', to: 'h1' });
});

test('Fog of War castling supports Chess960-shaped king and rook starts', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-chess960-castle'),
    board: {
      b1: { color: 'white', role: 'king' },
      c1: { color: 'white', role: 'rook' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: ['c1'],
  };

  const moves = darkChessVariant.getLegalMoves(state, 'white');
  assert.ok(moves.some((move) => move.from === 'b1' && move.to === 'c1'));
  assert.equal(
    moves.some((move) => move.from === 'b1' && move.to === 'g1'),
    false,
  );

  const next = darkChessVariant.applyMove(state, { from: 'b1', to: 'g1' });
  assert.equal(next.board.b1, undefined);
  assert.equal(next.board.c1, undefined);
  assert.deepEqual(next.board.g1, { color: 'white', role: 'king' });
  assert.deepEqual(next.board.f1, { color: 'white', role: 'rook' });
  assert.deepEqual(next.lastMove, { from: 'b1', to: 'c1' });
});

test('Fog of War castling rejects occupied Chess960 final squares', () => {
  const kingDestinationBlocked: GameState = {
    ...darkChessVariant.createInitialState('fog-chess960-castle-king-blocked'),
    board: {
      b1: { color: 'white', role: 'king' },
      c1: { color: 'white', role: 'rook' },
      e8: { color: 'black', role: 'king' },
      g1: { color: 'white', role: 'knight' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: ['c1'],
  };
  const rookDestinationBlocked: GameState = {
    ...kingDestinationBlocked,
    id: 'fog-chess960-castle-rook-blocked',
    board: {
      b1: { color: 'white', role: 'king' },
      c1: { color: 'white', role: 'rook' },
      e8: { color: 'black', role: 'king' },
      f1: { color: 'white', role: 'knight' },
    },
  };

  for (const state of [kingDestinationBlocked, rookDestinationBlocked]) {
    const moves = darkChessVariant.getLegalMoves(state, 'white');
    assert.equal(
      moves.some((move) => move.from === 'b1' && move.to === 'c1'),
      false,
    );
    assert.equal(
      moves.some((move) => move.from === 'b1' && move.to === 'g1'),
      false,
    );
    assert.equal(darkChessVariant.applyMove(state, { from: 'b1', to: 'g1' }), state);
  }
  assert.equal(
    darkChessVariant.getPlayerView(rookDestinationBlocked, 'white').visibleSquares.includes('g1'),
    false,
  );
});

test('Fog of War applies en passant captures', () => {
  const state: GameState = {
    ...darkChessVariant.createInitialState('fog-en-passant-apply'),
    board: {
      e1: { color: 'white', role: 'king' },
      e5: { color: 'white', role: 'pawn' },
      d5: { color: 'black', role: 'pawn' },
      e8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
    enPassantSquare: 'd6',
  };

  const moves = darkChessVariant.getLegalMoves(state, 'white');
  assert.ok(moves.some((move) => move.from === 'e5' && move.to === 'd6'));

  const next = darkChessVariant.applyMove(state, { from: 'e5', to: 'd6' });
  assert.equal(next.board.e5, undefined);
  assert.equal(next.board.d5, undefined);
  assert.deepEqual(next.board.d6, { color: 'white', role: 'pawn' });
  assert.deepEqual(next.status, { type: 'playing', turn: 'black' });
});
