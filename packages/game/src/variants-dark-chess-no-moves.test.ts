import assert from 'node:assert/strict';
import test from 'node:test';
import { type GameEvent, replayGameEvents } from './events.js';
import type { GameState, Move, PieceRole } from './types.js';
import { darkChessFen, darkChessVariant, parseDarkChessFen } from './variants.js';

// Sven's post in hgm's 2011 Dark Chess thread (TalkChess t=37571), a game by Uri
// Blass: legal under fog, and after 32. Qc2 Black has no pseudo-legal move at
// all. Decided 2026-09-30: a side with no moves at all draws.
// 1. b3 e5 2. b4 Bxb4 3. Nf3 Bf8 4. Nxe5 b5 5. Nxf7 b4 6. Nxh8 b3 7. a4 a6
// 8. a5 h5 9. Ba3 b2 10. Ra2 h4 11. Nc3 b1=B 12. Ra1 Ba2 13. g3 hxg3 14. e4 gxf2+
// 15. Kxf2 g6 16. Nxg6 Ne7 17. Nxe7 Bxe7 18. Bxe7 Qxe7 19. e5 Qxe5 20. d3 Qxc3
// 21. Bg2 Ke7 22. Qe1+ Kd6 23. Qxc3 Bd5 24. Qd2 Kc6 25. d4 Kb7 26. Bh3 Ra7
// 27. c4 Ka8 28. Rad1 Bdb7 29. d5 Bc6 30. d6 B6b7 31. c5 c6 32. Qc2
const SVEN_NO_MOVES_UCI =
  'b2b3 e7e5 b3b4 f8b4 g1f3 b4f8 f3e5 b7b5 e5f7 b5b4 f7h8 b4b3 a2a4 a7a6 a4a5 h7h5 ' +
  'c1a3 b3b2 a1a2 h5h4 b1c3 b2b1b a2a1 b1a2 g2g3 h4g3 e2e4 g3f2 e1f2 g7g6 h8g6 g8e7 ' +
  'g6e7 f8e7 a3e7 d8e7 e4e5 e7e5 d2d3 e5c3 f1g2 e8e7 d1e1 e7d6 e1c3 a2d5 c3d2 d6c6 ' +
  'd3d4 c6b7 g2h3 a8a7 c2c4 b7a8 a1d1 d5b7 d4d5 b7c6 d5d6 c6b7 c4c5 c7c6 d2c2';
const SVEN_FINAL_FEN = 'knb5/rb1p4/p1pP4/P1P5/8/7B/2Q2K1P/3R3R b - - 1 32';

const PROMOTION: Record<string, Exclude<PieceRole, 'king' | 'pawn'>> = {
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
};

function uciMove(uci: string): Move {
  const move: Move = { from: uci.slice(0, 2) as Move['from'], to: uci.slice(2, 4) as Move['to'] };
  const promotion = uci[4];
  return promotion ? { ...move, promotion: PROMOTION[promotion]! } : move;
}

const SVEN_MOVES = SVEN_NO_MOVES_UCI.split(' ').map(uciMove);

test("Sven's game: black has no moves after 32. Qc2, and the game ends as a draw at ply 63", () => {
  assert.equal(SVEN_MOVES.length, 63);
  let state: GameState = darkChessVariant.createInitialState('sven-no-moves');
  SVEN_MOVES.forEach((move, index) => {
    assert.equal(state.status.type, 'playing', `ply ${index + 1} played into a finished game`);
    const next = darkChessVariant.applyMove(state, move);
    assert.notEqual(next, state, `ply ${index + 1} (${move.from}${move.to}) was rejected`);
    state = next;
  });

  assert.deepEqual(state.status, { type: 'finished', winner: null, reason: 'no-legal-moves' });
  assert.equal(darkChessFen(state).split(' ')[0], SVEN_FINAL_FEN.split(' ')[0]);
  // Once finished, nobody has moves and further moves are ignored.
  assert.deepEqual(darkChessVariant.getLegalMoves(state, 'black'), []);
  assert.equal(darkChessVariant.applyMove(state, { from: 'a8', to: 'b8' }), state);
});

test("Sven's game through the event log projects the same no-moves draw", () => {
  const roomId = 'sven-no-moves-events';
  const events: GameEvent[] = [
    { type: 'room-created', at: 0, roomId, variant: 'dark-chess' },
    { type: 'seat-assigned', at: 0, roomId, clientId: 'white-client', seat: 'white' },
    { type: 'seat-assigned', at: 0, roomId, clientId: 'black-client', seat: 'black' },
    ...SVEN_MOVES.map(
      (move, index): GameEvent => ({
        type: 'move-played',
        at: index + 1,
        roomId,
        color: index % 2 === 0 ? 'white' : 'black',
        move,
      }),
    ),
  ];
  const projection = replayGameEvents(events);
  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: null,
    reason: 'no-legal-moves',
  });
});

test("Sven's final position has zero pseudo-legal moves for black", () => {
  // FEN import does not adjudicate, so the loaded position is still "playing";
  // the same FEN is the engine-side agreement fixture (mistboard-engine).
  const parsed = parseDarkChessFen(SVEN_FINAL_FEN);
  assert.ok(parsed.ok);
  assert.deepEqual(darkChessVariant.getLegalMoves(parsed.state, 'black'), []);
});

test('Fog of War: a side whose every move walks into attack still has to move', () => {
  // Black king a8 boxed by a white queen on c7: every king step is covered, but
  // moves exist, so the game goes on (no stalemate draw).
  const parsed = parseDarkChessFen('k7/2Q5/8/8/8/8/8/4K3 w - - 0 1');
  assert.ok(parsed.ok);
  const next = darkChessVariant.applyMove(parsed.state, { from: 'e1', to: 'e2' });
  assert.deepEqual(next.status, { type: 'playing', turn: 'black' });
  assert.ok(darkChessVariant.getLegalMoves(next, 'black').length > 0);
});
